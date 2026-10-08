// Deterministic FFT of the rendered soundtrack for offline audiovisual proof.
// The same two texture rows as the live Web Audio AnalyserNode backend.
export function soundtrackAnalysis(buffer,time) {
  const n=2048,re=new Float64Array(n),im=new Float64Array(n),samples=new Float32Array(n);
  const channels=Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i));
  const start=Math.floor(time*buffer.sampleRate)-n;
  for(let i=0;i<n;i++) {
    let x=0;for(const a of channels)x+=(a[start+i]||0)/channels.length;
    samples[i]=x;re[i]=x*(.5-.5*Math.cos(2*Math.PI*i/(n-1)));
  }
  for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){[re[i],re[j]]=[re[j],re[i]];}}
  for(let size=2;size<=n;size<<=1){const half=size>>1,angle=-2*Math.PI/size;
    for(let at=0;at<n;at+=size)for(let j=0;j<half;j++){
      const c=Math.cos(angle*j),s=Math.sin(angle*j),a=at+j,b=a+half;
      const xr=re[b]*c-im[b]*s,xi=re[b]*s+im[b]*c;
      re[b]=re[a]-xr;im[b]=im[a]-xi;re[a]+=xr;im[a]+=xi;
    }
  }
  return {sampleRate:buffer.sampleRate,fftSize:n,minDecibels:-100,maxDecibels:-30,
    getByteTimeDomainData(out){for(let i=0;i<out.length;i++)out[i]=Math.max(0,Math.min(255,Math.round(128+samples[i%n]*128)));},
    getByteFrequencyData(out){for(let i=0;i<out.length;i++){const mag=Math.hypot(re[i],im[i])/n,db=20*Math.log10(Math.max(1e-8,mag));out[i]=Math.max(0,Math.min(255,Math.round((db+100)/70*255)));}}};
}
