// /travel/api routes for the single TravelService + desk-owned browser sessions.
// Plugged into spikes/browser/serve.mjs through its generic `routes` option (after Host/Origin checks).
// Browser sessions are created, navigated and closed only for owners that ask here; other sessions are never touched.
import { safeUrl } from './service.mjs';

const OWNER = /^[a-z0-9]{6,24}$/;
const ID = /^[a-f0-9]{12}$/;
const bad = (m) => Object.assign(new Error(m), { status: 400 });
export function makeRoutes({ service, manager, log = () => {} }) {
  const owned = new Map(); // owner -> session id (only sessions this desk created)
  const sessionOf = (owner) => { if (!OWNER.test(owner || '')) throw bad('invalid desk owner'); return owned.get(owner); };
  async function current(s) {
    const out = { id: s.id, status: s.status, control: s.control, provider: s.provider, url: s.url, title: null, live: false };
    if (s.status === 'running') {
      try { out.url = (await manager.lock(s, () => manager.run(s, ['get', 'url']))).url || s.url; } catch { /* page may be mid-navigation */ }
      try { out.title = (await manager.lock(s, () => manager.run(s, ['get', 'title']))).title || null; } catch {}
      out.live = true;
    }
    return out;
  }
  async function inspect(owner, listing) {
    if (!OWNER.test(owner || '')) throw bad('invalid desk owner');
    const l = (await service.snapshot()).listings[listing]; if (!l) throw bad('unknown listing');
    const url = safeUrl(l.source?.finalUrl || l.url) || safeUrl(l.url); if (!url) throw bad('listing URL is not a public http(s) URL');
    let id = owned.get(owner); let s = id && manager.sessions.get(id);
    if (s && s.status === 'running') {
      await manager.lock(s, async () => { await manager.run(s, ['open', url]); manager.event(s, 'travel/navigate', { listing }); await manager.persist(); });
    } else {
      id = 'tv-' + owner; owned.set(owner, id);
      s = await manager.open({ id, mode: 'headful', url, profile: 'travel-' + owner });
      manager.event(s, 'travel/inspect', { listing }); await manager.persist();
    }
    return { ok: true, session: id, listing, url, title: l.title || l.source?.title || url, state: await current(s) };
  }
  async function release(owner) {
    const id = sessionOf(owner); owned.delete(owner);
    if (!id) return { ok: true, released: false };
    const s = manager.sessions.get(id); if (!s) return { ok: true, released: false };
    try { await manager.action(id, 'close'); await manager.action(id, 'forget'); } catch (e) { log('release ' + id + ': ' + e.message); return { ok: false, message: e.message }; }
    manager.sessions.delete(id); await manager.persist().catch(() => {});
    return { ok: true, released: true, session: id };
  }
  async function nav(owner, verb) {
    const id = sessionOf(owner); const s = id && manager.sessions.get(id); if (!s || s.status !== 'running') throw bad('no browser open for this desk');
    const js = { back: 'history.back()', forward: 'history.forward()', reload: 'location.reload()' }[verb]; if (!js) throw bad('unknown navigation');
    await manager.lock(s, async () => { await manager.run(s, ['eval', js]); manager.event(s, 'travel/' + verb); });
    await new Promise((r) => setTimeout(r, 400));
    return { ok: true, state: await current(s) };
  }
  const handlers = {
    'GET /state': async () => {
      const [trip, listings] = await Promise.all([service.getTrip(), service.list()]); const snap = await service.snapshot();
      return { ok: true, trip, listings, searches: snap.searches.slice(-8), now: new Date().toISOString(), stats: service.fetchStats };
    },
    'POST /trip': async (b) => service.setTrip(b.patch || {}),
    'POST /discover': async (b) => { const r = await service.discover(b.query, { 'max-results': 8, 'max-total-results': 8 }, { force: !!b.force });
      return r.ok ? { ok: true, cache: r.cache, count: r.search.citations.length, added: r.listingIds.length, modelAnswer: r.search.modelAnswer, model: r.search.model } : { ok: false, message: r.error }; },
    'POST /refresh': async (b) => {
      if (b.id) { if (!ID.test(b.id)) throw bad('invalid listing'); const r = await service.refresh(b.id, { force: !!b.force }); return r.ok ? r : { ok: false, message: r.error }; }
      return service.refreshAll({ force: !!b.force });
    },
    'POST /shortlist': async (b) => service.setShortlist(b.id, !!b.on),
    'POST /note': async (b) => service.addNote(b.id, b.text),
    'POST /evidence': async (b) => service.addManualEvidence(b.id, { value: Number(b.value), excerpt: b.excerpt }),
    'POST /kind': async (b) => service.setKind(b.id, b.kind, 'set by you in the desk'),
    'POST /location': async (b) => service.setLocation(b.id, b.status),
    'POST /check': async (b) => service.toggleCheck(b.id, b.key, !!b.on),
    'POST /add-url': async (b) => { const r = await service.addCandidate({ url: b.url, title: b.title || '', origin: 'user' }); if (!r.ok) return { ok: false, message: r.error }; await service.save(); return { ok: true, id: r.id }; },
    'POST /inspect': async (b) => inspect(b.owner, b.id),
    'POST /nav': async (b) => nav(b.owner, b.verb),
    'POST /release': async (b) => release(b.owner),
    'POST /session': async (b) => { const id = sessionOf(b.owner); const s = id && manager.sessions.get(id); return s ? { ok: true, state: await current(s) } : { ok: true, state: null }; },
  };
  const route = async (req, res, u, { json, body }) => {
    if (!u.pathname.startsWith('/travel/api/')) return false;
    if (req.method === 'POST' && req.headers['content-type'] !== undefined && !/json/.test(req.headers['content-type'])) return json(res, 415, { ok: false, message: 'JSON required' }), true;
    const h = handlers[req.method + ' ' + u.pathname.slice('/travel/api'.length)];
    if (!h) return json(res, 404, { ok: false, message: 'Unknown travel route' }), true;
    try { const b = req.method === 'POST' ? await body(req) : {}; json(res, 200, await h(b)); }
    catch (e) { json(res, e.status || 500, { ok: false, message: String(e.message || e) }); }
    return true;
  };
  route.owned = owned; route.release = release; route.releaseAll = async () => { for (const o of [...owned.keys()]) await release(o); };
  return route;
}
