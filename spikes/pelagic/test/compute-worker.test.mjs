import {hostImport} from './host-runtime.mjs';
import {test} from 'node:test';import assert from 'node:assert/strict';
const {createPreparationWorker,preparationWorkers,closeIdlePreparationWorkers}=await hostImport('compute-worker.mjs');
class WorkerStub{
 constructor(){this.listeners=new Map();this.sent=[];this.terminated=0;}
 addEventListener(name,fn){this.listeners.set(name,fn);}
 postMessage(data){this.sent.push(data);if(data.op==='init')queueMicrotask(()=>this.emit({op:'ready'}));if(data.op==='cancel')queueMicrotask(()=>this.emit({op:'cancelled',id:data.id}));}
 emit(data){this.listeners.get('message')?.({data});}
 terminate(){this.terminated++;}
}
const turn=()=>new Promise(r=>setTimeout(r,0));
test('100 leases reuse one worker, isolate messages and reset to zero live owners',async()=>{
 let count=0;const actual=new WorkerStub(),factory=()=>{count++;return actual;};
 const ids=new Set();
 for(let i=0;i<100;i++){
  const a=createPreparationWorker('same-generation',factory),events=[];
  a.addEventListener('message',e=>events.push(e.data));a.postMessage({op:'init',budgetMs:4});await turn();
  assert.equal(events[0].op,'ready');a.postMessage({op:'prepare',id:1});
  const id=actual.sent.at(-1).id;assert(!ids.has(id));ids.add(id);
  actual.emit({op:'chunk',id,start:0});assert.equal(events.at(-1).id,1);
  a.terminate();actual.emit({op:'chunk',id,start:16});assert.equal(events.length,2);
  await turn();assert.equal(preparationWorkers().active,0);assert.equal(preparationWorkers().resetting,0);
 }
 assert.equal(count,1);assert.equal(preparationWorkers().workers,1);
 closeIdlePreparationWorkers();assert.equal(actual.terminated,1);assert.equal(preparationWorkers().workers,0);
});
test('two sessions receive only their own job, and closing A leaves B intact',async()=>{
 const actual=new WorkerStub(),factory=()=>actual;
 const a=createPreparationWorker('two',factory),b=createPreparationWorker('two',factory),ea=[],eb=[];
 a.addEventListener('message',e=>ea.push(e.data));b.addEventListener('message',e=>eb.push(e.data));
 a.postMessage({op:'init'});b.postMessage({op:'init'});await turn();
 a.postMessage({op:'prepare',id:1});const aid=actual.sent.at(-1).id;
 b.postMessage({op:'prepare',id:1});const bid=actual.sent.at(-1).id;
 assert.notEqual(aid,bid);actual.emit({op:'chunk',id:aid,start:0});assert.equal(ea.length,2);assert.equal(eb.length,1);
 a.terminate();await turn();actual.emit({op:'chunk',id:bid,start:0});assert.equal(eb.length,2);assert.equal(actual.terminated,0);
 b.terminate();await turn();closeIdlePreparationWorkers();
});
test('worker crash invalidates leases and permits a fresh owner',async()=>{
 const actual=new WorkerStub(),errors=[],a=createPreparationWorker('crash',()=>actual);
 a.addEventListener('error',e=>errors.push(e.message));a.postMessage({op:'init'});await turn();
 actual.listeners.get('error')({message:'broken'});assert.deepEqual(errors,['broken']);assert.equal(actual.terminated,1);
 const replacement=new WorkerStub(),b=createPreparationWorker('crash',()=>replacement);
 b.postMessage({op:'init'});await turn();b.terminate();await turn();closeIdlePreparationWorkers();
});
test('failed native postMessage retires the owner and releases its capacity',async()=>{
 const actual=new WorkerStub(),a=createPreparationWorker('send-failure',()=>actual),errors=[];
 a.addEventListener('error',e=>errors.push(e.message));a.postMessage({op:'init'});await turn();
 actual.postMessage=()=>{throw new Error('clone failed');};
 assert.throws(()=>a.postMessage({op:'prepare',id:1}),/clone failed/);
 assert.deepEqual(errors,['clone failed']);assert.equal(actual.terminated,1);
 assert.equal(preparationWorkers().active,0);assert.equal(preparationWorkers().resetting,0);
});
test('bounded admission includes clients waiting for cancellation acknowledgement',async()=>{
 const actual=new WorkerStub(),leases=[];
 actual.postMessage=data=>{actual.sent.push(data);if(data.op==='init')queueMicrotask(()=>actual.emit({op:'ready'}));};
 for(let i=0;i<8;i++){
  const a=createPreparationWorker('bounded',()=>actual);a.postMessage({op:'init'});leases.push(a);
 }
 await turn();leases[0].terminate();
 const ninth=createPreparationWorker('bounded',()=>actual);
 assert.throws(()=>ninth.postMessage({op:'init'}),/capacity exhausted/);
 assert.equal(preparationWorkers().active,7);assert.equal(preparationWorkers().resetting,1);
 actual.emit({op:'cancelled',id:actual.sent.at(-1).id});
 ninth.postMessage({op:'init'});ninth.terminate();
 for(const a of leases.slice(1))a.terminate();
 for(const data of actual.sent.filter(m=>m.op==='cancel'))actual.emit({op:'cancelled',id:data.id});
 closeIdlePreparationWorkers();assert.equal(preparationWorkers().workers,0);
});
test('closing before worker readiness queues cancellation without poisoning another session',async()=>{
 const actual=new WorkerStub();actual.postMessage=data=>actual.sent.push(data);
 const a=createPreparationWorker('starting',()=>actual),b=createPreparationWorker('starting',()=>actual);
 a.postMessage({op:'init'});a.terminate();b.postMessage({op:'init'});
 assert.deepEqual(actual.sent.map(m=>m.op),['init']);
 actual.emit({op:'ready'});assert.equal(actual.sent.at(-1).op,'cancel');
 actual.emit({op:'cancelled',id:actual.sent.at(-1).id});
 assert.equal(preparationWorkers().active,1);assert.equal(preparationWorkers().resetting,0);
 b.terminate();actual.emit({op:'cancelled',id:actual.sent.at(-1).id});closeIdlePreparationWorkers();
});

test('actor observations are demand-driven, bounded and never routed as lease work',async()=>{
 const actual=new WorkerStub(),a=createPreparationWorker('observations',()=>actual),events=[];
 a.addEventListener('message',e=>events.push(e.data));a.postMessage({op:'init'});await turn();
 const before=actual.sent.length;preparationWorkers();assert.equal(actual.sent.length,before);
 const pending=preparationWorkers({observe:true});assert.equal(pending.actors[0].available,false);
 assert.equal(actual.sent.at(-1).op,'observe');
 preparationWorkers({observe:true});assert.equal(actual.sent.length,before+1);
 actual.emit({op:'observation',id:0,value:{schema:'bl.runtime.observation.v1',resources:[{kind:'actor'}]}});
 assert.equal(events.length,1);
 const observed=preparationWorkers().actors[0];assert.equal(observed.available,true);assert.ok(observed.ageMs>=0);
 assert.equal(observed.snapshot.resources[0].kind,'actor');
 a.terminate();await turn();closeIdlePreparationWorkers();
 assert.equal(preparationWorkers().actors.length,0);
});

test('final package unload retires a resetting worker after cancellation, preserving an active peer',async()=>{
 const actual=new WorkerStub(),a=createPreparationWorker('unload',()=>actual),b=createPreparationWorker('unload',()=>actual);
 a.postMessage({op:'init'});b.postMessage({op:'init'});await turn();
 a.terminate();closeIdlePreparationWorkers({whenDrained:true});await turn();
 assert.equal(actual.terminated,0);assert.equal(preparationWorkers().active,1);
 b.terminate();closeIdlePreparationWorkers({whenDrained:true});
 assert.equal(actual.terminated,0);await turn();
 assert.equal(actual.terminated,1);assert.equal(preparationWorkers().workers,0);
});
