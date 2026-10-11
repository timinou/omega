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
const [M,F,Runtime,Mobile]=await Promise.all(['ed.main','ed.frame','rtview.main','mob.main'].map(load));
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
