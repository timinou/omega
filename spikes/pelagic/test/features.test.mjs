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

test('cached feature plans preserve decibel calibration across analyser shapes',()=>{
 for(const fftSize of [512,1024,2048]){
 const fft=Uint8Array.from({length:fftSize/2},(_,i)=>(i*73+19)%256),wave=new Uint8Array(fftSize).fill(128);
 for(let i=0;i<24;i++){
  const sampleRate=22050+i*1000,minDecibels=-110+i,maxDecibels=-25;
  const result=audioFeatures(fft,wave,{sampleRate,fftSize,minDecibels,maxDecibels});
  for(const [key,lo,hi,gain] of [['bass',35,180,22],['mid',250,2500,55],['high',4500,14000,240]]){
   const first=Math.max(1,Math.ceil(lo*fftSize/sampleRate)),last=Math.min(fft.length-1,Math.floor(hi*fftSize/sampleRate));let power=0;
   for(let bin=first;bin<=last;bin++)if(fft[bin]){const amplitude=10**((minDecibels+fft[bin]/255*(maxDecibels-minDecibels))/20);power+=amplitude*amplitude;}
   const expected=Math.min(1,Math.sqrt(power/Math.max(1,last-first+1))*gain);
   assert.ok(Math.abs(result[key]-expected)<1e-12,`${key}: ${result[key]} vs ${expected}`);
  }
 }
 }
});

import {ShaderStage} from '../host/shader.mjs';
test('audio textures preserve normalized spectrum and waveform across FFT window sizes',()=>{
 const stage=Object.create(ShaderStage.prototype),images=[];
 Object.assign(stage,{fft:new Uint8Array(1024),wave:new Uint8Array(2048),audio:new Uint8Array(512*2*4),audioTex:{},gl:{activeTexture(){},bindTexture(){},texSubImage2D(...args){images.push([...args.at(-1)]);}}});
 for(const size of [2048,1024,512,2048]){
  const fft=Uint8Array.from({length:size/2},(_,i)=>Math.floor(i*256/(size/2)));
  const wave=Uint8Array.from({length:size},(_,i)=>Math.floor(i*256/size));
  stage.sampleAudio(null,{fft,wave,features:{volume:.1}});
 }
 for(const image of images.slice(1))assert.deepEqual(image,images[0]);
});
