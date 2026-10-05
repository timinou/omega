// node --test spikes/present/test/scroll.test.mjs
// The conversation's scrolling contract, headless (pp.main compiled by build.sh):
//   1. opening a task shows the LATEST (pinned to the end), cursor not on the composer
//   2. an update while pinned keeps the end in view (a new turn scrolls in)
//   3. an update while you read (scrolled up) does NOT move what you see
//   4. scrolling by a fraction of a row is exact, and the rows below peek in
//   5. reaching the end re-pins; a key motion starts from what is on screen
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
const out = path.resolve(process.env.PP_OUT || new URL("../web/out", import.meta.url).pathname);
const load = (m) => import(pathToFileURL(path.join(out, m)).href);
const P = await load("pp.main.mjs");
const R = await load("rt.mjs");
const K = R.kw;
const get = (m, k) => m.get(K(k));
const ev = (...kv) => R.hashMap(...kv.map((x, i) => (i % 2 === 0 ? K(x) : x)));

const para = (n, tag) => Array.from({ length: n }, (_, i) => `${tag} line ${i} of an answer that is long enough to wrap in a narrow pane of cells`).join("\n");
function task(turns, extra = "") {
  let s = "#+TITLE: t-9 · scroll-fixture · ◆ your turn · 1h\nhome: scratch\n\n";
  for (let i = 1; i <= turns; i++) s += `* you · ${i}\nquestion number ${i}\n* model · ${i + 1}\n${para(6, "a" + i)}\n`;
  return s + extra + "* traces\n- tool · eval#1/x — eval ok\n\n* say ▸  (RET to message the task)\n";
}
const doc = (text, rev, visit) => ev("type", K("doc"), "path", "task:t-9", "text", text, "rev", rev, "read-only?", true, "title", "t-9", "objects", R.EMPTY_VEC ?? R.vecFromArray([]), "visit?", visit);

function open(turns = 6) {
  let ed = P.d_boot("", "omega:overview");   // the host boots on the overview, then visits
  ed = P.d_handle(ed, ev("type", K("resize"), "height", 24, "cols", 60));
  ed = P.d_handle(ed, doc(task(turns), "r1", true));
  return ed;
}
const view = (ed) => P.d_render(ed);
const texts = (v) => get(v, "lines").toArray().map((l) => (get(l, "segments") ? get(l, "segments").toArray().map((s) => get(s, "text")).join("") : ""));
const scroll = (ed, d) => P.d_handle(ed, ev("type", K("scroll-slots"), "delta", d));
const key = (ed, k) => P.d_handle(ed, ev("type", K("key"), "key", k));
const pin = (ed) => get(get(ed, "view"), "pin") ?? null;
const slotTop = (ed) => get(view(ed), "slot-top");

test("opening a task shows the latest, pinned, with the cursor off the composer", () => {
  const ed = open();
  assert.equal(pin(ed), K("end"));
  const v = view(ed);
  assert.ok(texts(v).join("\n").includes("say"), "the docked composer is shown");
  assert.equal(get(v, "slot-top"), get(v, "tail-top"), "the viewport is the one that ends at the end");
  const comp = texts(v).findIndex((t) => t.includes("say"));
  assert.ok(comp > 0);
});

test("an update while pinned keeps the end in view; a new turn scrolls in", () => {
  let ed = open();
  const before = slotTop(ed);
  ed = P.d_handle(ed, doc(task(6, "* model · 99\nBRAND NEW ANSWER\n"), "r2", false));
  assert.equal(pin(ed), K("end"), "still following");
  assert.ok(slotTop(ed) > before, "the viewport moved down with the new text");
  assert.ok(texts(view(ed)).join("\n").includes("BRAND NEW ANSWER"));
});

test("an update while you read does not move what you see", () => {
  let ed = open();
  ed = scroll(ed, -40);
  assert.equal(pin(ed), null, "scrolling up lets go");
  const first = texts(view(ed)).filter((t) => t.trim())[0];
  const top = slotTop(ed);
  ed = P.d_handle(ed, doc(task(6, "* model · 99\nBRAND NEW ANSWER\n"), "r2", false));
  assert.equal(slotTop(ed), top, "the same slot is at the top");
  assert.equal(texts(view(ed)).filter((t) => t.trim())[0], first, "the same words are at the top");
  const ed2 = P.d_handle(ed, doc(task(6, "* model · 99\nBRAND NEW ANSWER\n"), "r3", false));
  assert.equal(slotTop(ed2), top, "and again");
});

test("an update ABOVE what you read moves the row, not the picture", () => {
  let ed = open(8);
  ed = scroll(ed, -30);
  const first = texts(view(ed)).filter((t) => t.trim())[0];
  // a line is inserted at the top (the title's age line changes length, a header line is added)
  const t2 = task(8).replace("home: scratch\n", "home: scratch\nnew header line\n");
  ed = P.d_handle(ed, doc(t2, "r2", false));
  assert.equal(texts(view(ed)).filter((t) => t.trim())[0], first, "same words on top after text moved down a row");
});

test("scrolling by a fraction of a row is exact; the next row peeks in at the bottom", () => {
  let ed = open();
  ed = scroll(ed, -40);
  const v0 = view(ed);
  ed = scroll(ed, 0.5);
  const v1 = view(ed);
  assert.ok(Math.abs(get(v1, "frac") - ((get(v0, "frac") || 0) + 0.5)) < 1e-9 || get(v1, "slot-top") > get(v0, "slot-top"));
  assert.ok(get(v1, "frac") > 0);
  const ls = get(v1, "lines").toArray();
  assert.ok(ls.some((l) => get(l, "peek?")), "a slot peeks in below the body");
  assert.ok(ls.filter((l) => get(l, "fixed?")).length >= 2, "headline/composer rows are fixed");
  // scrolling back by the same amount returns the picture
  ed = scroll(ed, -0.5);
  assert.equal(get(view(ed), "slot-top"), get(v0, "slot-top"));
});

test("scrolling down to the end re-pins; a key moves from what is on screen", () => {
  let ed = open();
  ed = scroll(ed, -40);
  ed = scroll(ed, 9999);
  assert.equal(pin(ed), K("end"), "at the tail again → following");
  const before = slotTop(ed);
  ed = key(ed, "k");
  assert.equal(pin(ed), null, "a key unpins (it is a reader's move)");
  assert.ok(Math.abs(slotTop(ed) - before) <= 4, "and does not throw the picture away");
});


test("resizing a pinned conversation keeps its latest body and docked composer", () => {
  let ed = open(12);
  for (const [height, cols] of [[12, 36], [32, 100], [20, 48]]) {
    ed = P.d_handle(ed, ev("type", K("resize"), "height", height, "cols", cols));
    const v = view(ed);
    assert.equal(pin(ed), K("end"));
    assert.equal(get(v, "slot-top"), get(v, "tail-top"));
    assert.ok(texts(v).join("\n").includes("say"));
    const fixed = get(v, "lines").toArray().filter((l) => get(l, "fixed?"));
    assert.ok(fixed.every((l) => get(l, "vy") >= 0 && get(l, "vy") < height));
  }
});

test("a cursor left off-screen cannot make the first pinned motion jump to history", () => {
  let ed = open(20);
  const at = R.vec(0, 0);
  ed = ed.assoc(K("sels"), R.vec(R.hashMap(K("anchor"), at, K("head"), at)));
  const before = slotTop(ed);
  ed = key(ed, "k");
  assert.equal(pin(ed), null);
  assert.ok(Math.abs(slotTop(ed) - before) <= 4, "motion starts from the visible body, not the stale cursor");
});

test("a multiline composer draft survives refresh and resize without losing tail-follow", () => {
  let ed = key(open(8), "i");
  ed = P.d_handle(ed, ev("type", K("text"), "text", "first line"));
  ed = key(ed, "S-Enter");
  ed = P.d_handle(ed, ev("type", K("text"), "text", "second line"));
  const draft = get(get(ed, "minibuf"), "text");
  assert.equal(draft, "first line\nsecond line");
  ed = P.d_handle(ed, doc(task(8, "* model · 99\nNEW TURN WHILE DRAFTING\n"), "r2", false));
  ed = P.d_handle(ed, ev("type", K("resize"), "height", 18, "cols", 40));
  assert.equal(get(get(ed, "minibuf"), "text"), draft);
  assert.ok(texts(view(ed)).join("\n").includes("second line"));
  assert.equal(pin(ed), K("end"));
});

test("fractional reading position survives repeated updates and a narrow resize", () => {
  let ed = scroll(open(12), -60.5);
  const anchor = get(get(ed, "view"), "anchor");
  const sourceRow = get(anchor, "row");
  const sub = get(anchor, "sub");
  for (let rev = 2; rev < 8; rev++) {
    ed = P.d_handle(ed, doc(task(12, `* model · 99\nnew answer ${rev}\n`), "r" + rev, false));
    assert.equal(get(get(get(ed, "view"), "anchor"), "row"), sourceRow);
    assert.equal(get(get(get(ed, "view"), "anchor"), "sub"), sub);
    assert.equal(pin(ed), null);
  }
  ed = P.d_handle(ed, ev("type", K("resize"), "height", 16, "cols", 32));
  assert.equal(get(get(get(ed, "view"), "anchor"), "row"), sourceRow);
  assert.equal(pin(ed), null);
});

