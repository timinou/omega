import {test} from 'node:test';import assert from 'node:assert/strict';
import {GpuTimer} from '../host/gpu-timer.mjs';
test('GPU timing stays bounded, reads only available results, and discards disjoint samples',()=>{
 let id=0,available=false,disjoint=false,reads=0;const deleted=[];
 const ext={TIME_ELAPSED_EXT:1,GPU_DISJOINT_EXT:2,QUERY_RESULT_AVAILABLE_EXT:3,QUERY_RESULT_EXT:4,
  createQueryEXT:()=>++id,beginQueryEXT(){},endQueryEXT(){},deleteQueryEXT:q=>deleted.push(q),
  getQueryObjectEXT(_q,key){if(key===3)return available;reads++;return 2e6;}};
 const timer=new GpuTimer({getExtension:()=>ext,getParameter:()=>disjoint});
 for(let i=0;i<100;i++){timer.begin();timer.end();timer.poll();}
 assert.equal(id,4);assert.equal(reads,0);assert.equal(timer.report().pending,4);
 available=true;timer.poll();assert.equal(reads,4);assert.equal(timer.report().p95Ms,2);assert.equal(timer.report().pending,0);
 timer.begin();timer.end();disjoint=true;timer.poll();assert.equal(reads,4);assert.equal(timer.report().disjoint,1);
 timer.begin();timer.dispose();assert.equal(timer.report().pending,0);assert.equal(deleted.length,6);
});
test('missing GPU timing extension keeps rendering available and reports no invented measurement',()=>{
 const timer=new GpuTimer({getExtension:()=>null});timer.begin();timer.end();timer.poll();timer.dispose();
 assert.equal(timer.report().available,false);assert.equal(timer.report().samples,0);assert.equal(timer.report().p95Ms,null);
});
