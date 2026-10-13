// WebGL owns this realm. BL owns clock projection and quality policy.
import {GpuTimer} from './gpu-timer.mjs';
import {SceneStage} from './scenes.mjs';
import {projectClock,renderScale,requestFrame,cancelFrame} from './values.mjs';
let gpu=null,stage=null,snapshot=null,raf=null,last=0,scale=1,cooldown=0,lost=false,ack=false,loseExtension=null,armed=null,activation=null,nativeClock=null,clockPort=null,activeRevision=null;
let frames=0,reportAt=0,metrics={},workMax=0,frameMax=0;const recentIntervals=[],recentWork=[];
const av=new Uint32Array(1001);let avMax=0;
const intervals=new Uint32Array(1001),work=new Uint32Array(1001);
const quantile=(hist,f,unit=1)=>{const total=hist.reduce((a,b)=>a+b,0);let count=0;if(!total)return null;for(let i=0;i<hist.length;i++){count+=hist[i];if(count>=total*f)return i/unit;}return null;};
const audioNow=()=>nativeClock?nativeClock.time+Math.min(128/nativeClock.sampleRate,Math.max(0,(performance.now()-nativeClock.stamp)/1000)):projectClock(snapshot.audioTime||0,0,0,snapshot.running,snapshot.audioStamp??snapshot.stamp,stamp()).time;
function applyState(value){if(value.id!=null&&value.id===activeRevision)return;stage.setState(value.state,value.beat);activeRevision=value.id??null;if(Number.isFinite(value.time))activation=value.time;}
const stamp=()=>performance.timeOrigin+performance.now();
function draw(){
 raf=null;if(!stage||lost||!snapshot)return;
 // Arm the next clocks before GL work, so submission cost does not add to
 // the timer period when the document delays animation callbacks.
 if(snapshot.animate)raf=requestFrame(draw);
 const start=performance.now(),interval=last?start-last:0;
 if(interval)intervals[Math.min(1000,Math.round(interval))]++;
 last=start;frameMax=Math.max(frameMax,interval);
 const clock=nativeClock?projectClock(snapshot.time,snapshot.beat,snapshot.bpm||122,snapshot.running,(snapshot.audioTime||0)*1000,audioNow()*1000):projectClock(snapshot.time,snapshot.beat,snapshot.bpm||122,snapshot.running,snapshot.stamp,stamp());
 const audioClock=audioNow();
 if(armed&&audioClock>=armed.time){applyState(armed);armed=null;}
 stage.mouse=snapshot.mouse||stage.mouse;
 gpu.poll();gpu.begin();
 try{stage.draw({...snapshot,...clock,renderScale:scale*(snapshot.capture?.75:1)});}finally{gpu.end();}
 if(activation!==null){const delay=Math.max(0,(audioNow()-activation)*1000);av[Math.min(1000,Math.round(delay))]++;avMax=Math.max(avMax,delay);activation=null;}
 const elapsed=performance.now()-start;work[Math.min(1000,Math.round(elapsed*10))]++;workMax=Math.max(workMax,elapsed);frames++;
 // Do not mistake a stopped transport or a suspended tab for GPU load.
 if(snapshot.animate&&interval){recentIntervals.push(interval);recentWork.push(gpu.ext?gpu.last:elapsed);if(++cooldown>=30){recentIntervals.sort((a,b)=>a-b);recentWork.sort((a,b)=>a-b);const cost=recentWork[Math.floor(recentWork.length*.95)];scale=renderScale(scale,cost>12?recentIntervals[Math.floor(recentIntervals.length*.95)]:16.67,cost);cooldown=0;recentIntervals.length=0;recentWork.length=0;}}
 if(start-reportAt>250){metrics={frames,revision:activeRevision,clockSource:nativeClock?'audio-worklet':'snapshot',clockAgeMs:nativeClock?performance.now()-nativeClock.stamp:null,gpuTime:gpu.report(),frameP95:quantile(intervals,.95),frameP99:quantile(intervals,.99),workP95Ms:quantile(work,.95,10),workMaxMs:workMax,frameMaxMs:frameMax,avSubmitP95Ms:quantile(av,.95),avSubmitMaxMs:avMax,avSamples:av.reduce((a,b)=>a+b,0),scale,...stage.resources()};reportAt=start;}
 if(ack){ack=false;self.postMessage({op:'ack',submitted:true,metrics:{...metrics,...stage.resources(),frames:stage.frames},volume:stage.volume||0,features:stage.features});}
 if(!snapshot.animate)last=0;
}
self.addEventListener('message',event=>{
 const {op,value}=event.data;
 try{
  if(op==='init'){
   stage=new SceneStage(value,{preserve:false});gpu=new GpuTimer(stage.gl);
   value.addEventListener('webglcontextlost',e=>{e.preventDefault();lost=true;cancelFrame(raf);raf=null;self.postMessage({op:'lost'});});
   value.addEventListener('webglcontextrestored',()=>{const old=stage,source=old.baseSource,visual=old.visual;gpu.dispose();old.dispose({lose:false});stage=new SceneStage(value,{preserve:false});gpu=new GpuTimer(stage.gl);stage.compile(source);if(visual){stage.validateState(visual);stage.setState(visual,snapshot?.beat||0);}lost=false;last=0;self.postMessage({op:'restored'});if(snapshot&&!raf)raf=requestFrame(draw);});
   self.postMessage({op:'ready'});
  } else if(op==='clock'){clockPort?.close();clockPort=value;clockPort.onmessage=({data})=>{nativeClock={...data,stamp:performance.now()};clockPort.postMessage(1);};clockPort.start();}
  else if(op==='compile')stage.compile(value);
  else if(op==='state'){stage.validateState(value.state);if(value.running&&Number.isFinite(value.time)&&audioNow()<value.time)armed=value;else applyState(value);if(!raf&&!lost&&snapshot)raf=requestFrame(draw);}
  else if(op==='arm'){stage.validateState(value.state);armed=value;}
  else if(op==='cancel')armed=null;
  else if(op==='clear'){stage.visual=null;stage.transition=null;armed=null;}
  else if(op==='reset')stage.reset();
  else if(op==='frame'){
   snapshot=value;ack=true;if(!raf&&!lost)raf=requestFrame(draw);
  } else if(op==='suspend'){if(snapshot)snapshot.animate=false;cancelFrame(raf);raf=null;last=0;if(ack){ack=false;self.postMessage({op:'ack',submitted:false,metrics:{...metrics,...stage.resources(),frames:stage.frames},volume:stage.volume||0,features:stage.features});}}
  else if(op==='lose'){loseExtension=stage.gl.getExtension('WEBGL_lose_context');loseExtension?.loseContext();}
  else if(op==='restore')loseExtension?.restoreContext();
 }catch(error){self.postMessage({op:'error',error:error.message||String(error)});}
});

// Read-only realm probe: the UI mailbox can be stale during an injected UI stall.
self.pelagicDiagnostics=()=>({frames,metrics,now:performance.now()});

// Test the context this renderer actually uses, before taking a visible canvas.
let webgl=false;
try{const gl=new OffscreenCanvas(2,2).getContext('webgl');webgl=!!gl;gl?.getExtension('WEBGL_lose_context')?.loseContext();}catch{}
self.postMessage({op:'capabilities',webgl});
