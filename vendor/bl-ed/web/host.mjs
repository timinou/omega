// vendor/bl-ed/web/host.mjs — the browser host for bl-ed.
//
// Everything the editor DECIDES is Beam Lisp (ed.* compiled by the sync JS
// profile). This file only:
//   * turns DOM input into editor events  {:type :key|:text|:click|:resize}
//   * draws the render model BL returns    (lines → segments → spans)
//   * performs the effects BL asks for     (:save :eval-cell :clipboard-write)
//
// Input goes through a hidden <textarea> that keeps focus, the technique
// CodeMirror 6 and Monaco use: keydown carries commands, `input` carries
// text (IME compositions, dead keys, paste) — so a composed "é" or a pasted
// paragraph reaches BL as ONE :text event, never as raw key codes.
//
// Rendering is keyed by row and diffed against the previous frame per line,
// so a keystroke repaints the lines it changed, not the viewport.
//
// The host holds a FRAME (ed/frame.bl), not an editor: one or more panes,
// each a whole editor (or a VIEW of one, like a minimap). A frame of one
// pane is the bl-ed this file always drew — same DOM, same ids. A layout
// (:(ed/layout "inbox"), ?layout=inbox) adds panes beside it.

// The exported primitives below hold the host's ordering/timing policy
// (latest-request-wins, language readiness, elapsed-time easing, one render per
// frame value). They do not touch the DOM: test/host.test.mjs drives this same
// code under Node, and the page itself boots only where a document exists.

import { documentPackages } from "./document-packages.mjs";
import * as R from "./out/rt.mjs";
import { packageHosts } from "./package-hosts.mjs";
import { frameGeometry } from "./frame-geometry.mjs";
import { frameObservers } from "./frame-observers.mjs";

// ─── primitives ────────────────────────────────────────────────────────────

/** Latest-request-wins per key (a pane). begin() aborts the key's previous
    request; a BACKGROUND request (a revision refresh) never supersedes an
    in-flight foreground one (a visit): it is skipped (returns null). */
export function latestGate() {
  const slots = new Map();
  return {
    begin(key, { background = false } = {}) {
      const cur = slots.get(key);
      if (background && cur && cur.fg) return null;
      cur?.ctl.abort();
      const ctl = new AbortController();
      const slot = { ctl, fg: !background };
      slots.set(key, slot);
      return {
        signal: ctl.signal,
        current: () => slots.get(key) === slot && !ctl.signal.aborted,
        done: () => { if (slots.get(key) === slot) slots.delete(key); },
      };
    },
    cancel(key) { const s = slots.get(key); if (s) { s.ctl.abort(); slots.delete(key); } },
    cancelAll() { for (const k of [...slots.keys()]) this.cancel(k); },
    busy(key) { return slots.has(key); },
  };
}

/** Run `run(signal)` as the latest request for `key`. Only a still-current,
    still-`valid()` outcome reaches onValue/onError; a stale one (an older
    visit, a pane that left or changed document) is dropped silently.
    onDone(mine) fires last; mine=false when a newer request owns the key.
    → "applied" | "failed" | "stale" | "skipped". */
export async function latestRequest(gate, key, { background = false, run, valid = () => true, onStart, onValue, onError, onDone }) {
  const t = gate.begin(key, { background });
  if (!t) return "skipped";
  onStart?.();
  try {
    const v = await run(t.signal);
    if (!t.current() || !valid()) return "stale";
    onValue(v);
    return "applied";
  } catch (err) {
    if (!t.current() || !valid()) return "stale";
    onError?.(err);
    return "failed";
  } finally {
    const mine = t.current();
    t.done();
    onDone?.(mine);
  }
}

/** The command-line language, loaded off the first-display critical path.
    BL calls its hooks SYNCHRONOUSLY, so a hook never returns a Promise: until
    ready, call() starts (or, after a failure, retries) the load and returns
    notReady(state, error, name): an honest, visible "still loading". */
export function createLanguage({ load, notReady, onChange = () => {} }) {
  let state = "idle", error = null, repl = null, p = null;
  const set = (s, e = null) => { state = s; error = e; onChange(s, e); };
  function start() {
    if (state === "ready") return Promise.resolve(repl);
    if (state === "loading") return p;
    set("loading");
    p = (async () => {
      try { repl = await load(); set("ready"); return repl; }
      catch (e) { set("failed", e && e.message ? e.message : String(e)); return null; }
    })();
    return p;
  }
  return {
    get state() { return state; },
    get error() { return error; },
    start,
    call(name, ...args) {
      if (state === "ready") return repl[name](...args);
      // a failed load reports its error once, THEN retries; otherwise start and report "loading"
      if (state === "failed") { const answer = notReady(state, error, name); start(); return answer; }
      start();
      return notReady(state, error, name);
    },
  };
}

/** Perform BL's {:kind :await-language} effect: wait for the language, then
    answer with a plain event BL interprets (it owns whether the draft/cell
    that asked is still the thing to retry). Only a vanished pane is the
    host's business. Never throws; never dispatches twice per call. */
export async function awaitLanguage(lang, { alive, answer }) {
  let ok = false;
  try { ok = (await lang.start()) != null && lang.state === "ready"; } catch { ok = false; }
  if (!alive()) return false;
  answer(ok ? { ready: true } : { ready: false, message: lang.error || "language failed to load" });
  return true;
}

/** One render per frame value: memoised on frame identity, so watchers, glide
    and layout metadata reuse the render the dispatch just painted. */
export function memoFrame(render) {
  let last, out, has = false;
  return (fr) => { if (has && fr === last) return out; const v = render(fr); last = fr; out = v; has = true; return v; };
}

/** Elapsed-time exponential easing. At 60 Hz a frame covers 32 % of what is
    left (the former fixed step); 120/144 Hz displays settle in the same time. */
export const GLIDE_TAU_MS = -(1000 / 60) / Math.log(1 - 0.32);
export function easeStep(rest, dtMs, tau = GLIDE_TAU_MS) {
  if (Math.abs(rest) < 0.02) return rest;
  const dt = Math.min(Math.max(dtMs, 0), 250);
  return rest * (1 - Math.exp(-dt / tau));
}

/** "wheel" (a notch: glides) or "trackpad" (continuous small deltas: passed
    through, since easing them again double-smooths). Line/page modes, classic
    multiples of 120 and large whole-pixel deltas are notches. */
export function classifyWheel(e) {
  if (e.deltaMode !== 0) return "wheel";
  if (typeof e.wheelDeltaY === "number" && e.wheelDeltaY !== 0 && e.wheelDeltaY % 120 === 0) return "wheel";
  return Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50 ? "wheel" : "trackpad";
}

/** Per-pane scroll glide. apply(id, rows) returns false once the pane is gone
    (its glide is dropped); schedule/cancel/now are rAF/cancelAF/clock. Reduced
    motion and trackpad deltas apply directly, with no easing. */
export function createGlide({ apply, schedule, cancel, now, reduced = () => false }) {
  const g = new Map();
  function tick(id) {
    const s = g.get(id); if (!s) return;
    s.raf = 0;
    const t = now(), dt = t - s.t; s.t = t;
    const eased = reduced() ? s.rest : easeStep(s.rest, dt);
    s.rest -= eased;
    const step = s.direct + eased; s.direct = 0;
    if (step !== 0 && apply(id, step) === false) { g.delete(id); return; }
    if (Math.abs(s.rest) < 0.001) { g.delete(id); return; }
    s.raf = schedule(() => tick(id));
  }
  return {
    add(id, rows, kind = "wheel") {
      let s = g.get(id);
      if (!s) { s = { rest: 0, direct: 0, raf: 0, t: now() }; g.set(id, s); }
      if (kind === "trackpad" || reduced()) s.direct += rows; else s.rest += rows;
      if (!s.raf) s.raf = schedule(() => tick(id));
    },
    drop(id) { const s = g.get(id); if (s) { if (s.raf) cancel(s.raf); g.delete(id); } },
    dropAll() { for (const id of [...g.keys()]) this.drop(id); },
    has: (id) => g.has(id),
  };
}

/** Preserve boot options when recording a document visit for reload. */
export function documentUrl(href, path, layout) {
  const url = new URL(href);
  url.searchParams.set("file", path);
  if (layout && layout !== "single") url.searchParams.set("layout", layout);
  else url.searchParams.delete("layout");
  return url.pathname + url.search + url.hash;
}

/** Where a package name loads from: a bare name is ./pkg/<name>.mjs. */
export const packageUrl = (name) => (/[/.:]/.test(name) ? name : `./pkg/${name}.mjs`);

// ─── the page ──────────────────────────────────────────────────────────────
// Runs only where there is a document (main() at the end), so the primitives
// above import cleanly under Node. The body is not re-indented.

export function presentationCommand(value) {
  const name = typeof value === "string" ? value : value?.fq;
  return typeof name === "string" && /^[A-Za-z][A-Za-z0-9_.!?/-]*$/.test(name) ? name : null;
}

async function main() {
// Optional embedding service: read/save documents locally without HTTP APIs.
const documents = globalThis.BL_DOCUMENTS || null;
let M, F;                                   // ed.main / ed.frame, imported in parallel with the first fetches

const K = R.kw;
const get = (m, k) => (m == null ? null : m.get(K(k), null));
const ev = (...kv) => R.hashMap(...kv);

// The language (reader + compiler + macros) is NOT awaited before the editor:
// `js/eval-ed` / `js/eval-cells` are SYNCHRONOUS host fns, so until it has
// loaded they answer {:err "…still loading"} (the editor shows it) and kick
// the load, which otherwise starts right after the first display.
const lang = createLanguage({
  load: async () => {
    const { start } = await import("./out/repl.mjs");
    const repl = await start(async (f) => (await fetch("./out/src/" + f)).text());
    window.blRepl = repl;
    return repl;
  },
  // the sync hooks answer {:pending? true}; BL then emits an :await-language
  // effect (below) and resumes — it keeps the user's draft meanwhile
  notReady: () => R.hashMap(K("pending?"), true),
  onChange: () => refreshChrome(),
});
globalThis.BL_HOST = Object.assign(globalThis.BL_HOST || {}, {
  "eval-ed": (src, api) => lang.call("evalWith", src, "ed", api),
  "eval-cells": (cells) => lang.call("evalCells", cells),
});


// ─── DOM scaffold ──────────────────────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);
const sink = $("#input-sink");
const status = $("#status");
const echo = $("#echo");
const minibuf = $("#minibuf");
const overlay = $("#overlay");

// A PANE's DOM: the #editor element (id :main) is the first pane; a layout
// clones it for the others. Every per-pane node is looked up by class inside
// the pane, so painting is the same code for every editor pane.
const panesEl = $("#panes");
const paneDom = new Map();                  // pane id → {root, view, gutter, selLayer, caret, frameLayer, hint}
function domFor(root) {
  const q = (c) => root.querySelector(c);
  return { root, view: q(".lines"), gutter: q(".gutter"), selLayer: q(".selections"), caret: q(".caret"),
           frameLayer: q(".frames"), hint: q(".scroll-hint"), page: q(".page") };
}
paneDom.set("main", domFor($("#editor")));

let fr = null;                              // the frame (ed/frame.bl)
const ed$ = () => F.d_focused(fr);          // the focused editor
let metrics = { line: 22, ch: 8.4 };       // measured once fonts load

function measure() {
  // the row height is a CSS token (--row); every line is exactly that tall,
  // so line N is at y = N * row with no per-line measurement
  const row = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--row"));
  const probe = document.createElement("span");
  probe.className = "seg";
  probe.textContent = "M".repeat(100);
  paneDom.get("main").view.appendChild(probe);
  metrics.ch = probe.getBoundingClientRect().width / 100;
  metrics.line = row || probe.getBoundingClientRect().height;
  probe.remove();
}

// ─── the loop ──────────────────────────────────────────────────────────────

// ONE render per dispatch: draw(), the watchers, glide and layout metadata all
// read the frame's render through this memo (keyed on the frame value).
const renderFrame = memoFrame((f) => F.d_render(f));
const paneView = (id) => { const p = get(renderFrame(fr), "panes").toArray().find((q) => get(q, "id").name === id); return p && get(p, "kind") === K("editor") ? get(p, "view") : null; };
const observers = frameObservers();
let bootQueue = [];                         // input typed before the first display: replayed, never dropped

// run the frame's pending effects, then paint
function settle() {
  const [fr2, effects] = F.d_take_effects(fr).toArray();
  fr = fr2;
  syncDocumentPackages();
  syncPackageHosts();
  for (const e of effects) perform(e);
  draw();
  syncPackageHosts();
  observers.notify(fr);
  return effects.length;
}

function dispatch(event) {
  if (!fr) { bootQueue.push(event); return; }
  const t0 = performance.now();
  fr = F.d_handle(fr, event);
  const n = settle();
  if (event.get(K("type"), null) !== K("key") || n) { watchDocs(); watchCards(false); }
  const dt = performance.now() - t0;
  lastFrame.push(dt); if (lastFrame.length > 60) lastFrame.shift();
}
const lastFrame = [];
window.blEdStats = () => {
  const s = [...lastFrame].sort((a, b) => a - b);
  return { frames: s.length, p50: s[Math.floor(s.length * 0.5)], p95: s[Math.floor(s.length * 0.95)], max: s[s.length - 1] };
};

// ─── effects ───────────────────────────────────────────────────────────────

// JSON ↔ Beam Lisp: maps get keyword keys, arrays become vectors.
function toBL(x) {
  if (Array.isArray(x)) return R.vecFromArray(x.map(toBL));
  if (x && typeof x === "object") { let m = R.EMPTY_MAP; for (const [k, v] of Object.entries(x)) m = m.assoc(K(k), toBL(v)); return m; }
  return x;
}
function toJS(x) {
  if (x instanceof R.Flt) return x.v;
  if (x instanceof R.HMap) { const o = {}; for (const [k, v] of x.entries()) o[k instanceof R.Kw ? k.fq : String(k)] = toJS(v); return o; }
  if (x instanceof R.Vec) return x.toArray().map(toJS);
  if (x instanceof R.Kw) return x.fq;
  return x;
}
const postJSON = (url, body) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const pkgHosts = packageHosts({ dispatch: e => {
  let event = toBL(e);
  for (const k of ["type", "command", "pane"]) if (typeof e[k] === "string") event = event.assoc(K(k), K(e[k]));
  dispatch(event);
}, toBL, toJS,
  language: () => lang.start() });
const documentAutoUsed = new Set(), documentSuppressed = new Set();
let previousPackageNames = new Set();
function syncDocumentPackages() {
  const names = new Set();
  for (const id of F.d_editor_ids(fr)) for (const pkg of get(F.d_editor(fr, id), "packages") || []) names.add(get(pkg, "name"));
  for (const name of previousPackageNames) if (!names.has(name)) documentSuppressed.add(name);
  previousPackageNames = names;
}
function syncPackageHosts() {
  const names = new Set();
  for (const id of F.d_editor_ids(fr)) {
    const ed = F.d_editor(fr, id);
    for (const p of get(ed, "packages") || []) names.add(get(p, "name"));
  }
  pkgHosts.sync(names);
}

// an event for the pane that asked (a host answer carries {:pane id} back)
const toPane = (pane, e) => (pane == null ? e : e.assoc(K("pane"), pane));

// Latest request wins per PANE. A visit (foreground) aborts whatever that pane
// was fetching; a revision refresh (background) yields to an in-flight visit.
// A pane keeps its last screen while a document loads; its answer is applied
// only if it is still the newest request AND the pane still exists (and, for a
// refresh, still shows that path), so an older slow answer or error can never
// overwrite a newer visit. The pane's status chip says what is loading.
// Host-issued session identity orders effects across asynchronous requests.
const clientId = crypto.randomUUID();
let clientSequence = 0;
const gate = latestGate();
const loading = new Map();                  // pane id → path being visited
const paneKey = (pane) => (pane == null ? "main" : pane.name ?? String(pane));
const paneAlive = (pane) => !!F.d_editor(fr, K(paneKey(pane)));
const paneShows = (pane, path) => get(get(paneView(paneKey(pane)), "status"), "path") === path;
function setLoading(pane, path) {
  const id = paneKey(pane);
  if (path == null) loading.delete(id); else loading.set(id, path);
  const dom = paneDom.get(id);
  if (dom) { dom.root.classList.toggle("loading", path != null); if (path != null) dom.root.dataset.loading = path; else delete dom.root.dataset.loading; }
  refreshChrome();
}
async function fetchDoc(path, signal) {
  const j = documents ? await documents.read(path, signal)
    : await (await fetch("/api/doc?path=" + encodeURIComponent(path), { signal })).json();
  if (j.ok) j.packageEvents = await Promise.all(documentPackages(j.text, { loaded: fr ? new Set([...(get(ed$(), "packages") || [])].map(p => get(p, "name"))) : new Set(), suppressed: documentSuppressed }).map(async name => ({ name, event: await loadPackage(name) })));
  return j;
}
function installDocumentPackages(j) {
  for (const { name, event } of j.packageEvents || []) {
    if (documentSuppressed.has(name)) continue;
    const loaded = [...(get(ed$(), "packages") || [])].some(p => get(p, "name") === name);
    if (!loaded && get(event, "package")) { documentAutoUsed.add(name); dispatch(event); }
  }
}
function loadDoc(path, visit, goto, pane) {
  const id = paneKey(pane);
  return latestRequest(gate, id, {
    background: !visit,
    run: (signal) => fetchDoc(path, signal),
    valid: () => paneAlive(pane) && (visit || paneShows(pane, path)),
    onStart: () => { if (visit) setLoading(pane, path); },
    onDone: (mine) => { if (mine && visit) setLoading(pane, null); },
    onValue: (j) => applyDoc(j, path, visit, goto, pane),
    onError: (err) => { if (visit) dispatch(toPane(pane, ev(K("type"), K("eval-result"), K("id"), path, K("text"), "cannot open " + path + ": " + (err && err.message ? err.message : err) + " — select it again to retry"))); },
  });
}
function applyDoc(j, path, visit, goto, pane) {
  if (!j.ok) { dispatch(toPane(pane, ev(K("type"), K("eval-result"), K("id"), path, K("text"), j.message || "cannot open"))); return; }
  let e = ev(K("type"), K("doc"), K("path"), path, K("text"), j.text, K("rev"), j.rev, K("read-only?"), !!j.readOnly,
             K("title"), j.title || path, K("objects"), toBL(j.objects || []), K("data"), toBL(j.data ?? null), K("visit?"), !!visit);
  if (goto) e = e.assoc(K("goto"), goto);
  dispatch(toPane(pane, e));
  installDocumentPackages(j);
  if (visit && (pane == null || paneKey(pane) === get(fr, "focus").name)) history.replaceState(null, "", documentUrl(location.href, path, get(renderFrame(fr), "layout")));
}

// A generic leave event lets packages release host resources without IO in BL.
window.addEventListener("pagehide", () => {
  for (const key of [...watchers.keys()]) unwatch(key);
  pkgHosts.dispose();
  if (!fr) return;
  for (const pane of F.d_editor_ids(fr)) fr = F.d_handle(fr, ev(K("type"), K("session-leave"), K("pane"), pane));
  const [next, effects] = F.d_take_effects(fr).toArray(); fr = next;
  for (const e of effects) {
    if (get(e, "kind") !== K("intent")) continue;
    const body = { intent: get(e, "intent"), args: { ...toJS(get(e, "args")), client: clientId, "client-seq": ++clientSequence } };
    if (!documents) navigator.sendBeacon("/api/intent", new Blob([JSON.stringify(body)], { type: "application/json" }));
  }
});
window.addEventListener("pageshow", event => {
  if (!fr || !event.persisted) return;
  for (const pane of F.d_editor_ids(fr)) dispatch(ev(K("type"), K("session-resume"), K("pane"), pane));
});

const assetUploads = new Map();
const assetPreviews = new Map();
async function storeAsset(url, data) {
  if (documents) throw new Error("Local image storage is unavailable in this embedding");
  const task = (async () => {
    const r = await postJSON("/api/assets", { name: url.split("/").pop(), data });
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.message || "image save failed");
  })();
  assetUploads.set(url, task);
  // Keep failures observable by save, without an unhandled rejection.
  task.catch(() => {});
  return task;
}
async function perform(eff) {
  const pane = get(eff, "pane");
  const e = eff;
  const dispatchP = (x) => dispatch(toPane(pane, x));
  const kind = get(e, "kind").name;
  if (kind === "package-host") {
    try { await pkgHosts.effect(get(e, "package"), toJS(e)); }
    catch (err) { dispatchP(ev(K("type"), K("eval-result"), K("id"), "package-host", K("text"), err.message)); }
  } else if (kind === "asset-store") {
    try { await storeAsset(get(e, "url"), get(e, "data")); }
    catch (err) { dispatchP(ev(K("type"), K("asset-error"), K("message"), "Image not saved: " + err.message + " — paste again to retry")); }
  } else if (kind === "visit") {
    loadDoc(get(e, "path"), true, get(e, "goto"), pane);
  } else if (kind === "intent") {
    try {
      if (documents) throw new Error("World intents are unavailable in this embedding");
      const r = await postJSON("/api/intent", { intent: get(e, "intent"), args: { ...toJS(get(e, "args")), client: clientId, "client-seq": ++clientSequence } });
      const j = await r.json();
      dispatchP(ev(K("type"), K("intent-result"), K("ok?"), j.ok === true, K("message"), j.message || null,
                  K("data"), toBL(j), K("then"), get(e, "then"), K("block"), get(e, "block"), K("path"), get(e, "path")));
      watchCards(true);
    } catch (err) {
      dispatchP(ev(K("type"), K("intent-result"), K("ok?"), false, K("message"), err.message || "Host request failed",
                  K("then"), get(e, "then"), K("block"), get(e, "block"), K("path"), get(e, "path")));
    }
  } else if (kind === "save") {
    const body = { path: get(e, "path"), text: get(e, "text"), base: get(e, "base"), client: clientId, "client-seq": ++clientSequence };
    try {
      try {
        for (const [url, upload] of assetUploads) if (body.text.includes(url)) await upload;
      } catch (err) {
        dispatchP(ev(K("type"), K("saved"), K("rev"), get(e, "rev"), K("ok?"), false, K("message"), "Image not saved — paste it again to retry"));
        return;
      }
      const r = documents ? null : await postJSON("/api/save", body);
      const j = documents ? await documents.save(body) : await r.json();
      dispatchP(ev(K("type"), K("saved"), K("rev"), get(e, "rev"), K("ok?"), (documents || r.ok) && j.ok === true, K("message"), j.message || "",
                  K("conflict?"), j.conflict === true, K("doc-rev"), j.rev || null, K("text"), j.text ?? null, K("submitted-text"), body.text));
    } catch (err) {
      if (documents || get(e, "require-server?")) {
        dispatchP(ev(K("type"), K("saved"), K("rev"), get(e, "rev"), K("ok?"), false, K("message"), documents ? "Local save failed: " + err.message + "; draft retained." : "Not published: host unavailable; draft retained."));
      } else {
        // Static-page editors may still explicitly use the download fallback.
        download(body.path.split("/").pop(), body.text);
        dispatchP(ev(K("type"), K("saved"), K("rev"), get(e, "rev"), K("ok?"), true, K("message"), "downloaded"));
      }
    }
  } else if (kind === "await-language") {
    const token = get(e, "token");
    awaitLanguage(lang, {
      alive: () => paneAlive(pane),
      answer: (r) => dispatchP(r.ready
        ? ev(K("type"), K("language-ready"), K("token"), token)
        : ev(K("type"), K("language-failed"), K("token"), token, K("message"), r.message)),
    });
  } else if (kind === "eval-cell") {
    if (documents) {
      try { const vm = await lang.start(); if (!vm) throw new Error("Language unavailable");
        dispatchP(ev(K("type"), K("eval-result"), K("id"), get(e,"id"), K("text"), R.printStr(vm.evalString(get(e,"text")))));
      } catch (err) { dispatchP(ev(K("type"), K("eval-result"), K("id"), get(e,"id"), K("text"), err.message || String(err))); }
      return;
    }
    try {
      const r = await fetch("/api/eval", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: get(e, "path"), id: get(e, "id"), text: get(e, "text") }) });
      const j = await r.json();
      if (j.text != null) dispatchP(ev(K("type"), K("load"), K("text"), j.text, K("path"), get(e, "path")));
      dispatchP(ev(K("type"), K("eval-result"), K("id"), get(e, "id"), K("text"), j.result || j.message || "done"));
    } catch (err) {
      dispatchP(ev(K("type"), K("eval-result"), K("id"), get(e, "id"), K("text"), "no evaluation server — run `bl run apps/bl-ed/serve.bl`"));
    }
  } else if (kind === "place") {
    if (documents) { dispatchP(ev(K("type"), K("placements"), K("cells"), R.EMPTY_MAP)); return; }
    // where each cell may run (system.place on the BEAM): local cells then
    // evaluate in the page; no server → no placements, every cell goes there
    try {
      const r = await fetch("/api/place", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: get(e, "path"), text: get(e, "text") }) });
      const j = await r.json();
      if (j.ok) {
        let cells = R.EMPTY_MAP;
        for (const [id, p] of Object.entries(j.cells)) cells = cells.assoc(id, R.hashMap(K("place"), K(p.place), K("why"), p.why ?? null));
        dispatchP(ev(K("type"), K("placements"), K("cells"), cells));
      }
    } catch (err) { /* offline: placements stay unknown */ }
  } else if (kind === "load-package") {
    // a module is an ES module exporting `package` (a BL map, ed/pkg.bl) — or
    // a compiled BL namespace with a `bl-package` var (d_bl_package);
    // a bare name resolves to ./pkg/<name>.mjs next to the page
    const name = get(e, "name");
    documentSuppressed.delete(name);documentAutoUsed.delete(name);
    const url = packageUrl(name);
    try {
      const mod = await withTimeout(import(new URL(url, location.href).href), 15000, url);
      const p = mod.package ?? mod.d_bl_package;
      if (p) pkgHosts.register(get(typeof p === "function" ? p() : p, "name"), mod.createHost);
      dispatchP(ev(K("type"), K("use"), K("package"), typeof p === "function" ? p() : p, K("message"), p ? null : url + " exports no `package`"));
    } catch (err) {
      dispatchP(ev(K("type"), K("use"), K("package"), null, K("message"), "cannot load " + url + ": " + err.message));
    }
  } else if (kind === "clipboard-write") {
    navigator.clipboard?.writeText(get(e, "text")).catch(() => {});
  }
}

// ─── watching: the shown document and the cards, by rev (long-poll) ─────────
//
// One parked request per watched path: /api/rev answers as soon as the rev
// differs from `since` (or after ~25 s unchanged). Nothing renders while
// nothing changes. A changed rev → fetch the document → one :doc / :cards event.

const watchers = new Map();       // key → {path, since, alive}
let requestedVisible = !window.frameElement?.closest("[inert]");
let viewerVisible = requestedVisible && !document.hidden;
function watch(key, path, since, onChange) {
  if (documents || !viewerVisible) return;
  const cur = watchers.get(key);
  if (cur && cur.path === path) return;
  if (cur) unwatch(key);
  const w = { path, since, alive: true, controller: new AbortController() };
  watchers.set(key, w);
  (async () => {
    while (w.alive) {
      try {
        const r = await fetch("/api/rev?path=" + encodeURIComponent(path) + "&since=" + encodeURIComponent(w.since || ""), {signal:w.controller.signal});
        const j = await r.json();
        if (!w.alive) break;
        // a refresh that did not land (yielded to a visit, failed) is retried:
        // `since` goes back so the next poll answers at once, after a pause
        if (j.ok && j.rev !== w.since) {
          const prev = w.since; w.since = j.rev;
          const out = await onChange();
          if (out != null && out !== "applied" && out !== "stale") { w.since = prev; await new Promise((res) => setTimeout(res, 3000)); }
        }
        else if (!j.ok) await new Promise((res) => setTimeout(res, 3000));
      } catch (err) { if (w.alive) await new Promise((res) => setTimeout(res, 3000)); }
    }
  })();
}
function unwatch(key) { const w = watchers.get(key); if (w) { w.alive = false; w.controller.abort(); watchers.delete(key); } }

// Visibility suspends observation, not the editor, its actors or its audio.
// Aborting parked HTTP/1 requests leaves connection capacity for foreground
// assets and Workers. A retained same-origin parent calls this directly.
function setViewerVisible(visible) {
  requestedVisible = !!visible;
  const next = requestedVisible && !document.hidden;
  if (next === viewerVisible) return;
  viewerVisible = next;
  if (!next) { for (const key of [...watchers.keys()]) unwatch(key); cardIds = ""; }
  else if (fr) { watchDocs(); watchCards(true); }
}
document.addEventListener("visibilitychange", () => setViewerVisible(requestedVisible));

// one watch per editor pane's document; a pane that left drops its watch
function watchDocs() {
  const live = new Set();
  for (const p of get(renderFrame(fr), "panes").toArray()) {
    if (get(p, "kind") !== K("editor")) continue;
    const id = get(p, "id"), v = get(p, "view");
    const path = get(get(v, "status"), "path");
    if (!path) continue;
    const key = "doc:" + id.name;
    live.add(key);
    watch(key, path, get(v, "doc-rev"), () => loadDoc(path, false, null, id));
  }
  for (const k of [...watchers.keys()]) if (k.startsWith("doc:") && !live.has(k)) unwatch(k);
}

let cardIds = "";
async function loadCards(path) {
  if (documents) return;
  const r = await fetch("/api/doc?path=" + encodeURIComponent(path));
  const j = await r.json();
  if (j.ok) for (const pane of F.d_editor_ids(fr)) dispatch(ev(K("type"), K("cards"), K("data"), toBL(j.data || []), K("pane"), pane));
}
function watchCards(force) {
  const ids = [...new Set(get(renderFrame(fr), "panes").toArray()
    .filter(p => get(p, "kind") === K("editor"))
    .flatMap(p => (get(get(p, "view"), "cards") || R.vec()).toArray()))].sort().join(",");
  if (!ids) { unwatch("cards"); cardIds = ""; return; }
  if (ids === cardIds && !force) return;
  cardIds = ids;
  const path = "omega:tasks?ids=" + ids;
  if (force) unwatch("cards");
  watch("cards", path, null, () => loadCards(path));
}

function download(name, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  a.download = name || "untitled.bl.org";
  a.click();
  URL.revokeObjectURL(a.href);
}

// ─── drawing ───────────────────────────────────────────────────────────────

function segSig(segs) { let s = ""; for (const g of segs) s += get(g, "kind").name + "\u0001" + get(g, "text") + "\u0001" + (presentationCommand(get(g, "command")) || "") + "\u0002"; return s; }

function draw() {
  const rv = renderFrame(fr);
  const panes = get(rv, "panes").toArray();
  syncPanes(panes);
  let focusV = null;
  for (const p of panes) {
    const id = get(p, "id").name, dom = paneDom.get(id);
    if (!dom) continue;
    dom.root.classList.toggle("loading", loading.has(id));
    if (loading.has(id)) dom.root.dataset.loading = loading.get(id); else delete dom.root.dataset.loading;
    if (get(p, "kind") === K("view")) { paintView(dom, p); continue; }
    const v = get(p, "view");
    dom.root.classList.toggle("focus", !!get(p, "focus?"));
    const focused = !!get(p, "focus?"), editor = F.d_editor(fr, get(p, "id"));
    const previous = dom.painted;
    if (!previous || previous.editor !== editor || previous.focused !== focused || previous.ch !== metrics.ch || previous.line !== metrics.line) {
      paint(dom, v, focused);
      dom.painted = { editor, focused, ch: metrics.ch, line: metrics.line };
    }
    if (get(p, "focus?")) focusV = v;
  }
  chrome(focusV, rv);
}

// ─── panes: the DOM follows the frame's layout ─────────────────────────────
//
// #panes holds one element per pane, in layout order. The first editor pane
// is the original #editor; other editor panes are clones of its skeleton; a
// view pane is a plain box its painter fills. Widths come from :width:
// [:ch n] → n cells, :fill / [:fr n] → a share of the rest.

const editorSkeleton = $("#editor").cloneNode(true);
// There is one input sink for the frame; clones must not contain extra textareas.
editorSkeleton.querySelector("#input-sink")?.remove();
function cssWidth(w) {
  if (w == null || w === K("fill")) return "minmax(0, 1fr)";
  const a = w.toArray ? w.toArray() : null;
  if (a && a[0] === K("ch")) return `${a[1]}ch`;
  if (a && a[0] === K("fr")) return `minmax(0, ${a[1]}fr)`;
  return "minmax(0, 1fr)";
}
let layoutSig = "";
function syncPanes(panes) {
  const heldInput = document.activeElement === sink;
  const sig = panes.map((p) => get(p, "id").name + ":" + get(p, "kind").name).join(",");
  const geometry = frameGeometry(panes.map(p => ({id:get(p,"id").name,
    width:cssWidth(get(p,"width")),dock:get(p,"dock")?.name,height:get(p,"height")})));
  panesEl.style.gridTemplateColumns = geometry.columns;
  panesEl.style.gridTemplateRows = geometry.rows;
  panesEl.classList.toggle("multi", panes.length > 1);
  const visibility = () => { for (const p of panes) {
    const d = paneDom.get(get(p, "id").name), w = get(p, "width"), a = w?.toArray?.();
    if (d) { const place = geometry.placements.get(get(p,"id").name);
      d.root.style.gridRow = place.row; d.root.style.gridColumn = place.column;
      const hidden = get(p,"dock") ? get(p,"height") === 0 : a?.[0] === K("ch") && a[1] === 0; d.root.inert = hidden;
      if (hidden) d.root.setAttribute("aria-hidden", "true"); else d.root.removeAttribute("aria-hidden"); }
  } };
  if (sig === layoutSig) { visibility(); return; }
  layoutSig = sig;
  // 1. the original #editor always serves the FIRST editor pane (re-key it)
  const first = get(panes.find((p) => get(p, "kind") === K("editor")), "id").name;
  const original = [...paneDom].find(([, d]) => d.root.id === "editor");
  if (original && original[0] !== first) {
    const displaced = paneDom.get(first);          // a clone that held `first` before: drop it
    if (displaced && displaced.root.id !== "editor") displaced.root.remove();
    paneDom.delete(original[0]); paneDom.set(first, original[1]);
  }
  // 2. panes the layout no longer has go away (the original is kept in the
  //    map under the first editor pane's id, so it is never removed here)
  const want = new Set(panes.map((p) => get(p, "id").name));
  for (const [id, d] of [...paneDom]) if (!want.has(id)) { if (d.root.id !== "editor") d.root.remove(); paneDom.delete(id); glide.drop(id); gate.cancel(id); loading.delete(id); }
  for (const n of [...panesEl.children]) if (![...paneDom.values()].some((d) => d.root === n)) n.remove();
  // 3. new panes: an editor pane clones the skeleton, a view pane is a box
  for (const p of panes) {
    const id = get(p, "id").name;
    if (paneDom.has(id)) continue;
    if (get(p, "kind") === K("view")) {
      const root = document.createElement("aside");
      root.className = "pane view view-" + get(p, "view-kind").name;
      Object.assign(root.style, {position:"relative",minWidth:"0",minHeight:"0",overflow:"hidden"});
      root.innerHTML = '<div class="view-body"></div><div class="view-lens"></div>';
      paneDom.set(id, { root, body: root.querySelector(".view-body"), lens: root.querySelector(".view-lens") });
    } else {
      const root = editorSkeleton.cloneNode(true);
      root.removeAttribute("id");
      for (const n of root.querySelectorAll("[id]")) n.removeAttribute("id");
      root.querySelector(".lines").textContent = ""; root.querySelector(".gutter").textContent = "";
      paneDom.set(id, domFor(root));
    }
  }
  // 4. layout order, and each root knows its pane id
  for (const p of panes) { const id = get(p, "id").name, d = paneDom.get(id); d.root.dataset.pane = id; panesEl.appendChild(d.root); }
  visibility();
  if (heldInput && !sink.closest("[inert]")) sink.focus({ preventScroll: true });
  requestAnimationFrame(fitHeight);
}

// ─── view panes: a painter per view kind ───────────────────────────────────
//
// A view's model comes from BL (a package :provides {:views {kind fn}});
// the host only paints it and turns pointer input into events FOR the pane
// it views ({:pane of …}). Painters are keyed by kind.

const MAP_ROW = 3;                          // px per screen row in a minimap
const viewPainters = {
  // Same-origin embedded tools. Packages supply a URL, never HTML or host IO.
  embed(dom, p) {
    Object.assign(dom.root.style, {position:"relative",minWidth:"0",minHeight:"0",overflow:"hidden"});
    dom.body.style.cssText = "position:absolute;inset:0";
    const model = get(p, "view"), src = model && get(model, "src");
    if (!src) { dom.body.replaceChildren(); return; }
    const url = new URL(src, location.href);
    if (url.origin !== location.origin || !["http:", "https:"].includes(url.protocol)) return;
    if (dom.body.firstElementChild?.dataset.embedSource === url.href) {
      dom.body.firstElementChild.contentWindow?.blEd?.setVisible?.(!dom.root.inert);
      return;
    }
    const frame = document.createElement("iframe");
    frame.dataset.embedSource = url.href;
    frame.title = get(model, "title") || "Embedded tool";
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox");
    frame.allow = "autoplay; clipboard-read; clipboard-write; fullscreen";
    frame.style.cssText = "width:100%;height:100%;border:0;display:block";
    frame.src = url.href;
    frame.addEventListener("load", () => frame.contentWindow?.blEd?.setVisible?.(!dom.root.inert));
    dom.body.replaceChildren(frame);
  },
  // Generic image view: the package supplies the model; the host paints it.
  // Optional polling stops when the pane disappears. No domain knowledge here.
  image(dom, p) {
    const model = get(p, "view");
    const src = model && get(model, "src");
    if (!src) { dom.body.replaceChildren(); dom.imageSource = null; return; }
    const refresh = get(model, "refresh-ms") || 0;
    const signature = src + ":" + refresh;
    if (dom.imageSource === signature) return;
    dom.imageSource = signature;
    const img = document.createElement("img");
    img.alt = get(model, "alt") || "";
    img.style.cssText = "width:100%;height:100%;object-fit:contain";
    const update = () => {
      if (!img.isConnected) return;
      const url = new URL(src, location.href);
      if (!["http:", "https:"].includes(url.protocol)) return;
      if (refresh) url.searchParams.set("capture", Date.now());
      img.src = url.href;
    };
    let timer;
    const schedule = () => {
      clearTimeout(timer);
      if (refresh && img.isConnected) timer = setTimeout(update, Math.max(1000, refresh));
    };
    img.onload = schedule; img.onerror = schedule;
    dom.body.replaceChildren(img); update();
  },
  minimap(dom, p) {
    const m = get(p, "view");
    if (!m) { dom.body.replaceChildren(); dom.map = null; return; }
    const bars = get(m, "bars").toArray();
    const height = dom.viewportHeight ?? dom.root.clientHeight;
    const width = dom.viewportWidth ?? dom.root.clientWidth;
    const signature = JSON.stringify(bars.map((b) => [get(b, "role").name, get(b, "w"), get(b, "size"), get(b, "label"), get(b, "row")]));
    if (!dom.map || dom.map.signature !== signature || dom.map.height !== height || dom.map.width !== width) {
      const ys = []; let y = 0;
      for (const b of bars) { ys.push(y); y += (get(b, "size") || 1) * MAP_ROW; }
      const k = Math.min(1, Math.max(0, height - 16) / Math.max(1, y));
      const ch = Math.max(0, width - 24) / 84;
      const fragment = document.createDocumentFragment();
      bars.forEach((b, i) => {
        const d = document.createElement("div");
        d.className = "bar r-" + get(b, "role").name;
        d.style.cssText = `top:${ys[i] * k}px;height:${Math.max(1, (get(b, "size") || 1) * MAP_ROW * k - 1)}px;width:${Math.max(2, Math.min(84, get(b, "w")) * ch)}px`;
        fragment.appendChild(d);
        const label = get(b, "label");
        if (label) { const t = document.createElement("div"); t.className = "maplabel"; t.textContent = label; t.style.top = ys[i] * k + "px"; fragment.appendChild(t); }
      });
      dom.body.replaceChildren(fragment);
      dom.map = { signature, height, width, ys, y, k };
      dom.root.dataset.k = k; dom.root.dataset.ys = JSON.stringify(ys);
    }
    dom.root.dataset.of = get(p, "of").name;
    const { ys, y, k } = dom.map;
    const top = get(m, "top"), end = get(m, "end"), fraction = get(m, "frac") || 0;
    const offset = fraction * MAP_ROW;
    const css = `top:${((ys[top] ?? 0) + offset) * k}px;height:${Math.max(8, ((ys[end] ?? y) - (ys[top] ?? 0)) * k)}px`;
    if (dom.lens.style.cssText !== css) dom.lens.style.cssText = css;
  },
};
function paintView(dom, p) {
  if (get(p, "view-kind") === K("host") || get(get(p, "view"), "package")) {
    const model = toJS(get(p, "view"));
    if (model?.package) pkgHosts.paint(model.package, dom.body, model, get(p, "of").name);
    return;
  }
  // Pure package models may select an existing generic renderer.
  const renderer = get(get(p, "view"), "renderer") || get(p, "view-kind").name;
  const f = Object.prototype.hasOwnProperty.call(viewPainters, renderer) && viewPainters[renderer]; if (f) f(dom, p);
}
function minimapSlotAt(root, clientY) {
  const k = +root.dataset.k, ys = JSON.parse(root.dataset.ys || "[]");
  const y = (clientY - root.querySelector(".view-body").getBoundingClientRect().top) / k;
  let i = 0; while (i + 1 < ys.length && ys[i + 1] <= y) i++;
  return i;
}
let mapDrag = null;
panesEl.addEventListener("mousedown", (e) => {
  const root = e.target.closest(".view-minimap"); if (!root || !fr) return;
  e.preventDefault(); mapDrag = root;
  dispatch(ev(K("type"), K("scroll-to-slot"), K("pane"), K(root.dataset.of), K("y"), Math.max(0, minimapSlotAt(root, e.clientY) - 6)));
});
window.addEventListener("mousemove", (e) => { if (mapDrag && !mapDrag.isConnected) mapDrag = null; if (mapDrag) dispatch(ev(K("type"), K("scroll-to-slot"), K("pane"), K(mapDrag.dataset.of), K("y"), Math.max(0, minimapSlotAt(mapDrag, e.clientY) - 6))); });
window.addEventListener("mouseup", () => { mapDrag = null; });

// ─── one editor pane ───────────────────────────────────────────────────────

function paint(dom, v, focused) {
  const { view, gutter, selLayer, caret, frameLayer } = dom;
  const lineNode = (row) => lineNodeIn(view, row);
  const positions = new Map();
  const xOf = (row, col) => {
    const key = row + ":" + col;
    if (!positions.has(key)) positions.set(key, xOfIn(view, row, col));
    return positions.get(key);
  };
  const lineLen = (row) => lineLenIn(view, row);
  const lines = get(v, "lines");
  const top = get(v, "top");

  // lines: rebuild only rows whose content signature changed
  const nextLines = new Map();
  const frag = [];
  for (const ln of lines) {
    const row = get(ln, "row");
    // a package's presentation may draw ORNAMENT rows: derived text with no
    // row of its own; :src is the row a click lands on (ed/pkg.bl :render)
    const orn = get(ln, "ornament?");
    const size = get(ln, "size") || 1, role = get(ln, "role");
    const segs = get(ln, "segments");
    const band = get(ln, "band");
    const cls = "line" + (band ? " in-cell band-" + band : "") + (get(ln, "band-first?") ? " first" : "") +
      (get(ln, "band-last?") ? " last" : "") + (get(ln, "current?") ? " cur-line" : "");
    const place = get(ln, "agent?") ? "agent" : get(ln, "place"), why = get(ln, "place-why");
    // a reference row is DRAWN as its task's card: same row, same height
    const card = get(ln, "card");
    const obj = get(ln, "object");
    const cls2 = cls + (card ? " card tone-" + get(card, "tone") : "") + (obj ? " obj" : "") + (orn ? " ornament" : "")
      + (role ? " r-" + role.name : "") + (size > 1 ? " big" : "");
    const shown = card ? R.vec(ev(K("kind"), K("card"), K("text"), get(card, "text"))) : segs;
    const sig = segSig(shown) + (get(ln, "folded?") ? "\u0003" : "") + "\u0004" + cls2;
    nextLines.set(row ?? "o" + get(ln, "key"), sig);
    frag.push([row, sig, shown, get(ln, "folded?"), cls2, get(ln, "current?"), place, why, orn ? get(ln, "src") : null, size, get(ln, "vy")]);
  }
  // Reconcile by SLOT: slot i shows row frag[i]. A slot is touched only when
  // its row's signature changed (a scroll shifts every slot; a keystroke
  // usually touches one or two). The gutter is reconciled the same way.
  // Smooth scrolling: a presentation reports how many rows the body is scrolled
  // past its top slot (:frac, fractional) and, per line, whether it scrolls
  // (:fixed? rows — a sticky headline, the docked composer — do not), how much
  // of it the body's edges hide (:clip-top/:clip-bottom, rows) and whether it is
  // a slot peeking in below the body (:peek?, taken out of flow). The grid
  // stays integral; only transforms move.
  const frac = get(v, "frac") || 0;
  const lineArr = lines.toArray();
  const shiftOf = (ln) => {
    if (get(ln, "fixed?") || !frac) return { t: "", c: "", abs: null };
    const ct = get(ln, "clip-top") || 0, cb = get(ln, "clip-bottom") || 0;
    return { t: `translateY(${-frac * metrics.line}px)`, c: ct || cb ? `inset(${ct * metrics.line}px 0 ${cb * metrics.line}px 0)` : "", abs: null };
  };
  const place$ = (node, ln, sh) => {
    const peek = !!get(ln, "peek?");
    const css = peek ? "position:absolute;left:0;right:0;top:" + get(ln, "vy") * metrics.line + "px" : "";
    if (node.dataset.pos !== css) { node.dataset.pos = css; node.style.position = peek ? "absolute" : ""; node.style.left = peek ? "0" : ""; node.style.right = peek ? "0" : ""; node.style.top = peek ? get(ln, "vy") * metrics.line + "px" : ""; }
    const t = peek ? "" : sh.t;
    if (node.style.transform !== t) node.style.transform = t;
    const c = sh.c || (peek && (get(ln, "clip-top") || get(ln, "clip-bottom")) ? `inset(${(get(ln, "clip-top") || 0) * metrics.line}px 0 ${(get(ln, "clip-bottom") || 0) * metrics.line}px 0)` : "");
    if (node.style.clipPath !== c) node.style.clipPath = c;
  };
  for (let i = 0; i < frag.length; i++) {
    const [row, sig, segs, folded, cls, current, place, why, src, size, vy] = frag[i];
    let node = view.children[i];
    if (!node || node.dataset.sig !== sig) {
      const fresh = document.createElement("div");
      fresh.className = cls;
      if (row != null) fresh.dataset.row = row; else fresh.dataset.src = src;
      if (size > 1) fresh.style.height = size * metrics.line + "px";
      fresh.dataset.sig = sig;
      for (const g of segs) {
        const s = document.createElement("span");
        s.className = "seg k-" + get(g, "kind").name;
        const command = presentationCommand(get(g, "command"));
        if (command) {
          s.dataset.command = command; s.setAttribute("role", "button"); s.tabIndex = 0;
          s.title = get(g, "doc") || command;
          s.addEventListener("keydown", event => {
            if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activateCommand(s, command); }
          });
        }
        if (get(g, "kind").name === "image") {
          const url = get(g, "text");
          if (/^\/api\/assets\/[a-f0-9]{64}\.(png|jpg|webp)$/.test(url)) {
            const img = document.createElement("img");
            img.src = assetPreviews.get(url) || url;
            img.alt = "Pasted image";
            img.draggable = false;
            s.appendChild(img);
          }
        } else s.textContent = get(g, "text");
        fresh.appendChild(s);
      }
      if (folded) { const f = document.createElement("span"); f.className = "fold-mark"; f.textContent = " ⋯"; fresh.appendChild(f); }
      if (segs.cnt === 0) fresh.appendChild(document.createTextNode("\u200b"));
      if (node) view.replaceChild(fresh, node); else view.appendChild(fresh);
      node = fresh;
    }
    // Equal-looking rows may belong to different source positions after a fold
    // or scroll. Reused DOM must point at the row it now represents.
    if (row != null) { node.dataset.row = row; delete node.dataset.src; }
    else { node.dataset.src = src; delete node.dataset.row; }
    place$(node, lineArr[i], shiftOf(lineArr[i]));
    let g = gutter.children[i];
    // a cell's first row carries its placement: ● local (runs in the page),
    // ◆ beam (runs on the BEAM; the title says why), ✦ agent (a task block)
    const gcls = "gnum" + (current ? " cur" : "") + (place ? " place-" + place : "") + (row == null ? " orn" : ""), gtxt = row == null ? "·" : String(row + 1);
    if (!g) { g = document.createElement("div"); gutter.appendChild(g); }
    if (g.className !== gcls) g.className = gcls;
    const gh = size > 1 ? size * metrics.line + "px" : "";
    if (g.style.height !== gh) g.style.height = gh;
    if (g.textContent !== gtxt) g.textContent = gtxt;
    { const ln = lineArr[i], sh = shiftOf(ln), peek = !!get(ln, "peek?");
      g.style.display = peek ? "none" : "";
      if (g.style.transform !== sh.t) g.style.transform = sh.t;
      if (g.style.clipPath !== sh.c) g.style.clipPath = sh.c; }
    const title = place === "local" ? "runs here, in the page (pure, terminates)" : place === "beam" ? "runs on the BEAM — " + (why || "")
      : place === "agent" ? "runs as an agent in omega: C-Enter opens a task (again: refine it)" : "";
    if (g.title !== title) g.title = title;
  }
  while (view.children.length > frag.length) view.lastChild.remove();
  while (gutter.children.length > frag.length) gutter.lastChild.remove();

  // frames: boxes a presentation draws under its lines (cards, a sticky head,
  // the docked composer), in viewport ROWS; reused by index
  const frames = get(v, "frames") ? get(v, "frames").toArray() : [];
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    let n = frameLayer.children[i];
    if (!n) { n = document.createElement("div"); frameLayer.appendChild(n); }
    const cls = "frame tone-" + (get(f, "tone") || "plain") + (get(f, "sticky?") ? " sticky" : "") + (get(f, "head?") ? " head" : "") + " d" + get(f, "depth");
    if (n.className !== cls) n.className = cls;
    const css = `top:${get(f, "from") * metrics.line}px;height:${(get(f, "to") - get(f, "from")) * metrics.line}px`;
    if (n.style.cssText !== css) n.style.cssText = css;
  }
  while (frameLayer.children.length > frames.length) frameLayer.lastChild.remove();

  // selections + caret, positioned by grapheme column → pixel (measured per line)
  // a row's y: its viewport row offset (:vy, when a presentation sized rows), else its slot
  const slotOf = new Map(frag.filter((f) => f[0] != null).map((f, i) => [f[0], f[10] ?? frag.indexOf(f)]));
  const yOf = (row) => { const i = slotOf.get(row); return i === undefined ? null : i * metrics.line; };
  // Read every geometry value before writing any selection/caret styles.
  const rectangles = [];
  let boxI = 0;
  const box = () => { let b = selLayer.children[boxI++]; if (!b) { b = document.createElement("div"); selLayer.appendChild(b); } return b; };
  for (const s of get(v, "sels")) {
    const from = get(s, "from").toArray(), to = get(s, "to").toArray();
    for (let r = from[0]; r <= to[0]; r++) {
      const y = yOf(r); if (y == null) continue;
      const c0 = r === from[0] ? from[1] : 0;
      const c1 = r === to[0] ? to[1] : lineLen(r) + 1;
      if (c1 <= c0 && !(r < to[0])) continue;
      const cls = "sel" + (get(s, "primary?") ? " primary" : "");
      const x0 = xOf(r, c0), x1 = xOf(r, Math.max(c1, c0 + (r < to[0] ? 1 : 0)));
      rectangles.push([cls, `top:${y}px;left:${x0}px;width:${Math.max(2, x1 - x0)}px;height:${metrics.line}px`]);
    }
  }
  const cur = get(v, "cursor").toArray();
  const cy = yOf(cur[0]);
  const m = get(v, "mode").name;
  const cursorX = cy == null ? 0 : xOf(cur[0], cur[1]);
  const cursorWidth = cy == null || m === "insert" ? 2 : Math.max(metrics.ch, xOf(cur[0], cur[1] + 1) - cursorX);
  for (const [cls, css] of rectangles) {const b = box(); b.className = cls; b.style.cssText = css;}
  while (selLayer.children.length > boxI) selLayer.lastChild.remove();
  if (focused) document.body.dataset.mode = m;
  if (cy != null) {
    caret.style.cssText = `top:${cy}px;left:${cursorX}px;height:${metrics.line}px;width:${cursorWidth}px;`;
    caret.hidden = false;
    // keep the hidden input under the caret so the IME popup appears there
    if (focused && sink.parentElement !== dom.page) {
      const heldFocus = document.activeElement === sink;
      dom.page.appendChild(sink);
      if (heldFocus) sink.focus({ preventScroll: true });
    }
    if (focused) { sink.style.top = cy + "px"; sink.style.left = cursorX + "px"; }
  } else caret.hidden = true;

  // scrollbar hint
  if (dom.hint) dom.hint.style.cssText = `top:${(get(v, "top") / Math.max(1, get(v, "total"))) * 100}%;height:${Math.max(4, (frag.length / Math.max(1, get(v, "total"))) * 100)}%`;
}

// ─── the chrome: status, echo, minibuffer, overlay (the focused pane's) ────

let lastChrome = null;
function refreshChrome() { if (lastChrome) chrome(...lastChrome); }
function chrome(v, rv) {
  lastChrome = [v, rv];
  const m = get(v, "mode").name;
  // status line
  const st = get(v, "status");
  const pos = get(st, "pos").toArray();
  status.innerHTML = "";
  const chip = (cls, text) => { const s = document.createElement("span"); s.className = cls; s.textContent = text; status.appendChild(s); };
  chip("mode-chip m-" + m, { normal: "NOR", insert: "INS", select: "SEL", command: "CMD", palette: "M-x" }[m] || m);
  chip("file", (get(st, "path") || "untitled") + (get(st, "dirty?") ? " ●" : "") + (get(st, "read-only?") ? " · view" : ""));
  if (get(st, "asks") > 0) chip("asks", "⚑ " + get(st, "asks"));
  if (get(st, "back") > 0) chip("crumb", "C-o ←");
  if (get(st, "section")) chip("crumb", "§ " + get(st, "section"));
  if (get(st, "block")) chip("crumb", get(st, "block"));
  if (get(st, "problems") > 0) chip("problems", get(st, "problems") + " unbalanced");
  // loaded packages, the document's presentation and its modes
  if (get(v, "presentation")) chip("crumb pres", "▣ " + get(v, "presentation"));
  for (const l of (get(v, "modes") ? get(v, "modes").toArray() : [])) chip("crumb mode", l);
  // the window: its layout
  if (get(rv, "layout") && get(rv, "layout") !== "single") chip("crumb pres", "⊞ " + get(rv, "layout"));
  for (const [id, p] of loading) chip("crumb loading", "⏳ " + (loading.size > 1 ? id + ": " : "") + p);
  if (lang.state === "loading") chip("crumb lang", "⌛ language");
  else if (lang.state === "failed") chip("crumb lang failed", "language failed — run the command again to retry");
  const pend = get(st, "pending");
  if (pend) chip("pending", pend + (get(st, "count") ? " ×" + get(st, "count") : ""));
  else if (get(st, "count")) chip("pending", "×" + get(st, "count"));
  chip("spacer", "");
  if (get(st, "sels") > 1) chip("cursors", get(st, "sels") + " sel");
  chip("pos", pos[0] + ":" + pos[1]);

  echo.textContent = get(v, "message") || "";
  echo.classList.toggle("error", /^(error|read error|save failed)/.test(echo.textContent));

  // minibuffer
  const mb = get(v, "minibuf");
  if (mb && get(mb, "inline?")) {
    minibuf.hidden = true;                   // a presentation draws the draft in place (the composer)
  } else if (mb) {
    minibuf.hidden = false;
    // A view-only layout may retain its editor at zero width. The frame's
    // one input sink must stay usable while its real minibuffer is open.
    if (sink.closest('[inert]')) {
      minibuf.appendChild(sink); sink.style.top = '0'; sink.style.left = '0';
      sink.focus({preventScroll:true});
    }
    minibuf.querySelector(".prompt").textContent = get(mb, "prompt");
    minibuf.querySelector(".text").textContent = get(mb, "text");
    const list = minibuf.querySelector(".matches");
    list.textContent = "";
    const sel = get(mb, "sel");
    get(mb, "matches").toArray().forEach((x, i) => {
      const li = document.createElement("li");
      if (i === sel) li.className = "active";
      const n = document.createElement("span"); n.className = "name"; n.textContent = get(x, "name");
      const d = document.createElement("span"); d.className = "doc"; d.textContent = get(x, "doc");
      const k = document.createElement("span"); k.className = "keys"; k.textContent = get(x, "keys").toArray().slice(0, 2).join("  ");
      li.append(n, d, k); list.appendChild(li);
    });
  } else minibuf.hidden = true;

  // overlays
  const ov = get(v, "overlay");
  if (ov) {
    overlay.hidden = false;
    const kind = get(ov, "kind").name;
    overlay.dataset.kind = kind;
    overlay.querySelector("h2").textContent = get(ov, "title") || (kind === "outline" ? "Outline" : "Keys");
    const list = overlay.querySelector("ul");
    list.textContent = "";
    for (const it of get(ov, "items")) {
      const li = document.createElement("li");
      if (kind === "outline") {
        li.style.paddingLeft = (get(it, "level") - 1) * 1.1 + "rem";
        if (get(it, "todo")) { const t = document.createElement("span"); t.className = "todo"; t.textContent = get(it, "todo").toUpperCase(); li.appendChild(t); }
        li.appendChild(document.createTextNode(get(it, "title")));
        li.onclick = () => { dispatch(ev(K("type"), K("click"), K("pos"), R.vec(get(it, "row"), 0))); dispatch(ev(K("type"), K("key"), K("key"), "Escape")); };
      } else {
        if (kind === "actions") {
          const command = presentationCommand(get(it, "command"));
          if (command) { li.setAttribute("role", "button"); li.tabIndex = 0;
            const run = () => { dispatch(ev(K("type"), K("command"), K("command"), K(command))); sink.focus(); };
            li.onclick = run; li.onkeydown = event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); run(); } else if (event.key === "Escape") { event.preventDefault(); dispatch(ev(K("type"), K("key"), K("key"), "Escape")); sink.focus(); } };
          }
        }
        const k = document.createElement("kbd"); k.textContent = get(it, "keys") || get(it, "key");
        const n = document.createElement("span"); n.className = "name"; n.textContent = get(it, "name");
        const d = document.createElement("span"); d.className = "doc"; d.textContent = get(it, "doc");
        li.append(k, n, d);
      }
      list.appendChild(li);
    }
  } else overlay.hidden = true;
}

// grapheme column → x pixel offset within a row, measured from the DOM so
// proportional emoji/CJK widths are honest
const seg = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
function lineNodeIn(view, row) { for (const n of view.children) if (n.dataset.row == row) return n; return null; }
function lineTextIn(view, row) { const n = lineNodeIn(view, row); return n ? n.textContent.replace(/\u200b/g, "").replace(/ ⋯$/, "") : ""; }
function lineLenIn(view, row) { const t = lineTextIn(view, row); return seg ? [...seg.segment(t)].length : [...t].length; }
function xOfIn(view, row, col) {
  const node = lineNodeIn(view, row);
  if (!node || col === 0) return 0;
  // walk text nodes to the UTF-16 offset of grapheme `col`
  const t = lineTextIn(view, row);
  const gs = seg ? [...seg.segment(t)] : [...t].map((s, i) => ({ segment: s }));
  let u = 0; for (let i = 0; i < Math.min(col, gs.length); i++) u += gs[i].segment.length;
  if (col > gs.length) return xOfIn(view, row, gs.length) + (col - gs.length) * metrics.ch;
  const range = document.createRange();
  let acc = 0;
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  let tn;
  while ((tn = walker.nextNode())) {
    if (tn.parentElement?.classList.contains("fold-mark")) continue;
    const len = tn.data.replace(/\u200b/g, "").length;
    if (acc + len >= u) {
      range.setStart(tn, Math.min(u - acc, tn.data.length));
      range.collapse(true);
      const r = range.getBoundingClientRect();
      return r.left - node.getBoundingClientRect().left;
    }
    acc += len;
  }
  return node.getBoundingClientRect().width;
}

// ─── input ─────────────────────────────────────────────────────────────────

const NAMED = new Set(["Escape", "Enter", "Backspace", "Tab", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "Delete", "PageUp", "PageDown"]);

function keyName(e) {
  let k = e.key;
  if (k === "Dead" || k === "Process" || k === "Unidentified") return null;
  const mods = (e.ctrlKey ? "C-" : "") + (e.altKey ? "M-" : "");
  if (NAMED.has(k)) return mods + (e.shiftKey && (k === "Tab" || k === "Enter") ? "S-" + k : k);
  if (k.length === 1 || [...k].length === 1) return mods + k;   // shift already applied by the layout
  return null;
}

let composing = false;
sink.addEventListener("compositionstart", () => { composing = true; });
sink.addEventListener("compositionend", (e) => {
  composing = false;
  if (e.data) dispatch(ev(K("type"), K("text"), K("text"), e.data));
  sink.value = "";
});
sink.addEventListener("keydown", (e) => {
  if (composing || e.isComposing) return;
  // Native paste must reach the clipboardData handler, including on Linux.
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "v") return;
  const k = keyName(e);
  if (k == null) return;
  // printable keys WITHOUT modifiers in insert/command modes arrive via `input`
  // (so IME and dead keys work); everything else is a command key
  const mode = document.body.dataset.mode;
  const textMode = mode === "insert" || mode === "command" || mode === "palette";
  if (textMode && k.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) return;
  if (e.metaKey) return;            // leave Cmd-shortcuts to the browser
  e.preventDefault();
  dispatch(ev(K("type"), K("key"), K("key"), k));
});
sink.addEventListener("input", (e) => {
  if (composing) return;
  const text = sink.value;
  sink.value = "";
  if (!text) return;
  const mode = document.body.dataset.mode;
  if (mode === "insert" || mode === "command" || mode === "palette") dispatch(ev(K("type"), K("text"), K("text"), text));
});
const supportsClipboardImages = ed => [...(get(ed, "packages") || [])].some(p => get(get(get(p, "provides"), "clipboard"), "images"));
sink.addEventListener("paste", (e) => {
  const ed = ed$();
  const acceptsImages = supportsClipboardImages(ed);
  const file = [...(e.clipboardData?.items || [])].find(i => ["image/png", "image/jpeg", "image/webp"].includes(i.type))?.getAsFile();
  if (file && acceptsImages && !get(ed, "read-only?") && ["normal", "insert", "select"].includes(get(ed, "mode").name)) {
    e.preventDefault();
    const pane = get(fr, "focus"), originalText = get(ed, "text"), originalSels = get(ed, "sels");
    (async () => {
      try {
        if (file.size > 10000000) throw new Error("Image exceeds 10 MB");
        const bytes = await file.arrayBuffer();
        const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
        const data = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); });
        const current = F.d_editor(fr, pane);
        if (!current || !supportsClipboardImages(current)) return;
        if (get(current, "text") !== originalText || get(current, "sels") !== originalSels) {
          dispatch(toPane(pane, ev(K("type"), K("asset-error"), K("message"), "Buffer changed while reading the clipboard — paste again")));
          return;
        }
        const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[file.type];
        const url = `/api/assets/${hash}.${ext}`;
        assetPreviews.set(url, data);
        dispatch(toPane(pane, ev(K("type"), K("paste-image"), K("url"), url, K("data"), data.split(",")[1])));
      } catch (err) { dispatch(toPane(pane, ev(K("type"), K("asset-error"), K("message"), String(err.message || err)))); }
    })();
    return;
  }
  const text = e.clipboardData?.getData("text/plain");
  if (text) { e.preventDefault(); dispatch(ev(K("type"), K("text"), K("text"), text)); }
});

// a click focuses its pane (the frame's :focus) and lands in it
const paneOf = (node) => node.closest("[data-pane]")?.dataset.pane ?? "main";
function focusPane(id) { if (get(fr, "focus").name !== id) fr = fr.assoc(K("focus"), K(id)); }
function activateCommand(node, command) {
  const id = paneOf(node); focusPane(id);
  const line = node.closest(".line"), mode = get(ed$(), "mode");
  if (line && (mode === K("normal") || mode === K("select") || mode === K("command"))) {
    const row = Number(line.dataset.src ?? line.dataset.row);
    dispatch(ev(K("type"), K("click"), K("pos"), R.vec(row, 0)));
  }
  dispatch(ev(K("type"), K("command"), K("command"), K(command))); sink.focus();
}
panesEl.addEventListener("mousedown", (e) => {
  if (!fr || e.target.closest(".view")) return;
  const action = e.target.closest("[data-command]");
  if (action) { e.preventDefault(); activateCommand(action, action.dataset.command); return; }
  const lineNode = e.target.closest(".line");
  const id = paneOf(e.target);
  if (!lineNode) { focusPane(id); draw(); sink.focus(); return; }
  e.preventDefault();
  focusPane(id);
  const dom = paneDom.get(id);
  if (!dom) return;
  if (lineNode.dataset.src != null) {        // an ornament: land on its source row
    dispatch(ev(K("type"), K("click"), K("pos"), R.vec(Number(lineNode.dataset.src), 0), K("extend?"), e.shiftKey));
    sink.focus(); return;
  }
  const row = Number(lineNode.dataset.row);
  const x = e.clientX - lineNode.getBoundingClientRect().left;
  let col = 0; const n = lineLenIn(dom.view, row);
  while (col < n && xOfIn(dom.view, row, col + 1) <= x + metrics.ch / 2) col++;
  dispatch(ev(K("type"), K("click"), K("pos"), R.vec(row, col), K("extend?"), e.shiftKey));
  sink.focus();
});
// Wheel → a target in ROWS (fractional) per pane; a frame loop eases toward it
// and sends the step as :scroll-slots (a presentation moves by screen rows and
// by fractions of one; a plain document by whole rows). A trackpad's small
// deltas just pass through the same easing; a mouse wheel's notch glides.
const reducedMotion = () => !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
const wholeRows = new Map();       // plain documents scroll by whole rows: carry the fraction
const glide = createGlide({
  schedule: (f) => requestAnimationFrame(f), cancel: (h) => cancelAnimationFrame(h), now: () => performance.now(), reduced: reducedMotion,
  apply(id, step) {
    if (!fr || !F.d_editor(fr, K(id))) { wholeRows.delete(id); return false; }   // the pane is gone
    const v = paneView(id);
    if (!v) return false;
    if (get(v, "slot-top") != null) dispatch(ev(K("type"), K("scroll-slots"), K("pane"), K(id), K("delta"), step));
    else {
      const acc = (wholeRows.get(id) || 0) + step, w = Math.trunc(acc);
      wholeRows.set(id, acc - w);
      if (w) dispatch(ev(K("type"), K("scroll"), K("pane"), K(id), K("top"), Math.max(0, get(v, "top") + w)));
    }
    return true;
  },
});
panesEl.addEventListener("wheel", (e) => {
  if (e.target.closest(".view")) return;
  e.preventDefault();
  if (!fr) return;
  const id = paneOf(e.target);
  const px = e.deltaMode === 1 ? e.deltaY * metrics.line : e.deltaMode === 2 ? e.deltaY * metrics.line * 20 : e.deltaY;
  glide.add(id, px / metrics.line, classifyWheel(e));
}, { passive: false });

// every editor pane learns its height (rows) and width (cells)
let lastFit = "", fitFrame = 0;
function fitHeight() {
  const first = [...paneDom.values()].find((d) => d.page);
  if (!first || !fr) return;
  // the page's top padding is not rows (the last row was clipped by a few px)
  const pad = parseFloat(getComputedStyle(first.page).paddingTop) || 0;
  for (const dom of paneDom.values()) {
    dom.viewportHeight = dom.root.clientHeight;
    dom.viewportWidth = dom.root.clientWidth;
  }
  const h = Math.floor((first.root.clientHeight - pad) / metrics.line);
  let cols = R.EMPTY_MAP;
  for (const [id, d] of paneDom) if (d.page) cols = cols.assoc(K(id), Math.floor((d.page.clientWidth - 24) / metrics.ch));
  const signature = h + ":" + R.printStr(cols);
  if (signature === lastFit) return;
  lastFit = signature;
  dispatch(ev(K("type"), K("resize"), K("height"), h, K("cols"), cols));
}
function scheduleFit() {
  if (!fr || fitFrame) return;
  fitFrame = requestAnimationFrame(() => {fitFrame = 0; fitHeight();});
}
window.addEventListener("resize", scheduleFit);
// the boot-time fit measures before the status line lays out: refit on any change
new ResizeObserver(scheduleFit).observe(panesEl);
document.addEventListener("click", () => sink.focus());


// ─── boot ──────────────────────────────────────────────────────────────────
//
// Everything the first display needs is fetched at once: the editor modules,
// the document (or the welcome text) and any ?use= packages. The language is
// not among them: it starts after the first display (see `lang`). The layout
// is applied with the frame's own pure `arrange`, so the inbox opens without
// evaluating a command line.

const withTimeout = (p, ms, what) => {
  let timer;
  return Promise.race([p, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timed out loading " + what)), ms); })])
    .finally(() => clearTimeout(timer));
};

async function loadInitial() {
  const path = new URLSearchParams(location.search).get("file") || documents?.initialPath;
  let notice = null;
  if (path) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const j = await fetchDoc(path, controller.signal);
      if (j.ok) return { text: j.text, path, doc: j };
      notice = "cannot open " + path + ": " + (j.message || "document unavailable");
    } catch (error) {
      notice = "cannot open " + path + ": " + (controller.signal.aborted ? "loading timed out" : error.message);
    } finally { clearTimeout(timer); }
  }
  const r = await withTimeout(fetch("./welcome.bl.org"), 15000, "welcome");
  return { text: await r.text(), path: "welcome.bl.org", notice };
}
async function loadPackage(name) {
  const url = packageUrl(name);
  try {
    const mod = await withTimeout(import(new URL(url, location.href).href), 15000, url);
    const p = mod.package ?? mod.d_bl_package;
    if (p) pkgHosts.register(get(typeof p === "function" ? p() : p, "name"), mod.createHost);
    return ev(K("type"), K("use"), K("package"), typeof p === "function" ? p() : p, K("message"), p ? null : url + " exports no `package`");
  } catch (err) {
    return ev(K("type"), K("use"), K("package"), null, K("message"), "cannot load " + url + ": " + err.message);
  }
}

echo.textContent = "Loading editor…";
panesEl.setAttribute("aria-busy", "true");
sink.focus();                               // keys typed during boot are queued, not lost
const params = new URLSearchParams(location.search);
const wantLayout = params.get("layout") || documents?.layout;
const uses = (params.get("use") || documents?.packages?.join(",") || "").split(",").filter(Boolean);
const [mods, init, useEvents] = await Promise.all([
  Promise.all([import("./out/ed.main.mjs"), import("./out/ed.frame.mjs"), document.fonts?.ready]),
  loadInitial(),
  Promise.all(uses.map(loadPackage)),
]);
[M, F] = mods;
measure();
const { text, path, doc } = init;
fr = F.d_single(M.d_boot(text, path));
// the document's rev / read-only flag / objects: the same event a visit uses
if (doc) fr = F.d_handle(fr, ev(K("type"), K("doc"), K("path"), path, K("text"), doc.text, K("rev"), doc.rev, K("read-only?"), !!doc.readOnly,
                     K("title"), doc.title || path, K("objects"), toBL(doc.objects || []), K("data"), toBL(doc.data || null), K("visit?"), false));
for (const u of useEvents) fr = F.d_handle(fr, u);
for (const { name, event } of doc?.packageEvents || []) {
  if (![...(get(ed$(), "packages") || [])].some(p => get(p, "name") === name)) {
    if (get(event, "package")) documentAutoUsed.add(name);
    fr = F.d_handle(fr, event);
  }
}

if (wantLayout) {
  const layout = F.d_layouts(ed$()).get(wantLayout, null);
  if (layout) fr = F.d_arrange(fr, layout);
  else fr = F.d_handle(fr, ev(K("type"), K("eval-result"), K("id"), "layout", K("text"), "no layout " + wantLayout));
}
if (init.notice) fr = F.d_handle(fr, ev(K("type"), K("eval-result"), K("id"), "load", K("text"), init.notice));
settle();
scheduleFit();
watchDocs(); watchCards(true);
panesEl.removeAttribute("aria-busy");
const queued = bootQueue; bootQueue = [];
for (const e of queued) dispatch(e);        // keys typed during boot, in order
sink.focus();
window.blEd = { dispatch, focusInput: () => sink.focus({preventScroll:true}), observe: observers.subscribe, snapshot: () => renderFrame(fr), setVisible:setViewerVisible, state: () => ed$(), frame: () => fr, render: () => paneView(get(fr, "focus").name), R, K, F };
window.blHost = { lang, gate, glide, loading, observation:()=>({visible:viewerVisible,watches:watchers.size}) };
if (documents?.eagerLanguage !== false) setTimeout(() => lang.start(), 0);          // the language: off the first-display path
}

if (typeof document !== "undefined") {
  try { await main(); }
  catch (error) {
    const echo = document.querySelector("#echo");
    if (echo) echo.textContent = "Cannot load editor: " + error.message + " — reload to retry";
    document.querySelector("#panes")?.removeAttribute("aria-busy");
    console.error("bl-ed bootstrap failed", error);
  }
}
