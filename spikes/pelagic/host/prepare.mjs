import {scoreDecoder} from './score-wire.mjs';
// Own the worker and finite cache; scheduling policy lives in BL actors.
export function prepareScore(base,createWorker,{enabled=true,budgetMs=4,delay=4,admit=()=>true,onError=()=>{}}={}){
 const cache=new Map(),samples=[],decoder=scoreDecoder();let worker=null,closed=false,done=false,started=0,readyAt=0,timer=0,credit=0,rows=0;
 const state={mode:'actor',budgetMs,ready:false,done:false,rows:0,workMs:0,chunkMaxMs:0,error:null};
 const fail=error=>{state.error=error.message||String(error);dispose();onError(error);};
 function guard(){clearTimeout(timer);timer=setTimeout(()=>fail(new Error('Score preparation timed out')),15000);}
 function dispose(){if(closed)return;closed=true;clearTimeout(timer);clearTimeout(credit);worker?.terminate();worker=null;cache.clear();state.closed=true;}
 const source=index=>cache.has(index)?cache.get(index):base(index);
 source.dispose=dispose;
 source.stats=()=>({...state,worker:!!worker,rows,graphs:decoder.size,elapsedMs:done?state.elapsedMs:started?performance.now()-started:0,startupMs:readyAt?readyAt-started:null,chunkP95Ms:samples.length?samples.slice().sort((a,b)=>a-b)[Math.floor((samples.length-1)*.95)]:null});
 source.start=()=>{
  if(closed||worker||done||!enabled)return;
  started=performance.now();
  try{worker=createWorker();if(!worker){state.workerUnavailable=true;return;}
   worker.addEventListener('error',event=>fail(new Error(event.message||'Preparation worker failed')));
   worker.addEventListener('messageerror',()=>fail(new Error('Preparation message could not be decoded')));
   worker.addEventListener('message',({data})=>{
    if(closed||done)return;
    if(data.op==='error'){fail(new Error(data.error));return;}
    if(data.op==='ready'){readyAt=performance.now();state.ready=true;worker.postMessage({op:'prepare',id:1});guard();}
    else if(data.op==='chunk'){
     if(data.id!==1||data.start!==rows||!Array.isArray(data.rows)||!data.rows.length||data.rows.length>16||rows+data.rows.length>1024||!Number.isFinite(data.workMs)||data.workMs<0){fail(new Error('Invalid preparation chunk'));return;}
     try{for(const row of decoder.decode(data))cache.set(rows++,row);}catch(error){fail(error);return;}
     samples.push(data.workMs);state.workMs+=data.workMs;state.chunkMaxMs=Math.max(state.chunkMaxMs,data.workMs);
     clearTimeout(timer);clearTimeout(credit);
     const grant=()=>{if(closed||!worker)return;try{if(admit()){worker.postMessage({op:'credit',id:1});guard();}else credit=setTimeout(grant,Math.max(4,delay));}catch(error){fail(error);}};
     credit=setTimeout(grant,delay);
    }else if(data.op==='done'&&data.id===1){if(rows!==1024){fail(new Error('Incomplete preparation score'));return;}done=true;state.done=true;state.elapsedMs=performance.now()-started;clearTimeout(timer);clearTimeout(credit);worker.terminate();worker=null;}
   });guard();worker.postMessage({op:'init',budgetMs});
  }catch(error){fail(error);}
 };
 return source;
}
