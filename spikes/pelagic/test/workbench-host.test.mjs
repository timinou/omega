import {test} from 'node:test';
import assert from 'node:assert/strict';
import {workbenchHost} from '../host/workbench.mjs';

test('a thrown browser validator returns the request to a visible failed state',async()=>{
  const events=[];
  const host=workbenchHost({dispatch:e=>events.push(e),evaluate:async()=>{throw new Error('Worker unavailable');}});
  await host.effect({op:'work-check',pane:'main',args:{id:7,source:'code'}});
  assert.deepEqual(events,[{type:'pelagic/work',action:'failed',id:7,pane:'main',message:'Worker unavailable'}]);
  host.dispose();
});

test('provider and validator stalls both have a terminal deadline',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=()=>new Promise(()=>{});
  try{
    for(const op of ['work-request','work-check']){
      const events=[];
      const host=workbenchHost({dispatch:e=>events.push(e),evaluate:()=>new Promise(()=>{}),timeouts:{requestMs:15,checkMs:15}});
      await host.effect({op,pane:'main',args:{id:8,mode:'change',source:'code'}});
      assert.equal(events.length,1);
      assert.equal(events[0].action,'failed');
      assert.match(events[0].message,/timed out/);
      host.dispose();
    }
  }finally{globalThis.fetch=original;}
});

test('cancel releases a pending check immediately and ignores its eventual result',async()=>{
  let resolve;const events=[];
  const host=workbenchHost({dispatch:e=>events.push(e),evaluate:()=>new Promise(done=>{resolve=done;})});
  const check=host.effect({op:'work-check',args:{id:9,source:'code'}});
  await Promise.resolve();
  await host.effect({op:'work-cancel'});
  await check;
  resolve({ok:true});await Promise.resolve();
  assert.deepEqual(events,[]);
  host.dispose();
});
