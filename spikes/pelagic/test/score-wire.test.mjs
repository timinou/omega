import {hostImport} from './host-runtime.mjs';
import {test} from 'node:test';import assert from 'node:assert/strict';
const {scoreDecoder}=await hostImport('score-wire.mjs');
const graph=()=>({ugen:'sin-osc',freq:{ugen:'param',key:'freq',default:440}});
test('graph catalogs preserve shared identity across chunks and own immutable templates',()=>{
 const decoder=scoreDecoder();
 const first=decoder.decode({graphs:[{id:0,graph:graph()}],rows:[[{graph:0,params:{freq:220}},{graph:0,params:{freq:330}}]]});
 const second=decoder.decode({graphs:[],rows:[[{graph:0}]]});
 assert.equal(first[0][0].graph,first[0][1].graph);assert.equal(first[0][0].graph,second[0][0].graph);
 assert.ok(Object.isFrozen(first[0][0].graph.freq));assert.equal(decoder.size,1);
 assert.throws(()=>{first[0][0].graph.freq.default=123;},TypeError);
});
test('invalid catalogs and references fail atomically; a replacement owns a fresh catalog',()=>{
 const decoder=scoreDecoder();
 for(const packet of [
  {graphs:[{id:1,graph:graph()}],rows:[]},
  {graphs:[{id:0,graph:graph()}],rows:[[{graph:1}]]},
  {graphs:[{id:0,graph:{ugen:'unknown'}}],rows:[]},
  {graphs:[],rows:[[{graph:-1}]]},
  {graphs:[],rows:[[{graph:0.5}]]}
 ]){assert.throws(()=>decoder.decode(packet));assert.equal(decoder.size,0);}
 decoder.decode({graphs:[{id:0,graph:graph()}],rows:[]});
 const replacement=scoreDecoder();replacement.decode({graphs:[{id:0,graph:graph()}],rows:[]});assert.equal(replacement.size,1);
});
