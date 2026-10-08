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
