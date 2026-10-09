// Local documents are separate from PELAGIC's existing session/audio store.
// All revision checks and writes happen in one IndexedDB transaction.
export async function localDocuments(seeds, {name='pelagic-documents-v1', indexedDB=globalThis.indexedDB}={}) {
  const db=await new Promise((resolve,reject)=>{
    const request=indexedDB.open(name,1);
    request.onupgradeneeded=()=>{request.result.createObjectStore('documents',{keyPath:'path'});};
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
  const missing=path=>({ok:false,message:'No local document: '+path});
  const seed=path=>Object.hasOwn(seeds,path)?{ok:true,path,text:seeds[path],rev:'seed',title:path}:missing(path);
  return {
    initialPath:'live-set.bl.org', eagerLanguage:false, packages:['pelagic'], layout:'pelagic',
    read(path,signal) {
      signal?.throwIfAborted();
      return new Promise((resolve,reject)=>{
        const request=db.transaction('documents').objectStore('documents').get(path);
        request.onsuccess=()=>{try{signal?.throwIfAborted();resolve(request.result?{ok:true,...request.result}:seed(path));}catch(e){reject(e);}};
        request.onerror=()=>reject(request.error);
      });
    },
    save({path,text,base}) {
      if(typeof path!=='string'||!path||typeof text!=='string'||text.length>2_000_000)
        return Promise.resolve({ok:false,message:'Invalid local document (limit 2 MB)'});
      return new Promise((resolve,reject)=>{
        const tx=db.transaction('documents','readwrite'),store=tx.objectStore('documents');
        let result;const request=store.get(path);
        request.onsuccess=()=>{
          const old=request.result||seed(path),rev=old.ok===false?null:old.rev;
          if(base!==rev){result={ok:false,conflict:true,rev,text:old.text,message:'Local revision changed; reload before saving'};return;}
          const next={path,text,rev:crypto.randomUUID(),history:[...(old.history||[]),...(rev?[{rev,text:old.text}]:[])].slice(-32)};
          store.put(next);result={ok:true,rev:next.rev,message:'Saved locally'};
        };
        tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(tx.error||new Error('Local save aborted'));tx.onerror=()=>{};
      });
    },
    close(){db.close();},
  };
}
