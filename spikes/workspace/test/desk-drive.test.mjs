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
test('a checklist is presented but toggles its actual editable source',()=>{
 let ed=P.d_use(M.d_boot('#+TITLE: Checklist\n\n* TODO Ship the board\nKeep this note.\n','work:omega/board.bl.org'),W.d_bl_package);
 ed=ed.assoc(K('sels'),R.vec(ev(K('anchor'),R.vec(2,0),K('head'),R.vec(2,0))));
 assert.equal(g(M.d_render(ed),'presentation'),'work-artifact');
 ed=M.d_handle(ed,key('Enter'));assert.match(R.printStr(g(ed,'text')),/DONE Ship the board/);assert.match(R.printStr(g(ed,'text')),/Keep this note/);
});
test('artifact expansion retains the rail and task; closing refuses a local draft',()=>{
 let fr=F.d_arrange(F.d_single(boot()),W.d_desk);fr=F.d_take_effects(fr).toArray()[0];
 fr=F.d_handle(fr,ev(K('type'),K('doc'),K('pane'),K('main'),K('path'),'task:t-1',K('text'),'#+TITLE: Task\n\n\n\n* you · 1\nWork\n',K('rev'),'1',K('read-only?'),true,K('data'),ev(K('desk'),'task',K('home'),ev(K('path'),'work:omega/plan.bl.org',K('block'),'anchor'),K('artifacts'),R.vec(ev(K('path'),'work:omega/board.bl.org'))),K('visit?'),true));
 fr=fr.assoc(K('focus'),K('main'));const rail=F.d_editor(fr,K('rail'));
 fr=F.d_handle(F.d_handle(fr,key('g')),key('b'));assert.equal(g(g(fr,'layout'),'name'),'desk-artifact');
 assert.strictEqual(F.d_editor(fr,K('rail')),rail);assert.equal(g(F.d_editor(fr,K('aside')),'path'),'task:t-1');
 fr=F.d_handle(fr,ev(K('type'),K('doc'),K('pane'),K('main'),K('path'),'work:omega/board.bl.org',K('text'),'#+TITLE: Board\n\n* TODO Ship\n',K('rev'),'1',K('read-only?'),false,K('visit?'),true));
 fr=F.d_handle(F.d_handle(fr,key('i')),ev(K('type'),K('text'),K('text'),'draft'));
 fr=F.d_handle(fr,key('Escape'));fr=F.d_handle(F.d_handle(fr,key('g')),key('t'));
 assert.equal(g(g(fr,'layout'),'name'),'desk-artifact');assert.match(g(F.d_focused(fr),'message'),/discard a draft/);
});

test('context actions are package contributions; a later definition overrides and unload is exact',async()=>{
 const A=await load('ws.actions');const ed=boot().assoc(K('sels'),R.vec(ev(K('anchor'),R.vec(7,0),K('head'),R.vec(7,0))));
 assert.ok(A.d_available(ed).toArray().some(a=>g(a,'command')===K('desk/link')));
 const extra=ev(K('name'),'my-actions',K('provides'),ev(K('actions'),()=>R.vec(ev(K('name'),'My references',K('key'),'r',K('command'),K('desk/references')))));
 const next=P.d_use(ed,extra);assert.equal(A.d_available(next).toArray().filter(a=>g(a,'command')===K('desk/references')).length,1);
 assert.equal(g(A.d_available(next).toArray().find(a=>g(a,'command')===K('desk/references')),'name'),'My references');
 assert.equal(R.printStr(A.d_available(P.d_unuse(next,'my-actions'))),R.printStr(A.d_available(ed)));
});
test('menu dispatches named commands and reference prompts produce data without replacing a draft',async()=>{
 const A=await load('ws.actions');let ed=boot().assoc(K('sels'),R.vec(ev(K('anchor'),R.vec(7,0),K('head'),R.vec(7,0))));
 ed=M.d_handle(ed,ev(K('type'),K('command'),K('command'),K('desk/actions')));assert.equal(g(g(M.d_render(ed),'overlay'),'kind'),K('actions'));
 ed=M.d_handle(ed,key('a'));assert.match(g(g(ed,'minibuf'),'prompt'),/input/);
 ed=M.d_handle(ed,ev(K('type'),K('text'),K('text'),'c'));ed=M.d_handle(ed,key('Enter'));
 assert.match(g(g(ed,'minibuf'),'prompt'),/File or document/);
 ed=M.d_handle(ed,ev(K('type'),K('text'),K('text'),'board.bl.org'));ed=M.d_handle(ed,key('Enter'));
 const fx=M.d_take_effects(ed).toArray()[1].toArray().find(e=>g(e,'intent')==='links/put');
 assert.match(g(g(fx,'args'),'text'),/:task "t-1"/);assert.match(g(g(fx,'args'),'text'),/:kind :context/);assert.match(g(g(fx,'args'),'text'),/:place "omega"/);
 const pending=W.d_new_task(boot());const retained=A.d_attach_reference(pending);assert.strictEqual(g(retained,'minibuf'),g(pending,'minibuf'));assert.match(g(retained,'message'),/current prompt/);
});
test('guided subplace creation inherits its parent and removal cancels an owned prompt',async()=>{
 let ed=boot().assoc(K('sels'),R.vec(ev(K('anchor'),R.vec(5,0),K('head'),R.vec(5,0))));
 ed=M.d_handle(M.d_handle(ed,key('?')),key('f'));
 ed=M.d_handle(ed,ev(K('type'),K('text'),K('text'),'Release notes'));ed=M.d_handle(ed,key('Enter'));
 assert.match(g(g(ed,'minibuf'),'prompt'),/blank inherits/);ed=M.d_handle(ed,key('Enter'));
 const fx=M.d_take_effects(ed).toArray()[1].toArray().find(e=>g(e,'intent')==='place/put');
 assert.match(g(g(fx,'args'),'text'),/:parent "omega"/);assert.doesNotMatch(g(g(fx,'args'),'text'),/:root/);
 ed=M.d_handle(M.d_handle(boot().assoc(K('sels'),R.vec(ev(K('anchor'),R.vec(5,0),K('head'),R.vec(5,0)))),key('?')),key('n'));assert.equal(g(g(ed,'minibuf'),'package'),'workbench');
 const removed=P.d_unuse(ed,'workbench');assert.equal(g(removed,'minibuf'),null);assert.equal(g(removed,'mode'),K('normal'));
});
test('folder task creation carries the actual directory and headings wrap without modifying source',async()=>{
 let ed=P.d_use(M.d_boot('#+TITLE: Directory\ncwd: /tmp/beam/sub\n\n* Files\nboard.bl.org\n','folder:beam/sub'),W.d_bl_package)
 .assoc(K('doc'),ev(K('read-only?'),true,K('data'),ev(K('place'),'beam',K('root'),'/tmp/beam/sub')))
 .assoc(K('obj-index'),R.hashMap(4,ev(K('type'),'workspace/file',K('key'),'work:beam/sub/board.bl.org')));
 assert.match(R.printStr(M.d_render(ed)),/board.bl.org/);
 ed=W.d_new_task(ed);ed=M.d_handle(ed,ev(K('type'),K('text'),K('text'),'Work here'));ed=M.d_handle(ed,key('Enter'));
 const fx=M.d_take_effects(ed).toArray()[1].toArray().find(e=>g(e,'intent')==='task/open');assert.equal(g(g(fx,'args'),'cwd'),'/tmp/beam/sub');
 const V=await load('ws.views');const original=P.d_use(M.d_boot('#+TITLE: This is a long title for an editable board\n\n* TODO Ship\n','work:omega/board.bl.org'),W.d_bl_package);
 const wide=original.assoc(K('view'),g(original,'view').assoc(K('cols'),100));const narrow=original.assoc(K('view'),g(original,'view').assoc(K('cols'),35));
 const ws=g(V.d_artifact,'focus-of')(wide,null),ns=g(V.d_artifact,'focus-of')(narrow,null);assert.notEqual(R.printStr(ws),R.printStr(ns));
 assert.ok(g((await load('pp.present')).d_screen_of(V.d_artifact,narrow),'slots').toArray().length>g((await load('pp.present')).d_screen_of(V.d_artifact,wide),'slots').toArray().length);
 assert.equal(R.printStr(g(narrow,'text')),R.printStr(g(wide,'text')));
});

test('a keyboard checklist toggle participates in the shared-buffer draft protocol',async()=>{
 const B=await load('buffer.main');let ed=P.d_use(P.d_use(M.d_boot('#+TITLE: Board\n\n** TODO Nested item\n','work:omega/board.bl.org'),B.d_bl_package),W.d_bl_package);
 ed=ed.assoc(K('doc'),ev(K('rev'),'0',K('read-only?'),false,K('data'),ev(K('buffer'),true)))
 .assoc(K('sels'),R.vec(ev(K('anchor'),R.vec(2,0),K('head'),R.vec(2,0))));
 ed=M.d_handle(ed,key('Enter'));assert.match(R.printStr(g(ed,'text')),/DONE Nested item/);
 const fx=M.d_take_effects(ed).toArray()[1].toArray().find(e=>g(e,'intent')==='buffer/draft');assert.ok(fx);assert.match(g(g(fx,'args'),'text'),/DONE Nested item/);
});

test('starting without a place asks for a valid place before the goal, with no hard-coded default',()=>{
 let ed=W.d_new_task(boot());assert.match(g(g(ed,'minibuf'),'prompt'),/Place/);
 ed=M.d_handle(ed,ev(K('type'),K('text'),K('text'),'unknown'));ed=M.d_handle(ed,key('Enter'));assert.match(g(g(ed,'minibuf'),'prompt'),/Place/);
 assert.ok(!M.d_take_effects(ed).toArray()[1].toArray().some(f=>g(f,'intent')==='task/open'));
 ed=M.d_handle(ed,ev(K('type'),K('text'),K('text'),'omega'));ed=M.d_handle(ed,key('Enter'));assert.match(g(g(ed,'minibuf'),'prompt'),/New task in omega/);
 ed=M.d_handle(ed,ev(K('type'),K('text'),K('text'),'Chosen place'));ed=M.d_handle(ed,key('Enter'));
 const fx=M.d_take_effects(ed).toArray()[1].toArray().find(f=>g(f,'intent')==='task/open');assert.equal(g(g(fx,'args'),'path'),'place:omega');
});
test('checkbox edits only the heading state and leaves TODO words in its title and prose intact',()=>{
 let ed=P.d_use(M.d_boot('#+TITLE: Board\n\n** TODO Write a TODO parser\nTODO stays in prose.\n','work:omega/board.bl.org'),W.d_bl_package)
 .assoc(K('sels'),R.vec(ev(K('anchor'),R.vec(2,0),K('head'),R.vec(2,0))));
 ed=M.d_handle(ed,ev(K('type'),K('command'),K('command'),K('desk/toggle')));
 assert.match(R.printStr(g(ed,'text')),/DONE Write a TODO parser/);assert.match(R.printStr(g(ed,'text')),/TODO stays in prose/);
});

test('a reply draft becomes a scoped follow-up when its task finishes',()=>{
 let ed=P.d_use(M.d_boot('#+TITLE: t-5 task\n\n\n\n* you · 1\nA goal\n','task:t-5'),W.d_bl_package)
 .assoc(K('doc'),ev(K('rev'),'1',K('read-only?'),true,K('data'),ev(K('desk'),'task',K('task-id'),'t-5',K('task-status'),'idle',K('place'),'beam',K('cwd'),'/tmp/beam')))
 .assoc(K('mode'),K('command')).assoc(K('minibuf'),ev(K('kind'),K('prompt'),K('text'),'Keep this follow-up',K('submit'),e=>e));
 ed=M.d_handle(ed,ev(K('type'),K('doc'),K('path'),'task:t-5',K('text'),'#+TITLE: t-5 ✓ done\n\n\n\n* you · 1\nA goal\n',K('rev'),'2',K('read-only?'),true,K('data'),ev(K('desk'),'task',K('task-id'),'t-5',K('task-status'),'done',K('place'),'beam',K('cwd'),'/tmp/beam')));
 assert.equal(g(g(ed,'minibuf'),'text'),'Keep this follow-up');assert.equal(g(g(ed,'minibuf'),'package'),'workbench');assert.equal(g(g(M.d_render(ed),'minibuf'),'inline?'),true);
 ed=M.d_handle(ed,key('Enter'));const fx=M.d_take_effects(ed).toArray()[1].toArray().find(f=>g(f,'intent')==='task/open');
 assert.equal(g(g(fx,'args'),'cwd'),'/tmp/beam');assert.equal(g(g(fx,'args'),'path'),'place:beam');assert.equal(g(g(fx,'args'),'goal'),'Keep this follow-up');
});
test('source inspection renders the task org text and a busy command prompt blocks pointer edits',()=>{
 let ed=P.d_use(M.d_boot('#+TITLE: Task\n#+begin_task :cwd @beam\nA goal\n#+end_task\n','task:t-5'),W.d_bl_package)
 .assoc(K('doc'),ev(K('read-only?'),true,K('data'),ev(K('desk'),'task',K('task-title'),'Readable task')));
 assert.equal(g(M.d_render(ed),'presentation'),'conversation');
 ed=M.d_handle(M.d_handle(ed,key('g')),key('v'));assert.equal(g(M.d_render(ed),'presentation'),'source');assert.match(R.printStr(M.d_render(ed)),/begin_task/);
 let file=P.d_use(M.d_boot('#+TITLE: Board\n\n* TODO Item\n','work:omega/board.bl.org'),W.d_bl_package)
 .assoc(K('mode'),K('command')).assoc(K('minibuf'),ev(K('kind'),K('eval'),K('text'),'(unfinished'));
 const original=g(file,'text');file=M.d_handle(file,ev(K('type'),K('command'),K('command'),K('insert')));
 assert.equal(g(file,'mode'),K('command'));assert.strictEqual(g(file,'text'),original);assert.equal(g(g(file,'minibuf'),'text'),'(unfinished');
 file=file.assoc(K('obj-index'),R.hashMap(2,ev(K('type'),'omega/msg',K('key'),'m-1',K('task'),'t-1')));
 file=M.d_handle(file,ev(K('type'),K('command'),K('command'),K('omega/answer')));assert.equal(g(g(file,'minibuf'),'text'),'(unfinished');
});

test('relative task references resolve in the actual nested working folder',async()=>{
 const A=await load('ws.actions');
 let ed=boot().assoc(K('path'),'task:t-9').assoc(K('doc'),ev(K('data'),ev(K('task-id'),'t-9',K('place'),'beam',K('folder'),'folder:beam/sub')));
 ed=A.d_attach_reference(ed);
 for(const value of ['o','board.bl.org']){ed=M.d_handle(ed,ev(K('type'),K('text'),K('text'),value));ed=M.d_handle(ed,key('Enter'));}
 const fx=M.d_take_effects(ed).toArray()[1].toArray().find(e=>g(e,'intent')==='links/put');
 assert.match(g(g(fx,'args'),'text'),/:path "work:beam\/sub\/board.bl.org"/);
});

test('long artifact prose wraps by pane width and remains raw while editing',async()=>{
 const V=await load('ws.views'),PP=await load('pp.present');
 const original=P.d_use(M.d_boot('#+TITLE: Plan\n\n* Notes\nThis editable plan has enough words to require several wrapped lines in a narrow pane.\n','work:omega/plan.bl.org'),W.d_bl_package);
 const narrow=original.assoc(K('view'),g(original,'view').assoc(K('cols'),32));
 const rows=ed=>g(PP.d_screen_of(V.d_artifact,ed),'slots').toArray().filter(s=>PP.d_slot_row(s)===3);
 assert.ok(rows(narrow).length>rows(original).length);
 const editing=narrow.assoc(K('mode'),K('insert')).assoc(K('sels'),R.vec(ev(K('anchor'),R.vec(3,0),K('head'),R.vec(3,0))));
 assert.equal(rows(editing).length,1);assert.equal(R.printStr(g(narrow,'text')),R.printStr(g(original,'text')));
});

test('rail opening and task creation target the retained conversation beside a file',()=>{
 let rail=boot().assoc(K('sels'),R.vec(ev(K('anchor'),R.vec(7,0),K('head'),R.vec(7,0))));
 let fr=F.d_arrange(F.d_single(rail),W.d_artifact_layout);fr=F.d_take_effects(fr).toArray()[0];fr=fr.assoc(K('focus'),K('rail'));
 const file=M.d_boot('a working file','work:omega/plan.bl.org');fr=fr.assoc(K('editors'),g(fr,'editors').assoc(K('main'),file));
 let next=F.d_handle(fr,ev(K('type'),K('command'),K('command'),K('desk/open')));
 assert.equal(g(next,'focus'),K('aside'));assert.strictEqual(F.d_editor(next,K('main')),file);
 assert.equal(g(F.d_take_effects(next).toArray()[1].toArray().find(e=>g(e,'path')==='task:t-1'),'pane'),K('aside'));
 next=F.d_handle(fr,ev(K('type'),K('intent-result'),K('ok?'),true,K('then'),K('desk-created'),K('data'),ev(K('path'),'task:t-new')));
 assert.equal(g(next,'focus'),K('aside'));assert.strictEqual(F.d_editor(next,K('main')),file);
 assert.equal(g(F.d_take_effects(next).toArray()[1].toArray().find(e=>g(e,'path')==='task:t-new'),'pane'),K('aside'));
});
