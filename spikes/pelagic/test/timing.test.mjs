import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
test('sample timestamps stay associated without message ordering and simultaneous pilots remain silent',()=>{
 let Processor;const messages=[];
 const scope={AudioWorkletProcessor:class{constructor(){this.port={postMessage:x=>messages.push(x)};}},currentFrame:100,sampleRate:1000,registerProcessor:(_name,type)=>Processor=type};
 vm.runInNewContext(readFileSync(new URL('../host/timing-worklet.mjs',import.meta.url),'utf8'),scope);
 const probe=new Processor(),output=new Float32Array([1,1,1]);
 probe.process([[new Float32Array([0,2,0]),new Float32Array([0,.202,0])]],[[output]]);
 assert.equal(messages.length,1);assert.equal(messages[0].actual,.101);assert.ok(Math.abs(messages[0].expected-.101)<1e-7);assert.deepEqual([...output],[0,0,0]);
 scope.currentFrame=5000;
 probe.process([[new Float32Array([1]),new Float32Array([5])]],[[output]]);
 assert.equal(messages[1].expected,5);assert.equal(messages[1].actual,5);
 // There is no pending expectation from an omitted/cancelled pilot.
 assert.equal(probe.expected,undefined);
});

import {voiceLifetime} from '../host/audio.mjs';
test('percussion voices stop after their envelope while ADSR retains its gate and release',()=>{
 const perc={ugen:'env-gen',envelope:{envelope:'perc',attack:.01,release:{ugen:'param',key:'dur',default:2}}};
 assert.equal(voiceLifetime(perc,{dur:2}),2.09);
 const adsr={ugen:'env-gen',envelope:{envelope:'adsr',attack:.1,decay:.2,sustain:.7,release:{ugen:'param',key:'tail',default:.4}}};
 assert.equal(voiceLifetime(adsr,{dur:2,tail:.8}),2.88);
 assert.equal(voiceLifetime({ugen:'sin-osc',freq:440},{dur:1}),1.08);
});

test('native audio clocks bypass the UI, stay bounded and release each graphics subscriber',()=>{
 let Processor;const pilots=[],packets=[],closed=[];
 const scope={AudioWorkletProcessor:class{constructor(){this.port={postMessage:x=>pilots.push(x)};}},currentFrame:4800,sampleRate:48000,registerProcessor:(_name,type)=>Processor=type};
 vm.runInNewContext(readFileSync(new URL('../host/timing-worklet.mjs',import.meta.url),'utf8'),scope);
 const probe=new Processor(),ports=[];
 for(let id=0;id<9;id++){const port={postMessage:x=>packets.push({id,...x}),close:()=>closed.push(id)};ports.push(port);probe.port.onmessage({data:{op:'clock',id,port}});}
 assert.deepEqual(closed,[8]);probe.process([],[]);assert.equal(packets.length,8);assert.equal(pilots.length,0);
 assert.ok(packets.every(x=>x.time===.1&&x.sampleRate===48000));
 probe.port.onmessage({data:{op:'unclock',id:3}});assert.deepEqual(closed,[8,3]);
 scope.currentFrame=9600;packets.length=0;probe.process([],[]);assert.equal(packets.length,0);
 for(const port of ports.slice(0,8))port.onmessage();probe.process([],[]);assert.equal(packets.length,7);assert.ok(packets.every(x=>x.id!==3&&x.time===.2));
});

import {AudioEngine} from '../host/audio.mjs';
test('replacing reserved audio stops future sources immediately and retires bounded native batches',()=>{
 const engine=Object.create(AudioEngine.prototype);let stopped=0,disconnected=0;
 const nodes=Array.from({length:80},()=>({disconnect(){disconnected++;}}));
 const source={onended(){},stop(){stopped++;}};
 Object.assign(engine,{voices:new Map([[1,{start:5,sources:[source],owned:nodes}],[2,{start:1,sources:[],owned:[]}]]),intents:[{time:1},{time:5}],retiredNodes:[],retireTimer:null});
 engine.cancelFrom(3);assert.equal(stopped,1);assert.equal(source.onended,null);assert.equal(disconnected,0);assert.equal(engine.voices.has(1),false);assert.equal(engine.voices.has(2),true);assert.deepEqual(engine.intents,[{time:1}]);
 engine.drainRetired();assert.equal(disconnected,32);assert.equal(engine.retiredNodes.length,48);
 engine.drainRetired(true);assert.equal(disconnected,80);assert.equal(engine.retireTimer,null);assert.equal(engine.retiredNodes.length,0);
});
