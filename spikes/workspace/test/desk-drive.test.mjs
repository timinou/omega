import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
globalThis.BL_HOST=globalThis.BL_HOST||{};
const out=path.resolve(process.env.BLED_OUT||'vendor/bl-ed/web/out');
const load=n=>import(pathToFileURL(path.join(out,n+'.mjs')));
const R=await load('rt'),M=await load('ed.main'),P=await load('ed.pkg'),W=await load('ws.desk'),F=await load('ed.frame'),D=await load('dwim.main');
const K=R.kw,g=(m,k)=>m?.get(K(k),null),ev=(...a)=>R.hashMap(...a);
const key=k=>ev(K('type'),K('key'),K('key'),k);
const raw='#+TITLE: Work\nTasks\n\n* Places\nAll places\nOmega\n* NEEDS YOU (1)\nt-1 task\n';
function boot(){let ed=P.d_use(P.d_use(M.d_boot(raw,'workspace:all'),D.d_bl_package),W.d_bl_package);
 return ed.assoc(K('doc'),ev(K('read-only?'),true,K('data'),ev(K('desk'),'rail',K('scope'),'all')))
 .assoc(K('obj-index'),R.hashMap(4,ev(K('type'),'desk/scope',K('key'),'workspace:all',K('title'),'All places'),5,ev(K('type'),'desk/scope',K('key'),'workspace:omega',K('title'),'Omega',K('place'),'omega'),7,ev(K('type'),'omega/task',K('key'),'t-1',K('title'),'A clear human title',K('place'),'omega',K('ask'),'Approve the board?',K('summary'),'Approve the board?')));}
test('rail presents provider objects as cards rather than raw task rows',()=>{
 const v=M.d_render(boot());assert.equal(g(v,'presentation'),'work-rail');
 const printed=R.printStr(v);assert.match(printed,/A clear human title/);assert.match(printed,/NEEDS YOU/);assert.match(printed,/Approve the board/);
 assert.ok(g(v,'frames').toArray().length>0);
});
test('DWIM movement visits the next visible object, skipping header source rows',()=>{
 let ed=boot();ed=M.d_handle(ed,key('j'));assert.equal(g(g(ed,'sels').nth(0),'head').nth(0),4);
 ed=M.d_handle(ed,key('j'));assert.equal(g(g(ed,'sels').nth(0),'head').nth(0),5);
});
test('Enter scopes a place and typing a goal creates a task without schema syntax',()=>{
 let ed=boot().assoc(K('sels'),R.vec(ev(K('anchor'),R.vec(5,0),K('head'),R.vec(5,0))));
 ed=M.d_handle(ed,key('Enter'));assert.equal(g(M.d_take_effects(ed).toArray()[1].toArray().at(-1),'path'),'workspace:omega');
 ed=W.d_new_task(ed);ed=M.d_handle(ed,ev(K('type'),K('text'),K('text'),'Review the release'));
 ed=M.d_handle(ed,key('Enter'));const fx=M.d_take_effects(ed).toArray()[1].toArray().find(e=>g(e,'intent')==='task/open');
 assert.equal(g(g(fx,'args'),'goal'),'Review the release');assert.equal(g(g(fx,'args'),'path'),'place:omega');
});
test('presentation is a removable layer and source inspection preserves text',()=>{
 const ed=boot(),text=R.printStr(g(ed,'text'));let next=M.d_handle(M.d_handle(ed,key('g')),key('v'));
 assert.equal(W.d_active_presentation(next),null);assert.equal(R.printStr(g(next,'text')),text);
 const base=P.d_unuse(ed,'workbench');assert.equal(R.printStr(P.d_unuse(P.d_use(base,W.d_bl_package),'workbench')),R.printStr(base));
});
test('desk has two populated panes, selection previews without stealing rail focus',()=>{
 assert.equal(g(W.d_desk,'panes').toArray().length,2);
 const fr=F.d_arrange(F.d_single(boot()),W.d_desk);assert.equal(g(fr,'focus'),K('rail'));
 const fx=F.d_take_effects(fr).toArray()[1].toArray();assert.ok(fx.some(e=>g(e,'path')==='desk:welcome'));
});
test('new-task result targets main without replacing the scoped rail',()=>{
 let fr=F.d_arrange(F.d_single(boot()),W.d_desk);fr=F.d_take_effects(fr).toArray()[0];
 fr=F.d_handle(fr,ev(K('type'),K('intent-result'),K('ok?'),true,K('then'),K('desk-created'),K('data'),ev(K('path'),'task:t-new')));
 assert.equal(g(F.d_editor(fr,K('rail')),'path'),'workspace:all');assert.equal(g(fr,'focus'),K('main'));
 const fx=F.d_take_effects(fr).toArray()[1].toArray().find(e=>g(e,'path')==='task:t-new');assert.equal(g(fx,'pane'),K('main'));
});
