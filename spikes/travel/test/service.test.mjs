import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  TravelService, CachedCall, Limiter, validateTrip, defaultTrip, safeUrl, classifyUrl, extractBridgeResult, normalizeSearch,
  extractCapacities, assessCapacity, fetchSource, htmlToText, rankListings, clip, runSearchCli,
} from '../service.mjs';

const tmp = () => mkdtemp(path.join(os.tmpdir(), 'travel-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const resp = (status, body = '', headers = {}) => ({ status, headers: new Map(Object.entries({ 'content-type': 'text/html', ...headers })), text: async () => body });
const page = (title, body) => '<html><head><title>' + title + '</title><script>var secret=1</script></head><body>' + body + '<p>' + 'A quiet courtyard house with terraces near the old harbour and a sunny roof garden. '.repeat(4) + '</p></body></html>';
const RAW = {
  status: 'ok', engine: 'exa', model: 'm', 'fetched-at': '2026-10-09T00:00:00Z', answer: 'The model claims Riad X sleeps 40.',
  results: [
    { rank: 1, url: 'https://www.rentbyowner.com/property/big-riad/HA-1', title: 'Big Riad', snippet: 's1', domain: 'rentbyowner.com' },
    { rank: 2, url: 'https://exa.ai/library/places?q=abc', title: 'synthesized', snippet: 's2', domain: 'exa.ai' },
    { rank: 3, url: 'https://www.villanovo.com/riad-rental-essaouira.html', title: 'Luxury Riad Rental', snippet: 's3', domain: 'villanovo.com' },
    { rank: 4, url: 'javascript:alert(1)', title: 'evil', snippet: '', domain: '' },
    { rank: 5, url: 'file:///etc/passwd', title: 'evil2', snippet: '', domain: '' },
  ],
};

test('trip defaults and validation', () => {
  const t = defaultTrip();
  assert.equal(t.destination, 'Essaouira'); assert.equal(t.checkIn, '2026-12-19');
  assert.deepEqual(t.nightsOptions, [4, 5]); assert.equal(t.totalGuests, 20); assert.equal(t.budget.unlimited, true);
  assert.deepEqual(t.groups[0].childAges, [], 'child ages are not invented');
  assert.ok(validateTrip().ok);
  assert.match(validateTrip({ checkIn: '2026-02-30' }).errors.join(), /checkIn/);
  assert.match(validateTrip({ adults: 10 }).errors.join(), /totalGuests/);
  assert.match(validateTrip({ budget: { unlimited: false } }).errors.join(), /budget/);
  assert.match(validateTrip({ groups: [{ id: 'a', adults: 5, children: 9, childAges: [] }] }).errors.join(), /groups must sum/);
  assert.match(validateTrip({ groups: [{ id: 'a', adults: 11, children: 9, childAges: [4, 30] }] }).errors.join(), /childAges/);
  const ok = validateTrip({ groups: [{ id: 'a', adults: 6, children: 4, childAges: [3] }, { id: 'b', adults: 5, children: 5 }] });
  assert.ok(ok.ok, ok.errors.join());
});

test('URL safety: http(s) only, no creds or private hosts', () => {
  assert.equal(safeUrl('javascript:alert(1)'), null); assert.equal(safeUrl('file:///etc/passwd'), null);
  assert.equal(safeUrl('data:text/html,hi'), null); assert.equal(safeUrl('http://localhost:8790/x'), null);
  assert.equal(safeUrl('http://192.168.1.2/'), null); assert.equal(safeUrl('https://u:p@example.com/'), null);
  assert.equal(safeUrl('https://example.com/a#frag'), 'https://example.com/a');
});

test('classification: exa library excluded, collection vs property', () => {
  assert.equal(classifyUrl('https://exa.ai/library/places?q=1').kind, 'excluded');
  assert.equal(classifyUrl('https://www.villanovo.com/riad-rental-essaouira.html').kind, 'collection');
  assert.equal(classifyUrl('https://mintmorocco.com/accommodations/romantic-riads/').kind, 'collection');
  assert.equal(classifyUrl('https://www.rentbyowner.com/property/x/HA-1').kind, 'property');
});

test('bridge: picks @@RESULT@@ line among noise; normalizeSearch separates answer from citations', () => {
  const out = 'warming up\n@@RESULT@@' + JSON.stringify(RAW) + '\ntrailing log\n';
  const r = extractBridgeResult(out); assert.ok(r.ok);
  assert.equal(extractBridgeResult('nothing').ok, false);
  assert.equal(extractBridgeResult('@@RESULT@@{bad').ok, false);
  const n = normalizeSearch(r.value, 'q');
  assert.equal(n.citations.length, 3, 'unsafe URLs dropped');
  assert.equal(n.modelAnswer.synthesized, true);
  assert.ok(!n.citations.some((c) => /claims/.test(c.snippet)), 'answer text never leaks into citations');
});

test('runSearchCli spawns bin/bl with argv (no shell) and parses the result', async () => {
  let seen;
  const fake = (cmd, args, o) => {
    seen = { cmd, args, o };
    const { EventEmitter } = require_events();
    const c = new EventEmitter(); c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); c.kill = () => {};
    setImmediate(() => { c.stdout.emit('data', 'noise\n@@RESULT@@{"status":"ok","results":[]}\n'); c.emit('close', 0); });
    return c;
  };
  const r = await runSearchCli('a "quoted"; $(rm -rf /)', { 'max-results': 3 }, { root: '/r', spawnFn: fake });
  assert.ok(r.ok); assert.equal(seen.cmd, '/r/bin/bl'); assert.equal(seen.o.shell, false);
  assert.deepEqual(JSON.parse(seen.args.at(-1)), { query: 'a "quoted"; $(rm -rf /)', opts: { 'max-results': 3 } });
});
import { EventEmitter } from 'node:events';
function require_events() { return { EventEmitter }; }

test('CachedCall: TTL cache, inflight dedup, concurrency limit, failures not cached', async () => {
  let t = 0, calls = 0, active = 0, peak = 0;
  const c = new CachedCall({ ttlMs: 1000, concurrency: 2, now: () => t });
  const work = (v) => async () => { calls++; active++; peak = Math.max(peak, active); await sleep(15); active--; return { ok: true, v }; };
  const same = await Promise.all([c.get('k', work(1)), c.get('k', work(1)), c.get('k', work(1))]);
  assert.equal(calls, 1); assert.deepEqual(same.map((x) => x.cache).sort(), ['joined', 'joined', 'miss']);
  assert.equal((await c.get('k', work(1))).cache, 'hit'); assert.equal(calls, 1);
  t = 1500; assert.equal((await c.get('k', work(2))).cache, 'miss'); assert.equal(calls, 2, 'TTL expiry refetches');
  await c.get('k', work(3), { force: true }); assert.equal(calls, 3);
  calls = 0; peak = 0;
  await Promise.all(['a', 'b', 'c', 'd', 'e'].map((k) => c.get(k, work(k)))); assert.equal(calls, 5); assert.ok(peak <= 2, 'peak ' + peak);
  let n = 0; const bad = () => c.get('bad', async () => (++n === 1 ? { ok: false, error: 'x' } : { ok: true }));
  assert.equal((await bad()).ok, false); assert.equal((await bad()).ok, true);
});

test('Limiter never exceeds max', async () => {
  const l = new Limiter(3); let a = 0, p = 0;
  await Promise.all(Array.from({ length: 10 }, () => l.run(async () => { a++; p = Math.max(p, a); await sleep(5); a--; })));
  assert.equal(p, 3);
});

test('capacity extraction requires quoted excerpt; below 20 unsuitable; unverified unknown', () => {
  const claims = extractCapacities('Lovely riad in the medina. It sleeps 14 guests across 7 rooms. Terrace views.');
  assert.ok(claims.length >= 1); assert.ok(claims.every((c) => c.excerpt && c.excerpt.includes(String(c.value))));
  assert.equal(assessCapacity(claims).status, 'below');
  assert.equal(assessCapacity(extractCapacities('Beautiful riad with a pool and a rooftop.')).status, 'unknown');
  assert.equal(assessCapacity(extractCapacities('Entire riad: 7 Bedrooms 7 Baths 21 Guests')).status, 'meets');
  assert.equal(assessCapacity([{ value: 30, excerpt: '' }]).status, 'unknown', 'no excerpt, no claim');
  const m = assessCapacity(claims, [{ value: 22, excerpt: 'owner email: sleeps 22 with extra beds' }]);
  assert.equal(m.status, 'meets'); assert.equal(m.evidence.source, 'manual');
});

test('fetchSource: ok extracts title/text/hash/capacity; scripts removed; text clipped', async () => {
  const html = page('Riad Big &amp; Co', '<p>Sleeps 22 guests.</p>' + 'x '.repeat(5000));
  const r = await fetchSource('https://a.example/p', { fetchFn: async () => resp(200, html, { etag: '"e1"' }), textLimit: 300, now: () => 'T' });
  assert.equal(r.status, 'ok'); assert.equal(r.title, 'Riad Big & Co'); assert.ok(r.textExcerpt.length <= 300);
  assert.ok(!/secret/.test(r.textExcerpt)); assert.equal(r.contentHash.length, 64); assert.equal(r.etag, '"e1"');
  assert.equal(r.capacityClaims[0].value, 22); assert.equal(r.checkedAt, 'T');
  assert.ok(!('body' in r) && !('html' in r));
});

test('capacity: header claims beat later related-listing noise; title counts; "max" is quoted', () => {
  const noise = ' filler'.repeat(400) + ' Related: Marrakech riad for 28 guests';
  const claims = extractCapacities('Dar X . 12 guests (14 max.) . 6 bedrooms ' + noise);
  assert.ok(claims.some((c) => c.value === 28));
  const a = assessCapacity(claims); assert.equal(a.max, 12, 'conservative: the base guest count, not the extra-bed max'); assert.equal(a.status, 'below');
  const b = assessCapacity(extractCapacities('Dar Y . 18 guests (21 max.) . 9 bedrooms'));
  assert.equal(b.status, 'unknown'); assert.equal(b.extraEvidence.value, 21); assert.match(b.label, /verify/);
});

test('collection pages never yield a property capacity; sale listings excluded', () => {
  assert.equal(classifyUrl('https://www.villanovo.com/villa-rentals/africa/morocco/essaouira/for:20-24-persons/').kind, 'collection');
  assert.equal(classifyUrl('https://www.villanovo.com/villa-rentals/africa/morocco/essaouira/service:swimming-pool/').kind, 'collection');
  assert.equal(classifyUrl('https://x.example/en/annonces/ref-1/buy-villa-11-rooms').kind, 'excluded');
  const r = rankListings([{ id: 'c', kind: 'collection', source: { status: 'ok', capacityClaims: [{ value: 50, excerpt: 'for 50 guests', pos: 1 }] }, manualEvidence: [] }]);
  assert.equal(r[0].capacity.status, 'unknown');
});

test('setKind records a reason and demotes a listing out of refresh', async () => {
  const dir = await tmp(); const { svc, calls } = mkService(dir);
  const { id } = await svc.addCandidate({ url: 'https://a.example/property/x' });
  await svc.setKind(id, 'excluded', 'outside Essaouira'); await svc.refreshAll();
  assert.equal(calls.fetch, 0); assert.equal((await svc.snapshot()).listings[id].kindReason, 'outside Essaouira');
  assert.equal((await svc.setKind(id, 'bogus')).ok, false);
  await rm(dir, { recursive: true });
});

test('fetchSource: blocked (403, bot challenge, redirect failures) vs unknown (transport) vs not-found', async () => {
  const f = (fn) => fetchSource('https://a.example/p', { fetchFn: fn });
  assert.equal((await f(async () => resp(403, 'Forbidden'))).status, 'blocked');
  const ch = await f(async () => resp(200, '<title>Just a moment...</title>Checking your browser before accessing'));
  assert.equal(ch.status, 'blocked'); assert.match(ch.reason, /bot/);
  assert.equal((await f(async () => resp(302, '', { location: 'javascript:alert(1)' }))).status, 'blocked');
  assert.equal((await f(async () => resp(302, '', { location: '/p' }))).status, 'blocked', 'self redirect loop');
  let hop = 0;
  const many = await f(async () => resp(302, '', { location: '/h' + ++hop }));
  assert.equal(many.status, 'blocked'); assert.equal(many.reason, 'too many redirects');
  const net = await f(async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); });
  assert.equal(net.status, 'unknown'); assert.match(net.reason, /ENOTFOUND/);
  const slow = await fetchSource('https://a.example/p', { timeoutMs: 20, fetchFn: (u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' })))) });
  assert.equal(slow.status, 'unknown'); assert.equal(slow.reason, 'timed out');
  assert.equal((await f(async () => resp(404, 'no'))).status, 'not-found');
  assert.equal((await f(async () => resp(503, 'no'))).status, 'server-error');
});

test('fetchSource: followed redirect records final URL; conditional headers sent; 304 reachable', async () => {
  const seen = [];
  const fetchFn = async (u, o) => { seen.push({ u, h: o.headers }); return u.endsWith('/old') ? resp(301, '', { location: '/new' }) : resp(200, page('T', 'Sleeps 12 guests')); };
  const r = await fetchSource('https://a.example/old', { fetchFn, prior: { etag: 'E', lastModified: 'LM' } });
  assert.equal(r.status, 'ok'); assert.equal(r.finalUrl, 'https://a.example/new'); assert.equal(r.redirects, 1);
  assert.equal(seen[0].h['if-none-match'], 'E'); assert.equal(seen[0].h['if-modified-since'], 'LM'); assert.equal(seen[1].h['if-none-match'], undefined);
  const nm = await fetchSource('https://a.example/x', { fetchFn: async () => resp(304), prior: { etag: 'E' } });
  assert.equal(nm.status, 'not-modified'); assert.equal(nm.reachable, true);
});

function mkService(dir, over = {}) {
  let n = 0;
  const calls = { search: 0, fetch: 0, active: 0, peak: 0 };
  const searchFn = over.searchFn || (async () => { calls.search++; await sleep(10); return { ok: true, value: RAW }; });
  const fetchFn = over.fetchFn || (async (u) => {
    calls.fetch++; calls.active++; calls.peak = Math.max(calls.peak, calls.active); await sleep(10); calls.active--;
    if (u.includes('big-riad')) return resp(200, page('Big Riad Essaouira', '<p>Entire riad. Sleeps 24 guests in 12 suites.</p>'));
    if (u.includes('villanovo')) return resp(403, 'Forbidden');
    throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
  });
  const svc = new TravelService({ dataDir: dir, seedFile: path.join(dir, 'none.json'), searchFn, fetchFn, now: () => '2026-10-09T10:00:' + String(n++ % 60).padStart(2, '0') + 'Z', fetchConcurrency: 2, ...over });
  return { svc, calls };
}

test('service discovery: dedup concurrent searches, cache, exclude exa, keep answer out of listings', async () => {
  const dir = await tmp(); const { svc, calls } = mkService(dir);
  const rs = await Promise.all([svc.discover('riads for 20'), svc.discover('riads for 20'), svc.discover('riads for 20')]);
  assert.equal(calls.search, 1); assert.ok(rs.every((r) => r.ok));
  assert.equal((await svc.discover('riads for 20')).cache, 'hit'); assert.equal(calls.search, 1);
  const all = await svc.list();
  assert.equal(all.length, 3, 'javascript:/file: citations never become candidates');
  const exa = all.find((l) => l.domain === 'exa.ai'); assert.equal(exa.kind, 'excluded');
  assert.equal(all.find((l) => l.kind === 'collection').domain, 'villanovo.com');
  assert.equal((await svc.list({ kind: 'property' })).length, 1);
  assert.ok(!JSON.stringify(await svc.snapshot()).includes('model claims'), 'synthesized answer not persisted');
  assert.equal((await svc.discover('')).ok, false);
  await rm(dir, { recursive: true });
});

test('service search failure is reported and not cached', async () => {
  const dir = await tmp(); let n = 0;
  const { svc } = mkService(dir, { searchFn: async () => (++n === 1 ? { ok: false, error: 'bridge down' } : { ok: true, value: RAW }) });
  assert.equal((await svc.discover('q')).ok, false);
  assert.equal((await svc.discover('q')).ok, true);
  await rm(dir, { recursive: true });
});

test('refreshAll: bounded concurrency, blocked vs unknown vs ok, excluded never fetched, availability never claimed', async () => {
  const dir = await tmp(); const { svc, calls } = mkService(dir);
  await svc.discover('q');
  for (let i = 0; i < 6; i++) await svc.addCandidate({ url: 'https://other' + i + '.example/p', title: 'x' });
  const r = await svc.refreshAll();
  assert.equal(r.count, 8, '2 property/collection from search + 6 added; exa excluded');
  assert.ok(calls.peak <= 2, 'peak ' + calls.peak); assert.equal(calls.fetch, 8);
  const by = Object.fromEntries((await svc.list()).map((l) => [l.domain, l]));
  const big = by['rentbyowner.com'];
  assert.equal(big.sourceStatus, 'ok'); assert.equal(big.capacity.status, 'meets'); assert.equal(big.capacity.max, 24);
  assert.match(big.capacity.evidence.excerpt, /Sleeps 24 guests/);
  assert.equal(big.availability.status, 'unknown'); assert.equal(big.price.status, 'unknown');
  assert.match(big.availability.label, /not verified/);
  assert.equal(by['villanovo.com'].sourceStatus, 'blocked'); assert.match(by['villanovo.com'].sourceLabel, /Blocked/);
  assert.equal(by['other3.example'].sourceStatus, 'unknown');
  assert.equal(by['exa.ai'].sourceStatus, 'unchecked');
  assert.equal(by['villanovo.com'].capacity.status, 'unknown'); assert.equal(by['villanovo.com'].suitability, 'capacity-unknown');
  await rm(dir, { recursive: true });
});

test('refresh: TTL cache, force, inflight dedup, failed refresh keeps last good extract', async () => {
  const dir = await tmp(); let mode = 'ok', fetches = 0;
  const fetchFn = async () => { fetches++; await sleep(10); return mode === 'ok' ? resp(200, page('Riad', 'Sleeps 10 guests')) : resp(403, 'nope'); };
  let clock = Date.parse('2026-10-09T10:00:00Z');
  const { svc } = mkService(dir, { fetchFn, now: () => new Date(clock).toISOString(), fetchTtlMs: 60000 });
  const { id } = await svc.addCandidate({ url: 'https://a.example/property/x' });
  await Promise.all([svc.refresh(id), svc.refresh(id), svc.refresh(id)]); assert.equal(fetches, 1);
  assert.equal((await svc.refresh(id)).cache, 'hit'); assert.equal(fetches, 1);
  clock += 120000; mode = 'blocked'; await svc.refresh(id); assert.equal(fetches, 2);
  const l = (await svc.list())[0];
  assert.equal(l.sourceStatus, 'blocked'); assert.equal(l.capacity.max, 10, 'previous excerpt retained, clearly with its own check time');
  const snap = await svc.snapshot(); assert.ok(snap.listings[id].source.previousOk);
  await rm(dir, { recursive: true });
});

test('manual evidence, notes, shortlist, kind override; persistence across instances', async () => {
  const dir = await tmp(); const { svc } = mkService(dir);
  await svc.discover('q');
  const props = await svc.list({ kind: 'property' }); const id = props[0].id;
  assert.equal((await svc.addManualEvidence(id, { value: 20, excerpt: '' })).ok, false);
  assert.equal((await svc.addManualEvidence(id, { value: 0, excerpt: 'owner said' })).ok, false);
  const m = await svc.addManualEvidence(id, { value: 21, excerpt: 'Owner email 2026-10-01: sleeps 21 with sofa beds' });
  assert.equal(m.listing.capacity.status, 'meets'); assert.equal(m.listing.capacity.evidence.source, 'manual');
  await svc.addNote(id, 'call not allowed yet; ask via host later'); await svc.setShortlist(id, true);
  assert.equal((await svc.addNote('nope', 'x')).ok, false);
  assert.ok((await svc.setTrip({ nightsOptions: [5] })).ok);
  assert.equal((await svc.setTrip({ checkIn: 'soon' })).ok, false);
  assert.deepEqual((await svc.getTrip()).nightsOptions, [5], 'invalid patch did not change trip');
  const svc2 = new TravelService({ dataDir: dir, seedFile: path.join(dir, 'none.json'), searchFn: async () => { throw new Error('no'); } });
  const l = (await svc2.list({ shortlistedOnly: true }));
  assert.equal(l.length, 1); assert.equal(l[0].id, id); assert.equal(l[0].notes.length, 1); assert.equal(l[0].manualEvidence.length, 1);
  assert.deepEqual((await svc2.getTrip()).nightsOptions, [5]);
  const cmp = await svc2.compare(); assert.equal(cmp.rows.length, 1); assert.equal(cmp.rows[0].suitability, 'capacity-stated');
  const files = JSON.parse(await readFile(path.join(dir, 'state.json'), 'utf8')); assert.equal(files.version, 1);
  await rm(dir, { recursive: true });
});

test('ranking: confirmed capacity first, unknown before below, collections after properties; below flagged unsuitable', () => {
  const mk = (id, kind, claims, st = 'ok', extra = {}) => ({ id, kind, source: { status: st, capacityClaims: claims }, manualEvidence: [], ...extra });
  const ls = [
    mk('below', 'property', [{ value: 10, excerpt: 'sleeps 10' }]),
    mk('coll', 'collection', []),
    mk('unk', 'property', [], 'blocked'),
    mk('meets', 'property', [{ value: 22, excerpt: 'sleeps 22' }]),
  ];
  assert.deepEqual(rankListings(ls).map((r) => r.id), ['meets', 'unk', 'below', 'coll']);
  assert.equal(rankListings(ls)[2].capacity.status, 'below');
  const big = Array.from({ length: 20000 }, (_, i) => mk('i' + i, 'property', [{ value: i % 40, excerpt: 'sleeps ' + i }]));
  const t0 = performance.now(); rankListings(big); assert.ok(performance.now() - t0 < 1000);
});

test('addCandidate rejects unsafe URLs; htmlToText/clip helpers', async () => {
  const dir = await tmp(); const { svc } = mkService(dir);
  for (const u of ['javascript:alert(1)', 'ftp://x.example/', 'file:///etc/hosts', 'http://127.0.0.1:8790/', 'not a url'])
    assert.equal((await svc.addCandidate({ url: u })).ok, false, u);
  assert.match(htmlToText('<style>p{}</style><p>a&nbsp;&amp;&#39;b</p>'), /a &'b/);
  assert.ok(!htmlToText('<style>p{}</style><p>x</p>').includes('p{}'));
  assert.equal(clip('abcdef', 4), 'abc…');
  await rm(dir, { recursive: true });
});

test('qualification: dining/event/extra-bed numbers never verify; outside-target and unreadable pages are explicit', async () => {
  const { locationOf, propertyTypeOf, effectiveSource, describeListing, factsOf } = await import('../service.mjs');
  const dining = assessCapacity(extractCapacities('Dar Z . Dining room seats 30 guests . 6 bedrooms'));
  assert.notEqual(dining.status, 'meets'); assert.match(dining.label, /dining|unverified/i);
  const conflict = assessCapacity([{ value: 12, excerpt: 'sleeps 12 guests', source: 'page-text', pos: 10 }, { value: 30, excerpt: 'party of 30 guests', source: 'page-text', pos: 50 }]);
  assert.equal(conflict.status, 'unknown'); assert.match(conflict.label, /confirmation/);
  const soft = assessCapacity([{ value: 30, excerpt: 'up to 30 max. with extra beds', source: 'page-text', pos: 10 }]);
  assert.equal(soft.status, 'unknown');
  const mirleft = { id: 'm', url: 'https://www.bellavista-villas.com/en/luxury-rent-villa/morocco/essaouira/mirleft/16-1', title: 'Luxury villa rental Mirleft with pool for 20 people', domain: 'bellavista-villas.com', kind: 'property', source: { status: 'ok', textLength: 900, textExcerpt: 'x', capacityClaims: [{ value: 20, excerpt: 'pool for 20 people', pos: 30, source: 'page-text' }] }, manualEvidence: [], notes: [] };
  assert.equal(locationOf(mirleft).status, 'outside');
  const marketplace = { id: 'b', url: 'https://www.bookabach.co.nz/holiday-accommodation/p2046298a', domain: 'bookabach.co.nz', title: 'Entire villa, sleeps 16 - Essaouira | Bookabach', source: { status: 'ok', textExcerpt: 'Entire villa - Essaouira | Bookabach' } };
  assert.equal(locationOf(marketplace).status, 'named', 'a marketplace name or country domain is not the property location');
  assert.equal(locationOf({ id: 'c', url: 'https://www.bookabach.co.nz/p/1', domain: 'bookabach.co.nz', title: 'Villa with pool' }).status, 'unknown');
  const d = describeListing(mirleft, 20); assert.equal(d.suitability, 'outside-target'); assert.match(d.capacity.label, /outside/);
  assert.equal(propertyTypeOf({ title: 'Riad Lailouza', url: 'https://x.example/p' }), 'riad');
  assert.equal(propertyTypeOf({ title: 'Villa Sultana', url: 'https://x.example/p' }), 'villa');
  assert.equal(effectiveSource({ status: 'ok', textLength: 3 }), 'unreadable');
  assert.equal(effectiveSource({ status: 'ok', textLength: 900 }), 'ok');
  assert.equal(describeListing({ id: 'j', url: 'https://x.example/p', title: 'Villa', kind: 'property', domain: 'x.example', source: { status: 'ok', textLength: 3, capacityClaims: [] }, manualEvidence: [], notes: [] }, 20).readable, false);
  assert.equal(factsOf({ source: { textExcerpt: 'Heated pool and fireplace. 6 bedrooms.' } }).heating.status, 'mentioned');
  assert.equal(factsOf({ source: null }).pool.status, 'unknown');
});

test('facts: only explicit whole-property wording counts as private use; generic access mentions are not step-free evidence', async () => {
  const { factsOf } = await import('../service.mjs');
  const f = (t) => factsOf({ source: { textExcerpt: t } });
  for (const t of ['Room with private bathroom and private terrace.', 'Private pool, private parking, self-catering kitchen.', 'A private villa with 6 bedrooms.'])
    assert.equal(f(t).privateUse.status, 'unknown', t);
  for (const t of ['Entire riad for your group, sleeps 20.', 'Rent the whole house.', 'Whole villa available.', 'Exclusive use of the property.', 'Sole use for groups.', 'Full buyout of the riad.', 'Available as a private rental.', 'Entire villa, sleeps 16'])
    assert.equal(f(t).privateUse.status, 'mentioned', t);
  const generic = f('Ten minutes from the medina and the airport; parking nearby; stairs to the terrace.');
  assert.equal(generic.access.status, 'mentioned'); assert.equal(generic.stepFree.status, 'unknown');
  assert.equal(f('Step-free entrance, wheelchair friendly ground floor.').stepFree.status, 'mentioned');
  assert.equal(factsOf({ source: null }).stepFree.status, 'unknown');
});
