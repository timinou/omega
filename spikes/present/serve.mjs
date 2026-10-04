// node spikes/present/serve.mjs [port=8791] [world=http://127.0.0.1:8790]
// Serves the spike's page (spikes/present/web) and forwards /api/* to a
// running bl-ed world (bin/bl-ed), so the spike draws REAL documents
// (task:t-5, omega:overview) without touching the vendored server.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const port = Number(process.argv[2] || 8791);
const world = new URL(process.argv[3] || "http://127.0.0.1:8790");
const web = new URL("./web/", import.meta.url).pathname;
const types = { html: "text/html; charset=utf-8", css: "text/css", mjs: "text/javascript", js: "text/javascript", org: "text/plain; charset=utf-8", bl: "text/plain; charset=utf-8" };

http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname.startsWith("/api/")) {
    const fwd = http.request({ host: world.hostname, port: world.port, path: req.url, method: req.method, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode, r.headers); r.pipe(res);
    });
    fwd.on("error", (e) => { res.writeHead(502); res.end(JSON.stringify({ ok: false, message: "no world at " + world + ": " + e.message })); });
    req.pipe(fwd);
    return;
  }
  const rel = u.pathname === "/" ? "index.html" : decodeURIComponent(u.pathname.slice(1));
  const abs = path.resolve(web, rel);
  if (!abs.startsWith(web) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) { res.writeHead(404); res.end("not found"); return; }
  res.writeHead(200, { "content-type": types[abs.split(".").pop()] || "application/octet-stream", "cache-control": "no-store" });
  fs.createReadStream(abs).pipe(res);
}).listen(port, "127.0.0.1", () => console.log(`spike: http://127.0.0.1:${port}/?file=task%3At-5  (api → ${world})`));
