import {test} from 'node:test';import assert from 'node:assert/strict';
import {packageHosts} from '../../../vendor/bl-ed/web/package-hosts.mjs';
test('host resources are lazy and follow package and view lifetime',()=>{
 let made=0,disposed=0,unmounted=0,effects=0,painted=0;const events=[];
 const h=packageHosts({dispatch:e=>events.push(e)});
 h.register('a',api=>{made++;return {effect(){effects++;api.dispatch({type:'done'});},mount(_root,dispatch){dispatch({type:'click'});return {update(){painted++;},dispose(){unmounted++;}}},dispose(){disposed++;}};});
 h.sync(['a']);assert.equal(made,0);h.effect('a',{});assert.equal(made,1);assert.equal(effects,1);
 const root={isConnected:true};h.paint('a',root,{},'main');h.paint('a',root,{},'main');assert.equal(painted,2);assert.equal(made,1);
 assert.equal(events[1].pane,'main');root.isConnected=false;h.sync(['a']);assert.equal(unmounted,1);assert.equal(disposed,0);
 h.sync([]);assert.equal(disposed,1);h.effect('a',{});assert.equal(effects,1);
});
test('late answers from a removed resource cannot reach a new use of the same name',()=>{
 const events=[],answers=[];const h=packageHosts({dispatch:e=>events.push(e)});
 h.register('a',api=>{answers.push(api.dispatch);return {dispose(){}}});h.sync(['a']);h.effect('a',{});h.sync([]);h.sync(['a']);h.effect('a',{});
 answers[0]({type:'stale'});answers[1]({type:'current'});assert.deepEqual(events,[{type:'current'}]);h.dispose();
});

test('detached view callbacks cannot act through a reused root',()=>{
 const events=[],answers=[],root={isConnected:true};const h=packageHosts({dispatch:e=>events.push(e)});
 h.register('a',()=>({mount(_r,dispatch){answers.push(dispatch);return {dispose(){}}},dispose(){}}));
 h.sync(['a']);h.paint('a',root,{},'main');root.isConnected=false;h.sync(['a']);root.isConnected=true;h.paint('a',root,{},'main');
 answers[0]({type:'stale-view'});answers[1]({type:'new-view'});assert.deepEqual(events,[{type:'new-view',pane:'main'}]);h.dispose();
});

test('stale effect rejection is ignored, current rejection remains visible',async()=>{
 const rejects=[],h=packageHosts({dispatch(){}});h.register('a',()=>({effect(){return new Promise((_resolve,reject)=>rejects.push(reject));},dispose(){}}));
 h.sync(['a']);const old=h.effect('a',{});h.sync([]);h.sync(['a']);const current=h.effect('a',{});
 rejects[0](new Error('stale'));await old;rejects[1](new Error('current'));await assert.rejects(current,/current/);h.dispose();
});
