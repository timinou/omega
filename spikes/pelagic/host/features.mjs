// Actual mixed-audio features, shared by live and offline ShaderStage draws.
// No score/transport input: silent audio must produce zero motion energy.
// Stable analyser shapes share a bounded byte->power lookup, keeping logarithms
// out of the frame loop without changing frequency or decibel semantics.
const plans=new Map();
function featurePlan(sampleRate,fftSize,minDecibels,maxDecibels,length){
  const key=[sampleRate,fftSize,minDecibels,maxDecibels,length].join(':');
  if(plans.has(key))return plans.get(key);
  const power=new Float64Array(256);
  for(let i=1;i<256;i++){const amplitude=10**((minDecibels+i/255*(maxDecibels-minDecibels))/20);power[i]=amplitude*amplitude;}
  const bands=[[35,180,22],[250,2500,55],[4500,14000,240]].map(([lo,hi,gain])=>[
    Math.max(1,Math.ceil(lo*fftSize/sampleRate)),Math.min(length-1,Math.floor(hi*fftSize/sampleRate)),gain]);
  const plan={power,bands};if(plans.size===16)plans.delete(plans.keys().next().value);plans.set(key,plan);return plan;
}
export function waveformRms(wave){let sum=0;for(let i=0;i<wave.length;i++){const x=(wave[i]-128)/128;sum+=x*x;}return Math.sqrt(sum/wave.length);}
export function audioFeatures(fft, wave, {sampleRate=44100, fftSize=2048,
  minDecibels=-100, maxDecibels=-30}={}) {
  const plan=featurePlan(sampleRate,fftSize,minDecibels,maxDecibels,fft.length);
  const band=([first,last,gain])=>{
    let power=0;for(let i=first;i<=last;i++)power+=plan.power[fft[i]];
    return Math.min(1,Math.sqrt(power/Math.max(1,last-first+1))*gain);
  };
  let sum=0,recent=0,older=0;
  for(let i=0;i<wave.length;i++) {
    const x=(wave[i]-128)/128,p=x*x;sum+=p;
    if(i>=wave.length*3/4)recent+=p;
    if(i<wave.length/2)older+=p;
  }
  const rms=Math.sqrt(sum/wave.length);
  const onset=Math.max(0,Math.sqrt(recent/(wave.length/4))-Math.sqrt(older/(wave.length/2)));
  return {bass:band(plan.bands[0]),mid:band(plan.bands[1]),high:band(plan.bands[2]),
    onset:Math.min(1,onset*12),volume:rms};
}
