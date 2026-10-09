// WebGL owns this realm. BL owns clock projection and quality policy.
import {SceneStage} from './scenes.mjs';
import {projectClock,renderScale} from './values.mjs';
let stage=null,snapshot=null,raf=0,last=0,scale=1,cooldown=0,lost=false,ack=false,loseExtension=null;
let frames=0,reportAt=0,metrics={},workMax=0,frameMax=0;const recentIntervals=[],recentWork=[];
const intervals=new Uint32Array(1001),work=new Uint32Array(1001);
const quantile=(hist,f,unit=1)=>{const total=hist.reduce((a,b)=>a+b,0);let count=0;if(!total)return null;for(let i=0;i<hist.length;i++){count+=hist[i];if(count>=total*f)return i/unit;}return null;};
const stamp=()=>performance.timeOrigin+performance.now();
function draw(){
 raf=0;if(!stage||lost||!snapshot)return;
 const start=performance.now(),interval=last?start-last:0;
 if(interval)intervals[Math.min(1000,Math.round(interval))]++;
 last=start;frameMax=Math.max(frameMax,interval);
 const clock=projectClock(snapshot.time,snapshot.beat,snapshot.bpm||122,snapshot.running,snapshot.stamp,stamp());
 stage.mouse=snapshot.mouse||stage.mouse;
 stage.draw({...snapshot,...clock,renderScale:scale*(snapshot.capture?.75:1)});
 const elapsed=performance.now()-start;work[Math.min(1000,Math.round(elapsed*10))]++;workMax=Math.max(workMax,elapsed);frames++;
 // Do not mistake a stopped transport or a suspended tab for GPU load.
 if(snapshot.animate&&interval){recentIntervals.push(interval);recentWork.push(elapsed);if(++cooldown>=30){recentIntervals.sort((a,b)=>a-b);recentWork.sort((a,b)=>a-b);scale=renderScale(scale,recentIntervals[Math.floor(recentIntervals.length*.95)],recentWork[Math.floor(recentWork.length*.95)]);cooldown=0;recentIntervals.length=0;recentWork.length=0;}}
 if(start-reportAt>250){metrics={frames,frameP95:quantile(intervals,.95),frameP99:quantile(intervals,.99),workP95Ms:quantile(work,.95,10),workMaxMs:workMax,frameMaxMs:frameMax,scale,...stage.resources()};reportAt=start;}
 if(ack){ack=false;self.postMessage({op:'ack',submitted:true,metrics:{...metrics,...stage.resources(),frames:stage.frames},volume:stage.volume||0,features:stage.features});}
 if(snapshot.animate)raf=requestAnimationFrame(draw);else last=0;
}
self.addEventListener('message',event=>{
 const {op,value}=event.data;
 try{
  if(op==='init'){
   stage=new SceneStage(value);
   value.addEventListener('webglcontextlost',e=>{e.preventDefault();lost=true;cancelAnimationFrame(raf);raf=0;self.postMessage({op:'lost'});});
   value.addEventListener('webglcontextrestored',()=>{const old=stage,source=old.baseSource,visual=old.visual;old.dispose({lose:false});stage=new SceneStage(value);stage.compile(source);if(visual){stage.validateState(visual);stage.setState(visual,snapshot?.beat||0);}lost=false;last=0;self.postMessage({op:'restored'});if(snapshot&&!raf)raf=requestAnimationFrame(draw);});
   self.postMessage({op:'ready'});
  } else if(op==='compile')stage.compile(value);
  else if(op==='state'){stage.validateState(value.state);stage.setState(value.state,value.beat);}
  else if(op==='clear'){stage.visual=null;stage.transition=null;}
  else if(op==='reset')stage.reset();
  else if(op==='frame'){
   snapshot=value;ack=true;if(!raf&&!lost)raf=requestAnimationFrame(draw);
  } else if(op==='suspend'){if(snapshot)snapshot.animate=false;cancelAnimationFrame(raf);raf=0;last=0;if(ack){ack=false;self.postMessage({op:'ack',submitted:false,metrics:{...metrics,...stage.resources(),frames:stage.frames},volume:stage.volume||0,features:stage.features});}}
  else if(op==='lose'){loseExtension=stage.gl.getExtension('WEBGL_lose_context');loseExtension?.loseContext();}
  else if(op==='restore')loseExtension?.restoreContext();
 }catch(error){self.postMessage({op:'error',error:error.message||String(error)});}
});
