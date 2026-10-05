// vendor/bl-ed/test/host.test.mjs — the host's ordering/timing primitives, run
// under Node (the page imports this same web/host.mjs; it only boots when a
// document exists).   node --test vendor/bl-ed/test/host.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import fs from "node:fs";

const web = path.resolve(process.env.BLED_WEB || "vendor/bl-ed/web");
const H = await import(pathToFileURL(path.join(web, "host.mjs")).href);
const tick = () => new Promise((r) => setTimeout(r, 0));
const deferred = () => { let res, rej; const p = new Promise((a, b) => { res = a; rej = b; }); return { p, res, rej }; };

// a pane's visit, as host.mjs wires it
function visitor(shown = { path: "a" }) {
  const gate = H.latestGate(), log = { applied: [], errors: [], loading: [], alive: true };
  const go = (p, { background = false, d } = {}) => H.latestRequest(gate, "main", {
    background, run: (signal) => new Promise((res, rej) => { d.p.then(res, rej); signal.addEventListener("abort", () => rej(new Error("aborted"))); }),
    valid: () => log.alive && (!background || shown.path === p),
    onStart: () => { if (!background) log.loading.push(p); },
    onValue: (v) => { log.applied.push(v); if (!background) shown.path = p; },
    onError: (e) => log.errors.push([p, e.message]),
    onDone: (mine) => { if (mine && !background) log.loading.push(null); },
  });
  return { gate, log, go, shown };
}

test("latest visit wins: an older slow answer never overwrites a newer one", async () => {
  const v = visitor(), d1 = deferred(), d2 = deferred();
  const r1 = v.go("slow", { d: d1 }), r2 = v.go("fast", { d: d2 });
  d2.res("fast-doc"); assert.equal(await r2, "applied");
  d1.res("slow-doc"); assert.equal(await r1, "stale");
  assert.deepEqual(v.log.applied, ["fast-doc"]);
  assert.equal(v.shown.path, "fast");
  assert.deepEqual(v.log.loading, ["slow", "fast", null], "loading status clears once, by the newest");
});

test("a stale ERROR is dropped; the newest request's error is shown", async () => {
  const v = visitor(), d1 = deferred(), d2 = deferred();
  const r1 = v.go("a", { d: d1 }), r2 = v.go("b", { d: d2 });
  d1.rej(new Error("boom-old")); assert.equal(await r1, "stale");
  d2.rej(new Error("boom-new")); assert.equal(await r2, "failed");
  assert.deepEqual(v.log.errors, [["b", "boom-new"]]);
});

test("superseded requests are aborted", async () => {
  const gate = H.latestGate();
  const a = gate.begin("p"), b = gate.begin("p");
  assert.ok(a.signal.aborted && !a.current() && b.current());
});

test("a background refresh never supersedes a foreground visit, nor lands on another path", async () => {
  const v = visitor({ path: "a" }), dv = deferred();
  const visit = v.go("b", { d: dv });
  assert.equal(await v.go("a", { background: true, d: deferred() }), "skipped");
  dv.res("b-doc"); assert.equal(await visit, "applied");
  // a refresh of "a" that was in flight when the pane moved to "b" is stale
  const v2 = visitor({ path: "a" }), dr = deferred();
  const refresh = v2.go("a", { background: true, d: dr });
  v2.shown.path = "b";
  dr.res("old-a"); assert.equal(await refresh, "stale");
  assert.deepEqual(v2.log.applied, []);
});

test("a visit supersedes an in-flight refresh of the same pane", async () => {
  const v = visitor({ path: "a" }), dr = deferred(), dv = deferred();
  const refresh = v.go("a", { background: true, d: dr });
  const visit = v.go("b", { d: dv });
  assert.equal(await refresh, "stale");
  dv.res("b"); assert.equal(await visit, "applied");
});

test("a disposed pane's answer is dropped", async () => {
  const v = visitor(), d = deferred();
  const r = v.go("x", { d }); v.log.alive = false;
  d.res("late"); assert.equal(await r, "stale");
  assert.deepEqual(v.log.applied, []);
});

test("memoFrame renders once per frame value", () => {
  let n = 0; const m = H.memoFrame((f) => { n++; return { f }; });
  const a = {}, b = {};
  assert.equal(m(a), m(a)); assert.equal(n, 1);
  m(b); m(b); assert.equal(n, 2);
});

test("language: sync hooks never return a Promise; honest status, retry after failure", async () => {
  const seen = []; let attempts = 0; const d = deferred();
  const lang = H.createLanguage({
    load: () => { attempts++; return attempts === 1 ? d.p : Promise.resolve({ evalWith: (s) => ({ text: s }) }); },
    notReady: (state, err, name) => ({ err: `${state}:${err}:${name}` }),
    onChange: (s) => seen.push(s),
  });
  const r = lang.call("evalWith", "1+1");
  assert.deepEqual(r, { err: "loading:null:evalWith" }); assert.ok(!(r instanceof Promise));
  assert.deepEqual(lang.call("evalWith", "x"), { err: "loading:null:evalWith" }); assert.equal(attempts, 1, "one load in flight");
  d.rej(new Error("net")); await tick();
  assert.equal(lang.state, "failed");
  assert.match(lang.call("evalWith", "x").err, /^failed:net/);   // and that call retried
  await tick(); await tick();
  assert.equal(lang.state, "ready"); assert.equal(attempts, 2);
  assert.deepEqual(lang.call("evalWith", "ok"), { text: "ok" });
  assert.deepEqual(seen, ["loading", "failed", "loading", "ready"]);
});

test("awaitLanguage: answers ready once; failure carries the message; a vanished pane gets nothing", async () => {
  const mk = (load) => H.createLanguage({ load, notReady: () => ({ "pending?": true }) });
  const run = async (lang, alive = () => true) => { const got = []; const r = await H.awaitLanguage(lang, { alive, answer: (x) => got.push(x) }); return { got, r }; };
  const d = deferred(); const slow = mk(() => d.p);
  assert.deepEqual(slow.call("evalWith", "x"), { "pending?": true });   // sync sentinel, no Promise
  const pending = run(slow); d.res({}); const a = await pending;
  assert.deepEqual(a.got, [{ ready: true }]);
  const bad = await run(mk(() => Promise.reject(new Error("net"))));
  assert.deepEqual(bad.got, [{ ready: false, message: "net" }]);
  const gone = await run(mk(() => Promise.resolve({})), () => false);
  assert.deepEqual(gone.got, []); assert.equal(gone.r, false);
});

// ─── easing ────────────────────────────────────────────────────────────────

function runGlide({ hz, rows = 10, kind = "wheel", reduced = false, frames = 400, apply }) {
  let t = 0, queue = null, total = 0, calls = 0, ms = null;
  const g = H.createGlide({
    now: () => t, reduced: () => reduced,
    schedule: (f) => { queue = f; return 1; }, cancel: () => { queue = null; },
    apply: apply || ((id, s) => { total += s; calls++; }),
  });
  g.add("p", rows, kind);
  for (let i = 0; i < frames && queue; i++) { t += 1000 / hz; const f = queue; queue = null; f(); if (ms === null && Math.abs(rows - total) < 0.5) ms = t; }
  return { total, calls, ms, g };
}

test("easing is elapsed-time based: 60/120/144 Hz settle alike and cover the distance", () => {
  const r = [60, 120, 144].map((hz) => runGlide({ hz }));
  for (const x of r) assert.ok(Math.abs(x.total - 10) < 0.05, "reaches target: " + x.total);
  const times = r.map((x) => x.ms);
  assert.ok(Math.max(...times) - Math.min(...times) < 40, "settle times within a frame or two: " + times);
  assert.ok(r[1].calls > r[0].calls * 1.8, "120 Hz takes proportionally more, smaller steps");
});

test("one 60 Hz frame covers the former 32 %", () => {
  assert.ok(Math.abs(H.easeStep(10, 1000 / 60) - 3.2) < 1e-9);
  assert.equal(H.easeStep(0.01, 16), 0.01, "tiny remainders finish at once");
  assert.ok(H.easeStep(10, 5000) < 10, "a stalled tab's huge dt is clamped, never overshoots");
});

test("reduced motion and trackpad deltas apply directly, with no easing", () => {
  const a = runGlide({ hz: 60, reduced: true }); assert.equal(a.calls, 1); assert.equal(a.total, 10);
  const b = runGlide({ hz: 60, rows: 0.4, kind: "trackpad" }); assert.equal(b.calls, 1); assert.equal(b.total, 0.4);
});

test("wheel vs trackpad classification", () => {
  assert.equal(H.classifyWheel({ deltaMode: 1, deltaY: 3 }), "wheel");
  assert.equal(H.classifyWheel({ deltaMode: 0, deltaY: 100, wheelDeltaY: -120 }), "wheel");
  assert.equal(H.classifyWheel({ deltaMode: 0, deltaY: 3.5 }), "trackpad");
  assert.equal(H.classifyWheel({ deltaMode: 0, deltaY: 4 }), "trackpad");
});

test("pane disposal: apply→false drops the glide; drop() cancels the frame", () => {
  const r = runGlide({ hz: 60, apply: () => false });
  assert.equal(r.g.has("p"), false);
  let q = null, cancelled = 0;
  const g = H.createGlide({ now: () => 0, schedule: (f) => (q = f, 7), cancel: (h) => { cancelled = h; }, apply: () => true });
  g.add("p", 5); g.drop("p"); assert.equal(cancelled, 7); assert.equal(g.has("p"), false);
});

test("packageUrl: bare names resolve under ./pkg", () => {
  assert.equal(H.packageUrl("inbox"), "./pkg/inbox.mjs");
  assert.equal(H.packageUrl("./x.mjs"), "./x.mjs");
  assert.equal(H.packageUrl("https://h/p.mjs"), "https://h/p.mjs");
});

test("task navigation preserves package and theme bootstrap parameters on reload", () => {
  const href = "http://localhost:8792/?file=omega%3Aoverview&use=present&theme=light&layout=inbox#latest";
  const next = new URL(H.documentUrl(href, "task:t-5", "inbox"), href);
  assert.equal(next.searchParams.get("file"), "task:t-5");
  assert.equal(next.searchParams.get("use"), "present");
  assert.equal(next.searchParams.get("theme"), "light");
  assert.equal(next.searchParams.get("layout"), "inbox");
  assert.equal(next.hash, "#latest");
  const single = new URL(H.documentUrl(href, "a.bl.org", "single"), href);
  assert.equal(single.searchParams.has("layout"), false);
});

