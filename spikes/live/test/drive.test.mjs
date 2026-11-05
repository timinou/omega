import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const out=process.env.BLED_OUT;
const load=n=>import(pathToFileURL(path.join(out,n+'.mjs')).href);
const R=await load('rt'),{start}=await load('repl');
const repl=await start(f=>fs.readFileSync(path.join(out,'src',f),'utf8'));
globalThis.BL_HOST=Object.assign(globalThis.BL_HOST||{},{'eval-ed':(s,a)=>repl.evalWith(s,'ed',a),'eval-cells':c=>repl.evalCells(c)});
const [M,F,L,W,Mobile]=await Promise.all(['ed.main','ed.frame','liveview.main','ws.main','mob.main'].map(load));
const K=R.kw,get=(m,k)=>m?.get(K(k),null),ev=(...kv)=>R.hashMap(...kv),key=k=>ev(K('type'),K('key'),K('key'),k);
const str=x=>R.printStr(x);
function session(){let fr=F.d_single(M.d_boot('Keep this notebook\n','notes.bl.org'));return {
 get fr(){return fr;},send(e){fr=F.d_handle(fr,e);return this;},
 use(p){return this.send(ev(K('type'),K('use'),K('package'),p));},
 cmd(s){this.send(key(':'));for(const c of s)this.send(ev(K('type'),K('text'),K('text'),c));return this.send(key('Enter'));}
};}
test('Live appends a view and exact unload retains the editor and user tables',()=>{
 const s=session(),before=F.d_focused(s.fr);s.use(L.d_bl_package).send(ev(K('type'),K('live/open')));
 assert.equal(get(F.d_render(s.fr),'panes').toArray().length,2);
 assert.equal(get(F.d_focused(s.fr),'user-keys'),get(before,'user-keys'));
 assert.ok(get(s.fr,'effects').toArray().some(e=>get(e,'intent')==='live/snapshot'));
 s.cmd('(ed/unuse "live")');
 assert.equal(get(F.d_render(s.fr),'panes').toArray().length,1);
 assert.equal(str(get(F.d_focused(s.fr),'text')),str(get(before,'text')));
 assert.equal(get(F.d_focused(s.fr),'user-commands'),get(before,'user-commands'));
 assert.equal(get(F.d_focused(s.fr),'pkg-state')?.get('live',null),null);
});
test('opening, reopening, closing and unusing Live preserves every workspace pane and widths',()=>{
 const s=session().use(W.d_bl_package);s.cmd('(ed/layout "workspace")');
 const ids=F.d_editor_ids(s.fr).toArray(),before=new Map(ids.map(id=>[id,F.d_editor(s.fr,id)]));
 const layout=get(s.fr,'layout');
 s.use(L.d_bl_package).send(ev(K('type'),K('live/open'))).send(ev(K('type'),K('live/open')));
 assert.equal(get(F.d_render(s.fr),'panes').toArray().length,4);
 assert.deepEqual(F.d_editor_ids(s.fr).toArray(),ids);
 s.send(ev(K('type'),K('live/close')));
 assert.equal(get(s.fr,'layout'),layout);
 s.send(ev(K('type'),K('live/open'))).cmd('(ed/unuse "live")');
 assert.equal(get(s.fr,'layout'),layout);
 for(const [id,ed] of before){const now=F.d_editor(s.fr,id);
  for(const field of ['text','sels','saved-text','user-keys','user-commands'])assert.equal(str(get(now,field)),str(get(ed,field)),field);
 }
});
test('one snapshot in flight and proposal ids flow through the same backend operations',()=>{
 let ed=L.d_refresh(M.d_boot('x','notes.bl.org'));
 assert.equal(get(L.d_refresh(ed),'effects'),get(ed,'effects'));
 ed=L.d_intercept(ed,ev(K('type'),K('intent-result'),K('then'),K('live/snapshot'),K('ok?'),true,K('data'),ev(K('candidate'),ev(K('id'),'candidate-7'))));
 ed=L.d_intercept(ed,ev(K('type'),K('live/apply')));
 const effect=get(ed,'effects').toArray().at(-1);
 assert.equal(get(effect,'intent'),'live/apply');assert.equal(get(get(effect,'args'),'candidate'),'candidate-7');
 const unchanged=L.d_intercept(ed,ev(K('type'),K('live/apply')));
 assert.equal(get(unchanged,'effects'),get(ed,'effects'));
});
test('Pocket opens Live without replacing retained editors, and routes source into its file editor',()=>{
 const s=session().use(Mobile.d_bl_package).use(L.d_bl_package);s.cmd('(ed/layout "mobile")');
 const rail=F.d_editor(s.fr,K('rail')),task=F.d_editor(s.fr,K('task'));
 s.send(ev(K('type'),K('mobile/live')));
 assert.equal(get(F.d_render(s.fr),'panes').toArray().length,7);
 s.send(ev(K('type'),K('intent-result'),K('then'),K('live/snapshot'),K('ok?'),true,
   K('data'),ev(K('source'),'work:project/live-worker.bl')));
 s.send(ev(K('type'),K('live/source')));
 assert.equal(get(F.d_render(s.fr),'layout'),'mobile');
 assert.equal(get(F.d_render(s.fr),'panes').toArray().length,6);
 assert.equal(get(F.d_editor(s.fr,K('rail')),'path'),get(rail,'path'));
 assert.equal(get(F.d_editor(s.fr,K('task')),'text'),get(task,'text'));
 assert.equal(get(get(F.d_editor(s.fr,K('rail')),'pkg-state').get('mobile'),'screen'),'document');
 assert.ok(get(s.fr,'effects').toArray().some(e=>get(e,'kind')===K('visit')&&get(e,'pane')===K('file')&&get(e,'path')==='work:project/live-worker.bl'));
});
test('Pocket can load Live on demand and open it after the package arrives',()=>{
 const s=session().use(Mobile.d_bl_package);s.cmd('(ed/layout "mobile")');
 s.send(ev(K('type'),K('mobile/live')));
 assert.ok(get(s.fr,'effects').toArray().some(e=>get(e,'kind')===K('load-package')&&get(e,'name')==='live'));
 s.use(L.d_bl_package);
 assert.equal(get(F.d_render(s.fr),'panes').toArray().length,7);
});
