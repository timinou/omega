import {test} from 'node:test';import assert from 'node:assert/strict';
import {prepareScore} from '../host/prepare.mjs';
class WorkerStub{
 constructor(){this.listeners={};this.sent=[];this.terminated=0;}
 addEventListener(name,fn){this.listeners[name]=fn;}
 postMessage(value){this.sent.push(value);}
 emit(data){this.listeners.message({data});}
 terminate(){this.terminated++;}
}
test('preparation demands one finite chunk, preserves fallback, and owns worker/cache disposal',async()=>{
 const w=new WorkerStub(),source=prepareScore(i=>['fallback',i],()=>w,{delay:0});
 source.start();source.start();assert.deepEqual(w.sent,[{op:'init',budgetMs:4}]);
 assert.deepEqual(source(0),['fallback',0]);w.emit({op:'ready'});
 assert.deepEqual(w.sent.at(-1),{op:'prepare',id:1});
 w.emit({op:'chunk',id:1,start:0,rows:[['voice']],workMs:2});
 assert.deepEqual(source(0),['voice']);assert.equal(w.sent.length,2);
 await new Promise(r=>setTimeout(r,10));assert.deepEqual(w.sent.at(-1),{op:'credit',id:1});
 source.dispose();assert.equal(w.terminated,1);assert.equal(source.stats().closed,true);
 assert.deepEqual(source(0),['fallback',0]);source.start();assert.equal(w.sent.length,3);
});
test('out-of-order or oversized preparation fails closed and retains the working score',()=>{
 const w=new WorkerStub(),errors=[],source=prepareScore(i=>i,()=>w,{onError:e=>errors.push(e)});
 source.start();w.emit({op:'chunk',id:1,start:16,rows:[1],workMs:0});
 assert.equal(errors.length,1);assert.equal(w.terminated,1);assert.equal(source(16),16);
});
test('disabled preparation creates no worker; completed preparation retains cache and does not restart',()=>{
 let count=0;const w=new WorkerStub(),none=prepareScore(i=>i,()=>{count++;return w;},{enabled:false});none.start();assert.equal(count,0);
 const source=prepareScore(i=>i,()=>{count++;return w;});source.start();for(let start=0;start<1024;start+=16)w.emit({op:'chunk',id:1,start,rows:Array.from({length:16},(_,i)=>start+i),workMs:0});w.emit({op:'done',id:1});source.start();assert.equal(count,1);source.dispose();
});

test('premature completion and invalid timing fail closed without poisoning the fallback',()=>{
 for(const data of [{op:'done',id:1},...[-1,NaN,Infinity,undefined].map(workMs=>({op:'chunk',id:1,start:0,rows:[['voice']],workMs}))]){
  const w=new WorkerStub(),errors=[],source=prepareScore(i=>['fallback',i],()=>w,{onError:e=>errors.push(e)});
  source.start();w.emit(data);assert.equal(errors.length,1);assert.equal(w.terminated,1);assert.deepEqual(source(0),['fallback',0]);
 }
});
test('completed preparation ignores late worker errors and preserves the complete cache',()=>{
 const w=new WorkerStub(),errors=[],source=prepareScore(i=>['fallback',i],()=>w,{onError:e=>errors.push(e)});
 source.start();for(let start=0;start<1024;start+=16)w.emit({op:'chunk',id:1,start,rows:Array.from({length:16},(_,i)=>start+i),workMs:0});
 w.emit({op:'done',id:1});w.emit({op:'error',error:'late'});assert.equal(errors.length,0);assert.equal(source.stats().done,true);assert.equal(source(1023),1023);source.dispose();
});
