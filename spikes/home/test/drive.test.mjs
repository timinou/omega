import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
const load=n=>import(pathToFileURL(path.join(process.env.BLED_OUT,n+'.mjs')));
const {start}=await load('repl');const repl=await start(f=>fs.readFileSync(path.join(process.env.BLED_OUT,'src',f),'utf8'));
globalThis.BL_HOST=Object.assign(globalThis.BL_HOST||{},{'eval-ed':(src,api)=>repl.evalWith(src,'ed',api)});
const [R,M,F,H,P]=await Promise.all(['rt','ed.main','ed.frame','home.main','ed.pkg'].map(load));
const K=R.kw,get=(m,k)=>m?.get(K(k),null),ev=(type,...kv)=>R.hashMap(K('type'),K(type),...kv);
function session(){let fr=F.d_single(M.d_boot('A retained draft','notes.bl.org'));return {get fr(){return fr},send(e){fr=F.d_handle(fr,e);return this}}}
test('Home is a removable layer; activity layouts retain the ordinary editor and tables',()=>{
 const s=session(),before=F.d_focused(s.fr);s.send(ev('use',K('package'),H.d_bl_package));
 for(const activity of ['home','music','work','machine','home']){
  s.send(ev('home/open',K('activity'),activity));
  assert.equal(get(F.d_render(s.fr),'layout'),activity==='home'?'home':'home-'+activity);
  assert.equal(get(F.d_focused(s.fr),'text'),get(before,'text'));
  assert.equal(get(F.d_focused(s.fr),'user-keys'),get(before,'user-keys'));
  assert.equal(get(F.d_render(s.fr),'panes').toArray().length,5);
 }
 const ed=F.d_focused(s.fr);assert.equal(H.d_intercept(ed,ev('home/open',K('activity'),'unknown')),ed);
 s.send(ev('key',K('key'),':')).send(ev('text',K('text'),'(ed/unuse "home")')).send(ev('key',K('key'),'Enter'));
 assert.equal(get(F.d_render(s.fr),'layout'),'single');
 assert.equal(get(F.d_focused(s.fr),'text'),get(before,'text'));
 assert.equal(get(F.d_focused(s.fr),'user-commands'),get(before,'user-commands'));
});
test('Unopened viewers stay lazy; opened viewer addresses stay stable on Home return',()=>{
 let ed=M.d_boot('','workspace:all');
 assert.equal(get(H.d_embed(ed,'music',H.d_music_url),'src'),null);
 ed=H.d_open(ed,'music');const src=get(H.d_embed(ed,'music',H.d_music_url),'src');
 ed=H.d_open(ed,'home');assert.equal(get(H.d_embed(ed,'music',H.d_music_url),'src'),src);
 assert.equal(get(H.d_embed(ed,'music',H.d_music_url),'renderer'),'embed');
 assert.equal(get(H.d_embed(ed,'work',H.d_work_url),'src'),null);
});
test('Continue uses current provider identities, bounds rows and rejects fabricated tasks',()=>{
 let ed=M.d_boot('','workspace:all');const rows=Array.from({length:50},(_,i)=>R.hashMap(K('row'),i,K('type'),'omega/task',K('key'),'t-'+i,K('title'),'Task '+i,K('status'),'running',K('ask'),i===0?'Ready?':null));
 ed=M.d_handle(ed,ev('doc',K('path'),'workspace:all',K('text'),'Tasks',K('read-only?'),true,K('rev'),'1',K('objects'),R.vecFromArray(rows)));
 assert.equal(get(H.d_model(ed),'tasks').toArray().length,24);assert.equal(get(H.d_model(ed),'attention').toArray().length,1);
 assert.equal(H.d_intercept(ed,ev('home/continue',K('id'),'made-up')),null);
 const next=H.d_intercept(ed,ev('home/continue',K('id'),'t-0'));
 assert.ok(get(next,'effects').toArray().some(e=>get(e,'op')===K('navigate')));
});
