// Actual mixed-audio features, shared by live and offline ShaderStage draws.
// No score/transport input: silent audio must produce zero motion energy.
export function audioFeatures(fft, wave, {sampleRate=44100, fftSize=2048,
  minDecibels=-100, maxDecibels=-30}={}) {
  const band=(lo,hi,gain)=>{
    const first=Math.max(1,Math.ceil(lo*fftSize/sampleRate));
    const last=Math.min(fft.length-1,Math.floor(hi*fftSize/sampleRate));
    let power=0;
    for(let i=first;i<=last;i++) {
      if(!fft[i])continue;
      const amplitude=10**((minDecibels+fft[i]/255*(maxDecibels-minDecibels))/20);
      power+=amplitude*amplitude;
    }
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
  return {bass:band(35,180,22),mid:band(250,2500,55),high:band(4500,14000,240),
    onset:Math.min(1,onset*12),volume:rms};
}
