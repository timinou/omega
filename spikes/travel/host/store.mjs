// Resource-level state shared by every travel view mount: service data, busy flags, drafts, messages.
import { api, PRESETS } from './util.mjs';
export function createStore(owner, notify) {
  const s = { data: null, loadError: null, loading: false, busy: { discover: false, all: false, refresh: new Set(), trip: false, inspect: null }, msg: null,
    drafts: {}, query: '', discover: null, tripDraft: null, tripDirty: false, tripErrors: [], addUrl: '', browser: null, tick: Date.now() };
  const say = (kind, text) => { s.msg = text ? { kind, text, at: Date.now() } : null; notify(); };
  async function load() {
    s.loading = true; notify();
    const r = await api('/state');
    s.loading = false;
    if (r.ok) { s.data = r; s.loadError = null; if (!s.tripDirty) s.tripDraft = null; } else s.loadError = r.message || 'Could not load the desk';
    notify(); return r;
  }
  async function act(fn, { ok } = {}) { const r = await fn(); if (r.ok === false) say('err', r.message || (r.errors || []).join('; ') || 'That did not work'); else if (ok) say('ok', typeof ok === 'function' ? ok(r) : ok); await load(); return r; }
  return {
    s, load, say,
    discover: async (query, force = false) => {
      query = String(query || '').trim(); if (!query) return say('err', 'Type what to look for, or choose a preset.');
      s.busy.discover = true; s.discover = { query, state: 'loading' }; say(null); notify();
      const r = await api('/discover', { query, force }, { timeout: 150000 });
      s.busy.discover = false;
      if (r.ok) { s.discover = { query, state: 'done', count: r.count, added: r.added, cache: r.cache, model: r.model, answer: r.modelAnswer }; say('ok', `${r.count} sources returned (${r.added} candidate links, ${r.cache === 'hit' ? 'from cache' : 'live search'}). Search summaries are not evidence.`); }
      else { s.discover = { query, state: 'error', error: r.message || 'Search failed' }; say('err', 'Search failed: ' + s.discover.error + ' Your query is kept; try again.'); }
      await load(); return r;
    },
    refresh: async (id, force) => {
      s.busy.refresh.add(id); notify();
      const r = await api('/refresh', { id, force }, { timeout: 60000 }); s.busy.refresh.delete(id);
      if (r.ok === false) say('err', r.message || 'Refresh failed'); else say('ok', force ? 'Forced a fresh fetch.' : r.cache === 'hit' ? 'Source checked recently; kept cached read (use Force for a fresh fetch).' : 'Source refreshed.');
      await load();
    },
    refreshAll: async (force) => {
      s.busy.all = true; notify();
      const r = await api('/refresh', { force }, { timeout: 120000 }); s.busy.all = false;
      if (r.ok === false) say('err', r.message || 'Refresh failed'); else say('ok', `Checked ${r.count} sources${force ? ' (forced)' : ' (recent reads reused)'}.`);
      await load();
    },
    shortlist: (id, on) => act(() => api('/shortlist', { id, on })),
    note: (id, text) => act(() => api('/note', { id, text }), { ok: 'Note saved.' }),
    evidence: async (id, value, excerpt) => { const r = await api('/evidence', { id, value: Number(value), excerpt }); if (r.ok === false) { s.drafts['ev-error'] = r.error || r.message; notify(); return r; } delete s.drafts['ev-error']; delete s.drafts['ev-value']; delete s.drafts['ev-excerpt']; say('ok', 'Evidence saved as user-provided.'); await load(); return r; },
    kind: (id, kind) => act(() => api('/kind', { id, kind })),
    location: (id, status) => act(() => api('/location', { id, status })),
    check: (id, key, on) => act(() => api('/check', { id, key, on })),
    addUrl: async (url) => { const r = await api('/add-url', { url }); if (r.ok === false) return say('err', r.message || 'Not a public http(s) URL'); s.addUrl = ''; say('ok', 'Added as a candidate. Refresh or inspect it.'); await load(); return r; },
    saveTrip: async (patch) => {
      s.busy.trip = true; notify(); const r = await api('/trip', { patch }); s.busy.trip = false;
      if (r.ok) { s.tripDirty = false; s.tripDraft = null; s.tripErrors = []; say('ok', 'Trip saved. Capacity checks now use ' + r.trip.totalGuests + ' guests.'); } else { s.tripErrors = r.errors || [r.message || 'Could not save']; say('err', 'Not saved: fix the highlighted problems.'); }
      await load(); return r;
    },
  };
}
export { PRESETS };
