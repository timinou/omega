// Realm adapter. Both schedulers invoke the SAME compiled BL score kernel.
let prepareChunk,prebuilt;
let actor=null,job=0,start=0,closed=false,mode='worker';
function chunk(id,offset,count){
 const before=performance.now(),rows=prebuilt?prebuilt.slice(offset,offset+count):prepareChunk(offset,count);
 self.postMessage({op:'chunk',id,start:offset,rows,workMs:performance.now()-before});
}
function advance(){if(start>=1024){self.postMessage({op:'done',id:job});return;}chunk(job,start,Math.min(16,1024-start));start+=16;}
function input(topic,id){actor.enqueueData(topic,id);}
self.addEventListener('message',({data})=>{
 if(closed)return;
 try{
  if(data.op==='init'){
   mode=data.mode;
   if(mode==='prebuilt')fetch(new URL('score-cache.json',import.meta.url)).then(response=>{
    if(!response.ok)throw new Error('Prepared score unavailable');return response.json();
   }).then(value=>{
    if(value.schema!=='pelagic.score.v1'||value.steps?.length!==1024||!value.steps.every(row=>Array.isArray(row)&&row.length<=64))throw new Error('Invalid prepared score');
    prebuilt=value.steps;self.postMessage({op:'ready'});
   }).catch(fail);
   else import('./values.mjs').then(B=>{
    prepareChunk=B.prepareChunk;
    if(mode==='actor')return import('./actor/host.mjs').then(H=>{
     actor=H;H.setEmitter((op,value)=>{
      if(op==='chunk'){const [id,offset,count]=H.vecItems(value);chunk(id,offset,count);}
      else self.postMessage({op,id:value});
     });
     import('./actor/out/prepare.mjs').catch(fail);
    });
    self.postMessage({op:'ready'});
   }).catch(fail);
  }else if(data.op==='prepare'){job=data.id;start=0;mode==='actor'?input('prepare',job):advance();}
  else if(data.op==='credit'&&data.id===job){mode==='actor'?input('credit',job):advance();}
  else if(data.op==='ping'){mode==='actor'?input('ping',data.id):self.postMessage({op:'pong',id:data.id});}
  else if(data.op==='cancel'){job=0;mode==='actor'?input('cancel',data.id):self.postMessage({op:'cancelled',id:data.id});}
 }catch(error){fail(error);}
});
function fail(error){closed=true;self.postMessage({op:'error',error:error.message||String(error)});}
