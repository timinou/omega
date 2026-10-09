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
