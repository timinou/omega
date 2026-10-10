// vendor/bl-ed/test/pkg.test.mjs — packages (ed/pkg.bl), driven headless.
//   BLED_OUT=vendor/bl-ed/web/out node --test vendor/bl-ed/test/pkg.test.mjs
// A package is a BL map of layers. These tests build one by hand (as a module
// would export it) and pin the contract: use / unuse are exact, packages
// survive visits, :intercept / :on-event / :adopt / :render run where the
// core says, and ed/use asks the host to load a module (an effect).
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
const K = (s) => R.kw(s);
const get = (m, k) => (m == null ? null : m.get(K(k), null));
const ev = (...kv) => R.hashMap(...kv);
const key = (k) => ev(K("type"), K("key"), K("key"), k);
const doc = (p, text, visit) => ev(K("type"), K("doc"), K("path"), p, K("text"), text, K("rev"), "r" + Math.random(),
  K("read-only?"), true, K("objects"), R.vecFromArray([]), K("visit?"), visit);

// A package written the way a module exports one: plain data + fns.
const shout = R.hashMap(
  K("name"), "shout",
  K("commands"), R.hashMap(K("shout/hi"), R.hashMap(K("doc"), "say hi", K("run"), (ed) => ed.assoc(K("message"), "HI"))),
  K("keys"), R.hashMap(K("normal"), R.hashMap("Q", K("shout/hi"))),
  // takes "!" before the core
  K("intercept"), (ed, e) => (get(e, "key") === "!" ? ed.assoc(K("message"), "taken") : null),
  // counts every event the core handled
  K("on-event"), (old, nw, e) => { const st = get(nw, "pkg-state") || R.EMPTY_MAP;
                                    return nw.assoc(K("pkg-state"), st.assoc("shout", (st.get("shout", 0) || 0) + 1)); },
  // marks every document it adopts
  K("adopt"), (ed) => ed.assoc(K("shout-adopted"), get(ed, "path")),
  // draws only shout: documents
  K("render"), (ed) => (String(get(ed, "path")).startsWith("shout:") ? R.hashMap(K("lines"), R.vecFromArray([]), K("drawn-by"), "shout") : null),
  K("owns"), R.vec(K("shout-adopted")));

const use = (ed, p) => M.d_handle(ed, ev(K("type"), K("use"), K("package"), p));

test("a used package adds keys and commands; unuse removes exactly them", () => {
  let ed = M.d_boot("a\nb\n", "x.bl.org");
  ed = M.d_handle(ed, key("Q"));
  assert.match(get(ed, "message"), /not bound/, "Q is not bound before");
  ed = use(ed, shout);
  assert.equal(get(ed, "message"), "using shout");
  ed = M.d_handle(ed, key("Q"));
  assert.equal(get(ed, "message"), "HI", "the package's key runs its command");
  assert.deepEqual(get(M.d_render(ed), "packages").toArray(), ["shout"]);
  const before = get(ed, "user-keys");
  ed = M.d_handle(ed, ev(K("type"), K("key"), K("key"), ":"));
  for (const ch of '(ed/unuse "shout")') ed = M.d_handle(ed, ev(K("type"), K("text"), K("text"), ch));
  ed = M.d_handle(ed, key("Enter"));
  ed = M.d_handle(ed, key("Q"));
  assert.match(get(ed, "message"), /not bound/, "unuse removed the key");
  assert.equal(get(ed, "user-keys"), before, "the user's own tables were never touched");
  assert.deepEqual(get(M.d_render(ed), "packages").toArray(), []);
  assert.equal(get(ed, "shout-adopted"), null, "the key it :owns is gone too");
});

test("a package intercepts before the core, reacts after it, adopts visited documents", () => {
  let ed = use(M.d_boot("a\nb\n", "x.bl.org"), shout);
  ed = M.d_handle(ed, key("!"));
  assert.equal(get(ed, "message"), "taken", "intercept took the key");
  ed = M.d_handle(ed, key("j"));
  assert.equal(get(ed, "pkg-state").get("shout", 0), 2, "on-event ran for installation and after the core moved the cursor (not for the intercepted key)");
  ed = M.d_handle(ed, doc("shout:one", "x\ny\n", true));
  assert.equal(get(ed, "shout-adopted"), "shout:one", "a visited document is adopted");
  assert.deepEqual(get(M.d_render(ed), "packages").toArray(), ["shout"], "the package survives the visit");
  assert.equal(get(M.d_render(ed), "drawn-by"), "shout", "its :render draws its documents");
  ed = M.d_handle(ed, doc("other:two", "z\n", true));
  assert.equal(get(M.d_render(ed), "drawn-by"), null, "other documents draw as text");
});

test("ed/use asks the host for the module (an effect); a failed load is a message", () => {
  let ed = M.d_boot("a\n", "x.bl.org");
  ed = M.d_handle(ed, ev(K("type"), K("key"), K("key"), ":"));
  for (const ch of '(ed/use "present")') ed = M.d_handle(ed, ev(K("type"), K("text"), K("text"), ch));
  ed = M.d_handle(ed, key("Enter"));
  const [, fx] = M.d_take_effects(ed).toArray();
  const load = fx.toArray().find((e) => get(e, "kind") === K("load-package"));
  assert.ok(load, "a :load-package effect");
  assert.equal(get(load, "name"), "present");
  ed = M.d_handle(ed, ev(K("type"), K("use"), K("package"), null, K("message"), "cannot load ./pkg/present.mjs"));
  assert.match(get(ed, "message"), /error: cannot load/);
});

test("package observers see completed module installation and failed loads", () => {
  const events=[];
  const observer=ev(K("name"),"observer",K("on-event"),(old,nw,event)=>{
    if(get(event,"type")===K("use"))events.push({old,new:nw,event});
    return nw;
  });
  let ed=use(M.d_boot("source","x.bl.org"),observer);
  const added=ev(K("name"),"added");ed=use(ed,added);
  assert.equal(events.length,2);
  assert.deepEqual(get(events[1].old,"packages").toArray().map(p=>get(p,"name")),["observer"]);
  assert.deepEqual(get(events[1].new,"packages").toArray().map(p=>get(p,"name")),["observer","added"]);
  assert.equal(get(events[1].event,"package"),added);
  ed=M.d_handle(ed,ev(K("type"),K("use"),K("package"),null,K("message"),"missing"));
  assert.equal(events.length,3);assert.match(get(ed,"message"),/error: missing/);
});
