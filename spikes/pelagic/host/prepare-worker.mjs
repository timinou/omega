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
    if(!['pelagic.score.v1','pelagic.score.v2'].includes(value.schema)||value.steps?.length!==1024||!value.steps.every(row=>Array.isArray(row)&&row.length<=64))throw new Error('Invalid prepared score');
    if(value.schema==='pelagic.score.v2'){
     if(!Array.isArray(value.graphs)||value.graphs.length>64)throw new Error('Invalid prepared graph catalog');
     for(const row of value.steps)for(const voice of row){if(!Number.isInteger(voice.graph)||voice.graph<0||voice.graph>=value.graphs.length)throw new Error('Invalid prepared graph reference');voice.graph=value.graphs[voice.graph];}
    }
    prebuilt=value.steps;self.postMessage({op:'ready'});
   }).catch(fail);
   else import('./values.mjs').then(B=>{
    prepareChunk=B.prepareChunk;
    if(mode==='actor'||mode==='actor-bridge')return import('./actor/host.mjs').then(H=>{
     actor=H;if(mode==='actor-bridge')H.setEmitter((op,value)=>{
      if(op==='chunk'){const [id,offset,count]=H.vecItems(value);chunk(id,offset,count);}
      else self.postMessage({op,id:value});
     });
     import(mode==='actor'?'./actor/out/prepare.mjs':'./actor/out/prepare-bridge.mjs').catch(fail);
    });
    self.postMessage({op:'ready'});
   }).catch(fail);
  }else if(data.op==='prepare'){job=data.id;start=0;actor?input('prepare',job):advance();}
  else if(data.op==='credit'&&data.id===job){actor?input('credit',job):advance();}
  else if(data.op==='ping'){actor?input('ping',data.id):self.postMessage({op:'pong',id:data.id});}
  else if(data.op==='cancel'){job=0;actor?input('cancel',data.id):self.postMessage({op:'cancelled',id:data.id});}
 }catch(error){fail(error);}
});
function fail(error){closed=true;self.postMessage({op:'error',error:error.message||String(error)});}
