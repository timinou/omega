// Resource ownership only: one worker, one demanded chunk, finite score cache.
// Actors manage the prototype's demand in BL; the native alternative uses the
// same credit protocol and kernel to make the scheduling comparison meaningful.
export function prepareScore(base,createWorker,{mode='prebuilt',delay=4,onError=()=>{}}={}){
 const cache=new Map(),samples=[];let worker=null,closed=false,done=false,started=0,readyAt=0,timer=0,credit=0,rows=0;
 const state={mode,ready:false,done:false,rows:0,workMs:0,chunkMaxMs:0,error:null};
 const fail=error=>{state.error=error.message||String(error);dispose();onError(error);};
 function guard(){clearTimeout(timer);timer=setTimeout(()=>fail(new Error('Score preparation timed out')),15000);}
 function dispose(){if(closed)return;closed=true;clearTimeout(timer);clearTimeout(credit);worker?.terminate();worker=null;cache.clear();state.closed=true;}
 const source=index=>cache.has(index)?cache.get(index):base(index);
 source.dispose=dispose;
 source.stats=()=>({...state,worker:!!worker,rows,elapsedMs:done?state.elapsedMs:started?performance.now()-started:0,startupMs:readyAt?readyAt-started:null,chunkP95Ms:samples.length?samples.slice().sort((a,b)=>a-b)[Math.floor((samples.length-1)*.95)]:null});
 source.start=()=>{
  if(closed||worker||done||mode==='none')return;
  started=performance.now();
  try{worker=createWorker();if(!worker){state.mode='none';return;}
   worker.addEventListener('error',event=>fail(new Error(event.message||'Preparation worker failed')));
   worker.addEventListener('messageerror',()=>fail(new Error('Preparation message could not be decoded')));
   worker.addEventListener('message',({data})=>{
    if(closed)return;
    if(data.op==='error'){fail(new Error(data.error));return;}
    if(data.op==='ready'){readyAt=performance.now();state.ready=true;worker.postMessage({op:'prepare',id:1});guard();}
    else if(data.op==='chunk'){
     if(data.id!==1||data.start!==rows||!Array.isArray(data.rows)||!data.rows.length||data.rows.length>16||rows+data.rows.length>1024){fail(new Error('Invalid preparation chunk'));return;}
     for(const row of data.rows)cache.set(rows++,row);
     samples.push(data.workMs);state.workMs+=data.workMs;state.chunkMaxMs=Math.max(state.chunkMaxMs,data.workMs);
     guard();credit=setTimeout(()=>{if(!closed)worker.postMessage({op:'credit',id:1});},delay);
    }else if(data.op==='done'&&data.id===1){done=true;state.done=true;state.elapsedMs=performance.now()-started;clearTimeout(timer);worker.terminate();worker=null;}
   });guard();worker.postMessage({op:'init',mode});
  }catch(error){fail(error);}
 };
 return source;
}
