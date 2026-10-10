import { test } from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
// Drive test of the guidelines package contract against the real compiled bl-ed (vendor/bl-ed/web/out).
// Run (after spikes/guidelines/build.sh): node --test spikes/guidelines/test/package.test.mjs
const out = path.resolve('vendor/bl-ed/web/out'), imp = (n) => import(pathToFileURL(path.join(out, n + '.mjs')));
const { start } = await imp('repl'), repl = await start((f) => fs.readFileSync(path.join(out, 'src', f), 'utf8'));
Object.assign(globalThis.BL_HOST || (globalThis.BL_HOST = {}), { 'eval-ed': (src, api) => repl.evalWith(src, 'ed', api), 'eval-cells': (cells) => repl.evalCells(cells) });
const [M, R, G, F, P] = await Promise.all(['ed.main', 'rt', 'guidelines.pkg', 'ed.frame', 'ed.pkg'].map(imp));
const K = R.kw, get = (m, k) => m?.get(K(k)), ev = (...kv) => R.hashMap(...kv), key = (k) => ev(K('type'), K('key'), K('key'), k);
const source = fs.readFileSync('spikes/guidelines/guidelines.bl.org', 'utf8');
const use = (ed) => M.d_handle(ed, ev(K('type'), K('use'), K('package'), G.d_bl_package));
const st = (ed) => get(ed, 'pkg-state')?.get('guidelines');
const fxOf = (ed) => { const [, fx] = M.d_take_effects(ed).toArray(); return fx.toArray(); };
const intents = (ed) => fxOf(ed).filter((x) => get(x, 'kind') === K('intent')).map((x) => get(x, 'intent'));
const keys = (ed, s) => s.split(' ').reduce((e, k) => M.d_handle(e, key(k === 'space' ? ' ' : k)), ed);
const toBL = (x) => Array.isArray(x) ? R.vecFromArray(x.map(toBL)) : x && typeof x === 'object' ? Object.entries(x).reduce((m, [k, v]) => m.assoc(K(k), toBL(v)), R.EMPTY_MAP) : x;
const MODEL = { rev: 'r1', guidelines: [{ id: 'visual-not-verbal', name: "Show, don't label", 'on?': false }, { id: 'observed-vs-inferred', name: 'Observed vs inferred', 'on?': true }, { id: 'pure-packages', name: 'Packages are pure', 'on?': false }],
  inbox: [{ kind: 'ready', gid: 'visual-not-verbal', task: 't-1', subject: 'visual-not-verbal#use/1', line: '2026-10-10 x' }, { kind: 'misfire', gid: 'test-first', task: 't-2', subject: 'test-first#misfire' }] };
const answer = (ed, then, data, ok = true) => M.d_handle(ed, ev(K('type'), K('intent-result'), K('then'), K(then), K('ok?'), ok, K('data'), toBL(data), K('message'), ok ? null : 'boom'));
const opened = () => answer(use(M.d_boot(source, 'guidelines.bl.org')), 'guidelines/model', MODEL);
const cursorRow = (ed) => get(ed, 'sels').toArray()[0].get(K('head')).toArray()[0];

test('package is plain maps and fns with the contract keys', () => {
  const p = G.d_bl_package; assert.equal(get(p, 'name'), 'guidelines');
  for (const k of ['doc', 'commands', 'keys', 'intercept', 'on-event', 'adopt', 'owns', 'provides']) assert.ok(get(p, k) !== undefined, k);
  assert.ok(get(get(p, 'provides'), 'layouts').get('guidelines'));
  assert.ok(get(get(p, 'provides'), 'views').get(K('guidelines/explorer')));
});

test('only a guidelines file adopts the explorer layout, and it asks the world for the model', () => {
  const plain = use(M.d_boot('hello\n', 'notes.bl.org')); assert.equal(get(plain, 'frame/layout'), undefined);
  const ed = use(M.d_boot(source, 'guidelines.bl.org'));
  assert.equal(get(get(ed, 'frame/layout'), 'name'), 'guidelines');
  assert.deepEqual(intents(ed), ['guidelines/model']);
  const byTag = use(M.d_boot('#+GUIDELINES: mine\n* A\n', 'mine.bl.org')); assert.equal(get(get(byTag, 'frame/layout'), 'name'), 'guidelines');
});

test('the explorer follows the file cursor, and selecting moves the cursor to the heading', () => {
  let ed = opened();
  const row = source.split('\n').findIndex((l) => l.startsWith('* Packages are pure'));
  ed = M.d_handle(ed, ev(K('type'), K('click'), K('pos'), R.vec(row + 4, 0)));
  assert.equal(st(ed).get(K('selected')), 'pure-packages', 'cursor inside the section selects it');
  ed = M.d_handle(ed, ev(K('type'), K('guidelines/select'), K('id'), 'observed-vs-inferred'));
  assert.equal(source.split('\n')[cursorRow(ed)].startsWith('* Observed vs inferred'), true);
  ed = keys(ed, 'space g j'); assert.equal(st(ed).get(K('selected')), 'pure-packages', 'space g j = next in the model order');
  ed = keys(ed, 'space g k'); assert.equal(st(ed).get(K('selected')), 'observed-vs-inferred');
});

test('toggle needs a saved file and asks the world; the answer reloads the file in place', () => {
  let ed = opened();
  ed = M.d_handle(ed, ev(K('type'), K('guidelines/select'), K('id'), 'visual-not-verbal'));
  let e2 = keys(ed, 'space g t');
  const call = fxOf(e2).find((x) => get(x, 'intent') === 'guidelines/toggle'); assert.ok(call);
  assert.equal(get(get(call, 'args'), 'id'), 'visual-not-verbal');
  e2 = answer(e2, 'guidelines/changed', { message: "Show, don't label is ON" });
  const fx = fxOf(e2);
  assert.ok(fx.some((x) => get(x, 'kind') === K('visit') && get(x, 'path') === 'guidelines.bl.org'), 'reloads the file');
  assert.ok(fx.some((x) => get(x, 'intent') === 'guidelines/model'), 'and refreshes the model');
  const dirty = keys(M.d_handle(keys(ed, 'i'), ev(K('type'), K('text'), K('text'), 'x')), 'Escape');
  assert.equal(intents(keys(dirty, 'space g t')).includes('guidelines/toggle'), false, 'unsaved edits block the rewrite');
});

test('inbox: accept only a ready item, with the rev the explorer read', () => {
  let ed = keys(opened(), 'space g i'); assert.equal(st(ed).get(K('tab')), 'inbox');
  let e2 = keys(ed, 'space g a'); const call = fxOf(e2).find((x) => get(x, 'intent') === 'guidelines/promote');
  assert.ok(call); assert.equal(get(get(call, 'args'), 'base'), 'r1'); assert.equal(get(get(call, 'args'), 'subject'), 'visual-not-verbal#use/1');
  ed = keys(ed, 'space g j'); assert.equal(get(G.d_model(ed), 'inbox-sel'), 'test-first#misfire');
  e2 = keys(ed, 'space g a'); assert.equal(intents(e2).includes('guidelines/promote'), false, 'a misfire cannot be accepted');
  assert.match(get(e2, 'message'), /Only a ready example/);
  e2 = keys(ed, 'space g x'); assert.ok(intents(e2).includes('guidelines/reject'));
});

test('try: the line under the cursor goes to the world; results land in the model', () => {
  let ed = opened();
  const row = source.split('\n').findIndex((l) => l.includes('make the blocked row stand out'));
  ed = M.d_handle(ed, ev(K('type'), K('click'), K('pos'), R.vec(row, 0)));
  const e2 = keys(ed, 'space g .'); const call = fxOf(e2).find((x) => get(x, 'intent') === 'guidelines/try');
  assert.equal(get(get(call, 'args'), 'text'), '- make the blocked row stand out');
  const e3 = answer(e2, 'guidelines/tried', { text: 'x', rows: [{ id: 'visual-not-verbal', score: 0.99, 'picked?': true }] });
  const m = G.d_model(e3); assert.equal(get(m, 'tab'), 'try'); assert.equal(get(get(m, 'try'), 'rows').toArray().length, 1);
});

test('a failed world call is shown, not swallowed', () => {
  const ed = answer(use(M.d_boot(source, 'guidelines.bl.org')), 'guidelines/model', null, false);
  assert.equal(get(G.d_model(ed), 'error'), 'boom');
});

test('unuse leaves editor text, tables, history and layout exactly as before', () => {
  const base = M.d_boot(source, 'guidelines.bl.org'); let ed = answer(use(base), 'guidelines/model', MODEL);
  ed = keys(ed, 'space g i'); ed = keys(ed, 'space g ?');
  ed = P.d_unuse(ed, 'guidelines');
  for (const k of ['text', 'user-keys', 'user-commands', 'mode']) assert.equal(get(ed, k), get(base, k), k);
  assert.equal(get(ed, 'frame/layout'), undefined); assert.equal(get(ed, 'pkg-state')?.get('guidelines'), undefined);
});

test('real frame: two panes, then (ed/unuse "guidelines") returns to one editor', () => {
  let fr = F.d_handle(F.d_single(M.d_boot(source, 'guidelines.bl.org')), ev(K('type'), K('use'), K('package'), G.d_bl_package));
  assert.equal(get(get(fr, 'layout'), 'name'), 'guidelines');
  const r = F.d_render(fr); const panes = get(r, 'panes').toArray(); assert.equal(panes.length, 2);
  assert.equal(get(get(panes[1], 'view'), 'package'), 'guidelines', 'the explorer view carries :package for the host');
  fr = F.d_handle(fr, key(':')); for (const ch of '(ed/unuse "guidelines")') fr = F.d_handle(fr, ev(K('type'), K('text'), K('text'), ch)); fr = F.d_handle(fr, key('Enter'));
  assert.equal(get(get(fr, 'layout'), 'name'), 'single'); assert.equal(P.d_names(F.d_focused(fr)).toArray().includes('guidelines'), false);
});
