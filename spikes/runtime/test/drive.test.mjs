import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const out=process.env.BLED_OUT;
const load=n=>import(pathToFileURL(path.join(out,n+'.mjs')).href);
const R=await load('rt');
const {start}=await load('repl');const repl=await start(f=>fs.readFileSync(path.join(out,'src',f),'utf8'));
globalThis.BL_HOST=Object.assign(globalThis.BL_HOST||{},{'eval-ed':(src,api)=>repl.evalWith(src,'ed',api),'eval-cells':cells=>repl.evalCells(cells)});
const [M,F,Runtime,Mobile,Inspector]=await Promise.all(['ed.main','ed.frame','rtview.main','mob.main','ed.inspector'].map(load));
const K=R.kw,get=(m,k)=>m?.get(K(k),null),ev=(...kv)=>R.hashMap(...kv),key=k=>ev(K('type'),K('key'),K('key'),k);
function session(){let fr=F.d_single(M.d_boot('notes\n','notes.bl.org'));return {
 get fr(){return fr;},send(e){fr=F.d_handle(fr,e);return this;},
 use(p){return this.send(ev(K('type'),K('use'),K('package'),p));},
 cmd(s){this.send(key(':'));for(const c of s)this.send(ev(K('type'),K('text'),K('text'),c));return this.send(key('Enter'));}
};}
test('runtime is a layered package: five projections, effects and exact single-pane unload',()=>{
 const s=session(),before=F.d_focused(s.fr),userKeys=get(before,'user-keys');s.use(Runtime.d_bl_package);
 s.send(ev(K('type'),K('runtime/open')));
 assert.equal(get(F.d_render(s.fr),'layout'),'runtime');
 assert.equal(get(F.d_focused(s.fr),'user-keys'),userKeys);
 const view=Runtime.d_model(F.d_focused(s.fr));assert.ok(get(view,'items'));
 s.send(ev(K('type'),K('runtime/start')));
 assert.ok(get(s.fr,'effects').toArray().some(e=>get(e,'intent')==='runtime/start-probe'));
 s.cmd('(ed/unuse "runtime")');
 assert.equal(get(F.d_render(s.fr),'layout'),'single');
 assert.equal(get(F.d_focused(s.fr),'path'),'notes.bl.org');
 assert.equal(get(F.d_focused(s.fr),'user-keys'),userKeys);
 assert.equal(get(F.d_focused(s.fr),'pkg-state')?.get('runtime',null),null);
});
test('unuse restores all three Pocket editors before collapsing the inspector layout',()=>{
 const s=session().use(Mobile.d_bl_package);s.cmd('(ed/layout "mobile")');
 const prior=new Map(F.d_editor_ids(s.fr).toArray().map(id=>[id.name,F.d_editor(s.fr,id)]));
 s.use(Runtime.d_bl_package).send(ev(K('type'),K('runtime/open'),K('layout'),'runtime-pocket'));
 assert.equal(get(F.d_render(s.fr),'layout'),'runtime-pocket');
 s.cmd('(ed/unuse "runtime")');
 assert.equal(get(F.d_render(s.fr),'layout'),'mobile');
 assert.deepEqual(F.d_editor_ids(s.fr).toArray().map(id=>id.name),['rail','task','file']);
 for(const [id,ed] of prior){assert.equal(get(F.d_editor(s.fr,K(id)),'text'),get(ed,'text'));assert.equal(get(F.d_editor(s.fr,K(id)),'user-keys'),get(ed,'user-keys'));}
});
test('unconfirmed watcher stop is inert; one pending snapshot prevents polling overlap',()=>{
 let ed=M.d_boot('x','notes.bl.org');
 assert.equal(Runtime.d_intercept(ed,ev(K('type'),K('runtime/watch-stop'))),null);
 ed=Runtime.d_refresh(ed);const effects=get(ed,'effects');
 assert.equal(get(Runtime.d_refresh(ed),'effects'),effects);
});
test('pooled workers expose actual actor owners under the reporting browser resource',()=>{
 const pid=n=>R.vecFromArray(['pid',1,n]);
 const actor=(n,owner)=>R.hashMap(K('id'),pid(n),K('owner'),owner===null?null:pid(owner),K('status'),'waiting');
 const worker=R.hashMap(K('id'),7,K('available'),true,K('snapshot'),
   R.hashMap(K('resources'),R.vecFromArray([actor(0,null),actor(1,0)])));
 const resource=R.hashMap(K('id'),'tab/resource',K('name'),'pelagic',K('data'),
   R.hashMap(K('pool'),R.hashMap(K('actors'),R.vecFromArray([worker]))));
 const tab=R.hashMap(K('session'),'tab',K('remote'),true,K('resources'),R.vecFromArray([resource]));
 const s=session().use(Runtime.d_bl_package);
 s.send(ev(K('type'),K('runtime/browser'),K('data'),R.vecFromArray([tab])));
 const rows=Runtime.d_items(F.d_focused(s.fr)).toArray(),thread=rows.find(r=>get(r,'kind')==='worker');
 const actors=rows.filter(r=>get(r,'kind')==='actor');
 assert.equal(get(thread,'parent'),'tab/resource');assert.equal(actors.length,2);
 assert.equal(get(actors[0],'parent'),get(thread,'id'));
 assert.equal(get(actors[1],'parent'),get(actors[0],'id'));
 assert.ok(actors.every(r=>get(r,'remote')===true));
 assert.ok(actors.every(r=>get(r,'source')==='spikes/pelagic/actor/prepare.bl'));
});

test('generic inspector is independent, bounds trees and retains ended selection',()=>{
 const s=session(),before=F.d_focused(s.fr);s.use(Inspector.d_bl_package);
 s.cmd('(ed/layout "inspector")');assert.equal(get(F.d_render(s.fr),'layout'),'inspector');
 const view=Inspector.d_view(F.d_focused(s.fr));assert.equal(get(view,'sections').toArray().length,5);
 s.cmd('(ed/unuse "inspector")');assert.equal(get(F.d_render(s.fr),'layout'),'single');
 assert.equal(get(F.d_focused(s.fr),'text'),get(before,'text'));
 const row=(id,parent)=>ev(K('id'),id,K('parent'),parent,K('title'),id);
 const rows=R.vecFromArray([row('root',null),row('child','root'),row('grandchild','child')]);
 const collapsed=R.hashSet('root');
 assert.deepEqual(Inspector.d_tree(rows,collapsed).toArray().map(r=>get(r,'id')),['root']);
 assert.equal(get(Inspector.d_selection(rows,'ended'),'available'),false);
 const cycle=Inspector.d_tree(R.vecFromArray([row('a','b'),row('b','a')]),R.hashSet()).toArray();
 assert.ok(cycle.every(r=>get(r,'cycle')===true));
 const many=R.vecFromArray(Array.from({length:1000},(_,i)=>row(String(i),null)));
 assert.equal(Inspector.d_tree(many,R.hashSet()).toArray().length,512);
});
