import {test} from 'node:test';
import assert from 'node:assert/strict';
import {audioFeatures} from '../host/features.mjs';
import {soundtrackAnalysis} from '../host/analysis.mjs';
function analyse(freq,amplitude=.1,sampleRate=44100){
  const data=Float32Array.from({length:4096},(_,i)=>Math.sin(i/sampleRate*2*Math.PI*freq)*amplitude);
  const analyser=soundtrackAnalysis({sampleRate,numberOfChannels:1,getChannelData:()=>data},4096/sampleRate);
  const fft=new Uint8Array(1024),wave=new Uint8Array(2048);
  analyser.getByteFrequencyData(fft);analyser.getByteTimeDomainData(wave);
  return audioFeatures(fft,wave,analyser);
}
test('silent soundtrack has zero visual energy; bass, mids and hats drive separate bands',()=>{
  assert.deepEqual(analyse(70,0),{bass:0,mid:0,high:0,onset:0,volume:0});
  for(const [frequency,band] of [[70,'bass'],[1000,'mid'],[8000,'high']]){
    const result=analyse(frequency);
    assert.ok(result[band]>.1,JSON.stringify(result));
    for(const other of ['bass','mid','high'].filter(x=>x!==band))assert.ok(result[other]<result[band]*.1);
  }
});
test('frequency mapping follows the sample rate rather than hardcoded texture coordinates',()=>{
  for(const rate of [22050,44100,48000]){
    const f=analyse(100,.04,rate);
    assert.ok(f.bass>.05);
    assert.ok(f.bass>10*Math.max(f.mid,f.high));
  }
});
test('transients respond to an actual amplitude attack, not a beat clock',()=>{
  const fft=new Uint8Array(1024),wave=new Uint8Array(2048).fill(128);
  wave.fill(160,1536);
  assert.equal(audioFeatures(fft,wave).onset,1);
  wave.fill(160);
  assert.equal(audioFeatures(fft,wave).onset,0);
});
