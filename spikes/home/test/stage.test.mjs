// Exercise ownership while the native graphics capability probe is pending.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const {createStage}=await import(pathToFileURL(path.join(process.env.HOME_FRONTEND,'pkg/pelagic/render-stage.mjs')));
class Worker extends EventTarget {
 static last;
 constructor(){super();Worker.last=this;this.stopped=false;}
 terminate(){this.stopped=true;}
}
globalThis.Worker=Worker;
function canvas(){return {transferControlToOffscreen(){throw Error('visible canvas must remain owned');},getContext(){throw Error('main renderer selected');}};}
test('unload cancels capability probing and terminates its worker',async()=>{
 const controller=new AbortController(),stage=createStage(canvas(),{signal:controller.signal});
 const worker=Worker.last;controller.abort();
 await assert.rejects(stage,{name:'AbortError'});assert.equal(worker.stopped,true);
});
test('unsupported worker GL falls back before transferring the visible canvas',async()=>{
 const stage=createStage(canvas()),worker=Worker.last;
 worker.dispatchEvent(new MessageEvent('message',{data:{op:'capabilities',webgl:false}}));
 await assert.rejects(stage,/main renderer selected/);assert.equal(worker.stopped,true);
});
test('worker boot failure preserves the canvas for the existing main renderer',async()=>{
 const stage=createStage(canvas()),worker=Worker.last;worker.dispatchEvent(new Event('error'));
 await assert.rejects(stage,/main renderer selected/);assert.equal(worker.stopped,true);
});
test('cancellation between capability response and continuation releases the worker',async()=>{
 const controller=new AbortController(),stage=createStage(canvas(),{signal:controller.signal}),worker=Worker.last;
 worker.dispatchEvent(new MessageEvent('message',{data:{op:'capabilities',webgl:true}}));controller.abort();
 await assert.rejects(stage,{name:'AbortError'});assert.equal(worker.stopped,true);
});
