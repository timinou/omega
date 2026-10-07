import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
globalThis.BL_HOST = globalThis.BL_HOST || {};
const out=path.resolve(process.env.BLED_OUT||'vendor/bl-ed/web/out');
const load=n=>import(pathToFileURL(path.join(out,n+'.mjs')));
const R=await load('rt'),M=await load('ed.main'),P=await load('ed.pkg'),B=await load('buffer.main'),G=await load('buffer.merge'),T=await load('ed.text');
const K=R.kw,g=(m,k)=>m?.get(K(k),null),ev=(...a)=>R.hashMap(...a);
const key=k=>ev(K('type'),K('key'),K('key'),k);
const text=s=>ev(K('type'),K('text'),K('text'),s);
const source='TODO first\nsecond line\nthird line\n';
function boot(){let ed=M.d_boot(source,'work:omega/board.bl.org').assoc(K('doc'),ev(K('rev'),'base',K('data'),ev(K('buffer'),true)));return P.d_use(ed,B.d_bl_package);}
const content=ed=>T.d_to_string(g(ed,'text'));
const effects=ed=>M.d_take_effects(ed).toArray()[1].toArray();
test('typing in a shared file sends an unpublished draft through an intent',()=>{
 let ed=M.d_handle(M.d_handle(boot(),key('i')),text('draft '));
 const fx=effects(ed).find(e=>g(e,'intent')==='buffer/draft');
 assert.equal(g(g(fx,'args'),'base'),'base');assert.equal(g(g(fx,'args'),'text'),content(ed));
 assert.ok(!effects(ed).some(e=>g(e,'kind')===K('save')));
});
test('remote disjoint text preserves local draft, mode and command draft',()=>{
 let ed=M.d_handle(M.d_handle(boot(),key('i')),text('HUMAN '));
 ed=M.d_handle(ed,key('Escape'));ed=M.d_handle(ed,key(':'));ed=M.d_handle(ed,text('unfinished'));
 const mb=g(ed,'minibuf');
 ed=M.d_handle(ed,ev(K('type'),K('doc'),K('path'),'work:omega/board.bl.org',K('text'),source.replace('third','THIRD'),K('rev'),'remote',K('data'),ev(K('buffer'),true),K('visit?'),false));
 assert.equal(content(ed),'HUMAN '+source.replace('third','THIRD'));
 assert.equal(g(ed,'mode'),K('command'));assert.equal(R.printStr(g(ed,'minibuf')),R.printStr(mb));
 assert.equal(g(g(ed,'doc'),'rev'),'remote');assert.ok(g(ed,'saved-text')!==g(ed,'text'));
});
test('overlapping refresh retains local text and does not repeatedly emit invalid drafts',()=>{
 let ed=M.d_handle(M.d_handle(boot(),key('i')),text('HUMAN '));
 const event=ev(K('type'),K('doc'),K('path'),'work:omega/board.bl.org',K('text'),'REMOTE '+source,K('rev'),'remote',K('data'),ev(K('buffer'),true),K('visit?'),false);
 ed=M.d_take_effects(ed).toArray()[0];ed=M.d_handle(ed,event);
 assert.equal(content(ed),'HUMAN '+source);assert.equal(g(g(ed,'doc'),'rev'),'base');
 assert.equal(effects(ed).filter(e=>g(e,'intent')==='buffer/draft').length,0);
 ed=M.d_handle(ed,event);assert.equal(content(ed),'HUMAN '+source);
});
test('publish never substitutes a stale remote revision to force overwrite',()=>{
 let ed=boot().assoc(K('doc'),g(boot(),'doc').assoc(K('stale'),'newer'));
 ed=M.d_handle(ed,key('C-s'));const fx=effects(ed).find(e=>g(e,'kind')===K('save'));
 assert.equal(g(fx,'base'),'base');
});
test('merged save acknowledgement installs returned text while preserving in-flight typing',()=>{
 let ed=M.d_handle(M.d_handle(boot(),key('i')),text('HUMAN '));
 const submitted=content(ed);ed=M.d_handle(ed,text('MORE '));
 const remote=submitted.replace('third','THIRD');
 ed=M.d_handle(ed,ev(K('type'),K('saved'),K('ok?'),true,K('text'),remote,K('submitted-text'),submitted,K('doc-rev'),'published'));
 assert.equal(content(ed),'HUMAN MORE '+source.replace('third','THIRD'));
 assert.equal(T.d_to_string(g(ed,'saved-text')),remote);assert.equal(g(g(ed,'doc'),'rev'),'published');
});
test('change inspection and operation undo use ordinary visits and intents',()=>{
 let ed=B.d_changes(boot());assert.equal(g(effects(ed).at(-1),'path'),'changes:work:omega/board.bl.org');
 ed=boot().assoc(K('obj-index'),R.hashMap(0,ev(K('type'),'buffer/op',K('key'),'op-1',K('path'),'work:omega/board.bl.org')));
 ed=B.d_undo_operation(ed);const fx=effects(ed).find(e=>g(e,'intent')==='buffer/undo');assert.equal(g(g(fx,'args'),'id'),'op-1');
});
test('accepted disjoint merges commute; same-point insertions refuse',()=>{
 const base='alpha beta gamma',a='ALPHA beta gamma',b='alpha beta GAMMA';
 assert.equal(g(G.d_merge_text(base,a,b),'ok'),g(G.d_merge_text(base,b,a),'ok'));
 assert.ok(g(G.d_merge_text('ab','aXb','aYb'),'error'));
});
test('unloading removes draft transport and leaves editor text intact',()=>{
 let ed=P.d_unuse(boot(),'buffers');ed=M.d_handle(M.d_handle(ed,key('i')),text('plain '));
 assert.ok(!effects(ed).some(e=>g(e,'intent')==='buffer/draft'));
 const raw=M.d_boot('hello').assoc(K('packages'),R.vec());assert.equal(R.printStr(P.d_unuse(P.d_use(raw,B.d_bl_package),'buffers')),R.printStr(raw));
});
test('a conflict acknowledgement retains the original publication base',()=>{
 const ed=M.d_handle(boot(),ev(K('type'),K('saved'),K('ok?'),false,K('conflict?'),true,K('doc-rev'),'newer',K('message'),'overlap'));
 assert.equal(g(g(ed,'doc'),'rev'),'base');assert.match(g(ed,'message'),/resolve before publishing/);
});
test('unload and page leave release draft resources as host effects',()=>{
 let ed=M.d_handle(M.d_handle(boot(),key('i')),text('draft '));
 ed=M.d_take_effects(ed).toArray()[0];
 const unloaded=P.d_unuse(ed,'buffers');
 assert.ok(effects(unloaded).some(e=>g(e,'intent')==='buffer/close'));
 const left=M.d_handle(ed,ev(K('type'),K('session-leave')));
 assert.ok(effects(left).some(e=>g(e,'intent')==='buffer/close'));
});
test('frame-wide unload collects cleanup from every pane before collapse',async()=>{
 const F=await load('ed.frame');
 const left=boot().assoc(K('pkg-state'),R.hashMap('buffers',ev(K('drafted-path'),'work:omega/a.bl.org')));
 const right=boot().assoc(K('pkg-state'),R.hashMap('buffers',ev(K('drafted-path'),'work:omega/b.bl.org')));
 const layout=ev(K('name'),'two',K('panes'),R.vec(ev(K('id'),K('left'),K('doc'),K('linked')),ev(K('id'),K('right'),K('doc'),K('linked'))),K('focus'),K('left'));
 let fr=F.d_arrange(F.d_single(left),layout).assoc(K('editors'),R.hashMap(K('left'),left,K('right'),right));
 fr=F.d_take_effects(fr).toArray()[0];
 const previous=globalThis.BL_HOST['eval-ed'];
 globalThis.BL_HOST['eval-ed']=(_src,api)=>ev(K('text'),api.get('unuse')('buffers'));
 try {
  for(const e of [key(':'),text('(ed/unuse "buffers")'),key('Enter')])fr=F.d_handle(fr,e);
  const fx=F.d_take_effects(fr).toArray()[1].toArray().filter(e=>g(e,'intent')==='buffer/close');
  assert.equal(fx.length,2);assert.deepEqual(fx.map(e=>g(g(e,'args'),'path')).sort(),['work:omega/a.bl.org','work:omega/b.bl.org']);
  assert.equal(g(g(fr,'layout'),'name'),'single');
 } finally {globalThis.BL_HOST['eval-ed']=previous;}
});
test('manual resolution requires explicit confirmation and the chosen remote revision',()=>{
 let ed=boot().assoc(K('pkg-state'),R.hashMap('buffers',ev(K('conflict-rev'),'chosen')));
 ed=B.d_resolve_conflict(ed);ed=M.d_handle(ed,text('resolved'));ed=M.d_handle(ed,key('Enter'));
 const fx=effects(ed).find(e=>g(e,'intent')==='buffer/resolve');assert.equal(g(g(fx,'args'),'base'),'chosen');
 const acknowledged=M.d_handle(ed,ev(K('type'),K('intent-result'),K('then'),K('buffer-resolved'),K('ok?'),true,K('data'),ev(K('text'),source,K('submitted-text'),source,K('rev'),'chosen')));
 assert.equal(g(g(acknowledged,'doc'),'rev'),'chosen');
});
