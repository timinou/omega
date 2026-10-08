// Inspect the delivered PCM WAV: timing, dynamic development and clipping.
import fs from 'node:fs';
const proof=new URL('../proof/club/',import.meta.url),file=new URL('pelagic.wav',proof),a=fs.readFileSync(file);
if(a.toString('ascii',0,4)!=='RIFF'||a.readUInt16LE(20)!==1||a.readUInt16LE(34)!==16)throw new Error('Expected exported PCM16 WAV');
const rate=a.readUInt32LE(24),channels=a.readUInt16LE(22),frames=(a.length-44)/(channels*2);
const act=64*60/122,bounds=[0,act,act*2,act*3,act*4],names=['Bathymetry','Current','Cathedral','Afterglow'];
const stats=names.map(()=>({sum:0,peak:0,n:0}));let clipped=0;
for(let i=0;i<frames;i++)for(let ch=0;ch<channels;ch++){
 const x=a.readInt16LE(44+(i*channels+ch)*2)/32768;if(Math.abs(x)>=.9999)clipped++;
 const t=i/rate,k=Math.min(3,Math.floor(t/act)),s=stats[k];s.sum+=x*x;s.peak=Math.max(s.peak,Math.abs(x));s.n++;
}
const report={sampleRate:rate,channels,duration:frames/rate,clippedSamples:clipped,
 movements:stats.map((s,i)=>({name:names[i],startSeconds:bounds[i],endSeconds:i===3?frames/rate:bounds[i+1],rmsDBFS:20*Math.log10(Math.sqrt(s.sum/s.n)),peakDBFS:20*Math.log10(s.peak)}))};
if(clipped)throw new Error('Export has clipped PCM samples');
fs.writeFileSync(new URL('audio.json',proof),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
