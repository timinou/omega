// Package host for the travel desk: one resource per page (store + owned browser session).
// BL emits models and {:kind :package-host :package "travel" :op …} effects; only this module does IO.
import { css } from './css.mjs';
import { esc, PRESETS, api } from './util.mjs';
import { createStore } from './store.mjs';
import { strip, nav, discover, shortlist, compare, notes, tripForm } from './tabs.mjs';
import { detail } from './cards.mjs';

const rnd = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => (b % 36).toString(36)).join('');
const parseAges = (s) => String(s).split(/[,\s]+/).filter(Boolean).map(Number);
function applyTrip(t, key, v) {
  const m = /^g\.(\d+)\.(\w+)$/.exec(key);
  if (m) { const g = t.groups[+m[1]]; if (m[2] === 'ages') g.childAges = parseAges(v); else if (m[2] === 'label') g.label = v; else g[m[2]] = v === '' ? NaN : Number(v); return; }
  if (key === 'nights') t.nightsOptions = String(v).split(/[,\s]+/).filter(Boolean).map(Number);
  else if (key === 'adults' || key === 'children') t[key] = v === '' ? NaN : Number(v);
  else if (key === 'unlimited') t.budget = v ? { unlimited: true, max: null, currency: null } : { unlimited: false, max: t.budget.max, currency: t.budget.currency };
  else if (key === 'bmax') t.budget.max = v === '' ? null : Number(v);
  else if (key === 'bcur') t.budget.currency = String(v).toUpperCase();
  else t[key] = v;
  t.totalGuests = (Number.isFinite(t.adults) ? t.adults : 0) + (Number.isFinite(t.children) ? t.children : 0);
}
export function createHost(api0) {
  const owner = rnd(); let disposed = false, timer = null; const views = new Set(); let inspectSession = null;
  const notify = () => { if (disposed) return; for (const v of views) v.schedule(); };
  const store = createStore(owner, notify);
  const ask = (type, extra = {}) => { // only live (still mounted) views can answer; drop stale ones left by a layout switch
    for (const v of [...views]) { if (v.root && !v.root.isConnected) { v.dispose(); continue; } if (v.dispatch) return v.dispatch({ type, ...extra }); } };
  async function inspect(id) {
    store.s.busy.inspect = id; notify();
    const r = await api('/inspect', { owner, id }, { timeout: 90000 });
    store.s.busy.inspect = null;
    if (r.ok) { inspectSession = r.session; ask('travel/inspected', { session: r.session, listing: id, url: r.url, title: r.title }); store.say('ok', 'Opened in the browser panel. Navigate freely; the panel is a real browser.'); }
    else { ask('travel/inspect-failed', { message: r.message }); store.say('err', 'Could not open the browser: ' + (r.message || 'unknown error') + ' Use Open link to view it in your own tab.'); }
    notify();
  }
  async function release() { if (!inspectSession) return; inspectSession = null; await api('/release', { owner }, { timeout: 30000 }); }
  const resource = {
    async effect(e) {
      if (e.op === 'inspect') return inspect(e.listing);
      if (e.op === 'release-session') return release();
      if (e.op === 'refresh') { if (e.scope === 'all') return store.refreshAll(!!e.force); if (e.listing) return store.refresh(e.listing, !!e.force); return store.say('err', 'Select a listing first.'); }
      if (e.op === 'focus-search') { setTimeout(() => document.querySelector('.travel #tv-q')?.focus(), 30); }
    },
    mount(root, dispatch) {
      return mountView(root, dispatch);
    },
    dispose() {
      disposed = true; clearInterval(timer);
      if (inspectSession) { fetch('/travel/api/release', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ owner }) }).catch(() => {}); inspectSession = null; }
      for (const v of [...views]) v.dispose(); views.clear();
    },
  };
  function mountView(root, dispatch) {
    const style = document.createElement('style'); style.dataset.travel = ''; style.textContent = css;
    const wrap = document.createElement('div'); root.append(style, wrap);
    let model = null, role = null, frame = null, raf = 0, bState = null, bTimer = null, bMsg = '', lastInspectUrl = null;
    const view = { dispatch, root, schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); }, dispose() { cancelAnimationFrame(raf); clearInterval(bTimer); style.remove(); wrap.remove(); views.delete(view); } };
    views.add(view);
    if (!timer) { timer = setInterval(() => { if (!disposed && !document.hidden && !store.s.loading && !store.s.busy.all && !store.s.tripDirty && !wrap.contains(document.activeElement)) store.load(); }, 20000); }
    if (!store.s.data && !store.s.loading) store.load();
    const select = (field, value) => dispatch({ type: 'travel/select', field, value });
    const st = () => model?.state || {};
    function drawDesk() {
      wrap.className = 'travel';
      const s = store.s, state = st();
      if (!s.data) { wrap.innerHTML = `<div class="tv-head"><div class="tv-eyebrow">Essaouira · group stay</div><h1>Travel desk</h1></div><main class="tv-body single"><div class="tv-main">${s.loadError ? `<div class="tv-err" role="alert">${esc(s.loadError)} <button data-act="reload">Retry</button></div>` : '<div class="tv-ok tv-busy" role="status">Loading the desk…</div>'}</div></main>`; return; }
      const tab = state.tab || 'discover', d = s.data, cmp = (state.compare || []).filter((id) => d.listings.some((l) => l.id === id));
      const ctx = { selected: state.selected, compare: cmp, now: Date.parse(d.now) || Date.now() };
      const counts = { props: d.listings.filter((l) => l.kind === 'property' && l.location.status !== 'outside').length, short: d.listings.filter((l) => l.shortlisted).length, cmp: cmp.length || null };
      const sel = d.listings.find((l) => l.id === state.selected);
      const body = { discover, shortlist, compare, notes, trip: tripForm }[tab]?.(store, ctx) || discover(store, ctx);
      const side = (tab === 'discover' || tab === 'shortlist') ? `<aside class="tv-side" aria-label="Selected candidate">${detail(sel, { busy: s.busy, forms: s.drafts, now: ctx.now })}</aside>` : '';
      const research = s.researchOpen ? `<section class="tv-form"><form data-form="research"><label>Question for an Omega research task<textarea data-draft="question" placeholder="e.g. Which Essaouira riads can host 20 for exclusive use and how are they heated?">${esc(s.drafts.question || '')}</textarea></label><div class="tv-actions"><button class="primary" type="submit">Start research task</button><button type="button" data-act="research-close">Cancel</button></div><p class="tv-note">Opens an Omega task with this desk's shortlist as context. It reads and cites only; it never contacts, books or pays. In an offline world (bl-ed --offline, as in the isolated launcher) the task answers with a scripted demo, not live research; Search and listing reads above are real.</p></form></section>` : '';
      wrap.innerHTML = `<header class="tv-head"><div class="tv-eyebrow">Essaouira · private group stay · draft planning only</div><h1>Where will twenty of us sleep?</h1>${strip(d.trip)}</header>${nav(tab, counts, store)}<main class="tv-body ${side ? '' : 'single'}"><div class="tv-main">${research}${body}</div>${side}</main><footer class="tv-foot">Candidates come from live web search and pages you add; source text is quoted, never summarised into facts. “Page read” means the link works, not that dates, price or capacity are confirmed. Keys: space t d / s / c / p / n · / search · r refresh · i inspect · x close browser.</footer>`;
    }
    async function pollBrowser() {
      const i = st().inspect || model?.inspect; if (!i) return;
      const r = await api('/session', { owner }); if (r.ok) { bState = r.state; paintBar(); }
    }
    function paintBar() { const a = wrap.querySelector('.bar a'); if (a && bState?.url) a.href = bState.url; const u = wrap.querySelector('.where'); if (u && bState) { u.textContent = (bState.title ? bState.title + ' · ' : '') + (bState.url || ''); u.title = bState.url || ''; } const m = wrap.querySelector('.msg'); if (m) m.textContent = bMsg; }
    function drawBrowser() {
      const i = st().inspect || model?.inspect;
      wrap.className = 'travel-browser';
      if (!i) { frame = null; wrap.innerHTML = '<div class="empty"><h3>No listing open</h3><p>Choose “Inspect listing” on a candidate. The real browser opens here.</p></div>'; return; }
      if (frame?.dataset.session === i.session) {
        // same owned session re-pointed at another listing: take the new listing's metadata until the live poll answers
        if (i.url && i.url !== lastInspectUrl) { lastInspectUrl = i.url; bState = { ...(bState || {}), url: i.url, title: i.title || null }; frame.title = 'Browser inspecting ' + (i.title || i.url); pollBrowser(); }
        paintBar(); return;
      }
      lastInspectUrl = i.url;
      wrap.innerHTML = `<div class="bar"><button data-b="back" aria-label="Back">← Back</button><button data-b="forward" aria-label="Forward">Forward →</button><button data-b="reload">Reload</button><span class="where" aria-live="polite">${esc(i.url)}</span><a href="${esc(i.url)}" target="_blank" rel="noopener noreferrer" style="color:#0f6f73">Open link ↗</a><button data-b="close">Close browser</button></div><div class="msg" role="alert"></div><iframe title="Browser inspecting ${esc(i.title || i.url)}" data-session="${esc(i.session)}" src="/browser/view/${encodeURIComponent(i.session)}" allow="clipboard-read; clipboard-write; fullscreen"></iframe>`;
      frame = wrap.querySelector('iframe'); clearInterval(bTimer); bTimer = setInterval(pollBrowser, 3000); pollBrowser();
    }
    function draw() {
      if (!model) return;
      const keep = document.activeElement && wrap.contains(document.activeElement) ? document.activeElement : null;
      const sig = keep && (keep.dataset.draft ? '[data-draft="' + CSS.escape(keep.dataset.draft) + '"]' : keep.dataset.trip ? '[data-trip="' + CSS.escape(keep.dataset.trip) + '"]' : null);
      const sel = sig && keep.selectionStart != null ? [keep.selectionStart, keep.selectionEnd] : null, top = wrap.scrollTop;
      if (role === 'browser') drawBrowser(); else drawDesk();
      wrap.scrollTop = top;
      if (sig) { const el = wrap.querySelector(sig); if (el) { el.focus({ preventScroll: true }); try { if (sel) el.setSelectionRange(...sel); } catch {} } }
    }
    wrap.addEventListener('input', (e) => {
      const t = e.target;
      if (t.dataset.draft === 'query') store.s.query = t.value; else if (t.dataset.draft === 'addUrl') store.s.addUrl = t.value;
      else if (t.dataset.draft) store.s.drafts[t.dataset.draft] = t.value;
      else if (t.dataset.trip && t.type !== 'checkbox') { store.s.tripDraft ||= structuredClone(store.s.data.trip); applyTrip(store.s.tripDraft, t.dataset.trip, t.value); store.s.tripDirty = true; wrap.querySelector('[readonly]') && (wrap.querySelector('[readonly]').value = store.s.tripDraft.totalGuests); }
    });
    wrap.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.trip && t.type === 'checkbox') { store.s.tripDraft ||= structuredClone(store.s.data.trip); applyTrip(store.s.tripDraft, t.dataset.trip, t.checked); store.s.tripDirty = true; draw(); }
      if (t.dataset.act === 'check') store.check(t.dataset.id, t.dataset.key, t.checked);
    });
    wrap.addEventListener('submit', (e) => {
      e.preventDefault(); const f = e.target.dataset.form, id = e.target.dataset.id, s = store.s;
      if (f === 'search') store.discover(s.query);
      else if (f === 'addurl') store.addUrl(s.addUrl);
      else if (f === 'note') { const key = s.drafts['note-' + id] != null ? 'note-' + id : 'note'; const text = s.drafts[key]; if (!String(text || '').trim()) return store.say('err', 'Write something first.'); s.drafts[key] = ''; store.note(id, text); }
      else if (f === 'evidence') store.evidence(id, s.drafts['ev-value'], s.drafts['ev-excerpt']);
      else if (f === 'trip') { const t = s.tripDraft || structuredClone(s.data.trip); store.saveTrip({ destination: t.destination, checkIn: t.checkIn, nightsOptions: t.nightsOptions, adults: t.adults, children: t.children, totalGuests: t.totalGuests, budget: t.budget, groups: t.groups.map((g) => ({ ...g, adults: g.adults, children: g.children })) }); }
      else if (f === 'research') { const q = s.drafts.question; const ctxText = s.data.listings.filter((l) => l.shortlisted).map((l) => `- ${l.title} ${l.url} · ${l.capacity.label} · ${l.location.label} · source: ${l.sourceLabel}`).join('\n') || '(nothing shortlisted yet)'; if (!String(q || '').trim()) return store.say('err', 'Enter a research question first.'); s.researchOpen = false; dispatch({ type: 'travel/research', question: q, context: ctxText }); notify(); }
    });
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act],[data-b]'); if (!b || b.tagName === 'INPUT') return;
      if (b.closest('a[data-ext]') && !b.dataset.act) return;
      if (b.tagName === 'A') e.preventDefault();
      if (b.dataset.b) {
        if (b.dataset.b === 'close') return dispatch({ type: 'travel/close-inspect' });
        bMsg = ''; api('/nav', { owner, verb: b.dataset.b }).then((r) => { if (r.ok) { bState = r.state; bMsg = ''; } else bMsg = r.message || 'Navigation failed'; paintBar(); }); return;
      }
      const { act, id } = b.dataset, s = store.s;
      switch (act) {
        case 'tab': select('tab', b.dataset.tab); break;
        case 'select': select('selected', id); break;
        case 'short': store.shortlist(id, !s.data.listings.find((l) => l.id === id)?.shortlisted); break;
        case 'cmp': dispatch({ type: 'travel/toggle-compare', id }); break;
        case 'inspect': select('selected', id); inspect(id); break;
        case 'refresh': store.refresh(id, false); break;
        case 'force': store.refresh(id, true); break;
        case 'refresh-all': store.refreshAll(false); break;
        case 'force-all': store.refreshAll(true); break;
        case 'kind': store.kind(id, b.dataset.kind); break;
        case 'loc': store.location(id, b.dataset.status); break;
        case 'force-search': store.discover(s.query, true); break;
        case 'preset': s.query = PRESETS[+b.dataset.i][1]; draw(); wrap.querySelector('#tv-q')?.focus(); break;
        case 'research': s.researchOpen = true; draw(); wrap.querySelector('[data-draft="question"]')?.focus(); break;
        case 'research-close': s.researchOpen = false; draw(); break;
        case 'reload': store.load(); break;
        case 'add-group': s.tripDraft ||= structuredClone(s.data.trip); s.tripDraft.groups.push({ id: 'g' + Date.now().toString(36), label: 'New group', adults: 0, children: 0, childAges: [] }); s.tripDirty = true; draw(); break;
        case 'del-group': s.tripDraft ||= structuredClone(s.data.trip); s.tripDraft.groups.splice(+b.dataset.i, 1); s.tripDirty = true; draw(); break;
        case 'reset-trip': s.tripDraft = null; s.tripDirty = false; s.tripErrors = []; draw(); break;
      }
    });
    return { update(m) { model = m; role = m.role === 'browser' ? 'browser' : 'desk'; draw(); }, dispose() { view.dispose(); } };
  }
  return resource;
}
