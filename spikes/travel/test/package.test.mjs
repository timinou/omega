import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';
// Drive test of the travel package contract against the real compiled bl-ed (vendor/bl-ed/web/out).
const out=path.resolve('vendor/bl-ed/web/out'),imp=n=>import(pathToFileURL(path.join(out,n+'.mjs')));
const {start}=await imp('repl'),repl=await start(f=>fs.readFileSync(path.join(out,'src',f),'utf8'));Object.assign(globalThis.BL_HOST||(globalThis.BL_HOST={}),{'eval-ed':(src,api)=>repl.evalWith(src,'ed',api),'eval-cells':cells=>repl.evalCells(cells)});
const [M,R,T,F,P]=await Promise.all(['ed.main','rt','travel.main','ed.frame','ed.pkg'].map(imp));
const K=R.kw,get=(m,k)=>m?.get(K(k)),ev=(...kv)=>R.hashMap(...kv),key=k=>ev(K('type'),K('key'),K('key'),k);
const use=ed=>M.d_handle(ed,ev(K('type'),K('use'),K('package'),T.d_bl_package));
const source=fs.readFileSync('spikes/travel/trip.bl.org','utf8');
const state=ed=>get(ed,'pkg-state')?.get('travel');
const fxOf=ed=>{const [,fx]=M.d_take_effects(ed).toArray();return fx.toArray()};
const host=(fx,op)=>fx.find(x=>get(x,'kind')===K('package-host')&&get(x,'op')===op);
const frameFx=fr=>get(fr,'effects')?.toArray?.()??[];
test('package is plain maps and fns with the contract keys',()=>{
 const p=T.d_bl_package;assert.equal(get(p,'name'),'travel');
 for(const k of ['doc','commands','keys','intercept','adopt','owns','provides'])assert.ok(get(p,k)!==undefined,k);
 const layouts=get(get(p,'provides'),'layouts');for(const n of ['travel','travel-inspect','travel-research'])assert.ok(layouts.get(n),n);
 assert.ok(get(get(p,'provides'),'views').get(K('travel/desk')));
 assert.ok(get(p,'owns').toArray().some(k=>k===K('frame/layout')));
});
test('adoption is scoped: only a #+TRAVEL notebook gets the desk layout',()=>{
 const plain=M.d_boot('hello\n','plain.bl.org');assert.equal(T.d_adopt(plain),plain);
 const ed=use(M.d_boot(source,'trip.bl.org'));assert.equal(get(get(ed,'frame/layout'),'name'),'travel');
 assert.equal(state(ed).get(K('notebook-path')),'trip.bl.org');
 const plainUsed=use(plain);assert.equal(get(plainUsed,'frame/layout'),undefined,'unrelated documents keep the single editor');
});
test('desk model is a projection of the editable notebook text',()=>{
 let ed=use(M.d_boot(source,'trip.bl.org'));const m=T.d_model(ed);assert.equal(get(m,'source'),source);
 assert.equal(get(m,'package'),'travel');assert.match(get(m,'source'),/Essaouira group stay/);assert.equal(get(m,'role'),'desk');
});
test('select, tab and compare live in package state; compare toggles',()=>{
 let ed=use(M.d_boot(source,'trip.bl.org'));
 ed=M.d_handle(ed,ev(K('type'),K('travel/select'),K('field'),'tab',K('value'),'compare'));assert.equal(state(ed).get(K('tab')),'compare');
 ed=M.d_handle(ed,ev(K('type'),K('travel/select'),K('field'),'selected',K('value'),'abc'));assert.equal(state(ed).get(K('selected')),'abc');
 ed=M.d_handle(ed,ev(K('type'),K('travel/select'),K('field'),'bogus',K('value'),'x'));assert.equal(state(ed).get(K('bogus')),undefined);
 ed=M.d_handle(ed,ev(K('type'),K('travel/toggle-compare'),K('id'),'a'));ed=M.d_handle(ed,ev(K('type'),K('travel/toggle-compare'),K('id'),'b'));
 assert.deepEqual(state(ed).get(K('compare')).toArray?.()??[...state(ed).get(K('compare'))],['a','b']);
 ed=M.d_handle(ed,ev(K('type'),K('travel/toggle-compare'),K('id'),'a'));assert.deepEqual([...state(ed).get(K('compare'))],['b']);
 ed=M.d_handle(ed,ev(K('type'),K('command'),K('command'),K('travel/trip')));assert.equal(state(ed).get(K('tab')),'trip');
});
test('IO leaves as host effects: refresh needs a selection for the selected scope, inspect needs one too',()=>{
 let ed=use(M.d_boot(source,'trip.bl.org'));
 let e2=M.d_handle(ed,ev(K('type'),K('command'),K('command'),K('travel/inspect')));assert.equal(host(fxOf(e2),'inspect'),undefined,'no selection, no inspect');
 ed=M.d_handle(ed,ev(K('type'),K('travel/select'),K('field'),'selected',K('value'),'abc123'));
 e2=M.d_handle(ed,ev(K('type'),K('command'),K('command'),K('travel/inspect')));const i=host(fxOf(e2),'inspect');assert.ok(i);assert.equal(get(i,'listing'),'abc123');assert.equal(get(i,'package'),'travel');
 e2=M.d_handle(ed,ev(K('type'),K('command'),K('command'),K('travel/force-refresh')));const r=host(fxOf(e2),'refresh');assert.equal(get(r,'force'),true);assert.equal(get(r,'listing'),'abc123');
 e2=M.d_handle(ed,ev(K('type'),K('command'),K('command'),K('travel/refresh-all')));assert.equal(get(host(fxOf(e2),'refresh'),'scope'),'all');
});
test('inspect opens the browser pane once, close releases the owned session and restores the desk',()=>{
 let fr=F.d_handle(F.d_single(M.d_boot(source,'trip.bl.org')),ev(K('type'),K('use'),K('package'),T.d_bl_package));
 assert.equal(get(get(fr,'layout'),'name'),'travel');
 const ins=(l)=>ev(K('type'),K('travel/inspected'),K('session'),'tv-abc',K('listing'),l,K('url'),'https://example.com/'+l,K('title'),'T');
 fr=F.d_handle(fr,ins('a'));assert.equal(get(get(fr,'layout'),'name'),'travel-inspect');assert.equal(get(get(fr,'layout'),'panes').toArray().length,3);
 const again=F.d_handle(fr,ins('b'));assert.equal(get(get(again,'layout'),'name'),'travel-inspect');
 assert.equal(state(F.d_focused(again)).get(K('inspect')).get(K('listing')),'b','navigating to another listing re-targets without re-layout');
 fr=F.d_handle(again,ev(K('type'),K('travel/close-inspect')));assert.equal(get(get(fr,'layout'),'name'),'travel');
 assert.equal(state(F.d_focused(fr)).get(K('inspect')),undefined);
});
test('failed inspect keeps layout and stores the message',()=>{
 let ed=use(M.d_boot(source,'trip.bl.org'));ed=M.d_handle(ed,ev(K('type'),K('travel/inspect-failed'),K('message'),'nope'));
 assert.equal(state(ed).get(K('inspect-error')),'nope');assert.equal(get(get(ed,'frame/layout'),'name'),'travel');
});
test('research: empty question is refused; submitted question emits a draft-only task/open with desk context',()=>{
 let ed=use(M.d_boot(source,'trip.bl.org'));
 let e2=M.d_handle(ed,ev(K('type'),K('travel/research'),K('question'),'  '));assert.equal(fxOf(e2).find(x=>get(x,'intent')==='task/open'),undefined);
 e2=M.d_handle(ed,ev(K('type'),K('travel/research'),K('question'),'Which riads sleep 20?',K('context'),'- Riad X https://x.example'));
 const call=fxOf(e2).find(x=>get(x,'intent')==='task/open');assert.ok(call);assert.equal(get(call,'then'),K('travel/research-route'));
 const goal=get(get(call,'args'),'goal');assert.match(goal,/Which riads sleep 20/);assert.match(goal,/Riad X/);assert.match(goal,/11 adults and 9 children, 20 guests/);assert.match(goal,/do NOT contact owners, book, pay/);assert.equal(get(get(call,'args'),'path'),'trip.bl.org');
});
test('research result opens a task beside retained notebook and desk; failure retains both',()=>{
 let fr=F.d_handle(F.d_single(M.d_boot(source,'trip.bl.org')),ev(K('type'),K('use'),K('package'),T.d_bl_package));const original=F.d_focused(fr);
 const bad=F.d_handle(fr,ev(K('type'),K('intent-result'),K('then'),K('travel/research-route'),K('ok?'),false,K('message'),'boom'));
 assert.equal(get(get(bad,'layout'),'name'),'travel');assert.equal(state(F.d_focused(bad)).get(K('research-error')),'boom');
 fr=F.d_handle(fr,ev(K('type'),K('intent-result'),K('then'),K('travel/research-route'),K('ok?'),true,K('data'),ev(K('id'),'t-1',K('path'),'task:t-1')));
 assert.equal(get(get(fr,'layout'),'name'),'travel-research');assert.equal(get(F.d_editor(fr,K('notebook')),'text'),get(original,'text'));
 assert.ok(frameFx(fr).some(x=>get(x,'kind')===K('visit')&&get(x,'path')==='task:t-1'));
 fr=F.d_handle(fr,ev(K('type'),K('command'),K('command'),K('travel/return')));assert.equal(get(get(fr,'layout'),'name'),'travel');
});
test('unuse leaves editor text, tables, history and layout exactly as before',()=>{
 const base=M.d_boot(source,'trip.bl.org');let ed=use(base);
 ed=M.d_handle(ed,ev(K('type'),K('travel/select'),K('field'),'selected',K('value'),'zz'));ed=M.d_handle(ed,ev(K('type'),K('travel/toggle-compare'),K('id'),'zz'));
 ed=P.d_unuse(ed,'travel');for(const k of ['text','sels','user-keys','user-commands','history','mode'])assert.equal(get(ed,k),get(base,k),k);
 assert.equal(get(ed,'frame/layout'),undefined);assert.equal(get(ed,'pkg-state').get('travel'),undefined);assert.equal(get(use(base),'user-keys'),get(base,'user-keys'),'package keys are layered, never merged');
});
test('real frame: typing (ed/unuse "travel") returns to one editor, inspect pane included',()=>{
 let fr=F.d_handle(F.d_single(M.d_boot(source,'trip.bl.org')),ev(K('type'),K('use'),K('package'),T.d_bl_package));
 fr=F.d_handle(fr,ev(K('type'),K('travel/inspected'),K('session'),'tv-abc',K('listing'),'a',K('url'),'https://example.com/',K('title'),'T'));assert.equal(get(get(fr,'layout'),'name'),'travel-inspect');
 fr=F.d_handle(fr,key(':'));for(const ch of '(ed/unuse "travel")')fr=F.d_handle(fr,ev(K('type'),K('text'),K('text'),ch));fr=F.d_handle(fr,key('Enter'));
 assert.equal(get(get(fr,'layout'),'name'),'single');assert.equal(P.d_names(F.d_focused(fr)).toArray().includes('travel'),false);
});
test('browser view model carries inspect metadata at the top level (the host reads it there, not under :state)',()=>{
 let fr=F.d_handle(F.d_single(M.d_boot(source,'trip.bl.org')),ev(K('type'),K('use'),K('package'),T.d_bl_package));
 const ins=(l)=>ev(K('type'),K('travel/inspected'),K('session'),'tv-abc',K('listing'),l,K('url'),'https://example.com/'+l,K('title'),'T '+l);
 fr=F.d_handle(F.d_handle(fr,ins('a')),ins('b'));
 const bm=get(get(T.d_bl_package,'provides'),'views').get(K('travel/browser'))(F.d_focused(fr));
 assert.equal(get(bm,'role'),'browser');const i=get(bm,'inspect');
 assert.deepEqual([i.get(K('session')),i.get(K('listing')),i.get(K('url')),i.get(K('title'))],['tv-abc','b','https://example.com/b','T b'],'re-targeted metadata is projected');
 assert.equal(get(get(bm,'state'),'inspect'),undefined);
});
