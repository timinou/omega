import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url)),out=path.join(root,'vendor/bl-ed/web/out');
const imp=n=>import(pathToFileURL(path.join(out,n+'.mjs')));
const {start}=await imp('repl');const repl=await start(f=>fs.readFileSync(path.join(out,'src',f),'utf8'));Object.assign(globalThis.BL_HOST||(globalThis.BL_HOST={}),{'eval-ed':(src,api)=>repl.evalWith(src,'ed',api),'eval-cells':cells=>repl.evalCells(cells)});
const [M,R,P,F,G]=await Promise.all(['ed.main','rt','pq.main','ed.frame','ed.pkg'].map(imp));
const K=R.kw,get=(m,k)=>m?.get(K(k)),ev=(...a)=>R.hashMap(...a),key=k=>ev(K('type'),K('key'),K('key'),k);
const source='#+USE: present,browser,procurement\n#+PROCUREMENT_DESK: second\n#+TITLE: Desk\n\n#+begin_decision :id first :stage notice-checked :decision needs-information\nFirst notice\n#+end_decision\n\n#+begin_decision :id second :stage discovered :decision needs-information\nSecond notice\n#+end_decision';
const use=ed=>M.d_handle(ed,ev(K('type'),K('use'),K('package'),P.d_bl_package));
const at=(ed,row)=>ed.assoc(K('sels'),R.vec(ev(K('anchor'),R.vec(row,0),K('head'),R.vec(row,0))));
test('file directive chooses desk-scoped layout; ordinary document remains untouched',()=>{const ed=M.d_boot('ordinary','plain.bl.org');assert.equal(P.d_adopt(ed),ed);const scoped=use(M.d_boot(source,'desks/second/desk.bl.org'));assert.equal(get(get(scoped,'frame/layout'),'name'),'procurement-desk');assert.equal(get(get(get(scoped,'frame/layout'),'panes').nth(0),'doc'),'procurement:second/queue');});
test('selected decision is the cursor card, not the first notice in the file',()=>{let ed=at(use(M.d_boot(source,'desks/second/desk.bl.org')),9);assert.equal(P.d_opportunity_id(ed),'second');ed=M.d_handle(ed,key('C-Enter'));const [,fx]=M.d_take_effects(ed).toArray();assert.equal(get(fx.toArray().find(e=>get(e,'kind')===K('visit')),'path'),'desks/second/opportunity-second.bl.org');});
test('refresh source runs through Omega intent and keeps workspace context',()=>{let ed=at(use(M.d_boot('#+PROCUREMENT_DESK: second\n#+begin_src beam-lisp\n(defn search [] nil)\n#+end_src','desks/second/search.bl.org')),2);ed=M.d_handle(ed,key('C-Enter'));const [,fx]=M.d_take_effects(ed).toArray();const x=fx.toArray().find(e=>get(e,'intent')==='procurement/run');assert.equal(get(get(x,'args'),'desk'),'second');assert.equal(get(get(x,'args'),'operation'),'refresh');});
test('unload removes layout, state, commands and owned prompt in all panes',()=>{const ed=M.d_boot(source,'desks/second/desk.bl.org'),tables=get(ed,'user-commands');let fr=F.d_handle(F.d_single(ed),ev(K('type'),K('use'),K('package'),P.d_bl_package));assert.equal(get(get(fr,'layout'),'name'),'procurement-desk');fr=F.d_handle(fr,key(':'));for(const ch of '(ed/unuse "procurement")')fr=F.d_handle(fr,ev(K('type'),K('text'),K('text'),ch));fr=F.d_handle(fr,key('Enter'));assert.equal(get(get(fr,'layout'),'name'),'single');const survivor=F.d_focused(fr);assert.equal(get(survivor,'user-commands'),tables);assert.equal(G.d_names(survivor).toArray().includes('procurement'),false);assert.equal(get(get(survivor,'pkg-state'),'procurement')==null,true);});

test('new-desk prompt submits a scoped host intent and unload cancels its closure',()=>{
 let ed=use(M.d_boot(source,'desks/second/desk.bl.org'));
 ed=M.d_handle(ed,ev(K('type'),K('command'),K('command'),K('procurement/new')));
 assert.equal(get(get(ed,'minibuf'),'package'),'procurement');
 let submitted=M.d_handle(M.d_handle(ed,ev(K('type'),K('text'),K('text'),'third')),key('Enter'));
 const [,fx]=M.d_take_effects(submitted).toArray();const x=fx.toArray().find(e=>get(e,'intent')==='procurement/new');
 assert.equal(get(get(x,'args'),'from'),'second');assert.equal(get(get(x,'args'),'id'),'third');
 const removed=G.d_unuse(ed,'procurement');assert.equal(get(removed,'mode'),K('normal'));assert.equal(get(get(removed,'minibuf'),'submit')==null,true);
});
