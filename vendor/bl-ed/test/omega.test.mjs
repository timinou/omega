// vendor/bl-ed/test/omega.test.mjs — omega's console half, driven headless.
//   BLED_OUT=vendor/bl-ed/web/out node --test vendor/bl-ed/test/omega.test.mjs
// The editor is a pure function of events; effects come back as data. These
// tests play the world's part by answering effects with events, exactly as
// web/host.mjs does over HTTP — so they pin the CONTRACT between page and
// server, not a mock of either.
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
const R = await import(pathToFileURL(path.join(out, "rt.mjs")).href);
const T = await import(pathToFileURL(path.join(out, "ed.text.mjs")).href);
const K = (s) => R.kw(s);
const get = (m, k) => (m == null ? null : m.get(K(k), null));
const ev = (...kv) => R.hashMap(...kv);

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

/** An editor session: events in, effects collected (not performed). */
function session(text, file = "plan.bl.org") {
  let ed = M.d_boot(text, file);
  let effects = [];
  const take = () => { const [e2, fx] = M.d_take_effects(ed).toArray(); ed = e2; effects.push(...fx.toArray().map(toJS)); };
  take();
  const s = {
    get ed() { return ed; },
    send(e) { ed = M.d_handle(ed, e); take(); return s; },
    key(k) { return s.send(ev(K("type"), K("key"), K("key"), k)); },
    keys(seq) { for (const k of seq.split(" ")) s.key(k === "<sp>" ? " " : k); return s; },
    type(str) { for (const ch of [...str]) s.key(ch); return s; },
    text() { return T.d_to_string(get(ed, "text")); },
    msg() { return get(ed, "message"); },
    goto(row) { return s.send(ev(K("type"), K("click"), K("pos"), R.vec(row, 0))); },
    drain(kind) { const hit = effects.filter((e) => e.kind === kind); effects = effects.filter((e) => e.kind !== kind); return hit; },
    render() { return M.d_render(ed); },
    line(row) { return get(s.render(), "lines").toArray().find((l) => get(l, "row") === row); },
  };
  return s;
}

const PLAN = [
  "#+TITLE: plan",
  "",
  "* TODO Hex literals",
  "#+begin_task :id hex",
  "Make read_number accept 0x hex literals.",
  "#+end_task",
  "",
  "* notes",
].join("\n");

test("C-Enter on a task block asks the world to open a task, then writes the reference", () => {
  const s = session(PLAN);
  s.goto(4).key("C-Enter");
  const [op] = s.drain("intent");
  assert.equal(op.intent, "task/open");
  assert.equal(op.args.goal, "Make read_number accept 0x hex literals.");
  assert.equal(op.args.block, "hex");
  assert.equal(op.args.path, "plan.bl.org");
  // the world answers (as host.mjs does with /api/intent's JSON)
  s.send(ev(K("type"), K("intent-result"), K("ok?"), true, K("data"), toBL({ id: "t-7", goal: "1" }),
            K("then"), K("task-opened"), K("block"), "hex"));
  const t = s.text();
  assert.match(t, /#\+end_task\n#\+RESULTS: hex\n: #omega\/task \{:id "t-7" :goal "\d+"\}\n/);
  assert.match(s.msg(), /opened t-7/);
});

test("the reference row is drawn as a live card; the text stays the reference", () => {
  const s = session(PLAN.replace("#+end_task", "#+end_task\n#+RESULTS: hex\n: #omega/task {:id \"t-7\" :goal \"1\"}"));
  assert.deepEqual(toJS(get(s.render(), "cards")), ["t-7"], "the host is told which cards to watch");
  s.send(ev(K("type"), K("cards"), K("data"), toBL([{ id: "t-7", status: "running", glyph: "●", word: "running", title: "make hex", age: "12s", claims: ["reader.py"] }])));
  const card = get(s.line(7), "card");
  assert.ok(card, "row 7 draws as a card");
  assert.match(get(card, "text"), /● running {2}t-7 · make hex {2}· 12s · ✎ reader.py/);
  assert.equal(get(card, "tone"), "running");
  assert.match(s.text(), /: #omega\/task \{:id "t-7" :goal "1"\}/, "the document text is unchanged");
  assert.equal(get(s.line(3), "agent?"), true, "the task block's first row is marked as an agent cell");
});

test("y on a card answers its question; y elsewhere still yanks", () => {
  const s = session(PLAN.replace("#+end_task", "#+end_task\n#+RESULTS: hex\n: #omega/task {:id \"t-7\" :goal \"1\"}"));
  s.send(ev(K("type"), K("cards"), K("data"), toBL([{ id: "t-7", status: "idle", glyph: "◆", word: "your turn", title: "x", age: "1s",
                                                       ask: { msg: "msg-3", text: "Bump to 0.2?" } }])));
  assert.match(get(get(s.line(7), "card"), "text"), /⚑ needs you {2}t-7 · asks: Bump to 0.2\?/);
  assert.equal(get(get(s.render(), "status"), "asks"), 1, "the status line counts open questions");
  s.goto(7).key("y");
  const [a] = s.drain("intent");
  assert.deepEqual([a.intent, a.args], ["msg/answer", { msg: "msg-3", text: "yes" }]);
  // elsewhere: y is yank, as always
  s.goto(0).key("x").key("y");
  assert.equal(s.drain("intent").length, 0);
  assert.match(s.msg() || "", /yank|^$/i);
});

test("C-Enter again: same body focuses, an edited body refines, a finished task reopens", () => {
  const ref = (status) => `: #omega/task {:id "t-7" :goal "${DIGEST}"${status ? ` :status :${status}` : ""}}`;
  // the digest the editor computes for the block body
  const probe = session(PLAN);
  probe.goto(4).key("C-Enter");
  probe.send(ev(K("type"), K("intent-result"), K("ok?"), true, K("data"), toBL({ id: "t-7" }), K("then"), K("task-opened"), K("block"), "hex"));
  const DIGEST = probe.text().match(/:goal "(\d+)"/)[1];

  const live = session(PLAN.replace("#+end_task", "#+end_task\n#+RESULTS: hex\n" + ref()));
  live.goto(4).key("C-Enter");
  assert.equal(live.drain("intent").length, 0, "same body: nothing is sent");
  assert.match(live.msg(), /t-7 is live/);

  live.goto(4).keys("A").type(" Octal too.").key("Escape").key("C-Enter");
  const [say] = live.drain("intent");
  assert.equal(say.intent, "task/say");
  assert.match(say.args.text, /Octal too\./);

  const done = session(PLAN.replace("#+end_task", "#+end_task\n#+RESULTS: hex\n" + ref("done")));
  done.goto(4).key("C-Enter");
  const [open] = done.drain("intent");
  assert.equal(open.intent, "task/open", "a finished task opens a new one");
  done.send(ev(K("type"), K("intent-result"), K("ok?"), true, K("data"), toBL({ id: "t-9" }), K("then"), K("task-opened"), K("block"), "hex"));
  assert.match(done.text(), /\{:id "t-9" :goal "\d+" :prev "t-7"\}/);
});

test("a reference the world wrote (no digest) is adopted on C-Enter, not refined", () => {
  const s = session(PLAN.replace("#+end_task", "#+end_task\n#+RESULTS: hex\n: #omega/task {:id \"t-10\"}"));
  s.goto(4).key("C-Enter");
  assert.equal(s.drain("intent").length, 0, "nothing is sent");
  assert.match(s.text(), /: #omega\/task \{:id "t-10" :goal "\d+"\}/, "the digest is added");
  assert.match(s.msg(), /t-10 is live/);
});

test("a finished task's reference is rewritten once with its summary", () => {
  const s = session(PLAN.replace("#+end_task", "#+end_task\n#+RESULTS: hex\n: #omega/task {:id \"t-7\" :goal \"1\"}"));
  s.send(ev(K("type"), K("cards"), K("data"), toBL([{ id: "t-7", status: "done", glyph: "✓", word: "done", title: "x", age: "4m", result: "parses 0x" }])));
  assert.match(s.text(), /: #omega\/task \{:id "t-7" :goal "1" :status :done :summary "parses 0x"\}/);
  const once = s.text();
  s.send(ev(K("type"), K("cards"), K("data"), toBL([{ id: "t-7", status: "done", glyph: "✓", word: "done", title: "x", age: "5m", result: "parses 0x" }])));
  assert.equal(s.text(), once, "not rewritten twice");
});

test("visiting a read-only view: objects get their keys, edits are refused, C-o goes back", () => {
  const s = session(PLAN);
  s.keys("<sp> a o");
  const [v] = s.drain("visit");
  assert.equal(v.path, "omega:overview");
  const OV = ["#+TITLE: omega · 1 task", "", "* Running (1)", "● t-7  hex  · 3s · plan.bl.org"].join("\n");
  s.send(ev(K("type"), K("doc"), K("path"), "omega:overview", K("text"), OV, K("rev"), "r1", K("read-only?"), true,
            K("title"), "omega:overview", K("objects"), toBL([{ row: 3, type: "omega/task", key: "t-7" }]), K("visit?"), true));
  assert.equal(get(get(s.render(), "status"), "path"), "omega:overview");
  // editing is refused, with a message saying what to do instead
  s.goto(3).key("i");
  assert.match(s.msg(), /read-only view/, "entering insert mode is refused, with what to do instead");
  assert.equal(get(s.ed, "mode").name, "normal");
  s.goto(0).key("x").key("d");
  assert.equal(T.d_to_string(get(s.ed, "text")), OV, "a delete is refused too");
  // on a task row, x is the task's cancel (it asks first), not select-line
  s.goto(3).key("x");
  assert.match(get(get(s.render(), "minibuf"), "prompt"), /cancel t-7\? type yes/);
  s.key("Escape");
  // t on a task row visits the task document
  s.goto(3).key("t");
  assert.equal(s.drain("visit")[0].path, "task:t-7");
  // C-o returns to the plan (a visit with the saved position)
  s.key("C-o");
  const [back] = s.drain("visit");
  assert.equal(back.path, "plan.bl.org");
});

test("a refreshed read-only view keeps the cursor; a refreshed dirty file keeps your text", () => {
  const s = session(PLAN);
  s.send(ev(K("type"), K("doc"), K("path"), "omega:overview", K("text"), "a\nb\nc", K("rev"), "r1", K("read-only?"), true, K("objects"), toBL([]), K("visit?"), true));
  s.goto(2);
  s.send(ev(K("type"), K("doc"), K("path"), "omega:overview", K("text"), "a\nb\nc\nd", K("rev"), "r2", K("read-only?"), true, K("objects"), toBL([]), K("visit?"), false));
  assert.equal(T.d_to_string(get(s.ed, "text")), "a\nb\nc\nd");
  assert.deepEqual(toJS(get(s.render(), "cursor")), [2, 0]);

  const f = session(PLAN);
  f.send(ev(K("type"), K("doc"), K("path"), "plan.bl.org", K("text"), PLAN, K("rev"), "p1", K("read-only?"), false, K("objects"), toBL([]), K("visit?"), false));
  f.goto(7).keys("A").type(" mine").key("Escape");
  f.send(ev(K("type"), K("doc"), K("path"), "plan.bl.org", K("text"), PLAN + "\ntheirs", K("rev"), "p2", K("read-only?"), false, K("objects"), toBL([]), K("visit?"), false));
  assert.match(f.text(), /notes mine/, "unsaved text is never overwritten by a refresh");
  assert.match(f.msg(), /changed elsewhere/);
  // C-s now sends the newer rev: an explicit overwrite
  f.key("C-s");
  const [save] = f.drain("save");
  assert.equal(save.base, "p2");
});

test("a refresh of a read-only view keeps what you are typing in the minibuffer", () => {
  const s = session(PLAN);
  s.send(ev(K("type"), K("doc"), K("path"), "omega:overview", K("text"), "a\nb", K("rev"), "r1", K("read-only?"), true, K("objects"), toBL([]), K("visit?"), true));
  s.keys("<sp> a n");
  s.send(ev(K("type"), K("text"), K("text"), "half a thou"));
  // the world ticks (an age, a new turn) while the prompt is open
  s.send(ev(K("type"), K("doc"), K("path"), "omega:overview", K("text"), "a\nb\nc", K("rev"), "r2", K("read-only?"), true, K("objects"), toBL([]), K("visit?"), false));
  assert.equal(get(get(s.render(), "minibuf"), "text"), "half a thou", "the draft survives the refresh");
  assert.equal(T.d_to_string(get(s.ed, "text")), "a\nb\nc", "and the view still follows the world");
  s.send(ev(K("type"), K("text"), K("text"), "ght")).key("Enter");
  const [op] = s.drain("intent");
  assert.deepEqual(op.args, { goal: "half a thought" });
});

test("space a n opens a homeless task through the minibuffer", () => {
  const s = session(PLAN);
  s.keys("<sp> a n");
  assert.equal(get(get(s.render(), "minibuf"), "prompt"), "new task ▸ ");
  s.send(ev(K("type"), K("text"), K("text"), "tidy imports")).key("Enter");
  const [op] = s.drain("intent");
  assert.deepEqual([op.intent, op.args], ["task/open", { goal: "tidy imports" }]);
});

test("ordinary cells still evaluate (C-Enter falls through to eval-cell)", () => {
  const s = session("#+begin_src beam-lisp\n(+ 1 2)\n#+end_src\n");
  s.goto(1).key("C-Enter");
  assert.equal(s.drain("intent").length, 0);
  assert.ok(s.drain("eval-cell").length + (/⇒ 3/.test(s.msg() || "") ? 1 : 0) >= 1, "evaluated in the page or sent to the BEAM");
});
