import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {imp} from './paths.mjs';import {hostImport} from './host-runtime.mjs';
const [R,M,P,C,F,T,G]=await Promise.all(['rt','ed.main','pelagic.main','pelagic.composer','ed.forms','ed.text','ed.pkg'].map(imp));
const {plain}=await hostImport('audio.mjs');const K=R.kw,get=(x,k)=>x?.get(K(k),null),ev=x=>R.hashMap(...Object.entries(x).flatMap(([k,v])=>[K(k),v]));
const fixture=fs.readFileSync(new URL('../composer.bl.org',import.meta.url),'utf8');
const replacement='(defn melody [root seed]\n  [[0 root 0.38] [1.5 (+ root 7) 0.24] [4 (+ root 12) 0.5] [7 (+ root 3) 0.38]])';
const action=(ed,action,args={})=>M.d_handle(ed,ev({type:K('pelagic/compose'),action,...args}));
function fresh(){let [ed]=M.d_take_effects(M.d_boot(fixture,'spikes/pelagic/composer.bl.org')).toArray();return M.d_handle(ed,ev({type:K('use'),package:P.d_bl_package}));}
const s=ed=>plain(C.d_state(ed));
test('package activation keeps cursor/user tables intact; phrase presentations select exact source',()=>{
 const ed=fresh();assert.equal(s(ed).enabled,true);assert.deepEqual(plain(get(ed,'sels')),[{anchor:[0,0],head:[0,0]}]);
 const selected=action(ed,'select');assert.equal(s(selected).selection.code.startsWith('(defn melody '),true);assert.equal(s(selected).notes.length,4);
 const note=action(selected,'note',{index:1});assert.equal(s(note).selection.code,'[2 (+ root 7) 0.38]');
 const parent=action(note,'move',{direction:'up'});assert.equal(s(parent).selection.kind,'vector');assert.ok(s(parent).selection.code.startsWith('[[0'));
 const unuse=G.d_unuse(ed,'pelagic');assert.equal(get(unuse,'user-keys'),get(ed,'user-keys'));assert.equal(plain(get(unuse,'pkg-state'))?.pelagic,undefined);
});
test('generation checks a candidate without changing source; commit is the source transition',()=>{
 let ed=action(fresh(),'select');const source=C.d_source(ed);ed=action(ed,'generate',{prompt:'Syncopate',provider:'demo'});const id=s(ed).serial;
 ed=action(ed,'generated',{id,replacement,provider:'Demo',attempts:1});assert.equal(s(ed).phase,'checking');assert.equal(C.d_source(ed),source);
 ed=action(ed,'checked',{id,checks:R.vec('Reader','Browser compile')});assert.equal(s(ed).phase,'ready');assert.equal(s(ed).versions.length,1);
 ed=action(ed,'audition');assert.equal(s(ed).phase,'preparing');ed=action(ed,'auditioned',{id});assert.equal(s(ed).phase,'audition');assert.equal(C.d_source(ed),source);
 ed=action(ed,'commit');ed=action(ed,'committed',{id,revision:3});assert.equal(s(ed).phase,'queued');assert.ok(C.d_source(ed).includes(replacement));assert.equal(R.printStr(get(ed,'saved-text')),R.printStr(get(fresh(),'saved-text')));
 ed=action(ed,'active');assert.equal(s(ed).phase,'active');ed=action(ed,'undone',{id,source});assert.equal(s(ed).phase,'reverted');assert.equal(C.d_source(ed),source);
});
test('late provider/check replies and edited bases cannot acquire the current selection',()=>{
 let ed=action(fresh(),'select');ed=action(ed,'generate',{prompt:'Syncopate'});const id=s(ed).serial;ed=action(ed,'cancel');
 ed=action(ed,'generated',{id,replacement,provider:'late'});assert.equal(s(ed).phase,'idle');assert.equal(s(ed).candidate,null);
 ed=action(ed,'generate',{prompt:'Again'});const next=s(ed).serial;
 ed=M.d_handle(ed,ev({type:K('text'),text:'changed'}));assert.equal(s(ed).phase,'stale');ed=action(ed,'generated',{id:next,replacement,provider:'late'});assert.equal(s(ed).candidate,null);
});
test('a subform request replaces only its captured span and validates the enclosing function',()=>{
 let ed=action(action(fresh(),'select'),'note',{index:1});const before=C.d_source(ed);ed=action(ed,'generate',{prompt:'Move this event earlier'});const id=s(ed).serial;
 ed=action(ed,'generated',{id,replacement:'[1.5 (+ root 7) 0.24]',provider:'test'});assert.equal(s(ed).phase,'checking');
 assert.equal(s(ed).candidate.source,before.replace('[2 (+ root 7) 0.38]','[1.5 (+ root 7) 0.24]'));
 ed=action(ed,'generated',{id,replacement:'(File/write! "x" "bad")',provider:'test'});assert.equal(s(ed).phase,'checking');
});
test('invalid music fails before browser evaluation is requested',()=>{
 let ed=action(fresh(),'select');ed=action(ed,'generate',{prompt:'Break it'});const id=s(ed).serial;[ed]=M.d_take_effects(ed).toArray();
 ed=action(ed,'generated',{id,replacement:'(defn melody [root seed] [[9 root 1]])',provider:'test'});assert.equal(s(ed).phase,'failed');
 const [,fx]=M.d_take_effects(ed).toArray();assert.equal(fx.cnt,0);
});
