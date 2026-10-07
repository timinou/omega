// vendor/bl-ed/test/frame.test.mjs — frames (ed/frame.bl), driven headless.
//   BLED_OUT=vendor/bl-ed/web/out node --test vendor/bl-ed/test/frame.test.mjs
// The frame is a pure function of events like the editor; these tests play
// the host (they answer :visit effects with :doc events for the pane that
// asked) and pin the contract in research/domain/interface/frames.bl.md §5.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import fs from "node:fs";

const out = path.resolve(process.env.BLED_OUT || "vendor/bl-ed/web/out");
const { start } = await import(pathToFileURL(path.join(out, "repl.mjs")).href);
const repl = await start((f) => fs.readFileSync(path.join(out, "src", f), "utf8"));
globalThis.BL_HOST = Object.assign(globalThis.BL_HOST || {}, {
  "eval-ed": (src, api) => repl.evalWith(src, "ed", api),
  "eval-cells": (cells) => repl.evalCells(cells),
});
const M = await import(pathToFileURL(path.join(out, "ed.main.mjs")).href);
const F = await import(pathToFileURL(path.join(out, "ed.frame.mjs")).href);
const R = await import(pathToFileURL(path.join(out, "rt.mjs")).href);
const K = (s) => R.kw(s);
const get = (m, k) => (m == null ? null : m.get(K(k), null));
const ev = (...kv) => R.hashMap(...kv);
const key = (k) => ev(K("type"), K("key"), K("key"), k);
const toBL = (x) => Array.isArray(x) ? R.vecFromArray(x.map(toBL))
  : (x && typeof x === "object") ? Object.entries(x).reduce((m, [k, v]) => m.assoc(K(k), toBL(v)), R.EMPTY_MAP) : x;

// two documents a world would serve
const DOCS = {
  "list:all": { text: "* tasks\nalpha\nbeta\n", objects: [{ row: 1, type: "demo/item", key: "a" }, { row: 2, type: "demo/item", key: "b" }] },
  "item:a": { text: "the alpha item\n", objects: [] },
  "item:b": { text: "the beta item\n", objects: [] },
};
const docEv = (pane, p, visit = true) => ev(K("type"), K("doc"), K("pane"), K(pane), K("path"), p, K("text"), DOCS[p].text, K("rev"), "r-" + p,
  K("read-only?"), true, K("objects"), toBL(DOCS[p].objects), K("visit?"), visit);

// a package that provides a layout, a link for its type and a view kind
const LAYOUT = toBL({ name: "two", panes: [{ id: "rail", doc: "list:all", width: ["ch", 30] }, { id: "main", doc: "linked", width: "fill" }, { id: "map", view: ["outline", "main"], width: ["ch", 20] }],
  links: [{ from: "rail", on: "select", to: "main", do: "visit" }], focus: "rail" })
  // keyword values where the contract wants keywords
  .assoc(K("panes"), R.vecFromArray([
    toBL({ doc: "list:all" }).assoc(K("id"), K("rail")).assoc(K("width"), R.vec(K("ch"), 30)),
    ev(K("id"), K("main"), K("doc"), K("linked"), K("width"), K("fill")),
    ev(K("id"), K("map"), K("view"), R.vec(K("outline"), K("main")), K("width"), R.vec(K("ch"), 20)),
  ]))
  .assoc(K("links"), R.vec(ev(K("from"), K("rail"), K("on"), K("select"), K("to"), K("main"), K("do"), K("visit"))))
  .assoc(K("focus"), K("rail"));
const demo = R.hashMap(K("name"), "demo",
  K("provides"), R.hashMap(
    K("layouts"), R.hashMap("two", LAYOUT),
    K("links"), R.hashMap("demo/item", (o) => "item:" + get(o, "key")),
    K("views"), R.hashMap(K("outline"), (ed) => R.hashMap(K("path"), get(ed, "path")))));

/** A frame session: host-side, answering :visit effects for the right pane. */
function session(text = "notes\n", file = "x.bl.org") {
  let fr = F.d_single(M.d_boot(text, file));
  const log = [];
  const s = {
    get fr() { return fr; },
    send(e) {
      fr = F.d_handle(fr, e);
      const [f2, fx] = F.d_take_effects(fr).toArray(); fr = f2;
      for (const x of fx.toArray()) {
        log.push(x);
        if (get(x, "kind") === K("visit") && DOCS[get(x, "path")]) s.send(docEv(get(x, "pane").name, get(x, "path")));
      }
      return s;
    },
    key(k) { return s.send(key(k)); },
    cmd(src) { s.key(":"); for (const ch of src) s.send(ev(K("type"), K("text"), K("text"), ch)); return s.key("Enter"); },
    visits() { return log.filter((x) => get(x, "kind") === K("visit")).map((x) => [get(x, "pane").name, get(x, "path")]); },
    ed(id) { return F.d_editor(fr, K(id)); },
    path(id) { return get(s.ed(id), "path"); },
  };
  s.send(ev(K("type"), K("use"), K("package"), demo));
  return s;
}

test("one pane is today's bl-ed: the frame renders exactly ed.main/render", () => {
  let ed = M.d_boot("* a\nb\n#+begin_src beam-lisp\n(+ 1 2)\n#+end_src\n", "x.bl.org");
  let fr = F.d_single(ed);
  for (const k of ["j", "j", "w", "x", "k"]) { ed = M.d_handle(ed, key(k)); fr = F.d_handle(fr, key(k)); }
  const panes = get(F.d_render(fr), "panes").toArray();
  assert.equal(panes.length, 1);
  assert.equal(R.printStr(get(panes[0], "view")), R.printStr(M.d_render(ed)), "same view model, key for key");
});

test("ed/layout arranges the window: the current editor is kept, other panes fetch their docs", () => {
  const s = session();
  s.key("j");
  s.cmd('(ed/layout "two")');
  assert.equal(get(F.d_render(s.fr), "layout"), "two");
  assert.deepEqual(F.d_editor_ids(s.fr).toArray().map((k) => k.name), ["rail", "main"], "views are not editors");
  assert.equal(s.path("main"), "x.bl.org", "the editor you were in moved into the :linked pane, intact");
  assert.equal(get(s.ed("main"), "sels").toArray()[0].get(K("head")).toArray()[0], 1, "with its cursor");
  assert.equal(s.path("rail"), "list:all", "the rail fetched its document");
  assert.equal(get(s.fr, "focus"), K("rail"), "focus as the layout says");
});

test("a :select link: moving onto an object visits it in the linked pane (as an effect)", () => {
  const s = session().cmd('(ed/layout "two")');
  s.key("j");
  assert.deepEqual(s.visits().slice(-1), [["main", "item:a"]], "exactly one visit, for :main");
  assert.equal(s.path("main"), "item:a");
  s.key("j");
  assert.equal(s.path("main"), "item:b");
  s.key("k");
  assert.equal(s.path("main"), "item:a", "back onto alpha: item:a again");
  const n = s.visits().length;
  s.key("k");                                    // onto the heading: not an object
  assert.equal(s.visits().length, n, "leaving objects visits nothing");
  assert.equal(s.path("main"), "item:a", "the pane keeps what it showed");
  assert.equal(s.path("rail"), "list:all", "the rail itself never moved");
});

test("effects are tagged by pane; an answer for one pane changes only that pane", () => {
  const s = session().cmd('(ed/layout "two")');
  const before = s.ed("rail");
  s.send(docEv("main", "item:b"));
  assert.equal(s.path("main"), "item:b");
  assert.equal(s.ed("rail"), before, "the rail is the same value");
});

test("space w w cycles focus over editor panes only; space w o keeps the focused editor", () => {
  const s = session().cmd('(ed/layout "two")');
  assert.equal(get(s.fr, "focus"), K("rail"));
  s.key(" ").key("w").key("w");
  assert.equal(get(s.fr, "focus"), K("main"));
  s.key(" ").key("w").key("w");
  assert.equal(get(s.fr, "focus"), K("rail"), "the view pane was skipped");
  s.key("j");                                    // select item:a → main shows it
  s.key(" ").key("w").key("l").key(" ").key("w").key("o");
  assert.equal(get(F.d_render(s.fr), "layout"), "single");
  assert.equal(s.path("main"), "item:a", "only the focused editor remains, intact");
});

test("a view pane draws from the pane it views, through the package's :views", () => {
  const s = session().cmd('(ed/layout "two")');
  s.key("j");
  const map = get(F.d_render(s.fr), "panes").toArray().find((p) => get(p, "id") === K("map"));
  assert.equal(get(map, "kind"), K("view"));
  assert.equal(get(get(map, "view"), "path"), "item:a", "the view follows :main");
});

test("(ed/layout nil) and unknown layouts", () => {
  const s = session().cmd('(ed/layout "nope")');
  assert.match(get(s.ed("main"), "message"), /no layout nope/);
  s.cmd('(ed/layout "two")').cmd("(ed/layout nil)");
  assert.equal(get(F.d_render(s.fr), "layout"), "single");
});

test("packages are frame-wide: unuse in one pane removes it everywhere, and its layout", () => {
  const s = session().cmd('(ed/layout "two")');
  assert.deepEqual(get(M.d_render(s.ed("main")), "packages").toArray(), ["demo"], "a pane opened by the layout carries the package");
  s.cmd('(ed/unuse "demo")');                    // typed in :rail
  assert.equal(get(F.d_render(s.fr), "layout"), "single", "the layout its package provided ended");
  assert.deepEqual(get(M.d_render(F.d_focused(s.fr)), "packages").toArray(), []);
});

test("boot layout without a command line: F.arrange(fr, layouts[name]) is what ed/layout does", () => {
  // the host (web/host.mjs) opens ?layout= this way, so the inbox needs no language
  const viaCmd = session().cmd('(ed/layout "two")');
  let fr = F.d_single(M.d_boot("notes\n", "x.bl.org"));
  fr = F.d_handle(fr, ev(K("type"), K("use"), K("package"), demo));
  const layout = F.d_layouts(F.d_focused(fr)).get("two", null);
  assert.ok(layout, "layouts come from the loaded packages");
  fr = F.d_arrange(fr, layout);
  const [fr2, effects] = F.d_take_effects(fr).toArray();
  assert.deepEqual(effects.toArray().map((e) => [get(e, "pane").name, get(e, "path")]), [["rail", "list:all"]], "the rail's document is requested");
  assert.equal(get(F.d_render(fr2), "layout"), "two");
  assert.equal(get(fr2, "focus"), get(viaCmd.fr, "focus"));
  assert.deepEqual(F.d_editor_ids(fr2).toArray().map((k) => k.name), F.d_editor_ids(viaCmd.fr).toArray().map((k) => k.name));
  assert.equal(get(F.d_editor(fr2, K("main")), "path"), "x.bl.org", "the kept editor moved into the linked pane");
  assert.equal(F.d_layouts(F.d_focused(fr)).get("nope", null), null, "an unknown layout is detectable without evaluating");
});

test("events for a pane that left (a late host answer) leave the frame untouched", () => {
  const s = session().cmd('(ed/layout "two")');
  s.cmd("(ed/layout nil)");
  const before = get(s.fr, "editors");
  s.send(docEv("main", "item:a"));      // unarrange kept the focused :rail; :main is gone
  assert.equal(get(s.fr, "editors"), before, "dropped: the editors are the same value");
});

test("a frame reuses unchanged pane models while another editor moves", () => {
  const s = session("one\ntwo\nthree\n").cmd('(ed/layout "two")');
  const models = () => new Map(get(F.d_render(s.fr), "panes").toArray().map((p) => [get(p, "id").name, get(p, "view")]));
  const before = models();
  assert.equal(models().get("rail"), before.get("rail"));
  assert.equal(models().get("main"), before.get("main"));
  s.send(ev(K("type"), K("key"), K("pane"), K("main"), K("key"), "j"));
  const after = models();
  assert.equal(after.get("rail"), before.get("rail"), "scrolling/moving in main does not derive the rail again");
  assert.notEqual(after.get("main"), before.get("main"), "changed editor input invalidates its model");
});


test('reconfigure retains named editors and blocks discarded text and prompt drafts', () => {
 let ed=M.d_boot('saved','item:a');
 const layout=ev(K('name'),'detail',K('panes'),R.vec(ev(K('id'),K('rail'),K('width'),R.vec(K('ch'),30)),ev(K('id'),K('main'),K('width'),K('fill')),ev(K('id'),K('aside'),K('width'),R.vec(K('ch'),40))),K('links'),R.vec());
 const pkg=ev(K('name'),'reflow-test',K('provides'),ev(K('layouts'),R.hashMap('detail',layout)));
 ed=M.d_handle(ed,ev(K('type'),K('use'),K('package'),pkg));let fr=F.d_single(ed);
 const request=ev(K('layout'),'detail',K('pane'),K('main'),K('keep'),ev(K('aside'),K('origin'),K('main'),null),K('focus'),K('main'),K('visits'),ev(K('main'),ev(K('path'),'item:b')));
 const next=F.d_reconfigure(fr,request);assert.strictEqual(F.d_editor(next,K('aside')),ed);assert.equal(get(F.d_editor(next,K('main')),'path'),'');
 assert.equal(get(get(next,'effects').toArray().at(-1),'path'),'item:b');
 fr=F.d_single(M.d_handle(M.d_handle(ed,key('i')),ev(K('type'),K('text'),K('text'),'draft')));
 const refused=F.d_reconfigure(fr,request.assoc(K('keep'),ev(K('main'),null)));assert.equal(get(get(refused,'layout'),'name'),'single');assert.match(get(F.d_focused(refused),'message'),/discard a draft/);
 const prompt=ed.assoc(K('mode'),K('command')).assoc(K('minibuf'),ev(K('text'),'a reply'));
 const refusedPrompt=F.d_reconfigure(F.d_single(prompt),request.assoc(K('keep'),ev(K('main'),null)));assert.equal(get(get(refusedPrompt,'layout'),'name'),'single');
});

test('source candidates keep an existing context or retain main when adding the first aside', () => {
 const panes=R.vec(ev(K('id'),K('main'),K('doc'),K('linked'),K('width'),K('fill')),ev(K('id'),K('rail'),K('doc'),K('linked'),K('width'),R.vec(K('ch'),20)));
 const two=ev(K('name'),'two',K('panes'),panes,K('links'),R.vec());
 const detail=ev(K('name'),'detail',K('panes'),panes.conj(ev(K('id'),K('aside'),K('doc'),K('linked'),K('width'),K('fill'))),K('links'),R.vec());
 const pkg=ev(K('name'),'context-test',K('provides'),ev(K('layouts'),R.hashMap('two',two,'detail',detail)));
 const original=M.d_handle(M.d_boot('task','task:a'),ev(K('type'),K('use'),K('package'),pkg)).assoc(K('mode'),K('command')).assoc(K('minibuf'),ev(K('text'),'retained reply'));
 let fr=F.d_arrange(F.d_single(original),two);
 const request=ev(K('layout'),'detail',K('pane'),K('main'),K('keep'),ev(K('rail'),K('rail'),K('main'),null,K('aside'),R.vec(K('aside'),K('main'))),K('focus'),K('main'));
 fr=F.d_reconfigure(fr,request);assert.strictEqual(F.d_editor(fr,K('aside')),original);
 fr=fr.assoc(K('editors'),get(fr,'editors').assoc(K('main'),M.d_boot('folder listing','folder:a').assoc(K('packages'),get(original,'packages'))));
 const next=F.d_reconfigure(fr,request);assert.strictEqual(F.d_editor(next,K('aside')),original);assert.equal(get(F.d_editor(next,K('main')),'path'),'');
 assert.equal(get(get(F.d_editor(next,K('aside')),'minibuf'),'text'),'retained reply');
});
