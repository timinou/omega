// Live discovery + refresh -> data/seed.json (clipped excerpts only, no full HTML). Usage: node spikes/travel/live-seed.mjs [query ...]
import os from 'node:os';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { TravelService, SERVICE_DIR } from './service.mjs';
const dir = await mkdtemp(path.join(os.tmpdir(), 'travel-live-'));
const svc = new TravelService({ dataDir: dir, seedFile: path.join(dir, 'none.json'), searchConcurrency: 1, textLimit: 2500 });
const queries = process.argv.slice(2).length ? process.argv.slice(2) : [
  'large villa Essaouira 20 guests holiday rental',
  'riad Essaouira sleeps 20 guests entire riad rental 10 bedrooms',
];
const rs = [];
for (const q of queries) rs.push(await svc.discover(q, { 'max-results': 8, 'max-total-results': 8 }));
rs.forEach((r, i) => console.log('search', i, r.ok ? r.search.citations.length + ' citations' : 'ERR ' + r.error));
// Human review notes (location facts read from the URLs themselves; none are availability claims).
const REVIEW = [
  [/bellavista-villas\.com.*\/(mirleft|agadir)\//, 'note', 'Listed under Mirleft/Agadir in the URL path, far from Essaouira town; check location before relying on it.'],
  [/rosemarymarrakech/, 'exclude', 'Marrakech riad, not Essaouira.'],
];
for (const l of await svc.list()) {
  for (const [re, act, why] of REVIEW) if (re.test(l.url)) { if (act === 'exclude') await svc.setKind(l.id, 'excluded', why); else await svc.addNote(l.id, why); }
}
const out = await svc.refreshAll();
console.log('refreshed', out.count);
await svc.exportSeed(path.join(SERVICE_DIR, 'data/seed.json'));
for (const l of await svc.list()) console.log(l.kind.padEnd(10), l.sourceStatus.padEnd(12), l.capacity.status.padEnd(8), l.capacity.max ?? '-', l.url.slice(0, 110));
