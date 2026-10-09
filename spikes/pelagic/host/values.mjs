// Compatibility boundary for Omega's older compiler. The optional local build
// replaces this module with compiled pelagic.browser, using bl->js / js->bl.
export function plain(x) {
  if (x?.constructor?.name === "Flt") return x.v;
  if (x?.entries && x.constructor?.name === 'HMap') {
    return Object.fromEntries([...x.entries()].map(([k,v]) => [k.fq ?? String(k), plain(v)]));
  }
  if (x?.toArray) return x.toArray().map(plain);
  if (x?.fq) return x.fq;
  return x;
}
export function conversions(R) { const toBL=x=>Array.isArray(x)?R.vecFromArray(x.map(toBL)):x&&typeof x==='object'?R.hashMap(...Object.entries(x).flatMap(([k,v])=>[R.kw(k),toBL(v)])):x; return toBL; }
export function download(data,name,type){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([data],{type}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function setText(node,value){const text=String(value);if(node.textContent!==text)node.textContent=text;}
export function audioContext(){return new AudioContext({latencyHint:'interactive'});}
export async function readText(url){const response=await fetch(url);if(!response.ok)throw new Error('Cannot load '+url);return response.text();}

// The old compiler keeps its existing in-page evaluator.
export function createEvaluator(){return null;}
export function afterPaint(fn){return new Promise((resolve,reject)=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(()=>{try{resolve(fn());}catch(e){reject(e);}},0))));}

export function createGraphicsWorker(){return null;}
export function projectClock(time,beat,bpm,running,stamp,now){const elapsed=running?Math.max(0,now-stamp)/1000:0;return {time:time+elapsed,beat:beat+elapsed*bpm/60};}
export function renderScale(scale,interval,work){return interval>24||work>12?Math.max(.25,scale*.85):interval<18&&work<6?Math.min(1,scale*1.02):scale;}

export function createScoreSource(step,defaults){const cache=new Map();return index=>{if(!cache.has(index)){if(cache.size>=1024)cache.delete(cache.keys().next().value);cache.set(index,plain(step(index,defaults)));}return cache.get(index);};}

export function audibleTime(context,now){const stamp=context.getOutputTimestamp?.(),age=stamp?now-stamp.performanceTime:-1;return stamp?.contextTime>0&&age>=0&&age<1000?Math.min(context.currentTime,stamp.contextTime+age/1000):context.currentTime;}

export const requestFrame=f=>requestAnimationFrame(f),cancelFrame=handle=>cancelAnimationFrame(handle);

export const continuePreparation=(next,audio,elapsed)=>next<audio+1||elapsed<4;
