// spikes/dwim/test/drive.test.mjs — drive the DWIM package (spikes/dwim/dwim/main.bl)
// headless, on the compiled vendored editor, and pin the contract in
// spikes/dwim/dwim.bl.md §2/§4 and the shared topology in vendor/bl-ed/ed/view.bl.
//
//   spikes/dwim/build.sh            # dwim.main → vendor/bl-ed/web/out
//   spikes/present/build.sh pkg     # pp.main   → vendor/bl-ed/web/out (integration)
//   BLED_OUT=vendor/bl-ed/web/out node --test spikes/dwim/test/drive.test.mjs
//
// The editor is a pure function of events; this suite plays the page host (it
// answers the BL_HOST hooks with a real in-page language), installs packages
// through the real `:use` event — never by reaching into `:user-keys` — and
// reads the resulting editor. `ed.view` is the shared visible-source topology;
// the present package contributes its own navigation topology through
// `:provides {:navigation {:rows fn :reveal fn}}`.
//
// CAVEAT: this file is written against the intended slice and the sibling
// worker contracts (ed/view.bl; pp.main :provides :navigation; pp.present/reveal).
// It is NOT claimed green here — the orchestrator builds the modules and runs
// the suite. If pp.main.mjs is absent the integration tests FAIL LOUDLY (they
// do not silently skip): the present package must be built with `pkg`.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import fs from "node:fs";

const out = path.resolve(process.env.BLED_OUT || "vendor/bl-ed/web/out");
const load = (m) => import(pathToFileURL(path.join(out, m)).href);

// The command line evaluates real Beam Lisp: start the in-page language (built
// into out/ by vendor/bl-ed/build.sh) exactly as the page host does. The host
// hooks are SYNCHRONOUS here, so command-line eval is ready immediately.
const { start } = await load("repl.mjs");
const repl = await start((f) => fs.readFileSync(path.join(out, "src", f), "utf8"));
globalThis.BL_HOST = Object.assign(globalThis.BL_HOST || {}, {
  "eval-ed": (src, api) => repl.evalWith(src, "ed", api),
  "eval-cells": (cells) => repl.evalCells(cells),
});

const M = await load("ed.main.mjs");
const PKG = await load("ed.pkg.mjs");
const C = await load("ed.core.mjs");
const V = await load("ed.view.mjs");
const FR = await load("ed.frame.mjs");
const D = await load("dwim.main.mjs");
const R = await load("rt.mjs");
const T = await load("ed.text.mjs");

let PP = null;
let ppErr = null;
try { PP = await load("pp.main.mjs"); } catch (e) { ppErr = e; }
const needPP = () => assert.ok(PP, "pp.main.mjs must be built for the integration tests (spikes/present/build.sh pkg): " + (ppErr && ppErr.message));

// ─── plain-JS helpers over the compiled runtime ─────────────────────────────

const K = (s) => R.kw(s);
const get = (m, k) => (m == null ? null : m.get(K(k), null));
const ev = (...kv) => R.hashMap(...kv);
const keyEv = (k) => ev(K("type"), K("key"), K("key"), k);
const boot = (text, p = "x.bl.org") => M.d_boot(text, p);
const key = (ed, k) => M.d_handle(ed, keyEv(k));
function keys(ed, seq) { for (const k of seq.split(" ")) ed = key(ed, k === "<sp>" ? " " : k); return ed; }
function type(ed, s) { for (const ch of [...s]) ed = key(ed, ch); return ed; }
function cmd(ed, src) { return key(type(key(ed, ":"), src), "Enter"); }
const clickAt = (ed, r, c) => M.d_handle(ed, ev(K("type"), K("click"), K("pos"), R.vec(r, c)));
const usePkg = (ed, p) => M.d_handle(ed, ev(K("type"), K("use"), K("package"), p));

const text = (ed) => T.d_to_string(get(ed, "text"));
const heads = (ed) => get(ed, "sels").toArray().map((s) => get(s, "head").toArray());
const head0 = (ed) => heads(ed)[0];
const primary = (ed) => get(ed, "primary");
const mode = (ed) => get(ed, "mode").name;
const msg = (ed) => get(ed, "message");
const lineCount = (ed) => get(get(ed, "text"), "lines").cnt;
const folds = (ed) => { const f = get(ed, "folds"); return f == null ? [] : Array.from(f); };
const hasFold = (ed, r) => folds(ed).includes(r);
const pkgState = (ed, nm) => { const st = get(ed, "pkg-state"); return st == null ? null : st.get(nm, null); };
const withFolds = (ed, rs) => ed.assoc(K("folds"), R.hashSet(...rs));
const setSel = (ed, headList, prim = 0) =>
  ed.assoc(K("sels"), R.vecFromArray(headList.map((rc) => R.hashMap(K("anchor"), R.vec(rc[0], rc[1]), K("head"), R.vec(rc[0], rc[1]))))).assoc(K("primary"), prim);

const range = (a, b = null) => (b == null ? Array.from({ length: a }, (_, i) => i) : range(b - a).map((i) => a + i));
const toBL = (x) => (Array.isArray(x) ? R.vecFromArray(x.map(toBL))
  : (x && typeof x === "object") ? Object.entries(x).reduce((m, kv) => m.assoc(K(kv[0]), toBL(kv[1])), R.EMPTY_MAP) : x);
const docEvent = (p, tx, opts = {}) => ev(K("type"), K("doc"), K("path"), p, K("text"), tx,
  K("rev"), opts.rev ?? "r2", K("read-only?"), opts.ro ?? false, K("objects"), toBL(opts.objects ?? []),
  K("visit?"), opts.visit ?? false);
const paneDocEvent = (pane, p, tx, opts = {}) => ev(K("type"), K("doc"), K("pane"), K(pane),
  K("path"), p, K("text"), tx, K("rev"), opts.rev ?? "r1", K("read-only?"), opts.ro ?? true,
  K("objects"), toBL(opts.objects ?? []), K("visit?"), opts.visit ?? true);
const renderedRows = (ed) => get(M.d_render(ed), "lines").toArray().map((l) => get(l, "row"));
const renderedSources = (ed) => get(M.d_render(ed), "lines").toArray().map((l) => get(l, "row") ?? get(l, "src"));
const pkgNames = (ed) => get(ed, "packages").toArray().map((p) => get(p, "name"));

// ─── source fixtures (real org syntax) ──────────────────────────────────────

// nested headings, a folded parent and a nested child fold
const SRC = [
  "#+TITLE: nav",       // 0
  "",                   // 1
  "* Alpha",            // 2  end 10
  "a1",                 // 3
  "a2",                 // 4
  "** Beta",            // 5  end 10
  "b1",                 // 6
  "b2",                 // 7
  "*** Gamma",          // 8  end 10
  "c1",                 // 9
  "* Delta",            // 10 end 12
  "d1",                 // 11
].join("\n");

// sibling folds with a visible gap between them (adjacency merges only true overlaps)
const SIB = [
  "* A",   // 0 end 5
  "** B",  // 1 end 3
  "b",     // 2
  "** C",  // 3 end 5
  "c",     // 4
  "* D",   // 5 end 7
  "d",     // 6
].join("\n");

// columns: long rows for goal-column observation
const COLS = ["0123456789", "abcdefghij", "ABCDEFGHIJ", ""].join("\n");

// ─── a package value through the real event path ────────────────────────────

test("dwim package shape: commands + command keys (counts and describe-key keep working)", () => {
  assert.equal(get(D.d_bl_package, "name"), "dwim");
  const commands = get(D.d_bl_package, "commands");
  for (const n of ["dwim/down", "dwim/up", "dwim/left", "dwim/right"]) assert.ok(commands.get(K(n)), "command " + n);
  const kn = get(get(D.d_bl_package, "keys"), "normal");
  assert.equal(kn.get("j").fq, "dwim/down");
  assert.equal(kn.get("k").fq, "dwim/up");
  assert.equal(kn.get("h").fq, "dwim/left");
  assert.equal(kn.get("l").fq, "dwim/right");
  assert.equal(get(get(D.d_bl_package, "keys"), "select").get("j").fq, "dwim/down");

  let ed = usePkg(boot(SRC), D.d_bl_package);
  assert.ok(pkgNames(ed).includes("dwim"), "package installed through :use");
  ed = keys(ed, "space k");            // describe-key, then the bound key
  ed = key(ed, "j");
  assert.match(String(msg(ed)), /j runs :dwim\/down/);
});

test("immediate use/unuse is exact: no adopt, user tables and pkg-state untouched", () => {
  const ed0 = boot(SRC);
  const uk = get(ed0, "user-keys"), uc = get(ed0, "user-commands"), ps = get(ed0, "pkg-state");
  let ed = usePkg(ed0, D.d_bl_package);
  assert.ok(R.eqv(get(ed, "user-keys"), uk), "user-keys untouched by use");
  assert.ok(R.eqv(get(ed, "user-commands"), uc), "user-commands untouched by use");
  assert.ok(R.eqv(get(ed, "pkg-state"), ps), "pkg-state untouched by use (dwim has no :adopt)");
  ed = PKG.d_unuse(ed, "dwim");
  assert.deepEqual(pkgNames(ed), []);
  assert.ok(R.eqv(get(ed, "user-keys"), uk), "user-keys untouched by unuse");
  assert.ok(R.eqv(get(ed, "user-commands"), uc), "user-commands untouched by unuse");
  assert.ok(R.eqv(get(ed, "pkg-state"), ps), "pkg-state untouched by unuse");
});

test("command unload removes dwim's own state and falls back to raw source motion", () => {
  let ed = usePkg(boot(SRC), D.d_bl_package);
  ed = clickAt(ed, 2, 0); ed = key(ed, "Tab");   // fold A (hidden [3,10))
  ed = clickAt(ed, 0, 0);
  ed = key(ed, "j"); ed = key(ed, "j"); ed = key(ed, "j");
  assert.deepEqual(head0(ed), [10, 0], "dwim skips the folded body to the next visible row");
  assert.ok(pkgState(ed, "dwim"), "dwim keeps its own goal state under pkg-state");
  ed = cmd(ed, '(ed/unuse "dwim")');
  assert.deepEqual(pkgNames(ed), []);
  assert.equal(pkgState(ed, "dwim"), null, "unload removes the package state");
  ed = clickAt(ed, 0, 0); ed = key(ed, "j");
  assert.deepEqual(head0(ed), [1, 0], "without dwim, j is the raw one-source-row motion again");
});

// ─── j / k: visible source rows ─────────────────────────────────────────────

test("j/k step visible source rows: a folded section is one step, nested folds respected", () => {
  let ed = usePkg(boot(SRC), D.d_bl_package);
  ed = clickAt(ed, 8, 0); ed = key(ed, "Tab");   // fold C
  ed = clickAt(ed, 2, 0); ed = key(ed, "Tab");   // fold A (nested closed parent)
  assert.deepEqual(folds(ed).sort((a, b) => a - b), [2, 8]);
  ed = clickAt(ed, 0, 0);
  ed = key(ed, "j"); ed = key(ed, "j");
  assert.deepEqual(head0(ed), [2, 0], "reaches the folded heading");
  ed = key(ed, "j");
  assert.deepEqual(head0(ed), [10, 0], "one step crosses the whole hidden body");
  ed = clickAt(ed, 2, 0); ed = key(ed, "l");      // reopen parent; child fold retained
  assert.equal(hasFold(ed, 2), false, "parent expanded");
  assert.equal(hasFold(ed, 8), true, "nested child fold retained on reopen");
  ed = key(ed, "j");
  assert.deepEqual(head0(ed), [3, 0], "expanded contents become targets again");
  ed = clickAt(ed, 8, 0); ed = key(ed, "j");
  assert.deepEqual(head0(ed), [10, 0], "the retained child fold still hides its body");
  ed = clickAt(ed, 10, 0); ed = key(ed, "k");
  assert.deepEqual(head0(ed), [8, 0], "k skips the retained child's hidden body");
  ed = key(ed, "k");
  assert.deepEqual(head0(ed), [7, 0], "k walks back over the visible rows only");
});

test("counts: 3j == j j j, and the source topology is the same either way", () => {
  const a = keys(usePkg(boot(SRC), D.d_bl_package), "3 j");
  const b = keys(usePkg(boot(SRC), D.d_bl_package), "j j j");
  assert.deepEqual(heads(a), heads(b));
  assert.deepEqual(head0(a), [3, 0]);
});

test("boundaries clamp: no wrap at the first/last visible row", () => {
  let ed = usePkg(boot(SRC), D.d_bl_package);
  ed = clickAt(ed, 11, 0); ed = key(ed, "j");
  assert.deepEqual(head0(ed), [11, 0], "last visible row clamps");
  ed = clickAt(ed, 0, 0); ed = key(ed, "k");
  assert.deepEqual(head0(ed), [0, 0], "first visible row clamps");
  // with a fold at the tail the last VISIBLE row is before the hidden span
  ed = clickAt(ed, 2, 0); ed = key(ed, "Tab");
  ed = clickAt(ed, 0, 0); ed = key(ed, "j"); ed = key(ed, "j"); ed = key(ed, "j");
  assert.deepEqual(head0(ed), [10, 0]);
  ed = key(ed, "j");
  assert.deepEqual(head0(ed), [11, 0], "clamps at D, not inside the fold");
});

test("goal column survives short rows and reversal; invalidated by horizontal/click/text/doc", () => {
  const fresh = () => usePkg(boot(COLS), D.d_bl_package);
  // a short row clamps the column; the remembered goal restores it on return
  const SHORT = ["0123456789", "ab", "abcdefghij", ""].join("\n");
  let ed = usePkg(boot(SHORT), D.d_bl_package);
  ed = clickAt(ed, 0, 7);
  ed = key(ed, "j");
  assert.deepEqual(head0(ed), [1, 1], "a short row clamps the column");
  ed = key(ed, "j");
  assert.deepEqual(head0(ed), [2, 7], "the remembered column returns on a long row");
  ed = key(ed, "k");
  assert.deepEqual(head0(ed), [1, 1], "reversal clamps again on the short row");
  ed = key(ed, "k");
  assert.deepEqual(head0(ed), [0, 7], "and the goal survives the reversal");

  // a click resets the goal to where the reader put the cursor
  ed = fresh(); ed = clickAt(ed, 0, 7); ed = keys(ed, "j k");
  ed = clickAt(ed, 0, 3); ed = key(ed, "j");
  assert.deepEqual(head0(ed), [1, 3], "a click invalidates the remembered goal");

  // horizontal motion resets it too
  ed = fresh(); ed = clickAt(ed, 0, 7); ed = keys(ed, "j k");
  ed = key(ed, "h");                        // prose char motion, clears dwim state
  ed = key(ed, "j");
  assert.deepEqual(head0(ed), [1, 6], "h invalidates the remembered goal");

  // typing resets it
  ed = fresh(); ed = clickAt(ed, 0, 7); ed = keys(ed, "j k");
  ed = key(ed, "i"); ed = type(ed, "QQ"); ed = key(ed, "Escape");
  ed = key(ed, "j");
  assert.deepEqual(head0(ed), [1, 8], "typing invalidates the remembered goal");

  // a document refresh (the text changed) resets it
  ed = fresh(); ed = clickAt(ed, 0, 7); ed = keys(ed, "j k");
  ed = M.d_handle(ed, docEvent("x.bl.org", "012\nabcdefghij", { rev: "r3" }));
  ed = key(ed, "j");
  assert.deepEqual(head0(ed), [1, 3], "a refreshed document invalidates the remembered goal");
});

// ─── h / l: contextual outline motion ───────────────────────────────────────

test("normal heading h: collapse, then h goes to the parent", () => {
  let ed = usePkg(boot(SRC), D.d_bl_package);
  ed = clickAt(ed, 5, 0);                 // B, expanded
  ed = key(ed, "h");
  assert.equal(hasFold(ed, 5), true, "an expanded heading collapses");
  assert.deepEqual(head0(ed), [5, 0], "collapse keeps the heading");
  ed = key(ed, "h");
  assert.deepEqual(head0(ed), [2, 0], "a collapsed heading goes to its parent");
  assert.equal(hasFold(ed, 2), false, "moving to the parent does not fold it");
});

test("normal heading l: expand retaining nested folds, then enter first visible content; leaf no-op", () => {
  let ed = usePkg(boot(SRC), D.d_bl_package);
  ed = clickAt(ed, 8, 0); ed = key(ed, "Tab");   // fold C first
  ed = clickAt(ed, 2, 0); ed = key(ed, "Tab");   // fold A
  ed = key(ed, "l");
  assert.equal(hasFold(ed, 2), false, "l expands the collapsed heading");
  assert.equal(hasFold(ed, 8), true, "a nested fold is retained");
  assert.deepEqual(head0(ed), [2, 0], "expansion is in place");
  ed = key(ed, "l");
  assert.deepEqual(head0(ed), [3, 0], "l on an expanded heading enters its first visible content");

  let lf = usePkg(boot("* leaf"), D.d_bl_package);
  lf = clickAt(lf, 0, 2); lf = key(lf, "l");
  assert.deepEqual(head0(lf), [0, 2], "a leaf heading is a no-op");
  assert.equal(hasFold(lf, 0), false);
});

test("ordinary prose h/l stay character motion; insert mode types h j k l literally", () => {
  let ed = usePkg(boot("hello world\n"), D.d_bl_package);
  ed = key(ed, "l"); ed = key(ed, "l"); ed = key(ed, "h");
  assert.deepEqual(head0(ed), [0, 1], "prose h/l move characters");
  assert.deepEqual(folds(ed), [], "prose motion never folds");
  ed = keys(ed, "g g"); ed = key(ed, "i"); ed = type(ed, "hjkl"); ed = key(ed, "Escape");
  assert.equal(mode(ed), "normal");
  assert.ok(text(ed).startsWith("hjkl"), "insert mode types the dwim keys as text");
});

// ─── select mode: source-range semantics ────────────────────────────────────

test("select-mode j/k keep the anchor, including across a hidden folded span", () => {
  let ed = usePkg(boot(SRC), D.d_bl_package);
  ed = clickAt(ed, 2, 0); ed = key(ed, "Tab");   // fold A: hidden [3,10)
  ed = clickAt(ed, 0, 0);
  ed = key(ed, "v");                              // select mode
  assert.equal(mode(ed), "select");
  ed = key(ed, "j"); ed = key(ed, "j"); ed = key(ed, "j");
  const s = get(ed, "sels").nth(primary(ed));
  assert.deepEqual(get(s, "anchor").toArray(), [0, 0], "the anchor is unchanged");
  assert.deepEqual(get(s, "head").toArray(), [10, 0], "the head crossed the hidden span");
  ed = key(ed, "k");
  const s2 = get(ed, "sels").nth(primary(ed));
  assert.deepEqual(get(s2, "head").toArray(), [2, 0], "k steps the head back");
  assert.deepEqual(get(s2, "anchor").toArray(), [0, 0]);
  assert.deepEqual(folds(ed), [2], "select stepping never mutates folds");
});

test("select-mode h/l are character motion, not fold mutation", () => {
  let ed = usePkg(boot(SRC), D.d_bl_package);
  ed = clickAt(ed, 2, 3); ed = key(ed, "v");
  const before = folds(ed);
  ed = key(ed, "h");
  assert.deepEqual(head0(ed), [2, 2], "h moves the head a character");
  assert.deepEqual(folds(ed), before, "h does not collapse a heading in select mode");
  ed = key(ed, "l"); ed = key(ed, "l");
  assert.deepEqual(head0(ed), [2, 4]);
  assert.deepEqual(folds(ed), before, "l does not expand in select mode");
});

// ─── multi-cursor / multi-selection ─────────────────────────────────────────

test("multiple heads keep their own columns; the primary is retained", () => {
  let ed = usePkg(boot(COLS), D.d_bl_package);
  ed = setSel(ed, [[0, 7], [1, 7]], 0);
  ed = key(ed, "j");
  assert.deepEqual(heads(ed), [[1, 7], [2, 7]], "each head advances and keeps its column");
  assert.equal(primary(ed), 0, "the primary selection is retained");
});

test("duplicate heads on one heading do not double-toggle", () => {
  let ed = usePkg(boot(SRC), D.d_bl_package);
  // two heads on the collapsed heading A: l must expand, not conj+disj
  ed = setSel(withFolds(ed, [2]), [[2, 0], [2, 0]], 1);
  ed = key(ed, "l");
  assert.equal(hasFold(ed, 2), false, "expanded once, not toggled back");
  assert.equal(primary(ed), 1, "primary retained");
  // two heads on the expanded heading: h must collapse, not disj+conj
  ed = key(ed, "h");
  assert.equal(hasFold(ed, 2), true, "collapsed once");
});

// ─── reveal / rendering ─────────────────────────────────────────────────────

test("a huge folded section: j lands on the destination and M.render actually draws it", () => {
  const lines = ["#+TITLE: huge", "* Big"];
  for (let i = 0; i < 200; i++) lines.push("body " + i);
  lines.push("* End", "end");
  const HUGE = lines.join("\n");
  let ed = usePkg(boot(HUGE), D.d_bl_package);
  ed = clickAt(ed, 1, 0); ed = key(ed, "Tab");        // fold Big: hidden [2,202)
  ed = M.d_handle(ed, ev(K("type"), K("resize"), K("height"), 8));
  ed = clickAt(ed, 1, 0);
  ed = key(ed, "j");
  assert.deepEqual(head0(ed), [202, 0], "the destination is the row after the whole folded section");
  const shown = renderedRows(ed);
  assert.ok(shown.includes(202), "M.render draws the destination row: " + JSON.stringify(shown));
  assert.ok(!shown.includes(100), "the hidden body is not drawn");
});

test("user bindings win over package bindings", () => {
  let ed = usePkg(boot(SRC), D.d_bl_package);
  ed = cmd(ed, '(ed/bind :normal "j" :doc-end)');
  ed = key(ed, "j");
  assert.deepEqual(head0(ed), [11, 0], "the user's j (doc-end) ran, not dwim/down");
});

test("explicit dwim commands are discoverable through the palette", () => {
  let ed = usePkg(boot(SRC), D.d_bl_package);
  ed = keys(ed, "space space");
  assert.equal(mode(ed), "palette");
  ed = type(ed, "dwimdown");
  const matches = get(get(M.d_render(ed), "minibuf"), "matches").toArray().map((m) => get(m, "name"));
  assert.ok(matches.includes("dwim/down"), "the palette lists package commands: " + matches.join(","));
});

// ─── ed.view: the shared topology (unit) ────────────────────────────────────

test("ed.view/source-rows: folds hide bodies; nested and sibling folds merge correctly", () => {
  const ed = boot(SRC);
  assert.deepEqual(V.d_source_rows(ed).toArray(), range(12), "no folds: every row");
  assert.deepEqual(V.d_source_rows(withFolds(ed, [5])).toArray(), [0, 1, 2, 3, 4, 5, 10, 11], "fold B hides its body");
  assert.deepEqual(V.d_source_rows(withFolds(ed, [2])).toArray(), [0, 1, 2, 10, 11], "fold A hides every descendant");
  assert.deepEqual(V.d_source_rows(withFolds(ed, [2, 8])).toArray(), [0, 1, 2, 10, 11], "nested folds merge into the outer span");
  assert.deepEqual(V.d_source_rows(withFolds(ed, [8])).toArray(), [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11], "the child heading is retained, its body hidden");

  const sib = withFolds(boot(SIB), [1, 3]);
  assert.deepEqual(V.d_source_rows(sib).toArray(), [0, 1, 3, 5, 6], "sibling folds with a visible gap stay separate");
});

test("ed.view/visible-rows: the viewport in source rows, fold-aware", () => {
  let ed = boot(SRC);
  ed = M.d_handle(ed, ev(K("type"), K("resize"), K("height"), 5));
  ed = ed.assoc(K("view"), get(ed, "view").assoc(K("top"), 3));
  assert.deepEqual(V.d_visible_rows(ed).toArray(), [3, 4, 5, 6, 7], "no folds: :height rows from :top");
  ed = withFolds(ed, [2]);
  assert.deepEqual(V.d_visible_rows(ed).toArray(), [10, 11], "rows from :top skipping the folded span, :height max");
  const shown = renderedRows(ed).filter((r) => r != null);
  assert.deepEqual(shown, V.d_visible_rows(ed).toArray(), "the core renderer draws exactly visible-rows");
});

test("ed.view/reveal: keeps the head in visible space, idempotent, never mutates folds/sels", () => {
  const L = Array.from({ length: 60 }, (_, i) => "row " + i).join("\n");
  let ed = M.d_handle(boot(L), ev(K("type"), K("resize"), K("height"), 10));
  ed = setSel(ed, [[40, 0]]);
  ed = V.d_reveal(ed);
  assert.equal(get(get(ed, "view"), "top"), 33, "margin math in visible ranks");
  const again = V.d_reveal(ed);
  assert.equal(get(get(again, "view"), "top"), get(get(ed, "view"), "top"), "reveal is idempotent");

  // hidden head: the representative visible row <= head is kept in view
  let f = M.d_handle(boot(SRC), ev(K("type"), K("resize"), K("height"), 10));
  f = withFolds(f, [2]);
  f = setSel(f, [[5, 0]]);
  const selsBefore = f.get(K("sels"));
  f = V.d_reveal(f);
  assert.equal(get(get(f, "view"), "top"), 0, "top stays on a visible row (row 2's rank)");
  assert.ok(V.d_visible_rows(f).toArray().includes(0), "the representative row is visible");
  assert.ok(R.eqv(f.get(K("sels")), selsBefore), "reveal never mutates the selection");
  assert.deepEqual(folds(f), [2], "reveal never unfolds");

  // :top inside a hidden span normalizes to the first visible row at/after it
  let g = M.d_handle(boot(SRC), ev(K("type"), K("resize"), K("height"), 10));
  g = withFolds(g, [2]);
  g = g.assoc(K("view"), get(g, "view").assoc(K("top"), 5));
  g = setSel(g, [[10, 0]]);
  g = V.d_reveal(g);
  assert.equal(get(get(g, "view"), "top"), 1, "a hidden top normalizes to a visible row");
});

test("ed.view/rows: latest provider first, nil declines, empty vector is accepted", () => {
  const nav = (rowsFn, revealFn) => R.hashMap(K("navigation"), R.hashMap(K("rows"), rowsFn, K("reveal"), revealFn));
  const pkg = (name, rowsFn, revealFn) => R.hashMap(K("name"), name, K("provides"), nav(rowsFn, revealFn));

  let ed = usePkg(boot(SRC), pkg("prov-a", () => R.vec(1, 9), (e) => e.assoc(K("marked-a"), true)));
  assert.deepEqual(V.d_rows(ed).toArray(), [1, 9], "a provider replaces source-rows for navigation");
  assert.equal(get(V.d_reveal(ed), "marked-a"), true, "a provider reveal replaces the plain reveal");
  const renderedBefore = renderedRows(ed);

  ed = usePkg(ed, pkg("prov-b", () => R.vec(), (e) => e));
  assert.deepEqual(V.d_rows(ed).toArray(), [], "the latest package wins; [] is a non-nil accept");
  assert.deepEqual(renderedRows(ed), renderedBefore, "a :rows provider never changes what the core draws");

  // a nil answer declines to the next package, then to source-rows
  const dec = usePkg(boot(SRC), pkg("decliner", () => null, () => null));
  assert.deepEqual(V.d_rows(dec).toArray(), range(12), "a nil :rows declines to source-rows");
  assert.ok(R.eqv(V.d_reveal(dec), dec), "a nil :reveal declines to the plain reveal");
});

// ─── present integration (must not silently skip) ───────────────────────────

const OV = [
  "#+TITLE: omega · 2 tasks",   // 0
  "",                            // 1
  "* Needs you (2)",             // 2
  "◆ t-5  fix parser — read hex  · 1h · scratch",   // 3
  "◆ t-6  other thing — second  · 2h · scratch",    // 4
].join("\n");
const OV_OBJECTS = [{ row: 3, type: "omega/task", key: "t-5" }, { row: 4, type: "omega/task", key: "t-6" }];

function taskDoc(turns) {
  let s = "#+TITLE: t-9 · scroll fixture · ◆ your turn · 1h\nhome: scratch\n\n";
  for (let i = 1; i <= turns; i++) s += "* you · " + i + "\nquestion number " + i + "\n* model · " + (i + 1) + "\nanswer line A\nanswer line B\nanswer line C\n";
  return s + "* traces\n- tool · eval#1/x — eval ok\n\n* say ▸  (RET to message the task)\n";
}

test("present provides a navigation topology that replaces source rows, and declines for text", () => {
  needPP();
  // a rail document: provider rows are the task object source rows
  let ed = usePkg(M.d_boot("", "omega:overview"), PP.d_bl_package);
  ed = M.d_handle(ed, docEvent("omega:overview", OV, { objects: OV_OBJECTS, visit: true }));
  assert.deepEqual(V.d_rows(ed).toArray(), [3, 4], "the rail navigates task to task (object :from rows)");

  // a plain text document: the provider declines and source-rows is the fallback
  const plain = usePkg(boot(SRC), PP.d_bl_package);
  assert.deepEqual(V.d_rows(plain).toArray(), V.d_source_rows(plain).toArray(), "text presentation declines to source-rows");
});

test("present rail: j steps task to task and the frame link fires exactly one visit (both load orders)", () => {
  needPP();
  const run = (order) => {
    const ps = order === "present-first" ? [PP.d_bl_package, D.d_bl_package] : [D.d_bl_package, PP.d_bl_package];
    let fr = FR.d_single(M.d_boot("", "x.bl.org"));
    for (const p of ps) fr = FR.d_handle(fr, ev(K("type"), K("use"), K("package"), p));
    const inbox = FR.d_layouts(FR.d_focused(fr)).get("inbox", null);
    assert.ok(inbox, "present provides the inbox layout");
    fr = FR.d_arrange(fr, inbox);
    let fx;
    [fr, fx] = FR.d_take_effects(fr).toArray();
    assert.deepEqual(fx.toArray().map((e) => [get(e, "pane").name, get(e, "path")]), [["rail", "omega:overview"]], "the rail fetches its document");

    fr = FR.d_handle(fr, paneDocEvent("rail", "omega:overview", OV, { objects: OV_OBJECTS }));
    fr = FR.d_handle(fr, ev(K("type"), K("click"), K("pane"), K("rail"), K("pos"), R.vec(3, 0)));
    [fr, fx] = FR.d_take_effects(fr).toArray();       // the initial selection opens t-5
    assert.deepEqual(fx.toArray().filter((e) => get(e, "kind") === K("visit")).map((e) => get(e, "path")), ["task:t-5"]);

    fr = FR.d_handle(fr, keyEv("j"));
    [fr, fx] = FR.d_take_effects(fr).toArray();
    const visits = fx.toArray().filter((e) => get(e, "kind") === K("visit"));
    assert.deepEqual(visits.map((e) => [get(e, "pane").name, get(e, "path")]), [["main", "task:t-6"]], "exactly one visit, to the next task");
    assert.deepEqual(head0(FR.d_editor(fr, K("rail"))), [4, 0], "the rail cursor is on the next task's row");
    return head0(FR.d_editor(fr, K("rail")));
  };
  assert.deepEqual(run("present-first"), run("dwim-first"), "both load orders step the same task");
});

test("present conversation: pinned on open, and typed j on the composer is a draft, not dwim", () => {
  needPP();
  let ed = usePkg(M.d_boot("", "omega:overview"), PP.d_bl_package);
  ed = usePkg(ed, D.d_bl_package);
  ed = M.d_handle(ed, docEvent("task:t-9", taskDoc(6), { ro: true, visit: true }));
  assert.equal(get(get(ed, "view"), "pin").fq, "end", "a task visit opens pinned to the latest");
  ed = keys(ed, "g s");                                  // go to the say block
  const composerRow = head0(ed)[0];
  assert.ok(text(ed).split("\n")[composerRow].includes("say"), "the cursor is on the composer row");
  const before = head0(ed);
  ed = key(ed, "j");                                     // a printable key on the composer
  assert.equal(mode(ed), "command", "the composer prompt opened");
  assert.equal(get(get(ed, "minibuf"), "text"), "j", "the typed j is the draft, not a navigation");
  assert.ok(String(get(get(ed, "minibuf"), "prompt")).startsWith("say to t-9"));
  assert.deepEqual(head0(ed), before, "dwim did not move the cursor");
});

test("present conversation: folded presentation exposes visible source rows and j lands on one", () => {
  needPP();
  let ed = usePkg(boot("", "omega:overview"), PP.d_bl_package);
  ed = usePkg(ed, D.d_bl_package);
  ed = M.d_handle(ed, docEvent("task:t-9", taskDoc(8), { ro: true, visit: true }));
  const rows = V.d_rows(ed).toArray();
  assert.ok(rows.length > 0 && rows.every((r) => Number.isInteger(r)), "provider rows are source rows");
  assert.ok(rows.length < lineCount(ed), "a folded presentation exposes fewer rows than the text has");
  ed = keys(ed, "g g");                                   // off the composer
  ed = key(ed, "j");
  const dest = head0(ed)[0];
  assert.ok(rows.includes(dest), "j lands on a visible provider row: " + dest);
  assert.ok(renderedSources(ed).includes(dest), "M.render draws the destination");
});

test("frame-wide packages: unuse in one pane removes dwim from every pane", () => {
  needPP();
  let fr = FR.d_single(M.d_boot("", "x.bl.org"));
  for (const p of [PP.d_bl_package, D.d_bl_package]) fr = FR.d_handle(fr, ev(K("type"), K("use"), K("package"), p));
  fr = FR.d_arrange(fr, FR.d_layouts(FR.d_focused(fr)).get("inbox", null));
  fr = FR.d_handle(fr, paneDocEvent("rail", "omega:overview", OV, { objects: OV_OBJECTS }));
  assert.ok(PKG.d_names(FR.d_editor(fr, K("rail"))).toArray().includes("dwim"));
  // unuse typed in :rail; the frame must spread the removal
  fr = FR.d_handle(fr, ev(K("type"), K("key"), K("pane"), K("rail"), K("key"), ":"));
  for (const ch of '(ed/unuse "dwim")') fr = FR.d_handle(fr, ev(K("type"), K("key"), K("pane"), K("rail"), K("key"), ch));
  fr = FR.d_handle(fr, ev(K("type"), K("key"), K("pane"), K("rail"), K("key"), "Enter"));
  assert.ok(!PKG.d_names(FR.d_editor(fr, K("rail"))).toArray().includes("dwim"), "gone from :rail");
  assert.ok(!PKG.d_names(FR.d_editor(fr, K("main"))).toArray().includes("dwim"), "gone from :main too");
});

test("off-topology movement enters the first task and returns to a hidden heading", () => {
  needPP();
  for (const packages of [[PP.d_bl_package, D.d_bl_package], [D.d_bl_package, PP.d_bl_package]]) {
    let ed = boot("", "omega:overview");
    for (const p of packages) ed = usePkg(ed, p);
    ed = M.d_handle(ed, docEvent("omega:overview", OV, { ro: true, visit: true, objects: OV_OBJECTS }));
    assert.deepEqual(head0(ed), [0, 0]);
    ed = key(ed, "j");
    assert.deepEqual(head0(ed), [3, 0], "the first j must not skip the first task, regardless of load order");
  }
  let ed = usePkg(boot(SRC), D.d_bl_package);
  ed = clickAt(ed, 4, 0);
  ed = key(ed, "Tab");
  assert.ok(hasFold(ed, 2));
  assert.deepEqual(head0(key(ed, "k")), [2, 0], "up from hidden body lands on its heading, not before it");
  assert.deepEqual(head0(key(ed, "j")), [10, 0], "down from hidden body lands after the folded section");
});

test("a click at the current clamped head resets the remembered goal", () => {
  let ed = usePkg(boot("0123456789\nab\nabcdefghij"), D.d_bl_package);
  ed = key(clickAt(ed, 0, 7), "j");
  assert.deepEqual(head0(ed), [1, 1]);
  ed = key(clickAt(ed, 1, 1), "j");
  assert.deepEqual(head0(ed), [2, 1], "explicitly choosing this column cancels the old goal, even if the head did not move");
});

test("a simultaneous parent collapse reveals another head on its representative", () => {
  let ed = usePkg(boot(SRC), D.d_bl_package);
  ed = setSel(ed, [[2, 0], [6, 3]], 1);
  ed = key(ed, "h");
  assert.ok(hasFold(ed, 2));
  assert.deepEqual(heads(ed), [[2, 0], [2, 2]]);
  assert.equal(primary(ed), 1);
});

test("the pure BL contract also runs in the JS target", async () => {
  const S = await load("dwim.selftest.mjs");
  const r = S.d_run();
  assert.deepEqual(get(r, "fail").toArray(), []);
  assert.equal(get(r, "pass"), 10);
});


test("present reveal keeps a visible wrapped source row and reveals the next row idempotently", async () => {
  const P = await load("pp.present.mjs");
  const marks = Array.from({ length: 20 }, (_, i) => P.d_line_mark(0, R.vec(ev(K("text"), "wrapped " + i, K("kind"), K("prose"))), "wrap-" + i));
  marks.push(P.d_text_mark(1), P.d_text_mark(2));
  const tree = ev(K("type"), K("doc"), K("key"), "wrap-test", K("from"), 0, K("to"), 3, K("kids"), R.vec());
  const pr = toBL({
    read: () => tree,
    table: { doc: () => P.d_stack(R.vecFromArray(marks)) },
    "lod-of": () => () => 3,
    "focus-of": () => null,
    isa: {}, around: [],
  });
  let ed = boot("long wrapped source\nnext\nend");
  ed = ed.assoc(K("view"), toBL({ top: 0, height: 4 }));
  const before = get(ed, "view");
  ed = P.d_reveal(pr, ed);
  assert.ok(R.eqv(get(ed, "view"), before), "visible row 0 must not jump to the end of its 20 wrapped slots");
  ed = setSel(ed, [[1, 0]]);
  ed = P.d_reveal(pr, ed);
  const sources = get(P.d_render(pr, ed), "lines").toArray().map((l) => get(l, "row") ?? get(l, "src"));
  assert.ok(sources.includes(1), "the next source row is drawn after arrival");
  assert.ok(R.eqv(P.d_reveal(pr, ed), ed), "a second reveal preserves the anchor");
});

test("presentations that do not use source folds decline outline h/l", () => {
  needPP();
  let ed = PP.d_boot(taskDoc(3), "task:t-9");
  ed = usePkg(ed, D.d_bl_package);
  ed = clickAt(ed, 2, 0);
  assert.equal(V.d_outline$Q(ed), false, "conversation folding belongs to its presentation, not source headings");
  const before = folds(ed);
  ed = key(ed, "h");
  assert.deepEqual(folds(ed), before, "h must not add invisible fold state in a conversation");
});


test("all fold combinations agree with the original visibility predicate and reversible j/k", () => {
  const tx = "* A\na\n** B\nb\n*** C\nc\n** D\nd\n* E\ne";
  const base = usePkg(boot(tx), D.d_bl_package);
  const outline = get(get(base, "struct"), "outline").toArray();
  const headingRows = outline.map(h => get(h, "row"));
  for (let mask = 0; mask < 2 ** headingRows.length; mask++) {
    const closed = headingRows.filter((_, i) => mask & (1 << i));
    const ed = withFolds(base, closed);
    const expected = range(lineCount(ed)).filter(r => !outline.some(h => closed.includes(get(h, "row")) && r > get(h, "row") && r < get(h, "end")));
    assert.deepEqual(V.d_source_rows(ed).toArray(), expected, "visibility for mask " + mask);
    for (let i = 0; i + 1 < expected.length; i++) {
      const at = setSel(ed, [[expected[i], 0]]);
      const after = key(at, "j");
      assert.deepEqual(head0(after), [expected[i + 1], 0]);
      assert.deepEqual(head0(key(after, "k")), [expected[i], 0]);
    }
  }
});

test("counted horizontal actions equal repeated commands and stay in normal-mode policy", () => {
  let ed = usePkg(boot(SRC), D.d_bl_package);
  ed = clickAt(ed, 7, 0);
  assert.ok(R.eqv(keys(ed, "3 h"), keys(ed, "h h h")));
  ed = withFolds(clickAt(ed, 2, 0), [2, 5, 7]);
  assert.ok(R.eqv(keys(ed, "3 l"), keys(ed, "l l l")));
});


test("normal h/l use the visible heading when Tab hides the source head", () => {
  let ed = usePkg(boot(SRC), D.d_bl_package);
  ed = key(clickAt(ed, 4, 0), "Tab");
  assert.ok(hasFold(ed, 2));
  assert.deepEqual(head0(ed), [4, 0], "core Tab leaves the source head in the hidden body");
  const opened = key(ed, "l");
  assert.ok(!hasFold(opened, 2), "l acts on the visible representative, not the invisible prose");
  assert.deepEqual(head0(opened), [2, 0]);
  assert.deepEqual(head0(key(ed, "h")), [2, 0], "h resolves the closed top-level section in place");
});


test("rail counts and multiple heads use the navigation policy in either package load order", () => {
  needPP();
  for (const packages of [[PP.d_bl_package, D.d_bl_package], [D.d_bl_package, PP.d_bl_package]]) {
    let ed = boot("", "omega:overview");
    for (const p of packages) ed = usePkg(ed, p);
    ed = M.d_handle(ed, docEvent("omega:overview", OV, { ro: true, visit: true, objects: OV_OBJECTS }));
    const counted = keys(ed, "3 j");
    assert.deepEqual(head0(counted), [4, 0], "3j reaches the last task in either load order");
    ed = key(setSel(ed, [[3, 0], [4, 0]], 1), "j");
    assert.deepEqual(heads(ed), [[4, 0], [4, 0]], "the rail does not replace a multi-selection with a single head");
    assert.equal(primary(ed), 1);
  }
});


test("omega outline honors an explicit fold even while the cursor focuses its heading", () => {
  needPP();
  let ed = usePkg(PP.d_boot(SRC, "x.bl.org"), D.d_bl_package);
  ed = keys(ed, "space t p");
  assert.equal(get(get(ed, "presentation"), "name"), "omega");
  ed = clickAt(ed, 2, 0);
  ed = key(ed, "h");
  assert.ok(hasFold(ed, 2));
  assert.ok(!renderedSources(ed).includes(3), "manual collapse must override focus-driven detail");
  assert.deepEqual(head0(key(ed, "j")), [10, 0]);
  const opened = key(ed, "l");
  assert.ok(!hasFold(opened, 2));
  assert.ok(renderedSources(opened).includes(3), "l restores the visible contents");
});


test("oversized counts stop when every selection is stationary", () => {
  let calls = 0; // Test probe, not production provider state or a timing assertion.
  const provider = ev(K("name"), "count-probe", K("provides"), ev(K("navigation"), ev(K("rows"), () => { calls++; return R.vec(0, 1); })));
  let ed = usePkg(usePkg(boot("first\nlast"), D.d_bl_package), provider);
  ed = key(ed.assoc(K("count"), 1000000), "j");
  assert.deepEqual(head0(ed), [1, 0]);
  assert.equal(calls, 2, "repeated boundary steps do not repeatedly derive the document");
  assert.equal(get(ed, "count"), null);
  calls = 0;
  ed = key(clickAt(ed, 0, 0).assoc(K("count"), 1000000), "h");
  assert.deepEqual(head0(ed), [0, 0]);
  assert.equal(calls, 1, "horizontal boundaries also stop, but real fold changes remain repeatable");
});


test("source topology memo ignores attention but invalidates folds and row count", () => {
  const ed = boot(SRC);
  const rows = V.d_source_rows(ed);
  const elsewhere = setSel(ed, [[10, 0]]).assoc(K("view"), toBL({ top: 5, height: 4 }));
  assert.equal(V.d_source_rows(elsewhere), rows, "cursor and viewport do not rebuild source visibility");
  assert.deepEqual(V.d_source_rows(withFolds(ed, [2])).toArray(), [0, 1, 2, 10, 11]);
  V.d_source_rows(ed); // Restore this structure/fold key before varying only row count.
  const longer = ed.assoc(K("text"), T.d_from_string(SRC + "\nextra"));
  assert.deepEqual(V.d_source_rows(longer).toArray(), range(13), "row count is part of the cache key");
});


test("rail navigation reuses its read-derived rows and follows a refreshed object index", () => {
  needPP();
  let ed = usePkg(PP.d_boot("", "omega:overview"), D.d_bl_package);
  ed = M.d_handle(ed, docEvent("omega:overview", OV, { ro: true, visit: true, objects: OV_OBJECTS }));
  const rows = V.d_rows(ed);
  assert.deepEqual(rows.toArray(), [3, 4]);
  assert.equal(V.d_rows(setSel(ed, [[3, 0]])), rows, "attention does not rewalk the task list");
  ed = M.d_handle(ed, docEvent("omega:overview", "intro\n\n" + OV, { ro: true, rev: "r3", objects: OV_OBJECTS.map(o => ({ ...o, row: o.row + 2 })) }));
  assert.deepEqual(V.d_rows(ed).toArray(), [5, 6], "a new read tree invalidates the derived row list");
});

