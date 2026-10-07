import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const out = path.resolve(process.env.BLED_OUT || 'vendor/bl-ed/web/out');
const load = n => import(pathToFileURL(path.join(out, n + '.mjs')));
globalThis.BL_HOST = globalThis.BL_HOST || {};
const { start } = await load('repl');
const repl = await start(f => fs.readFileSync(path.join(out, 'src', f), 'utf8'));
globalThis.BL_HOST['eval-ed'] = (s, api) => repl.evalWith(s, 'ed', api);
const R = await load('rt'), M = await load('ed.main'), F = await load('ed.frame');
const W = await load('ws.main'), D = await load('dwim.main'), P = await load('ed.pkg');
const K = R.kw, get = (m,k) => m?.get(K(k), null), ev = (...args) => R.hashMap(...args);
const key = k => ev(K('type'),K('key'),K('key'),k);
const text = s => ev(K('type'),K('text'),K('text'),s);
const use = p => ev(K('type'),K('use'),K('package'),p);
const source = '#+TITLE: Plan\n* TODO Work\n#+begin_task :id board :cwd @other\nUpdate the board.\n#+end_task\n#+RESULTS: board\n: #omega/task {:id "t-41"}\n';
function session(layout=W.d_workspace) {
  let fr = F.d_single(M.d_boot(source,'work:omega/plan.bl.org'));
  const fx = [];
  const send = e => {
    fr = F.d_handle(fr,e);
    const [next,effects] = F.d_take_effects(fr).toArray(); fr = next;
    fx.push(...effects.toArray()); return fr;
  };
  send(use(D.d_bl_package)); send(use(W.d_bl_package));
  fr = F.d_arrange(fr,layout);
  const [next,effects] = F.d_take_effects(fr).toArray(); fr = next; fx.push(...effects.toArray());
  send(ev(K('type'),K('resize'),K('height'),40));
  return {send, fx, get fr(){return fr;}, ed(id){return F.d_editor(fr,K(id));},
    focus(){return get(fr,'focus').name;}, command(s){send(key(':'));send(text(s));send(key('Enter'));}};
}

test('Alt+h/l moves spatially, clamps, and does not emit host IO', () => {
  const s=session(); s.fx.length=0;
  s.send(key('M-h')); assert.equal(s.focus(),'places');
  s.send(key('M-l')); assert.equal(s.focus(),'document');
  s.send(key('M-l')); assert.equal(s.focus(),'task');
  s.send(key('M-l')); assert.equal(s.focus(),'task');
  s.send(key('M-h')); assert.equal(s.focus(),'document');
  assert.deepEqual(s.fx,[]);
});

test('pane focus preserves a command draft and an insert draft', () => {
  const s=session(); s.send(key('M-l')); s.send(key(':')); s.send(text('unfinished expression'));
  const draft=get(s.ed('document'),'minibuf');
  s.send(key('M-h')); s.send(key('M-l'));
  assert.equal(get(s.ed('document'),'mode'),K('command'));
  assert.equal(R.printStr(get(s.ed('document'),'minibuf')),R.printStr(draft));
  s.send(key('Escape')); s.send(key('i')); s.send(text('draft '));
  const before=R.printStr(get(s.ed('document'),'text'));
  s.send(key('M-l')); s.send(key('M-h'));
  assert.equal(get(s.ed('document'),'mode'),K('insert'));
  assert.equal(R.printStr(get(s.ed('document'),'text')),before);
  assert.ok(!s.fx.some(e=>get(e,'kind')===K('save') || get(e,'kind')===K('intent')));
});

test('spatial focus skips passive view panes', () => {
  const panes=get(W.d_workspace,'panes').toArray();
  panes.splice(1,0,ev(K('id'),K('map'),K('view'),R.vec(K('outline'),K('places'))));
  const s=session(W.d_workspace.assoc(K('panes'),R.vecFromArray(panes)));
  s.send(key('M-l')); assert.equal(s.focus(),'document');
  s.send(key('M-h')); assert.equal(s.focus(),'places');
});

test('task references in writable source drive the linked task pane', () => {
  const s=session(); s.fx.length=0;
  s.send(ev(K('type'),K('click'),K('pane'),K('document'),K('pos'),R.vec(6,0)));
  const visits=s.fx.filter(e=>get(e,'kind')===K('visit'));
  assert.equal(visits.length,1); assert.equal(get(visits[0],'path'),'task:t-41');
  assert.equal(get(visits[0],'pane'),K('task'));
});

test('a task block sends cwd and stable home anchor through the existing intent', () => {
  let ed=M.d_boot(source.split('#+RESULTS:')[0],'work:omega/plan.bl.org');
  ed=M.d_handle(ed,ev(K('type'),K('click'),K('pos'),R.vec(2,0)));
  ed=M.d_handle(ed,key('C-Enter'));
  const effects=M.d_take_effects(ed).toArray()[1].toArray();
  const open=effects.find(e=>get(e,'intent')==='task/open');
  assert.ok(open); const args=get(open,'args');
  assert.equal(get(args,'cwd'),'@other'); assert.equal(get(args,'block'),'board');
  assert.equal(get(args,'path'),'work:omega/plan.bl.org');
});

test('g H returns to a task home by current source anchor', () => {
  let ed=P.d_use(M.d_boot('task','task:t-41'),W.d_bl_package);
  ed=ed.assoc(K('obj-index'),R.hashMap(0,ev(K('type'),'omega/task',K('key'),'t-41',K('home'),ev(K('path'),'work:omega/plan.bl.org',K('block'),'board'))));
  for (const k of ['g','H']) ed=M.d_handle(ed,key(k));
  const effect=M.d_take_effects(ed).toArray()[1].toArray().find(e=>get(e,'kind')===K('visit'));
  assert.equal(get(effect,'path'),'work:omega/plan.bl.org');
  assert.equal(get(get(effect,'goto'),'block'),'board');
});

test('home arrival matches the complete block ID after surrounding source moves', () => {
  let ed=P.d_use(M.d_boot('task','task:t-41'),W.d_bl_package);
  const content='notes\n#+begin_task :id board-extra\nwrong\n#+end_task\nmore notes\n#+begin_task :id board\nright\n#+end_task\n';
  ed=M.d_handle(ed,ev(K('type'),K('doc'),K('path'),'work:omega/plan.bl.org',K('text'),content,
                      K('visit?'),true,K('goto'),ev(K('block'),'board')));
  assert.equal(get(get(ed,'sels').toArray()[0],'head').toArray()[0],5);
});

test('workspace unload removes its layout, commands and keys in every pane', () => {
  const s=session(); s.send(key('M-l')); s.command('(ed/unuse "workspace")');
  assert.equal(get(get(s.fr,'layout'),'name'),'single');
  assert.equal(get(s.ed('document'),'path'),'work:omega/plan.bl.org');
  assert.ok(!P.d_names(s.ed('document')).toArray().includes('workspace'));
  const ed=s.ed('document');
  const roundtrip=P.d_unuse(P.d_use(ed,W.d_bl_package),'workspace');
  assert.equal(R.printStr(roundtrip),R.printStr(ed));
});
