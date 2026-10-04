// apps/bl-ed/web/host.mjs — the browser host for bl-ed.
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

// Beam Lisp itself (reader + compiler + macros, compiled to JS) for the `:`
// command line: started before the editor module loads, so `js/eval-ed` is
// a host fn the editor can call (priv/lib/js/repl.mjs).
const { start } = await import("./out/repl.mjs");
const repl = await start(async (f) => (await fetch("./out/src/" + f)).text());
globalThis.BL_HOST = Object.assign(globalThis.BL_HOST || {}, {
  "eval-ed": (src, api) => repl.evalWith(src, "ed", api),
  "eval-cells": (cells) => repl.evalCells(cells),
});
window.blRepl = repl;

import * as R from "./out/rt.mjs";
const M = await import("./out/ed.main.mjs");
const F = await import("./out/ed.frame.mjs");

const K = R.kw;
const get = (m, k) => (m == null ? null : m.get(K(k), null));
const ev = (...kv) => R.hashMap(...kv);

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

function dispatch(event) {
  const t0 = performance.now();
  fr = F.d_handle(fr, event);
  const [fr2, effects] = F.d_take_effects(fr).toArray();
  fr = fr2;
  for (const e of effects) perform(e);
  draw();
  if (event.get(K("type"), null) !== K("key") || effects.length) { watchDocs(); watchCards(false); }
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
  if (x instanceof R.HMap) { const o = {}; for (const [k, v] of x.entries()) o[k instanceof R.Kw ? k.fq : String(k)] = toJS(v); return o; }
  if (x instanceof R.Vec) return x.toArray().map(toJS);
  if (x instanceof R.Kw) return x.fq;
  return x;
}
const postJSON = (url, body) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// an event for the pane that asked (a host answer carries {:pane id} back)
const toPane = (pane, e) => (pane == null ? e : e.assoc(K("pane"), pane));

async function loadDoc(path, visit, goto, pane) {
  const r = await fetch("/api/doc?path=" + encodeURIComponent(path));
  const j = await r.json();
  if (!j.ok) { dispatch(toPane(pane, ev(K("type"), K("eval-result"), K("id"), path, K("text"), j.message || "cannot open"))); return; }
  let e = ev(K("type"), K("doc"), K("path"), path, K("text"), j.text, K("rev"), j.rev, K("read-only?"), !!j.readOnly,
             K("title"), j.title || path, K("objects"), toBL(j.objects || []), K("visit?"), !!visit);
  if (goto) e = e.assoc(K("goto"), goto);
  dispatch(toPane(pane, e));
  if (visit && (pane == null || pane === get(fr, "focus"))) history.replaceState(null, "", "?file=" + encodeURIComponent(path) + layoutParam());
}

async function perform(eff) {
  const pane = get(eff, "pane");
  const e = eff;
  const dispatchP = (x) => dispatch(toPane(pane, x));
  const kind = get(e, "kind").name;
  if (kind === "visit") {
    try { await loadDoc(get(e, "path"), true, get(e, "goto"), pane); }
    catch (err) { dispatchP(ev(K("type"), K("eval-result"), K("id"), get(e, "path"), K("text"), "no server to open documents")); }
  } else if (kind === "intent") {
    try {
      const r = await postJSON("/api/intent", { intent: get(e, "intent"), args: toJS(get(e, "args")) });
      const j = await r.json();
      dispatchP(ev(K("type"), K("intent-result"), K("ok?"), j.ok === true, K("message"), j.message || null,
                  K("data"), toBL(j), K("then"), get(e, "then"), K("block"), get(e, "block"), K("path"), get(e, "path")));
      watchCards(true);
    } catch (err) {
      dispatchP(ev(K("type"), K("intent-result"), K("ok?"), false, K("message"), "no omega world — run bin/bl-ed"));
    }
  } else if (kind === "save") {
    const body = { path: get(e, "path"), text: get(e, "text"), base: get(e, "base") };
    try {
      const r = await postJSON("/api/save", body);
      const j = await r.json();
      dispatchP(ev(K("type"), K("saved"), K("rev"), get(e, "rev"), K("ok?"), r.ok && j.ok === true, K("message"), j.message || "",
                  K("conflict?"), j.conflict === true, K("doc-rev"), j.rev || null));
    } catch (err) {
      // no server (opened as a static page): fall back to a download
      download(body.path.split("/").pop(), body.text);
      dispatchP(ev(K("type"), K("saved"), K("rev"), get(e, "rev"), K("ok?"), true, K("message"), "downloaded"));
    }
  } else if (kind === "eval-cell") {
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
    const url = /[/.:]/.test(name) ? name : `./pkg/${name}.mjs`;
    try {
      const mod = await import(new URL(url, location.href).href);
      const p = mod.package ?? mod.d_bl_package;
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
function watch(key, path, since, onChange) {
  const cur = watchers.get(key);
  if (cur && cur.path === path) return;
  if (cur) cur.alive = false;
  const w = { path, since, alive: true };
  watchers.set(key, w);
  (async () => {
    while (w.alive) {
      try {
        const r = await fetch("/api/rev?path=" + encodeURIComponent(path) + "&since=" + encodeURIComponent(w.since || ""));
        const j = await r.json();
        if (!w.alive) break;
        if (j.ok && j.rev !== w.since) { w.since = j.rev; await onChange(); }
        else if (!j.ok) await new Promise((res) => setTimeout(res, 3000));
      } catch (err) { await new Promise((res) => setTimeout(res, 3000)); }
    }
  })();
}
function unwatch(key) { const w = watchers.get(key); if (w) { w.alive = false; watchers.delete(key); } }

// one watch per editor pane's document; a pane that left drops its watch
function watchDocs() {
  const live = new Set();
  for (const id of F.d_editor_ids(fr).toArray()) {
    const v = M.d_render(F.d_editor(fr, id));
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
  const r = await fetch("/api/doc?path=" + encodeURIComponent(path));
  const j = await r.json();
  if (j.ok) dispatch(ev(K("type"), K("cards"), K("data"), toBL(j.data || [])));
}
function watchCards(force) {
  const ids = get(M.d_render(ed$()), "cards").toArray().join(",");
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

function segSig(segs) { let s = ""; for (const g of segs) s += get(g, "kind").name + "\u0001" + get(g, "text") + "\u0002"; return s; }

function draw() {
  const rv = F.d_render(fr);
  const panes = get(rv, "panes").toArray();
  syncPanes(panes);
  let focusV = null;
  for (const p of panes) {
    const id = get(p, "id").name, dom = paneDom.get(id);
    if (get(p, "kind") === K("view")) { paintView(dom, p); continue; }
    const v = get(p, "view");
    dom.root.classList.toggle("focus", !!get(p, "focus?"));
    paint(dom, v, !!get(p, "focus?"));
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
function cssWidth(w) {
  if (w == null || w === K("fill")) return "minmax(0, 1fr)";
  const a = w.toArray ? w.toArray() : null;
  if (a && a[0] === K("ch")) return `${a[1]}ch`;
  if (a && a[0] === K("fr")) return `minmax(0, ${a[1]}fr)`;
  return "minmax(0, 1fr)";
}
let layoutSig = "";
function syncPanes(panes) {
  const sig = panes.map((p) => get(p, "id").name + ":" + get(p, "kind").name).join(",");
  panesEl.style.gridTemplateColumns = panes.map((p) => cssWidth(get(p, "width"))).join(" ");
  panesEl.classList.toggle("multi", panes.length > 1);
  if (sig === layoutSig) return;
  layoutSig = sig;
  const want = new Set(panes.map((p) => get(p, "id").name));
  for (const [id, dom] of [...paneDom]) if (!want.has(id)) { if (dom.root.id !== "editor") dom.root.remove(); paneDom.delete(id); }
  // the original #editor serves the FIRST editor pane, whatever its id
  const firstEd = panes.find((p) => get(p, "kind") === K("editor"));
  for (const p of panes) {
    const id = get(p, "id").name;
    if (paneDom.has(id)) continue;
    let root;
    if (get(p, "kind") === K("view")) {
      root = document.createElement("aside");
      root.className = "pane view view-" + get(p, "view-kind").name;
      root.innerHTML = '<div class="view-body"></div><div class="view-lens"></div>';
    } else if (p === firstEd && ![...paneDom.values()].some((d) => d.root.id === "editor")) {
      root = $("#editor");
    } else {
      root = editorSkeleton.cloneNode(true);
      root.removeAttribute("id");
      for (const n of root.querySelectorAll("[id]")) n.removeAttribute("id");
      root.querySelector(".lines").textContent = ""; root.querySelector(".gutter").textContent = "";
    }
    root.dataset.pane = id;
    paneDom.set(id, get(p, "kind") === K("view") ? { root, body: root.querySelector(".view-body"), lens: root.querySelector(".view-lens") } : domFor(root));
  }
  // keep the original #editor's mapping honest when ids differ
  for (const [id, dom] of paneDom) if (dom.root.id === "editor" && firstEd && get(firstEd, "id").name !== id) { paneDom.delete(id); paneDom.set(get(firstEd, "id").name, dom); dom.root.dataset.pane = get(firstEd, "id").name; }
  for (const p of panes) panesEl.appendChild(paneDom.get(get(p, "id").name).root);
  requestAnimationFrame(fitHeight);
}

// ─── view panes: a painter per view kind ───────────────────────────────────
//
// A view's model comes from BL (a package :provides {:views {kind fn}});
// the host only paints it and turns pointer input into events FOR the pane
// it views ({:pane of …}). Painters are keyed by kind.

const MAP_ROW = 3;                          // px per screen row in a minimap
const viewPainters = {
  minimap(dom, p) {
    const m = get(p, "view");
    dom.body.textContent = "";
    if (!m) return;
    const bars = get(m, "bars").toArray();
    const ys = []; let y = 0;
    for (const b of bars) { ys.push(y); y += (get(b, "size") || 1) * MAP_ROW; }
    const H = dom.root.clientHeight - 16, k = Math.min(1, H / Math.max(1, y));
    const ch = (dom.root.clientWidth - 24) / 84;
    dom.root.dataset.k = k; dom.root.dataset.ys = JSON.stringify(ys); dom.root.dataset.of = get(p, "of").name;
    bars.forEach((b, i) => {
      const d = document.createElement("div");
      d.className = "bar r-" + get(b, "role").name;
      d.style.cssText = `top:${ys[i] * k}px;height:${Math.max(1, (get(b, "size") || 1) * MAP_ROW * k - 1)}px;width:${Math.max(2, Math.min(84, get(b, "w")) * ch)}px`;
      dom.body.appendChild(d);
      const label = get(b, "label");
      if (label) { const t = document.createElement("div"); t.className = "maplabel"; t.textContent = label; t.style.top = ys[i] * k + "px"; dom.body.appendChild(t); }
    });
    const top = get(m, "top"), end = get(m, "end");
    dom.lens.style.cssText = `top:${(ys[top] ?? 0) * k}px;height:${Math.max(8, ((ys[end] ?? y) - (ys[top] ?? 0)) * k)}px`;
  },
};
function paintView(dom, p) { const f = viewPainters[get(p, "view-kind").name]; if (f) f(dom, p); }
function minimapSlotAt(root, clientY) {
  const k = +root.dataset.k, ys = JSON.parse(root.dataset.ys || "[]");
  const y = (clientY - root.querySelector(".view-body").getBoundingClientRect().top) / k;
  let i = 0; while (i + 1 < ys.length && ys[i + 1] <= y) i++;
  return i;
}
let mapDrag = null;
panesEl.addEventListener("mousedown", (e) => {
  const root = e.target.closest(".view-minimap"); if (!root) return;
  e.preventDefault(); mapDrag = root;
  dispatch(ev(K("type"), K("scroll-to-slot"), K("pane"), K(root.dataset.of), K("y"), Math.max(0, minimapSlotAt(root, e.clientY) - 6)));
});
window.addEventListener("mousemove", (e) => { if (mapDrag) dispatch(ev(K("type"), K("scroll-to-slot"), K("pane"), K(mapDrag.dataset.of), K("y"), Math.max(0, minimapSlotAt(mapDrag, e.clientY) - 6))); });
window.addEventListener("mouseup", () => { mapDrag = null; });

// ─── one editor pane ───────────────────────────────────────────────────────

function paint(dom, v, focused) {
  const { view, gutter, selLayer, caret, frameLayer } = dom;
  const lineNode = (row) => lineNodeIn(view, row);
  const xOf = (row, col) => xOfIn(view, row, col);
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
        s.textContent = get(g, "text");
        fresh.appendChild(s);
      }
      if (folded) { const f = document.createElement("span"); f.className = "fold-mark"; f.textContent = " ⋯"; fresh.appendChild(f); }
      if (segs.cnt === 0) fresh.appendChild(document.createTextNode("\u200b"));
      if (node) view.replaceChild(fresh, node); else view.appendChild(fresh);
    }
    let g = gutter.children[i];
    // a cell's first row carries its placement: ● local (runs in the page),
    // ◆ beam (runs on the BEAM; the title says why), ✦ agent (a task block)
    const gcls = "gnum" + (current ? " cur" : "") + (place ? " place-" + place : "") + (row == null ? " orn" : ""), gtxt = row == null ? "·" : String(row + 1);
    if (!g) { g = document.createElement("div"); gutter.appendChild(g); }
    if (g.className !== gcls) g.className = gcls;
    const gh = size > 1 ? size * metrics.line + "px" : "";
    if (g.style.height !== gh) g.style.height = gh;
    if (g.textContent !== gtxt) g.textContent = gtxt;
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
  // selections: reuse box elements by index
  let boxI = 0;
  const box = () => { let b = selLayer.children[boxI++]; if (!b) { b = document.createElement("div"); selLayer.appendChild(b); } return b; };
  for (const s of get(v, "sels")) {
    const from = get(s, "from").toArray(), to = get(s, "to").toArray();
    for (let r = from[0]; r <= to[0]; r++) {
      const y = yOf(r); if (y == null) continue;
      const c0 = r === from[0] ? from[1] : 0;
      const c1 = r === to[0] ? to[1] : lineLen(r) + 1;
      if (c1 <= c0 && !(r < to[0])) continue;
      const b = box();
      b.className = "sel" + (get(s, "primary?") ? " primary" : "");
      const x0 = xOf(r, c0), x1 = xOf(r, Math.max(c1, c0 + (r < to[0] ? 1 : 0)));
      b.style.cssText = `top:${y}px;left:${x0}px;width:${Math.max(2, x1 - x0)}px;height:${metrics.line}px`;
    }
  }
  while (selLayer.children.length > boxI) selLayer.lastChild.remove();
  const cur = get(v, "cursor").toArray();
  const cy = yOf(cur[0]);
  const m = get(v, "mode").name;
  if (focused) document.body.dataset.mode = m;
  if (cy != null) {
    caret.style.cssText = `top:${cy}px;left:${xOf(cur[0], cur[1])}px;height:${metrics.line}px;` +
      (m === "insert" ? "width:2px" : `width:${Math.max(metrics.ch, xOf(cur[0], cur[1] + 1) - xOf(cur[0], cur[1]))}px`);
    caret.hidden = false;
    // keep the hidden input under the caret so the IME popup appears there
    if (focused && sink.parentElement !== dom.page) dom.page.appendChild(sink);
    if (focused) { sink.style.top = cy + "px"; sink.style.left = xOf(cur[0], cur[1]) + "px"; }
  } else caret.hidden = true;

  // scrollbar hint
  if (dom.hint) dom.hint.style.cssText = `top:${(get(v, "top") / Math.max(1, get(v, "total"))) * 100}%;height:${Math.max(4, (frag.length / Math.max(1, get(v, "total"))) * 100)}%`;
}

// ─── the chrome: status, echo, minibuffer, overlay (the focused pane's) ────

function chrome(v, rv) {
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
  // the window: its layout and the C-w chord
  if (get(rv, "layout") && get(rv, "layout") !== "single") chip("crumb pres", "⊞ " + get(rv, "layout"));
  if (get(rv, "chord")) chip("pending", get(rv, "chord") + "-");
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
    overlay.querySelector("h2").textContent = kind === "outline" ? "Outline" : "Keys";
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
        const k = document.createElement("kbd"); k.textContent = get(it, "keys");
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
sink.addEventListener("paste", (e) => {
  const text = e.clipboardData?.getData("text/plain");
  if (text) { e.preventDefault(); dispatch(ev(K("type"), K("text"), K("text"), text)); }
});

// a click focuses its pane (the frame's :focus) and lands in it
const paneOf = (node) => node.closest("[data-pane]")?.dataset.pane ?? "main";
function focusPane(id) { if (get(fr, "focus").name !== id) fr = fr.assoc(K("focus"), K(id)); }
panesEl.addEventListener("mousedown", (e) => {
  if (e.target.closest(".view")) return;
  const lineNode = e.target.closest(".line");
  const id = paneOf(e.target);
  if (!lineNode) { focusPane(id); draw(); sink.focus(); return; }
  e.preventDefault();
  focusPane(id);
  const dom = paneDom.get(id);
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
panesEl.addEventListener("wheel", (e) => {
  if (e.target.closest(".view")) return;
  e.preventDefault();
  const id = K(paneOf(e.target));
  const v = M.d_render(F.d_editor(fr, id));
  const rows = Math.sign(e.deltaY) * Math.max(1, Math.round(Math.abs(e.deltaY) / metrics.line));
  // a presentation scrolls by SCREEN rows (a wrapped answer is many rows of one text row)
  if (get(v, "slot-top") != null) { dispatch(ev(K("type"), K("scroll-slots"), K("pane"), id, K("delta"), rows)); return; }
  dispatch(ev(K("type"), K("scroll"), K("pane"), id, K("top"), Math.max(0, get(v, "top") + rows)));
}, { passive: false });

// every editor pane learns its height (rows) and width (cells)
function fitHeight() {
  const first = [...paneDom.values()].find((d) => d.page);
  if (!first || !fr) return;
  // the page's top padding is not rows (the last row was clipped by a few px)
  const pad = parseFloat(getComputedStyle(first.page).paddingTop) || 0;
  const h = Math.floor((first.root.clientHeight - pad) / metrics.line);
  let cols = R.EMPTY_MAP;
  for (const [id, d] of paneDom) if (d.page) cols = cols.assoc(K(id), Math.floor((d.page.clientWidth - 24) / metrics.ch));
  dispatch(ev(K("type"), K("resize"), K("height"), h, K("cols"), cols));
}
window.addEventListener("resize", fitHeight);
// the boot-time fit measures before the status line lays out: refit on any change
new ResizeObserver(() => { if (fr) fitHeight(); }).observe(panesEl);
document.addEventListener("click", () => sink.focus());

// the ?layout= of the page's URL, kept across visits
function layoutParam() { const l = get(F.d_render(fr), "layout"); return l && l !== "single" ? "&layout=" + encodeURIComponent(l) : ""; }
// run a `:` command as if typed (boot-time ?layout=)
function runCommandLine(src) {
  dispatch(ev(K("type"), K("key"), K("key"), ":"));
  dispatch(ev(K("type"), K("text"), K("text"), src));
  dispatch(ev(K("type"), K("key"), K("key"), "Enter"));
}

// ─── boot ──────────────────────────────────────────────────────────────────

async function loadInitial() {
  const params = new URLSearchParams(location.search);
  const path = params.get("file");
  if (path) {
    try {
      const r = await fetch("/api/doc?path=" + encodeURIComponent(path));
      const j = await r.json();
      if (j.ok) return { text: j.text, path, doc: j };
    } catch (_) { /* fall through */ }
  }
  const r = await fetch("./welcome.bl.org");
  return { text: await r.text(), path: path || "welcome.bl.org" };
}

await document.fonts?.ready;
measure();
const { text, path, doc } = await loadInitial();
fr = F.d_single(M.d_boot(text, path));
fitHeight();
// the document's rev / read-only flag / objects: the same event a visit uses
if (doc) dispatch(ev(K("type"), K("doc"), K("path"), path, K("text"), doc.text, K("rev"), doc.rev, K("read-only?"), !!doc.readOnly,
                     K("title"), doc.title || path, K("objects"), toBL(doc.objects || []), K("visit?"), false));
watchDocs(); watchCards(true);
// ?use=a,b loads packages at boot (as ~/.bl-ed/init would); ?layout=x then
// arranges the window as a loaded package's layout says
const params = new URLSearchParams(location.search);
const wantLayout = params.get("layout");
for (const name of (params.get("use") || "").split(",").filter(Boolean)) await perform(ev(K("kind"), K("load-package"), K("name"), name));
if (wantLayout) runCommandLine(`(ed/layout "${wantLayout}")`);
sink.focus();
window.blEd = { dispatch, state: () => ed$(), frame: () => fr, render: () => M.d_render(ed$()), R, K, F };
