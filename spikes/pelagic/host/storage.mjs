// Bounded browser IO. Session revisions contain hashes, not embedded audio.
export class LocalStore {
  constructor(){this.pending=0;this.db=null;this.closed=false;this.opening=null;}
  async open(){
    if(this.closed)throw new Error('Storage closed');if(this.db)return this.db;if(this.opening)return this.opening;
    return this.opening=new Promise((resolve,reject)=>{const request=indexedDB.open('omega-pelagic',1);
      request.onupgradeneeded=()=>{for(const name of ['assets','chunks','takes'])request.result.createObjectStore(name);};
      request.onsuccess=()=>{if(this.closed){request.result.close();reject(new Error('Storage closed'));return;}this.db=request.result;resolve(this.db);};request.onerror=()=>reject(request.error);});
  }
  async op(store,mode,run){
    const db=await this.open();if(this.closed)throw new Error('Storage closed');this.pending++;
    try{return await new Promise((resolve,reject)=>{const transaction=db.transaction(store,mode),request=run(transaction.objectStore(store));
      transaction.oncomplete=()=>resolve(request?.result);transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error||new Error('Storage transaction aborted'));});}
    finally{this.pending--;}
  }
  put(store,key,value){return this.op(store,'readwrite',s=>s.put(value,key));}
  get(store,key){return this.op(store,'readonly',s=>s.get(key));}
  remove(store,key){return this.op(store,'readwrite',s=>s.delete(key));}
  async asset(file){const data=await file.arrayBuffer();const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(x=>x.toString(16).padStart(2,'0')).join('');await this.put('assets',hash,file);return hash;}
  close(){this.closed=true;this.db?.close();this.db=null;}
}
export class LiveTake {
  constructor(store,stream,options={}){
    this.store=store;this.stream=stream;this.id=crypto.randomUUID();this.count=0;this.bytes=0;this.storedCount=0;this.storedBytes=0;this.pendingBytes=0;this.error=null;
    const mime=['video/webm;codecs=vp8,opus','video/webm;codecs=vp9,opus','video/webm'].find(x=>MediaRecorder.isTypeSupported(x));
    this.mime=mime;this.recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:options.bitRate||1200000,audioBitsPerSecond:128000});
    this.writes=Promise.resolve();this.started=performance.now();this.stopped=null;
    this.recorder.ondataavailable=event=>{
      if(!event.data.size||this.error)return;const index=this.count++,blob=event.data;this.bytes+=blob.size;this.pendingBytes+=blob.size;
      // Never grow an unbounded RAM queue when storage is slow or full.
      if(this.pendingBytes>16*1024*1024){this.pendingBytes-=blob.size;this.fail(new Error('Recording storage backlog exceeded 16 MB'));return;}
      this.writes=this.writes.then(async()=>{
        if(this.error)return;
        await this.store.put('chunks',this.id+':'+index,blob);this.storedCount++;this.storedBytes+=blob.size;
        await this.store.put('takes',this.id,this.checkpoint(false));
      }).catch(e=>this.fail(e)).finally(()=>{this.pendingBytes-=blob.size;});
    };
    this.recorder.onerror=event=>this.fail(event.error||new Error('MediaRecorder failed'));
  }
  fail(error){this.error=error;if(this.recorder.state!=='inactive')this.recorder.stop();}
  checkpoint(complete){return {id:this.id,chunks:this.storedCount,bytes:this.storedBytes,mime:this.mime,duration:(performance.now()-this.started)/1000,complete,error:this.error?.message||null};}
  start(){
    // The pointer precedes large writes; a crash still exposes committed chunks.
    this.writes=this.store.put('takes',this.id,this.checkpoint(false)).then(()=>this.store.put('takes','latest',this.id)).catch(e=>this.fail(e));
    this.recorder.start(2000);return this;
  }
  async stop(){
    if(this.stopped)return this.stopped;
    return this.stopped=(async()=>{
      if(this.recorder.state!=='inactive')await new Promise(resolve=>{this.recorder.onstop=resolve;this.recorder.stop();});
      await this.writes;this.stream.getTracks().forEach(t=>t.stop());
      const info=this.info=this.checkpoint(!this.error);
      try{await this.store.put('takes',this.id,info);}catch(e){this.error||=e;info.complete=false;info.error=this.error.message;}
      if(this.error)throw this.error;return info;
    })();
  }
  async blob({allowPartial=false}={}){try{await this.stop();}catch(e){if(!allowPartial)throw e;}if(!this.storedCount)throw new Error('No recording chunks stored yet');const chunks=[];for(let i=0;i<this.storedCount;i++){const chunk=await this.store.get('chunks',this.id+':'+i);if(!chunk)throw new Error('Missing recording chunk '+i);chunks.push(chunk);}return new Blob(chunks,{type:this.mime});}
  async exportTo(writable){await this.stop();for(let i=0;i<this.storedCount;i++){const chunk=await this.store.get('chunks',this.id+':'+i);if(!chunk)throw new Error('Missing recording chunk '+i);await writable.write(chunk);}await writable.close();}
}
export function validateSession(value){
  if(!value||value.schema!=='omega.pelagic'||value.version!==1)throw new Error('Unsupported PELAGIC session version');
  if(!value.state?.config||!value.state.patterns||!value.state.visual||!value.state.scenes||!value.state.variation)throw new Error('Incomplete session');
  if(JSON.stringify(value).length>2*1024*1024)throw new Error('Session exceeds 2 MB');
  if(Object.keys(value.snapshots||{}).length>16)throw new Error('Snapshot limit exceeded');
  for(const asset of value.assets||[])if(!['a','b'].includes(asset.deck)||!/^[a-f0-9]{64}$/.test(asset.hash)||!Number.isFinite(asset.bpm)||asset.bpm<40||asset.bpm>240)throw new Error('Invalid audio reference');
  return value;
}
