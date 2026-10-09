// Travel desk host: the existing browser host (sessions, live panel, editor proxy) plus /travel/api.
// Browser registry is OUTSIDE the served document root. The editor is the real offline bin/bl-ed upstream.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startBrowserHost } from '../browser/serve.mjs';
import { TravelService, SERVICE_DIR } from './service.mjs';
import { makeRoutes } from './routes.mjs';

export async function startTravelHost({ root, state, dataDir, upstream, port = 8842, service, seedFile, manager, searchFn } = {}) {
  root ||= await fs.mkdtemp(path.join(os.tmpdir(), 'travel-world-'));
  state ||= root + '.state';
  dataDir ||= path.join(state, 'travel-data');
  service ||= new TravelService({ dataDir, seedFile: seedFile || path.join(SERVICE_DIR, 'data/seed.json'), ...(searchFn ? { searchFn } : {}) });
  await service.load();
  let routes;
  const proxy = { get routes() { return routes; } };
  const host = await startBrowserHost({ root, upstream, port, manager, routes: (...a) => proxy.routes(...a) });
  routes = makeRoutes({ service, manager: host.manager, log: (m) => console.error('[travel]', m) });
  const stop = async () => { await routes.releaseAll().catch(() => {}); await host.stop(); };
  return { ...host, service, routes, stop, root, state };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.TRAVEL_PORT || 8842), upstream = process.env.TRAVEL_UPSTREAM || 'http://127.0.0.1:8841';
  if (port === 8790 || /:8790\b/.test(upstream)) throw Error('Refusing the live world port 8790');
  const root = process.env.TRAVEL_ROOT, state = process.env.BROWSER_STATE_ROOT;
  const host = await startTravelHost({ root, state: state && path.dirname(state), dataDir: process.env.TRAVEL_DATA, upstream, port });
  console.log('Travel desk: ' + host.url + '/?file=trip.bl.org&use=travel');
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await host.stop(); process.exit(0); });
}
