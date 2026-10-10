import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
globalThis.BL_HOST=globalThis.BL_HOST||{};
const load=n=>import(pathToFileURL(path.resolve(process.env.BLED_OUT||'vendor/bl-ed/web/out',n+'.mjs')));
const R=await load('rt'),M=await load('ed.main'),P=await load('ed.pkg'),F=await load('ed.frame'),U=await load('mob.main'),B=await load('buffer.main');
const K=R.kw,g=(m,k)=>m?.get(K(k),null),map=o=>R.hashMap(...Object.entries(o).flatMap(([k,v])=>[K(k),v])),e=(type,o={})=>map({type:K(type),...o});
const event=(ed,type,o)=>M.d_handle(ed,e(type,o));
const boot=()=>P.d_use(M.d_boot('#+TITLE: Work\n','workspace:all'),U.d_bl_package);
const task=(id='t-1')=>boot().assoc(K('path'),'task:'+id).assoc(K('doc'),map({'read-only?':true,data:map({desk:'task','task-id':id,'task-status':'idle',place:'omega',cwd:'/tmp/mobile/omega'})}));
const effects=ed=>M.d_take_effects(ed).toArray()[1].toArray();
test('mobile is a removable layer and a real frame layout, with no user table mutation',()=>{
 const before=M.d_boot('ordinary text','welcome.bl.org').assoc(K('packages'),R.vec()),used=P.d_use(before,U.d_bl_package);
 assert.equal(R.printStr(P.d_unuse(used,'mobile')),R.printStr(before));
 assert.strictEqual(g(used,'user-commands'),g(before,'user-commands'));
 let fr=F.d_arrange(F.d_single(used),U.d_phone);assert.equal(F.d_editor_ids(fr).cnt,3);
 const models=g(F.d_render(fr),'panes').toArray().filter(p=>g(p,'kind')===K('view'));
 assert.equal(models.length,3);assert.ok(models.every(p=>g(g(p,'view'),'package')==='mobile'));
 fr=F.d_handle(fr,e('command',{command:K('mobile/unload')}));assert.equal(F.d_editor_ids(fr).cnt,1);
 assert.ok(!P.d_names(F.d_focused(fr)).toArray().includes('mobile'));
});
test('drafts stay keyed to tasks and navigation leaves the conversation editor untouched',()=>{
 let ed=event(task(),'mobile/draft',{text:'Keep my direction'});
 const next=event(ed.assoc(K('path'),'task:t-2'),'mobile/draft',{text:'Other task'});
 assert.equal(U.d_draft(next),'Other task');assert.equal(U.d_draft(next.assoc(K('path'),'task:t-1')),'Keep my direction');
 let rail=event(boot(),'mobile/nav',{screen:'task',path:'task:t-1'});
 assert.equal(g(effects(rail).find(x=>g(x,'kind')===K('visit')),'pane'),K('task'));
 rail=event(rail,'mobile/tab',{tab:'plan',path:'work:omega/plan.bl.org',block:'plan'});
 assert.equal(g(effects(rail).at(-1),'pane'),K('file'));
});
test('send uses the existing task intent, blocks duplicates and preserves drafts on failure',()=>{
 let ed=event(task(),'mobile/draft',{text:'Please check this'});ed=event(ed,'mobile/send',{});
 assert.equal(g(effects(ed).at(-1),'intent'),'task/say');assert.equal(g(g(effects(ed).at(-1),'args'),'id'),'t-1');
 const count=effects(ed).length;ed=event(ed,'mobile/send',{});assert.equal(effects(ed).length,count);
 ed=event(ed,'intent-result',{'ok?':false,then:K('mobile-sent'),message:'Disconnected'});
 assert.equal(U.d_draft(ed),'Please check this');assert.match(g(ed,'message'),/retained/);
});
test('quick answers keep a composed reply; successful text sends clear only the submitted draft',()=>{
 let ed=event(task(),'mobile/draft',{text:'A separate thought'}).assoc(K('obj-index'),R.hashMap(4,map({type:'omega/msg',key:'m-1',task:'t-1'})));
 ed=event(ed,'mobile/send',{answer:'yes'});const fx=effects(ed).at(-1);assert.equal(g(fx,'intent'),'msg/answer');assert.equal(g(g(fx,'args'),'msg'),'m-1');
 ed=event(ed,'intent-result',{'ok?':true,then:K('mobile-sent')});assert.equal(U.d_draft(ed),'A separate thought');
 ed=event(ed,'mobile/send',{});ed=event(ed,'intent-result',{'ok?':true,then:K('mobile-sent')});assert.equal(U.d_draft(ed),'');
});
test('completed task follow-up carries its actual place and frozen directory',()=>{
 let ed=task();ed=ed.assoc(K('doc'),g(ed,'doc').assoc(K('data'),g(g(ed,'doc'),'data').assoc(K('task-status'),'done')));
 ed=event(event(ed,'mobile/draft',{text:'One more thing'}),'mobile/send',{});
 const fx=effects(ed).at(-1);assert.equal(g(fx,'intent'),'task/open');assert.equal(g(g(fx,'args'),'path'),'place:omega');assert.equal(g(g(fx,'args'),'cwd'),'/tmp/mobile/omega');
});
test('mobile file input participates in the shared-buffer draft protocol and read-only guards',()=>{
 let ed=P.d_use(P.d_use(M.d_boot('saved','work:omega/plan.bl.org'),B.d_bl_package),U.d_bl_package).assoc(K('doc'),map({'read-only?':false,rev:'0',data:map({buffer:true})}));
 ed=event(ed,'mobile/edit',{text:'edited'});assert.equal(g(effects(ed).at(-1),'intent'),'buffer/draft');
 assert.equal(g(g(effects(ed).at(-1),'args'),'text'),'edited');
 const readonly=event(task(),'mobile/edit',{text:'bad'});assert.notEqual(g(U.d_model(readonly,'task'),'text'),'bad');
});

test('dirty file navigation keeps its current tab and exposes a publication message',()=>{
 let ed=event(boot(),'mobile/tab',{tab:'plan',path:'work:omega/board.bl.org'});
 const before=g(U.d_state(ed),'tab');
 ed=event(ed,'mobile/tab',{tab:'changes',path:'changes:work:omega/board.bl.org',dirty:true,'current-file':'work:omega/board.bl.org'});
 assert.equal(g(U.d_state(ed),'tab'),before);assert.match(g(ed,'message'),/Publish the file/);
 assert.equal(g(effects(ed).at(-1),'path'),'work:omega/board.bl.org');
});

test('task creation from a place document validates against the retained place choices',()=>{
 let ed=boot().assoc(K('path'),'place:omega').assoc(K('doc'),map({data:map({place:'omega'})}));
 ed=event(ed,'mobile/create',{place:'omega',goal:'A goal from place details'});
 const fx=effects(ed).at(-1);assert.equal(g(fx,'intent'),'task/open');assert.equal(g(g(fx,'args'),'path'),'place:omega');
});
