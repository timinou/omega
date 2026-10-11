import {test} from 'node:test';
import assert from 'node:assert/strict';
import {observePackage,observations} from '../../../vendor/bl-ed/web/package-observations.mjs';
test('observations own resource lifetime and permit only registered local actions',()=>{
 let calls=0;const stop=observePackage('fixture',()=>({workers:1}),{cancel:()=>++calls}),reader=observations();
 try{
  const resource=reader.sample()[0].resources[0];assert.equal(resource.name,'fixture');assert.equal(resource.data.workers,1);
  reader.invoke(resource.id,'cancel');assert.equal(calls,1);
  assert.throws(()=>reader.invoke('unowned','cancel'),/currently owned local/);
  stop();assert.equal(reader.sample()[0].resources.length,0);assert.throws(()=>reader.invoke(resource.id,'cancel'));
 }finally{stop();reader.dispose();}
 assert.deepEqual(reader.sample(),[]);assert.throws(()=>reader.invoke('x','cancel'),/closed/);
});
test('same-origin peer snapshots expire and never confer action authority',async()=>{
 const peer=await import('../../../vendor/bl-ed/web/package-observations.mjs?peer');
 const stop=peer.observePackage('peer',()=>({status:'running'}),{cancel:()=>{throw new Error('must not run');}}),reader=observations();
 try{
  reader.sample();await new Promise(r=>setTimeout(r,100));
  const remote=reader.sample().find(s=>s.remote);assert.ok(remote);assert.equal(remote.resources[0].name,'peer');
  assert.throws(()=>reader.invoke(remote.resources[0].id,'cancel'),/currently owned local/);
  const original=Date.now;try{Date.now=()=>original()+7000;assert.equal(reader.sample().filter(s=>s.remote).length,0);}finally{Date.now=original;}
 }finally{stop();reader.dispose();}
});
