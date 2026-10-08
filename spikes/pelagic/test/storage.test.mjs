import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LiveTake,validateSession} from '../host/storage.mjs';
class Recorder {
 static isTypeSupported(){return true;}
 constructor(){this.state='inactive';}
 start(){this.state='recording';}
 stop(){this.state='inactive';queueMicrotask(()=>this.onstop?.());}
 emit(blob){this.ondataavailable({data:blob});}
}
globalThis.MediaRecorder=Recorder;
const stream=()=>({stopped:false,getTracks(){return [{stop:()=>this.stopped=true}];}});
test('live recording stores ordered chunks incrementally and exports identical bytes',async()=>{
 const rows=new Map(),store={put:async(s,k,v)=>rows.set(s+':'+k,v),get:async(s,k)=>rows.get(s+':'+k)};
 const source=stream(),take=new LiveTake(store,source).start();
 take.recorder.emit(new Blob(['abc']));take.recorder.emit(new Blob(['def']));
 const info=await take.stop();assert.equal(info.chunks,2);assert.equal(info.bytes,6);assert.equal(take.pendingBytes,0);assert.ok(source.stopped);
 assert.equal(await (await take.blob()).text(),'abcdef');
 let output='';await take.exportTo({write:async b=>{output+=await b.text();},close:async()=>{}});assert.equal(output,'abcdef');
 rows.delete('chunks:'+take.id+':0');await assert.rejects(take.blob(),/Missing recording chunk/);
});
test('storage failure stops capture, releases tracks and marks the take incomplete',async()=>{
 const source=stream(),take=new LiveTake({put:async(s)=>{if(s==='chunks')throw new Error('quota exceeded');}},source).start();
 take.recorder.emit(new Blob(['sound']));await assert.rejects(take.stop(),/quota exceeded/);assert.ok(source.stopped);assert.equal(take.recorder.state,'inactive');
});
test('session schema rejects unsupported versions, missing state and malformed assets',()=>{
 const value={schema:'omega.pelagic',version:1,state:{config:{},patterns:{},visual:{},scenes:{},variation:{}},assets:[]};
 assert.equal(validateSession(value),value);
 assert.throws(()=>validateSession({...value,version:2}),/version/);
 assert.throws(()=>validateSession({...value,state:{}}),/Incomplete/);
 assert.throws(()=>validateSession({...value,assets:[{deck:'a',hash:'bad',bpm:120}]}),/reference/);
});
