import {test} from 'node:test';import assert from 'node:assert/strict';import {imp} from './paths.mjs';
const [R,S,P,B,J]=await Promise.all(['rt','pelagic.score','pelagic.playback-js','pelagic.browser','interop'].map(imp));
const source=B.d_score_source(S.d_step,S.d_defaults);
test('native playback and export retain the canonical score timing and stem filtering',()=>{
 for(const muted of ['kick','bass','hat','snare','melody']){
  const config=S.d_defaults.assoc(R.kw(muted),false),state={config:J.blToJS(config),patterns:{},variation:{density:1,seed:37,transpose:0}};
  const timeline=J.blToJS(S.d_timeline(config));
  for(const i of [0,64,130,255,448,640,766,896,1023]){
   const projected=P.d_voices(state,i,0,source(i),{a:false,b:false});
   assert.deepEqual(projected.map(({voice:{stem,...voice}})=>voice),timeline[i].voices);
   for(const item of projected)assert.ok(Math.abs((i+item.offset)*60/state.config.bpm/4-timeline[i].time/1000)<1e-10);
  }
 }
});
test('patterns suppress default lanes, preserve fractional offsets, and seeded selection is stable',()=>{
 const base=source(130),voice=base.find(x=>x.synth==='bass');assert.ok(voice);
 const state={config:J.blToJS(S.d_defaults),variation:{density:1,seed:81,transpose:12},patterns:{bass:{stem:'bass',beats:4,units:'beats',plan:{bundles:[{time:.625,voices:[voice]}]}}}};
 const result=P.d_voices(state,130,0,base,{a:true,b:false});
 const bass=result.filter(x=>x.voice.stem==='bass');assert.equal(bass.length,1);assert.equal(bass[0].offset,.5);assert.equal(bass[0].voice.params.freq,voice.params.freq*2);
 state.variation.density=.5;assert.deepEqual(P.d_voices(state,130,0,base,{}),P.d_voices(state,130,0,base,{}));
});
