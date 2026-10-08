import * as R from '../../out/rt.mjs';
import * as Score from '../../out/pelagic.score.mjs';
import * as Live from '../../out/pelagic.live.mjs';
import * as Tone from '../../out/pelagic.shadertone.mjs';
import {AudioEngine,plain,validateGraph,wav} from './audio.mjs';
import {ShaderStage} from './shader.mjs';
import {SampleDeck} from './deck.mjs';
import {soundtrackAnalysis} from './analysis.mjs';
const defaults=plain(Score.d_defaults),movements=plain(Score.d_movements);
const toBL=x=>Array.isArray(x)?R.vecFromArray(x.map(toBL)):x&&typeof x==='object'?R.hashMap(...Object.entries(x).flatMap(([k,v])=>[R.kw(k),toBL(v)])):x;
const moduleURL=name=>new URL(name,import.meta.url);
function download(data,name,type){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([data],{type}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function blocks(source){const result=[];const re=/^#\+begin_src\s+(\S+)[^\n]*\n([\s\S]*?)^#\+end_src\s*$/gmi;let m;while((m=re.exec(source)))result.push({language:m[1].toLowerCase(),code:m[2]});
  if(!result.length && source.trim())result.push({language:'beam-lisp',code:source});return result;}
export function createHost(api) {
  let config={...defaults},ctx=null,audio=null,timer=null,playing=false,nextStep=0,nextTime=0,origin=0,beatOrigin=0,disposed=false;
  let readyVM=null,sourcePromise=null,shaderSource=null,liveN=0,patterns=new Map(),pending=[],recording=null,rendering=false;
  const views=new Set(),files=new Map(),decks={},urls=new Set(), handles=new Map(),offlineRenders=new Set();
  const notice=(message,playingValue=playing)=>{for(const v of views)v.status(message);api.dispatch({type:'pelagic/status',message,playing:playingValue});};
  const alive=()=>{if(disposed)throw new Error('Package was unloaded');};
  function unlock(){alive();if(!ctx){ctx=new AudioContext({latencyHint:'interactive'});audio=new AudioEngine(ctx,config);for(const key of ['a','b'])decks[key]=new SampleDeck(audio,key);}ctx.resume();return audio;}
  async function sources(){if(!sourcePromise)sourcePromise=Promise.all(['pelagic.glsl','overtone.bl'].map(async f=>{const r=await fetch(moduleURL(f));if(!r.ok)throw new Error('Cannot load '+f);return r.text();}));return sourcePromise;}
  async function vm(){
    if(readyVM)return readyVM;
    const language=await api.language(),[,source]=await sources();alive();if(!language)throw new Error('Beam Lisp language failed to load');
    language.Env.declare_ns("pelagic.overtone");language.Env.in_ns("pelagic.overtone");
    language.evalString(source.replace("(ns pelagic.overtone)",""));
    for(const ns of ['overtone.live','shadertone.tone','av'])language.Env.declare_ns(ns);
    const names=['sin-osc','saw','pulse','lf-tri','white-noise','pink-noise','mix','lpf','hpf','rlpf','pan2','env-gen','perc','adsr','line','x-line','FREE','midi->hz','note','scale','chord','beat-ms','metronome','definst','defsynth','at','ctl','kill','stop','out','play'];
    for(const name of names)language.Env.intern('overtone.live',name,language.Env['fetch!']('pelagic.overtone',name));
    for(const [name,f] of Object.entries({start:Tone.d_start,stop:Tone.d_stop,uniform:Tone.d_uniform}))language.Env.intern('shadertone.tone',name,f);
    for(const [name,f] of Object.entries({configure:Live.d_configure,pattern:Live.d_pattern,session:Live.d_session,perform:Live.d_perform,cue:Live.d_cue}))language.Env.intern('av',name,f);
    readyVM=language;return language;
  }
  function current(){if(!ctx||!playing)return {time:nextStep/4*60/config.bpm,beat:nextStep/4};
    const beat=beatOrigin+Math.max(0,ctx.currentTime-origin)*config.bpm/60;return {time:beat*60/config.bpm,beat};}
  function applyConfig(values){for(const [control,value] of Object.entries(values))api.dispatch({type:"pelagic/control",control,value});}
  function configure(values){
    const old=current(),tempoChanged=values.bpm!==undefined&&values.bpm!==config.bpm;Object.assign(config,values);
    if(playing&&tempoChanged){origin=ctx.currentTime;beatOrigin=old.beat;nextTime=ctx.currentTime+Math.max(0,nextStep/4-old.beat)*60/config.bpm;}
    audio?.configure(config);for(const d of Object.values(decks))d.configure();
  }
  function applyPending(){if(!pending.length)return;for(const change of pending){if(change.kind==='pattern')patterns.set(change.stem,change);else if(change.kind==='configure')applyConfig(change.values);}pending=[];notice('Live edit committed on the bar');}
  const stem=v=>({lantern:'melody',tide:'atmosphere',air:'air'})[v.synth]||v.synth;
  function schedule(){
    if(!playing||disposed)return;
    // The audio clock owns time. Timers only fill the lookahead queue.
    // After background throttling, skip missed steps rather than burst notes.
    if(nextTime<ctx.currentTime-.25){const skip=Math.ceil((ctx.currentTime-nextTime)/(60/config.bpm/4));nextStep+=skip;nextTime+=skip*60/config.bpm/4;}
    while(nextTime<ctx.currentTime+.16&&nextStep<1024){
      if(nextStep%16===0)applyPending();
      const i=nextStep,voices=plain(Score.d_step(i,toBL(config)));
      const time=nextTime+(i%2?config.swing*60/config.bpm/4:0);
      for(const v of voices)if(!patterns.has(stem(v))&&!decks[v.deck]?.buffer)audio.trigger(v,time);
      for(const pattern of patterns.values()){
        const tick=i%(pattern.beats*4);
        for(const bundle of pattern.plan.bundles){const local=bundle.time/(60/config.bpm*1000/4);if(Math.floor(local)===tick){for(const v of bundle.voices)audio.trigger({...v,deck:pattern.stem==='atmosphere'?'a':'b'},nextTime+(local-tick)*60/config.bpm/4);}}
      }
      nextStep++;nextTime+=60/config.bpm/4;
    }
    if(nextStep>=1024&&ctx.currentTime>nextTime+8){stop();notice('The descent is complete. Everything returns as light.',false);}
  }
  function play(bar=0){unlock();audio.stop();patterns=patterns||new Map();nextStep=Math.min(1023,Math.max(0,bar*16));beatOrigin=nextStep/4;origin=ctx.currentTime+.09;nextTime=origin;playing=true;
    for(const d of Object.values(decks))if(d.buffer){d.offset=d.cue;d.play(origin);}
    clearInterval(timer);timer=setInterval(()=>{try{schedule();}catch(e){stop();notice(e?.message||String(e),false);}},25);schedule();notice('Audio clock locked · 64 bars / four movements');}
  function stop(){playing=false;clearInterval(timer);timer=null;audio?.stop();for(const d of Object.values(decks))d.stop();}
  function validatePlan(plan){
    if(plan?.kind==='voice'){validateGraph(plan.graph);return;}
    if(plan?.kind==='bundle'){if(!Number.isFinite(plan.time)||plan.time<0)throw new Error('Bundle time must be nonnegative milliseconds');plan.voices.forEach(validatePlan);return;}
    if(plan?.kind==='play'){plan.bundles.forEach(validatePlan);return;}
    throw new Error('Expected an instrument voice, at bundle, or play plan');
  }
  function validateEdit(x){
    if(!x)return;
    switch(x.kind){
      case 'session':x.edits.forEach(validateEdit);break;
      case 'configure':for(const [k,v] of Object.entries(x.values)){if(!(k in defaults)||!['number','boolean'].includes(typeof v))throw new Error('Unknown configuration '+k);if(typeof v==='number'&&!Number.isFinite(v))throw new Error('Invalid configuration '+k);}
        if(x.values.bpm!==undefined&&(x.values.bpm<60||x.values.bpm>180))throw new Error('BPM must be 60–180');break;
      case 'pattern':if(!['melody','bass','kick','hat','snare','atmosphere'].includes(x.stem))throw new Error('Unknown pattern stem');
        if(!Number.isInteger(x.beats)||x.beats<1||x.beats>64)throw new Error('Pattern length must be 1–64 beats');validatePlan(x.plan);
        if(x.plan.kind!=='play')throw new Error('Pattern requires a play plan');
        for(const b of x.plan.bundles)if(b.time>=x.beats*60000/config.bpm)throw new Error('Pattern event outside loop');break;
      case 'voice':case 'bundle':case 'play':validatePlan(x);break;
      case 'shader':if(typeof x.source!=='string')throw new Error('Shader source must be a string');for(const [name,value] of Object.entries(x.options?.['user-data']||{}))validateEdit({kind:'uniform',name,value});break;
      case 'uniform':if(typeof x.name!=='string'||!/^[_A-Za-z][_A-Za-z0-9]*$/.test(x.name))throw new Error('Uniform requires a GLSL name');
        if(!(typeof x.value==='number'&&Number.isFinite(x.value))&&!(Array.isArray(x.value)&&x.value.length>=1&&x.value.length<=4&&x.value.every(Number.isFinite)))throw new Error('Uniform requires a finite scalar or 1–4 vector');break;
      case 'stop':case 'perform':case 'shader-stop':case 'cue':break;
      case 'ctl':if(Object.keys(x.params).some(k=>!['amp','freq','cutoff','pan'].includes(k)))throw new Error('ctl supports :amp, :freq, :cutoff, :pan');break;
      case 'kill':break;
      default:throw new Error('Final expression must return a performance request; got '+x.kind);
    }
  }
  const voiceKey=v=>JSON.stringify(v);
  function trigger(v,time){const id=unlock().trigger(v,time);handles.set(voiceKey(v),id);return id;}
  function handle(v){return typeof v==="number"?v:handles.get(voiceKey(v));}
  function commit(x){if(!x)return;switch(x.kind){
    case 'session':x.edits.forEach(commit);break;
    case 'pattern':case 'configure':if(playing)pending.push(x);else if(x.kind==='configure')applyConfig(x.values);else patterns.set(x.stem,x);break;
    case 'perform':play();break;case 'cue':play(Math.min(3,Math.max(0,x.movement))*16);break;
    case 'stop':stop();break;
    case 'voice':return trigger(x,unlock().ctx.currentTime+.04);
    case 'bundle':for(const v of x.voices)trigger(v,unlock().ctx.currentTime+.04+x.time/1000);break;
    case 'play':{const base=unlock().ctx.currentTime+.04;for(const b of x.bundles)for(const v of b.voices)trigger(v,base+b.time/1000);break;}
    case 'ctl':audio?.ctl(handle(x.voice),x.params);break;case 'kill':audio?.kill(handle(x.voice));break;
    case 'shader':shaderSource=x.source;for(const v of views)v.shader?.compile(x.source);for(const [name,value] of Object.entries(x.options?.['user-data']||{}))commit({kind:'uniform',name,value});break;
    case 'uniform':for(const v of views)if(v.shader)v.shader.uniforms[x.name]=x.value;break;
    case 'shader-stop':for(const v of views)v.frozen=true;break;
  }}
  async function evaluate(source){
    const language=await vm();alive();const ns='pelagic.live.session'+(++liveN);
    language.Env.declare_ns(ns);language.Env.add_alias(ns,'o','overtone.live');language.Env.add_alias(ns,'t','shadertone.tone');
    const pieces=blocks(source),edits=[],shaders=[];
    const flatten=x=>x.kind==='session'?x.edits.flatMap(flatten):[x];
    try{
      // A fresh namespace stages definitions; a failed edit leaves playback and
      // the last good shader intact. Overtone calls yield plans, never IO here.
      for(const b of pieces){if(['beam-lisp','clojure','bl'].includes(b.language)){for(const form of language.readForms(b.code)){language.Env.in_ns(ns);const value=plain(language.evalForm(form));if(value?.kind){validateEdit(value);edits.push(value);}}}
        else if(['glsl','fragment'].includes(b.language))shaders.push(b.code);}
      for(const shader of [...shaders,...edits.flatMap(flatten).filter(e=>e.kind==='shader').map(e=>e.source)]){
        const temp=document.createElement('canvas'),test=new ShaderStage(temp);try{test.compile(shader);}finally{test.dispose();test.gl.getExtension('WEBGL_lose_context')?.loseContext();}}
      alive();for(const s of shaders)commit({kind:'shader',source:s});for(const e of edits)commit(e);
      notice(playing?'Live edit staged · next bar boundary':'Live definitions ready · press Play');
      return {ok:true,edits:edits.length,shaders:shaders.length};
    }catch(e){const message=e?.message||String(e);notice('Edit rejected · '+message);return {ok:false,error:message};}
    finally{language.Env.in_ns('user');}
  }
  async function renderAudio(values=config,{seconds=null,sampleRate=44100,onProgress=()=>{}}={}){
    const c={...defaults,...values},duration=seconds??1024/4*60/c.bpm+10;
    const offline=new OfflineAudioContext(2,Math.ceil(duration*sampleRate),sampleRate),engine=new AudioEngine(offline,c);offlineRenders.add(engine);
    onProgress("timeline");const timeline=plain(Score.d_timeline(toBL(c)));onProgress("graph-ready");
    // Bound the offline graph as well as the live graph: suspend ahead of
    // each 8-second chunk, schedule its next horizon, then resume native DSP.
    // Scheduling the entire concert upfront leaves thousands of future silent
    // nodes in every render quantum and makes export needlessly quadratic.
    const barriers=[];for(let t=7.8;t<duration-.3;t+=8)barriers.push({time:t,promise:offline.suspend(t)});
    let cursor=0;
    const fill=until=>{if(disposed){cursor=timeline.length;return;}while(cursor<timeline.length&&timeline[cursor].time/1000<Math.min(until,duration-1)){
      const bundle=timeline[cursor++];for(const v of bundle.voices)engine.trigger(v,bundle.time/1000);
    }};
    fill(8);onProgress("first-chunk");
    const fadeStart=Math.max(0,duration-7);engine.output.gain.setValueAtTime(c.master,fadeStart);engine.output.gain.linearRampToValueAtTime(0,duration-.1);
    const rendered=offline.startRendering();
    for(const barrier of barriers){await barrier.promise;onProgress(barrier.time);fill(barrier.time+8.2);await offline.resume();}
    const buffer=await rendered;engine.dispose();offlineRenders.delete(engine);return buffer;
  }
  async function exportAudio(){if(rendering)return;rendering=true;notice('Rendering the original score to stereo WAV…');try{const buffer=await renderAudio();alive();download(wav(buffer),'pelagic.wav','audio/wav');notice('Stereo WAV exported');}finally{rendering=false;}}
  function record(){
    if(recording){recording.recorder.stop();return;}
    unlock();const v=[...views][0];if(!v?.canvas)throw new Error('Open the stage to record');
    const dest=ctx.createMediaStreamDestination();audio.output.connect(dest);
    const video=v.canvas.captureStream(24),stream=new MediaStream([...video.getVideoTracks(),...dest.stream.getAudioTracks()]);
    const mime=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(x=>MediaRecorder.isTypeSupported(x));
    const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:4500000}),chunks=[];
    recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    recorder.onstop=()=>{audio?.output.disconnect(dest);stream.getTracks().forEach(t=>t.stop());const blob=new Blob(chunks,{type:mime});recording=null;if(!disposed)download(blob,'pelagic-live.webm',mime);notice('Live recording saved');};
    recording={recorder,stream,dest};recorder.start(1000);notice('Recording audio + shader · press REC to save');
  }
  const deckHTML=key=>`<section class="deck" data-deck="${key}"><div class="deck-head"><span class="deck-title">${key.toUpperCase()} / ${key==='a'?'ATMOSPHERE':'PULSE'}</span><label class="file-label">＋ AUDIO<input type="file" accept="audio/*" data-file="${key}" aria-label="Load audio into deck ${key.toUpperCase()}"></label></div><div class="file-name" data-file-name="${key}">${key==='a'?'harmonic field / D minor':'deep-house pulse / melodic fragments'}</div><div class="deck-meta"><button data-deck-op="play" data-deck-key="${key}" title="Play/pause imported audio">▶</button><button data-deck-op="cue" data-deck-key="${key}">CUE</button><button data-deck-op="set-cue" data-deck-key="${key}" title="Set cue at current sample position">SET</button><button data-deck-op="jog" data-value="-0.25" data-deck-key="${key}" title="Jog back">−¼</button><button data-deck-op="jog" data-value="0.25" data-deck-key="${key}" title="Jog forward">＋¼</button><label>LOOP<select data-loop="${key}" aria-label="Deck ${key.toUpperCase()} loop"><option value="0">OFF</option><option value="1">1</option><option value="2">2</option><option value="4">4</option><option value="8">8</option></select></label><label>BPM<input type="number" value="${defaults.bpm}" min="40" max="240" data-sample-bpm="${key}" aria-label="Deck ${key.toUpperCase()} source BPM"></label><button data-deck-op="clear" data-deck-key="${key}" title="Remove imported audio">×</button></div><div class="eq">${['low','mid','high'].map(b=>`<label>${b.toUpperCase()}<input type="range" min="-18" max="12" step=".5" value="0" data-control="eq-${key}-${b}" aria-label="Deck ${key.toUpperCase()} ${b} EQ"></label>`).join('')}</div><div class="level-row"><span>LEVEL</span><input type="range" min="0" max="1" step=".01" value=".9" data-control="deck-${key}" aria-label="Deck ${key.toUpperCase()} level"><div class="meter"><i data-meter="${key}"></i></div></div></section>`;
  function mount(root,dispatch){
    const shadow=root.shadowRoot||root.attachShadow({mode:'open'});
    shadow.innerHTML=`<link rel="stylesheet" href="${moduleURL('style.css')}"><div class="app"><header class="header"><div><div class="brand">PELAGIC</div><div class="edition">OMEGA / LIVE AUDIOVISUAL STUDY 001</div></div><div class="clock"><b data-time>00:00</b><span data-bar>BAR 01 · ${defaults.bpm} BPM</span></div></header><div class="visual"><canvas aria-label="Audio-reactive Pelagic shader"></canvas><div class="corner"><span class="live-dot"></span>PROCEDURAL / SOUND → LIGHT</div><div class="visual-actions"><button data-command="pelagic/eval">EVALUATE ↵</button><button data-freeze>FREEZE</button><button data-fullscreen aria-label="Fullscreen stage">⛶</button></div><div class="caption"><div class="act">I / THE DESCENT</div><h1>BATHYMETRY</h1><p>a signal beneath the surface</p></div></div><nav class="timeline" aria-label="Movement cues">${movements.map((m,i)=>`<button data-cue="${i}">${String(i+1).padStart(2,'0')} / ${m.name}<span>${String(i*16+1).padStart(2,'0')}—${(i+1)*16} BARS</span></button>`).join('')}</nav><div class="transport"><button class="primary" data-command="pelagic/play">▶ PLAY THE DESCENT</button><button data-command="pelagic/stop">■ STOP</button><label>BPM <input type="number" min="60" max="180" value="${defaults.bpm}" data-control="bpm" aria-label="Performance BPM"></label><label>SCENE <select data-control="scene" aria-label="Visual scene"><option value="-1">NARRATIVE</option>${movements.map((m,i)=>`<option value="${i}">${m.name}</option>`).join('')}</select></label><div class="spacer"></div><button data-record>● REC</button><button data-export title="Export original score, with current mixer settings">WAV ↗</button></div><div class="decks">${deckHTML('a')}${deckHTML('b')}</div><div class="mixer"><label>FILTER<input type="range" min=".15" max="2" step=".01" value="1" data-control="filter" aria-label="Master filter"></label><label>CROSSFADE<input type="range" min="0" max="1" step=".01" value=".5" data-control="crossfade" aria-label="Equal-power crossfade"><div class="cross-label"><span>ATMOSPHERE</span><span>PULSE</span></div></label><label>SPACE<input type="range" min="0" max=".9" step=".01" value=".45" data-control="space" aria-label="Reverb space"></label></div><div class="mixer"><label>SWING<input type="range" min="0" max=".45" step=".01" value=".12" data-control="swing" aria-label="Swing"></label><label>ECHO<input type="range" min="0" max=".7" step=".01" value=".32" data-control="echo" aria-label="Echo feedback"></label><label>MASTER<input type="range" min="0" max="1" step=".01" value=".72" data-control="master" aria-label="Master volume"></label></div><footer class="bottom"><div class="stems">${['kick','bass','hat','snare','melody'].map(s=>`<button class="active" data-stem="${s}">${s.toUpperCase()}</button>`).join('')}</div><div class="status" role="status">Ready · a four-movement descent / headphones welcome</div></footer></div>`;
    const $=s=>shadow.querySelector(s),canvas=$('canvas');let raf=0,dead=false,freezeTime=null,init=null;
    const v={canvas,shader:null,frozen:false,status(s){$('.status').textContent=s;$('.status').classList.toggle('error',s.startsWith('Edit rejected'));}};views.add(v);
    init=sources().then(([s])=>{if(dead||disposed)return;v.shader=new ShaderStage(canvas);v.shader.compile(shaderSource||s);frame();}).catch(e=>{if(!dead&&!disposed)v.status('Stage unavailable · '+e.message);});
    function renderAt(time,options={}){
      const beat=options.beat??time*config.bpm/60,bar=beat/4,act=Math.min(3,Math.floor(bar/16)),scene=config.scene<0?Math.max(0,Math.min(3,bar/16-.15)):config.scene;
      const breakdown=(bar>=28&&bar<32)||(bar>=52&&bar<56);
      const energy=bar<8?.1:breakdown?.25:bar<16?.65:bar<32?.85:bar<48?1:bar<60?.8:.1;
      v.shader?.draw({time,beat,scene,energy,accent:Math.exp(-(beat%1)*8)*energy,analyser:audio?.analyser,...options});
      const m=movements[act];$('.caption h1').textContent=m.name;$('.caption p').textContent=m.subtitle;$('.caption .act').textContent=['I / THE DESCENT','II / THE PULSE','III / THE OPENING','IV / THE RETURN'][act];
      $('[data-time]').textContent=String(Math.floor(time/60)).padStart(2,'0')+':'+String(Math.floor(time%60)).padStart(2,'0');$('[data-bar]').textContent=`BAR ${String(Math.min(64,Math.floor(bar)+1)).padStart(2,'0')} · ${config.bpm} BPM`;
      shadow.querySelectorAll('[data-cue]').forEach(b=>b.classList.toggle('current',+b.dataset.cue===act));
      for(const key of ['a','b'])$(`[data-meter="${key}"]`).style.width=Math.min(100,(v.shader?.volume||0)*400*config['deck-'+key])+'%';
    }
    function frame(){if(dead||disposed)return;if(!root.isConnected){raf=requestAnimationFrame(frame);return;}
      const now=current();if(config.freeze||v.frozen){freezeTime??=now.time;}else freezeTime=null;
      if((!config.freeze&&!v.frozen&&(playing||(audio?.voices.size||0)>0||Object.values(decks).some(d=>d.running))) || v.shader?.frames===0)renderAt(freezeTime??now.time);
      raf=requestAnimationFrame(frame);
      for(const key of ['a','b']){const button=$(`[data-deck-op="play"][data-deck-key="${key}"]`);button.classList.toggle('active',!!decks[key]?.running);button.textContent=decks[key]?.running?'Ⅱ':'▶';}
      const rec=$('[data-record]');rec.classList.toggle('recording',!!recording);rec.textContent=recording?'■ SAVE REC':'● REC';
    }
    shadow.addEventListener('click',e=>{
      e.stopPropagation();const b=e.target.closest('button');if(!b)return;
      if(b.dataset.command)dispatch({type:'command',command:b.dataset.command});
      else if(b.dataset.cue!==undefined)dispatch({type:'pelagic/cue',movement:+b.dataset.cue});
      else if(b.dataset.stem)dispatch({type:'pelagic/control',control:b.dataset.stem,value:!config[b.dataset.stem]});
      else if(b.hasAttribute('data-freeze'))dispatch({type:'pelagic/control',control:'freeze',value:!config.freeze});
      else if(b.hasAttribute('data-fullscreen')){if(document.fullscreenElement)document.exitFullscreen();else $('.visual').requestFullscreen();}
      else if(b.hasAttribute('data-export'))dispatch({type:'pelagic/export'});
      else if(b.hasAttribute('data-record'))dispatch({type:'pelagic/record'});
      else if(b.dataset.deckOp)dispatch({type:'pelagic/deck',deck:b.dataset.deckKey,op:b.dataset.deckOp,value:+b.dataset.value||0});
    });
    shadow.addEventListener('input',e=>{const x=e.target;if(x.dataset.control)dispatch({type:'pelagic/control',control:x.dataset.control,value:+x.value});});
    shadow.addEventListener('change',e=>{const x=e.target;if(x.dataset.file&&x.files[0]){const token=crypto.randomUUID();files.set(token,x.files[0]);dispatch({type:'pelagic/sample',deck:x.dataset.file,token});}
      if(x.dataset.loop)dispatch({type:'pelagic/deck',deck:x.dataset.loop,op:'loop',value:+x.value});
      if(x.dataset.sampleBpm)dispatch({type:'pelagic/deck',deck:x.dataset.sampleBpm,op:'bpm',value:+x.value});});
    // Proof methods are attached to the owned DOM node, removed with the view.
    root.pelagic={renderAt,renderAudio,evaluate,stats:()=>({playing,nextStep,voices:audio?.voices.size||0,context:ctx?.state||'none',frames:v.shader?.frames||0,recording:!!recording,patterns:[...patterns.keys()],pending:pending.length}),ready:()=>init,
      wav,soundtrackAnalysis,shader:()=>v.shader,engine:()=>audio,config:()=>({...config}),decks:()=>decks};
    return {update(model){const state=model.state||defaults;configure(state);
      for(const [k,value] of Object.entries(state)){const el=$(`[data-control="${k}"]`);if(el&&shadow.activeElement!==el)el.value=value;}
      shadow.querySelectorAll('[data-stem]').forEach(b=>b.classList.toggle('active',!!config[b.dataset.stem]));$('[data-freeze]').classList.toggle('active',!!config.freeze);
      for(const key of ['a','b']){const name=decks[key]?.name;$(`[data-file-name="${key}"]`).textContent=name||(key==='a'?'harmonic field / D minor':'deep-house pulse / melodic fragments');}
    },dispose(){dead=true;cancelAnimationFrame(raf);v.shader?.dispose();views.delete(v);delete root.pelagic;shadow.replaceChildren();}};
  }
  return {mount,async effect(e){alive();switch(e.op){case 'play':configure(e.args);play();break;case 'stop':stop();notice('All voices stopped',false);break;
    case 'configure':configure(e.args);break;case 'cue':play(e.args.bar);break;
    case 'evaluate':unlock();await evaluate(e.args.source);break;
    case 'sample':{unlock();const {token,deck}=e.args,file=files.get(token);files.delete(token);if(!file)throw new Error('Audio file expired');const result=await decks[deck].load(file);alive();notice(`Deck ${deck.toUpperCase()} · ${result.name} · set its source BPM, then play`);break;}
    case 'deck':unlock();decks[e.args.deck].action(e.args.op,e.args.value);break;
    case 'record':record();break;case 'export':await exportAudio();break;
    default:throw new Error('Unknown Pelagic effect '+e.op);}},
    dispose(){disposed=true;stop();if(recording){recording.recorder.onstop=null;recording.recorder.stop();recording.stream.getTracks().forEach(t=>t.stop());recording=null;}
      for(const d of Object.values(decks))d.dispose();for(const engine of offlineRenders)engine.dispose();offlineRenders.clear();audio?.dispose();ctx?.close();files.clear();handles.clear();pending=[];patterns.clear();for(const url of urls)URL.revokeObjectURL(url);
      for(const v of views)v.shader?.dispose();}
  };
}
