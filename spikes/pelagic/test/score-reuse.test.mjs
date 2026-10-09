import {hostImport} from './host-runtime.mjs';
import {test} from 'node:test';import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';
const {scoreDecoder}=await hostImport('score-wire.mjs');
const out=resolve(process.env.PELAGIC_OUT||new URL('../dist/local/out',import.meta.url).pathname);
const Score=await import(pathToFileURL(resolve(out,'pelagic.score.mjs')));
const Browser=await import(pathToFileURL(resolve(out,'pelagic.browser.mjs')));
const J=await import(pathToFileURL(resolve(out,'interop.mjs')));
test('all 1024 packed steps equal canonical score output; only seven templates cross the boundary',()=>{
 const context=Browser.d_preparation_context(),decoder=scoreDecoder();let nativeGraphs=0;
 for(let start=0;start<1024;start+=16){
  const packet=Browser.d_score_slice(context,start,16,0);nativeGraphs+=packet.graphs.length;
  const rows=decoder.decode(structuredClone(packet));
  for(let i=0;i<rows.length;i++)assert.deepEqual(rows[i],J.blToJS(Score.d_step(start+i,Score.d_defaults)));
 }
 assert.equal(nativeGraphs,7);assert.equal(decoder.size,7);
 const replacement=Browser.d_preparation_context();assert.equal(Browser.d_score_slice(replacement,0,1,0).graphs[0].id,0);
});
