// spikes/present/web/frame.mjs — the host for pp.frame: ONE pure BL frame
// (rail | conversation | questions), painted pane by pane on the row grid
// (spike: spikes/scroll-and-type.bl.md).
//
// The host stays dumb, as bl-ed's does: events in (keys, resizes, documents
// fetched for a pane), effects out (visit / intent tagged {:pane}), the view
// model painted. Every pane is a whole bl-ed editor; this file only knows
// how to put several of them side by side.
//
// What it paints beyond host-pp.mjs: a line's :size (a double-height row is
// two grid rows, its text set larger — VT100 DECDHL), a line's :role (a face
// from frame.css), frames with :head? that stick to the top.

const { start } = await import("./out/repl.mjs");
const repl = await start(async (f) => (await fetch("./out/src/" + f)).text());
globalThis.BL_HOST = Object.assign(globalThis.BL_HOST || {}, {
  "eval-ed": (src, api) => repl.evalWith(src, "ed", api),
  "eval-cells": (cells) => repl.evalCells(cells),
});
import * as R from "./out/rt.mjs";
const P = await import("./out/pp.main.mjs");
const F = await import("./out/pp.frame.mjs");
const CV = await import("./out/pp.conv.mjs");

const K = R.kw;
const get = (m, k) => (m == null ? null : m.get(K(k), null));
const ev = (...kv) => R.hashMap(...kv);
const $ = (s) => document.querySelector(s);
const toBL = (x) => Array.isArray(x) ? R.vecFromArray(x.map(toBL))
  : (x && typeof x === "object") ? Object.entries(x).reduce((m, [k, v]) => m.assoc(K(k), toBL(v)), R.EMPTY_MAP) : x;
const toJS = (x) => x instanceof R.HMap ? Object.fromEntries([...x.entries()].map(([k, v]) => [k instanceof R.Kw ? k.fq : String(k), toJS(v)]))
  : x instanceof R.Vec ? x.toArray().map(toJS) : x instanceof R.Kw ? x.fq : x;

let fr = null;
let ROW = 25, CH = 9;

// ─── the loop ──────────────────────────────────────────────────────────────

function dispatch(event) {
  fr = F.d_handle(fr, event);
  const [fr2, effects] = F.d_take_effects(fr).toArray();
  fr = fr2;
  for (const e of effects) perform(e);
  draw();
}

async function fetchDoc(path) {
  const j = await (await fetch("/api/doc?path=" + encodeURIComponent(path))).json();
  return j.ok ? j : null;
}
function docEvent(pane, path, j, visit) {
  return ev(K("type"), K("doc"), K("pane"), pane, K("path"), path, K("text"), j.text, K("rev"), j.rev,
            K("read-only?"), !!j.readOnly, K("title"), j.title || path, K("objects"), toBL(j.objects || []), K("visit?"), visit);
}
const watching = new Map();           // pane → {path, rev, alive}
function watch(pane, path, rev) {
  const cur = watching.get(pane);
  if (cur && cur.path === path) { cur.rev = rev; return; }
  if (cur) cur.alive = false;
  const w = { path, rev, alive: true }; watching.set(pane, w);
  (async () => {
    while (w.alive) {
      try {
        const j = await (await fetch(`/api/rev?path=${encodeURIComponent(path)}&since=${encodeURIComponent(w.rev || "")}`)).json();
        if (!w.alive) break;
        if (j.ok && j.rev !== w.rev) { const d = await fetchDoc(path); if (d && w.alive) { w.rev = d.rev; dispatch(docEvent(pane, path, d, false)); } }
        else if (!j.ok) await new Promise((r) => setTimeout(r, 3000));
      } catch { await new Promise((r) => setTimeout(r, 3000)); }
    }
  })();
}

async function perform(e) {
  const pane = get(e, "pane"), kind = get(e, "kind").name;
  if (kind === "visit") {
    const path = get(e, "path"); const j = await fetchDoc(path);
    if (j) { dispatch(docEvent(pane, path, j, true)); watch(pane, path, j.rev); }
  } else if (kind === "intent") {
    const r = await fetch("/api/intent", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent: get(e, "intent"), args: toJS(get(e, "args")) }) });
    const j = await r.json();
    dispatch(ev(K("type"), K("intent-result"), K("pane"), pane, K("ok?"), j.ok === true, K("message"), j.message || null,
                K("data"), toBL(j), K("then"), get(e, "then"), K("block"), get(e, "block"), K("path"), get(e, "path")));
  }
}

// ─── painting one pane ─────────────────────────────────────────────────────

function paintPane(el, pv, focus) {
  const v = get(pv, "view");
  el.classList.toggle("focus", focus);
  const lines = el.querySelector(".lines"), frames = el.querySelector(".frames"), caret = el.querySelector(".caret");
  lines.textContent = ""; frames.textContent = "";
  for (const ln of get(v, "lines")) {
    const size = get(ln, "size") || 1, role = get(ln, "role");
    const d = document.createElement("div");
    d.className = "line" + (role ? " r-" + role.name : "") + (size > 1 ? " big" : "") + (get(ln, "band") ? " in-cell band-" + get(ln, "band") : "")
      + (get(ln, "band-first?") ? " first" : "") + (get(ln, "band-last?") ? " last" : "") + (get(ln, "ornament?") ? " ornament" : "");
    d.style.top = get(ln, "vy") * ROW + "px"; d.style.height = size * ROW + "px";
    d.dataset.row = get(ln, "row") ?? get(ln, "src");
    for (const g of get(ln, "segments")) {
      const s = document.createElement("span"); s.className = "seg k-" + get(g, "kind").name; s.textContent = get(g, "text"); d.appendChild(s);
    }
    lines.appendChild(d);
  }
  for (const f of get(v, "frames")) {
    const b = document.createElement("div");
    b.className = "frame tone-" + (get(f, "tone") || "plain") + (get(f, "head?") ? " head" : "");
    b.style.top = get(f, "from") * ROW + "px"; b.style.height = (get(f, "to") - get(f, "from")) * ROW + "px";
    frames.appendChild(b);
  }
  // the caret: on the line showing the cursor's row (text or an ornament with that :src)
  const cur = get(v, "cursor").toArray();
  const hit = [...lines.children].find((n) => !n.classList.contains("ornament") && n.dataset.row == cur[0])
           || [...lines.children].find((n) => n.dataset.row == cur[0]);
  caret.hidden = !hit || !focus;
  if (hit) { caret.style.top = hit.style.top; caret.style.height = hit.style.height; }
  const st = get(v, "status");
  el.querySelector(".pane-status").textContent =
    `${get(st, "path") || ""}  ▣ ${get(v, "presentation")}  ${(get(v, "modes")?.toArray() || []).join(" ")}  ${get(v, "slot-count")} slots / ${get(v, "total")} rows`;
  return v;
}

function paintIndex(convEd) {
  const ix = $("#questions .list"); ix.textContent = "";
  const qs = CV.d_questions(convEd).toArray();
  const v = P.d_render(convEd);
  const ys = get(v, "lines").toArray().map((l) => get(l, "row") ?? get(l, "src")).filter((x) => x != null);
  const topRow = Math.min(...ys.length ? ys : [0]);
  let at = 0; qs.forEach((q, i) => { if (get(q, "row") <= topRow + 1) at = i; });
  qs.forEach((q, i) => {
    const d = document.createElement("div");
    d.className = "q" + (i === at ? " at" : "");
    d.innerHTML = `<span class="n">${get(q, "n")}</span>`; d.append(get(q, "text"));
    ix.appendChild(d);
  });
}

function draw() {
  const rv = F.d_render(fr);
  let convEd = null;
  for (const pv of get(rv, "panes")) {
    const id = get(pv, "id").name;
    paintPane($("#" + id), pv, get(pv, "focus?"));
  }
  const panes = get(fr, "panes");
  paintIndex(panes.get(K("pane")));
  const focusV = get(get(rv, "panes").toArray().find((p) => get(p, "focus?")), "view");
  $("#echo").textContent = get(focusV, "message") || (get(rv, "chord") ? "C-w-" : "");
  const mb = get(focusV, "minibuf");
  $("#minibuf").hidden = !mb || get(mb, "inline?");
  if (mb && !get(mb, "inline?")) $("#minibuf").textContent = get(mb, "prompt") + get(mb, "text") + "▏";
  document.body.dataset.mode = get(focusV, "mode").name;
}

// ─── input: the frame decides which pane a key goes to ─────────────────────

const NAMED = new Set(["Escape", "Enter", "Backspace", "Tab", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "Delete", "PageUp", "PageDown"]);
function keyName(e) {
  const k = e.key; if (k === "Dead" || k === "Process" || k === "Unidentified") return null;
  const mods = (e.ctrlKey ? "C-" : "") + (e.altKey ? "M-" : "");
  if (NAMED.has(k)) return mods + (e.shiftKey && k === "Tab" ? "S-Tab" : k);
  if ([...k].length === 1) return mods + k;
  return null;
}
const sink = $("#sink");
sink.addEventListener("keydown", (e) => {
  if (e.isComposing) return;
  const k = keyName(e); if (k == null || e.metaKey) return;
  const m = document.body.dataset.mode;
  if ((m === "insert" || m === "command" || m === "palette") && k.length === 1 && !e.ctrlKey && !e.altKey) return;
  e.preventDefault();
  dispatch(ev(K("type"), K("key"), K("key"), k));
});
sink.addEventListener("input", () => {
  const t = sink.value; sink.value = ""; if (!t) return;
  const m = document.body.dataset.mode;
  if (m === "insert" || m === "command" || m === "palette") dispatch(ev(K("type"), K("text"), K("text"), t));
});
document.addEventListener("click", () => sink.focus());
// the measure the conversation fills: the pane's width in cells (a resize
// re-wraps, as Emacs' visual-line-mode does)
function fit() {
  // the page's top padding (4px) is not a row
  const h = Math.floor(($("#pane .page").clientHeight - 4) / ROW);
  const cols = (id) => Math.floor(($("#" + id + " .page").clientWidth - 24) / CH);
  dispatch(ev(K("type"), K("resize"), K("height"), h, K("cols"), ev(K("rail"), cols("rail"), K("pane"), cols("pane"))));
}
new ResizeObserver(() => { if (fr) fit(); }).observe($("#frame"));

// ─── boot: the overview in the rail, its first task in the pane ────────────

await document.fonts?.ready;
ROW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--row")) || 25;
{ const s = document.createElement("span"); s.className = "seg"; s.textContent = "M".repeat(100); $("#pane .lines").appendChild(s);
  CH = s.getBoundingClientRect().width / 100; s.remove(); }
const ov = await fetchDoc("omega:overview");
const rail = P.d_boot(ov.text, "omega:overview");
const pane = P.d_boot("#+TITLE: …\n", "task:");
fr = F.d_frame(R.vecFromArray([R.vec(K("rail"), rail, 1), R.vec(K("pane"), pane, 3)]),
               ev(K("links"), ev(K("rail"), K("pane")),
                  K("link-path"), (k) => (k.nth(0) === "omega/task" ? "task:" + k.nth(1) : null)));
fit();
dispatch(docEvent(K("rail"), "omega:overview", ov, false)); watch(K("rail"), "omega:overview", ov.rev);
dispatch(ev(K("type"), K("key"), K("key"), "j"));     // select the first task → it opens in the pane
sink.focus();
window.frame = { dispatch, state: () => fr, R, K, F, P };
