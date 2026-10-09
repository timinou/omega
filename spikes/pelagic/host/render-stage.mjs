// DOM ownership and the one-slot graphics mailbox stay outside package state.
import {audioFeatures} from './features.mjs';
import {SceneStage} from './scenes.mjs';
import {createGraphicsWorker} from './values.mjs';
export function createStage(canvas,{lost=()=>{},restored=()=>{},error=()=>{}}={}){
 if(!canvas.transferControlToOffscreen||!globalThis.Worker)return new SceneStage(canvas);
 const worker=createGraphicsWorker(new URL('render-worker.mjs',import.meta.url));
 if(!worker)return new SceneStage(canvas);
 // Synchronous validation preserves atomic public edits. This small off-DOM
 // context prepares programs only; all per-frame GPU work lives in the worker.
 let validator;
 try{validator=new SceneStage(document.createElement('canvas'),{preserve:false});}catch(e){worker.terminate();throw e;}
 let closed=false,inFlight=false,pending=null,contextLost=false,metrics={worker:true},readyResolve,readyReject,frameResolve=null,frameTimer=0,suspended=true,clockBridge=null;
 const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
 const send=(op,value,transfer)=>{if(!closed)worker.postMessage({op,value},transfer||[]);};
 const timeout=setTimeout(()=>{readyReject(new Error('Graphics worker startup timed out'));dispose();error(new Error('Graphics worker startup timed out'));},15000);
 const fail=e=>{if(closed)return;e.preventDefault?.();const reason=new Error(e.message||'Graphics worker failed');readyReject(reason);dispose();error(reason);};
 worker.addEventListener('error',fail);worker.addEventListener('messageerror',fail);
 worker.addEventListener('message',({data})=>{
  if(closed)return;
  if(data.op==='ready'){clearTimeout(timeout);readyResolve();}
  else if(data.op==='error')fail({message:data.error});
  else if(data.op==='lost'){contextLost=true;lost({preventDefault(){}});}
  else if(data.op==='restored'){contextLost=false;restored();}
  else if(data.op==='ack'){
   metrics={worker:true,...data.metrics};proxy.frames=metrics.frames||proxy.frames;proxy.volume=data.volume;proxy.features=data.features;
   clearTimeout(frameTimer);frameResolve?.(data.submitted);frameResolve=null;inFlight=false;if(pending){const next=pending;pending=null;submit(next.value,next.resolve);}
  }
 });
 function dispose(){if(closed)return;closed=true;clearTimeout(timeout);clearTimeout(frameTimer);frameResolve?.(false);pending?.resolve(false);readyReject(new Error('Graphics worker disposed'));pending=null;clockBridge?.dispose();clockBridge=null;worker.terminate();validator.dispose();canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointerup',up);proxy.disposed=true;}
 function submit(value,resolve){inFlight=true;frameResolve=resolve;send('frame',value);frameTimer=setTimeout(()=>fail({message:'Graphics frame timed out'}),15000);}
 const mouse=[0,0,0,0];
 const move=e=>{const r=canvas.getBoundingClientRect();mouse[0]=(e.clientX-r.left)*canvas.width/r.width;mouse[1]=(r.bottom-e.clientY)*canvas.height/r.height;};
 const down=e=>{move(e);mouse[2]=mouse[0];mouse[3]=mouse[1];};const up=()=>{mouse[2]=-Math.abs(mouse[2]);mouse[3]=-Math.abs(mouse[3]);};
 canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointerup',up);
 const proxy={canvas,ready,frames:0,disposed:false,worker:true,
  gl:{isContextLost:()=>contextLost,getExtension:name=>name==='WEBGL_lose_context'?{loseContext:()=>send('lose'),restoreContext:()=>send('restore')}:null},
  compile(source){validator.compile(source);send('compile',source);return true;},
  validateState:state=>validator.validateState(state),
  setState(state,beat,time,id,running=false){validator.setState(state,beat);send('state',{state,beat,time,id,running});},
  armState(state,beat,time,id){validator.validateState(state);send('arm',{state,beat,time,id});},
  cancelState(){send('cancel');},
  connectClock(bridge){if(!bridge)return;if(closed){bridge.dispose();bridge.port.close();return;}clockBridge?.dispose();clockBridge=bridge;send('clock',bridge.port,[bridge.port]);},
  reset(){validator.reset();send('reset');},
  suspend(){if(suspended)return;suspended=true;pending?.resolve(false);pending=null;send('suspend');},
  draw(options={}){
   if(closed)return;
   suspended=false;
   const {analyser,...value}=options;
   if(analyser&&!value.audioFrame){const fft=new Uint8Array(1024),wave=new Uint8Array(2048);analyser.getByteFrequencyData(fft);analyser.getByteTimeDomainData(wave);value.audioFrame={fft,wave,features:audioFeatures(fft,wave,{sampleRate:analyser.context?.sampleRate??analyser.sampleRate??44100,fftSize:analyser.fftSize??2048,minDecibels:analyser.minDecibels??-100,maxDecibels:analyser.maxDecibels??-30}),signals:value.signals||{}};}
   value.width??=Math.max(2,Math.round(canvas.clientWidth*.8));value.height??=Math.max(2,Math.round(canvas.clientHeight*.8));
   // Explicit recording sizes retain their lower internal resolution; responsive
   // sizes are already scaled CSS pixels and must not receive recording's .75.
   value.capture=!!options.width;value.mouse=mouse.slice();value.stamp??=performance.timeOrigin+performance.now();
   return new Promise(resolve=>{if(inFlight){pending?.resolve(false);pending={value,resolve};}else submit(value,resolve);});
  },resources:()=>({...metrics,inFlight,pending:pending?1:0,validationPrograms:validator.resources().programs}),dispose};
 Object.defineProperty(proxy,'visual',{get:()=>validator.visual,set:value=>{validator.visual=value;if(!value)send('clear');}});
 try{const offscreen=canvas.transferControlToOffscreen();send('init',offscreen,[offscreen]);}catch(e){dispose();throw e;}
 return proxy;
}
