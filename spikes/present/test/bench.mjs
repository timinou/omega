// node spikes/present/test/bench.mjs FILE [path-for-scheme]
// Per-keystroke cost of a FRAME in BL (handle + render, no DOM):
//   text   = today's ed.main handle + render
//   pp/def = pp.main handle + render with the DEFAULT presentation (read + present + layout)
//   pp/om  = the same with the omega presentation (task: scheme)
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const out = process.env.PP_OUT || new URL("../web/out", import.meta.url).pathname;
const load = (m) => import(pathToFileURL(path.join(out, m)).href);
const M = await load("ed.main.mjs");
const P = await load("pp.main.mjs");
const R = await load("rt.mjs");
const K = R.kw;
const file = process.argv[2];
const src = fs.readFileSync(file, "utf8");
const warmup = Number(process.env.BENCH_WARMUP || 20);
const samples = Number(process.env.BENCH_SAMPLES || 200);
const key = (h) => (ed, k) => h(ed, R.hashMap(K("type"), K("key"), K("key"), k));

function measure(label, n, step, render, ed0) {
  let ed = ed0; const t = [];
  for (let i = 0; i < n; i++) { const a = performance.now(); ed = step(ed, i); render(ed); t.push(performance.now() - a); }
  t.sort((a, b) => a - b);
  const q = (p) => t[Math.min(t.length - 1, Math.floor(p * t.length))].toFixed(2);
  return `${label.padEnd(5)} p50 ${q(0.5).padStart(6)}  p95 ${q(0.95).padStart(6)}`;
}

function suite(name, boot, handle, render, scheme) {
  const k = key(handle);
  let ed = boot(src, scheme);
  const resize = (e) => handle(e, R.hashMap(K("type"), K("resize"), K("height"), 40));
  ed = resize(ed);
  for (let i = 0; i < warmup; i++) { ed = k(ed, "j"); render(ed); }
  const lines = [];
  lines.push(measure("j", 200, (e) => k(e, "j"), render, ed));
  lines.push(measure("k", 200, (e) => k(e, "k"), render, ed));
  lines.push(measure("w", 200, (e) => k(e, "w"), render, ed));
  lines.push(measure("G/gg", 40, (e, i) => (i % 2 ? k(k(e, "g"), "g") : k(e, "G")), render, ed));
  const scrollEd = k(ed, "G");
  const slotScroll = render(scrollEd).get(K("slot-top")) != null;
  lines.push(measure("scroll", samples, (e, i) => {
    const delta = i % 40 < 20 ? -0.32 : 0.32;
    return handle(e, slotScroll
      ? R.hashMap(K("type"), K("scroll-slots"), K("delta"), delta)
      : R.hashMap(K("type"), K("scroll"), K("top"), Math.max(0, render(e).get(K("top")) + Math.sign(delta))));
  }, render, scrollEd));
  let ins = k(ed, "i");
  lines.push(measure("type", 300, (e, i) => k(e, "abcdefghij"[i % 10]), render, ins));
  console.log(`${name.padEnd(8)} ${lines.join(" | ")}`);
}

const scheme = process.argv[3] || file;
console.log(`${file}: ${src.split("\n").length} lines, scheme ${scheme}  (ms per frame = handle + render)`);
suite("text", M.d_boot, M.d_handle, M.d_render, scheme);
suite("pp", P.d_boot, P.d_handle, P.d_render, scheme);
