import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {imp} from './paths.mjs';
const [R,M,P,W,T,C,G]=await Promise.all(['rt','ed.main','pelagic.main','pelagic.workbench','pelagic.targets','ed.core','ed.pkg'].map(imp));
const K=R.kw,fixture=fs.readFileSync(new URL('../composer.bl.org',import.meta.url),'utf8');
const plain=x=>x?.get&&x?.entries?Object.fromEntries([...x].map(([k,v])=>[k.name||k,plain(v)])):x?.toArray?x.toArray().map(plain):x;
const ev=x=>R.hashMap(...Object.entries(x).flatMap(([k,v])=>[K(k),v]));
const get=(x,k)=>x.get(K(k),null),state=e=>plain(W.d_state(e));
function fresh(){return M.d_handle(M.d_take_effects(M.d_boot(fixture,'composer.bl.org')).toArray()[0],ev({type:K('use'),package:P.d_bl_package}));}
const act=(e,action,args={})=>M.d_handle(e,ev({type:K('pelagic/work'),action,...args}));
const roots=e=>plain(T.d_roots(e)),root=(e,label)=>roots(e).find(x=>x.label===label);
function pick(e,label,add=false){return act(e,'select',{id:root(e,label).id,add});}
function changes(e){return state(e).request.targets.map(t=>ev({id:t.id,replacement:`(defn ${t.label} [root seed] [[0 ${t.label==='kick-pattern'?'0.22':'root'} 0.25]])`}));}
test('musical components, syntax nodes and mixed selection share exact nonoverlapping source targets',()=>{
 let e=fresh();assert.equal(roots(e).filter(x=>x.supported).length,6);
 e=pick(e,'kick-pattern');e=pick(e,'bass-pattern',true);assert.equal(state(e).marks.length,2);
 const selected=T.d_current(e);e=W.d_mark(e);assert.equal(state(e).marks.length,1);e=W.d_mark(e);assert.equal(state(e).marks.length,2);
 const target=T.d_current(e),xs=R.vec(target,target);assert.equal(plain(T.d_normalize(xs)).length,1);
});
test('multi-target Change modifies only selected forms, with one undo and redo',()=>{
 let e=pick(pick(fresh(),'kick-pattern'),'bass-pattern',true);const source=T.d_source(e),past=get(e,'history').get(K('past')).cnt;
 e=act(e,'submit',{mode:'change',prompt:'More space'});const id=state(e).serial;
 e=act(e,'generated',{id,edits:R.vecFromArray(changes(e)),summary:'More space',provider:'fixture'});assert.equal(state(e).phase,'checking');assert.equal(T.d_source(e),source);
 e=act(e,'checked',{id});assert.equal(state(e).phase,'idle');const changed=T.d_source(e);assert.notEqual(changed,source);
 assert.ok(changed.includes(root(fresh(),'glass').code));assert.ok(changed.includes(root(fresh(),'melody').code));
 assert.equal(get(e,'history').get(K('past')).cnt,past+1);assert.equal(state(e).entries[0].status,'changed');
 e=M.d_handle(e,ev({type:K('key'),key:'u'}));assert.equal(T.d_source(e),source);
 e=M.d_handle(e,ev({type:K('key'),key:'U'}));assert.equal(T.d_source(e),changed);
});
test('Ask and history browsing never edit, evaluate, save or add undo history; follow-ups keep context',()=>{
 let e=pick(fresh(),'bass-pattern');const source=T.d_source(e),history=get(e,'history');
 e=act(e,'submit',{mode:'ask',prompt:'Why late?'});let id=state(e).serial;
 e=act(e,'answered',{id,answer:'The notes enter on half beats.',provider:'fixture'});
 assert.equal(T.d_source(e),source);assert.equal(get(e,'history'),history);assert.equal(state(e).entries[0].mode,'ask');
 e=act(e,'entry',{id});e=act(e,'submit',{surface:'session',mode:'ask',prompt:'And the decay?'});
 assert.equal(state(e).request.context.length,1);assert.equal(state(e).request.targets[0].label,'bass-pattern');
 assert.equal(state(e).request.conversation,id);const result=M.d_take_effects(e).toArray()[1];
 assert.ok(plain(result).every(x=>!['save','evaluate'].includes(x.kind)));
});
test('session survives layout toggles, draft changes and document visits; history reads do not rerun requests',()=>{
 let e=pick(fresh(),'melody');e=act(e,'submit',{mode:'ask',prompt:'Explain'});const id=state(e).serial;
 e=act(e,'answered',{id,answer:'A phrase.'});e=act(e,'draft',{surface:'session',prompt:'Unsent'});
 e=act(e,'layout');e=act(e,'sidebar');assert.equal(state(e).layout,'inline');assert.equal(state(e)['sidebar-draft'],'Unsent');
 e=M.d_handle(e,ev({type:K('doc'),path:'notes.bl.org',text:'A different file\n',rev:'two','read-only?':false,'visit?':true,objects:R.vec()}));
 assert.equal(state(e).entries.length,1);assert.equal(state(e)['sidebar-draft'],'Unsent');assert.equal(state(e).marks.length,0);
 e=act(e,'entry',{id});assert.equal(T.d_source(e),'A different file\n');assert.equal(state(e).serial,id);
});
test('inline presentation replaces source forms with owned marks and peek exposes actual editable source',()=>{
 let e=pick(fresh(),'melody');e=act(e,'layout');let view=plain(M.d_render(e));
 assert.ok(view.lines.some(x=>x.host?.kind==='component'));const sourceRow=root(e,'melody').from[0];
 assert.equal(view.lines.some(x=>x.row===sourceRow),false);
 e=act(e,'peek',{id:root(e,'melody').id});view=plain(M.d_render(e));assert.equal(view.lines.some(x=>x.row===sourceRow),true);
 const removed=G.d_unuse(e,'pelagic');assert.equal(get(removed,'user-keys'),get(e,'user-keys'));assert.equal(get(removed,'user-commands'),get(e,'user-commands'));
 assert.equal(plain(M.d_render(removed)).lines.some(x=>x.host),false);assert.equal(T.d_source(removed),fixture);
});
test('cancelled/stale Changes cannot replace later source; extra definitions cannot escape selected scope',()=>{
 let e=pick(fresh(),'melody');e=act(e,'submit',{mode:'change',prompt:'Change'});const id=state(e).serial,edits=R.vecFromArray(changes(e));
 const cancelled=act(e,'cancel');assert.equal(T.d_source(act(cancelled,'generated',{id,edits})),fixture);
 e=M.d_handle(e,ev({type:K('text'),text:'different'}));const source=T.d_source(e);
 assert.equal(T.d_source(act(e,'generated',{id,edits})),source);
 let f=pick(fresh(),'melody');f=act(f,'submit',{mode:'change',prompt:'Change'});
 const target=state(f).request.targets[0];f=act(f,'generated',{id:state(f).serial,edits:R.vec(ev({id:target.id,replacement:'(defn melody [root seed] [[0 root 0.2]]) (def other 1)'}))});
 assert.equal(T.d_source(f),fixture);assert.ok(state(f).error);
});
