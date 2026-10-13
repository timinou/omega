import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
const load=n=>import(pathToFileURL(path.join(process.env.BLED_OUT,n+'.mjs')));
const {start}=await load('repl');const repl=await start(f=>fs.readFileSync(path.join(process.env.BLED_OUT,'src',f),'utf8'));
globalThis.BL_HOST=Object.assign(globalThis.BL_HOST||{},{'eval-ed':(src,api)=>repl.evalWith(src,'ed',api)});
const [R,M,F,H,W]=await Promise.all(['rt','ed.main','ed.frame','home.main','home.workbench'].map(load));
const K=R.kw,get=(m,k)=>m?.get(K(k),null),ev=(type,...kv)=>R.hashMap(K('type'),K(type),...kv);
function session(){let fr=F.d_single(M.d_boot('A retained draft','notes.bl.org'));return {get fr(){return fr},send(e){fr=F.d_handle(fr,e);return this}}}
test('one docked workbench retains editors and retracts its layers exactly',()=>{
 const s=session(),before=F.d_focused(s.fr);s.send(ev('use',K('package'),H.d_bl_package));
 for(const activity of ['home','music','work','machine','home']){
  s.send(ev('home/open',K('activity'),activity));
  const model=F.d_render(s.fr),panes=get(model,'panes').toArray();
  assert.equal(get(model,'layout'),activity==='home'?'home':'home-'+activity);
  assert.equal(get(F.d_focused(s.fr),'text'),get(before,'text'));
  assert.equal(get(F.d_focused(s.fr),'user-keys'),get(before,'user-keys'));
  assert.equal(panes.length,6);assert.equal(panes.filter(p=>get(p,'dock')).length,2);
  const visible=panes.filter(p=>get(p,'width')===K('fill'));assert.equal(visible.length,1,'one working surface owns the full width');
 }
 s.send(ev('key',K('key'),':')).send(ev('text',K('text'),'(ed/unuse "home")')).send(ev('key',K('key'),'Enter'));
 assert.equal(get(F.d_render(s.fr),'layout'),'single');assert.equal(get(F.d_focused(s.fr),'text'),get(before,'text'));
 assert.equal(get(F.d_focused(s.fr),'user-commands'),get(before,'user-commands'));
});
test('work opens immediately; tool instances remain lazy and stable through return',()=>{
 let ed=M.d_boot('','workspace:all');assert.ok(get(H.d_embed(ed,'work',H.d_work_url),'src'));
 assert.equal(get(H.d_embed(ed,'music',H.d_music_url),'src'),null);
 ed=H.d_open(ed,'music');const src=get(H.d_embed(ed,'music',H.d_music_url),'src');
 ed=H.d_open(ed,'home');assert.equal(H.d_activity(ed),'work');assert.equal(get(H.d_embed(ed,'music',H.d_music_url),'src'),src);
 assert.equal(H.d_intercept(ed,ev('home/tool',K('id'),'unknown')),ed);
});
test('work classification is exclusive; terminal asks do not become new attention',()=>{
 const rows=R.vecFromArray([['a','idle','Ready?'],['b','running',null],['c','idle',null],['d','done','Old question']].map(([key,status,ask])=>R.hashMap(K('type'),'omega/task',K('key'),key,K('title'),'Task '+key,K('status'),status,K('ask'),ask)));
 const groups=W.d_groups(rows,'').toArray();assert.deepEqual(groups.map(g=>get(g,'id')),['attention','working','answered','recent']);
 assert.equal(groups.reduce((n,g)=>n+get(g,'count'),0),4);assert.equal(W.d_groups(rows,'Task b').toArray().length,1);
 assert.equal(W.d_navigation('full').toArray().length,3);assert.equal(W.d_navigation('scoped').toArray().length,2);
});
