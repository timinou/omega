import * as R from '../../out/rt.mjs';
import {d_observe_package as observePackage} from '../../out/js.observation.mjs';
import * as Score from '../../out/pelagic.score.mjs';
import * as Performance from '../../out/pelagic.performance.mjs';
import * as Audition from '../../out/pelagic.audition.mjs';
import * as Takes from '../../out/pelagic.take.mjs';
import * as Explore from '../../out/pelagic.explore.mjs';
import {errorText} from './errors.mjs';
import {LocalStore,LiveTake,validateSession} from './storage.mjs';
import {performanceControls} from './controls.mjs';
import {SceneStage} from './scenes.mjs';
import {createStage} from './render-stage.mjs';
import {prepareScore} from './prepare.mjs';
import {createPreparationWorker,preparationWorkers,closeIdlePreparationWorkers} from './compute-worker.mjs';
import {freezeGraph} from './score-wire.mjs';
import * as Bridge from '../../out/pelagic.bridge.mjs';
import {conversions,download,setText,audioContext,readText,createEvaluator,afterPaint,createScoreSource,audibleTime,createGraphicsWorker,continuePreparation,admitWork,exportWindow,playbackVoices} from './values.mjs';
import {AudioEngine,plain,validateGraph,wav} from './audio.mjs';
import {ShaderStage} from './shader.mjs';
import {SampleDeck} from './deck.mjs';
import {soundtrackAnalysis} from './analysis.mjs';
const toBL=conversions(R);
const defaults=plain(Score.d_defaults),movements=plain(Score.d_movements);
const moduleURL=name=>new URL(name,import.meta.url);
function blocks(source){const result=[];const re=/^#\+begin_src\s+(\S+)[^\n]*\n([\s\S]*?)^#\+end_src\s*$/gmi;let m;while((m=re.exec(source)))result.push({language:m[1].toLowerCase(),code:m[2]});
  if(!result.length && source.trim())result.push({language:'beam-lisp',code:source});return result;}
export function createHost(api) {
  const prepareEnabled=new URLSearchParams(globalThis.location?.search||'').get('prepare')!=='none';
  const scoreVoices=prepareScore(createScoreSource(Score.d_step,Score.d_defaults),()=>createPreparationWorker(moduleURL('prepare-worker.mjs'),()=>createGraphicsWorker(moduleURL('prepare-worker.mjs'))),{enabled:prepareEnabled,admit:()=>admitWork('prepare',playing,playing?nextTime-ctx.currentTime:Infinity)});
  afterPaint(()=>scoreVoices.start());
  let config={...defaults},ctx=null,ctxWall=0,audio=null,timer=null,playing=false,nextStep=0,nextTime=0,origin=0,beatOrigin=0,disposed=false;
  const store=new LocalStore();let lastTake=null,restoreGeneration=0,recordPreparing=false,lastEvaluation=null,evalCount=0;
  let model=Performance.d_initial(),active=plain(model.get(R.kw('current'))),scheduled=active,revision=null,mode='finite',pausedBeat=0,pausedTime=0,timeOrigin=0,evaluation=0;
  const ownedNamespaces=new Set();
  let capturedTake=null,savedTake=null,lastSource=null,explorations=[],replayQueue=[],replayActivations=[];
  const preparationTurns=new Uint32Array(2001);let preparationTurnMax=0;
  const preparationP95=()=>{const total=preparationTurns.reduce((a,b)=>a+b,0);if(!total)return null;let count=0;for(let i=0;i<preparationTurns.length;i++){count+=preparationTurns[i];if(count>=total*.95)return i;}};
  const events=[],diagnostics={ticks:0,missed:0,late:[],frames:[],longTasks:0,compiles:[],frameHistogram:new Uint32Array(1001),av:[],handoff:[],activation:[],render:[],started:performance.now()};
  let lastFrame=0,syncing=false,avExpected=null,announcement=null;
  const log=(kind,data={})=>{const event={kind,audioTime:ctx?.currentTime||0,beat:current().beat,...data};const {state,...compact}=event;if(typeof compact.source==='string')compact.source=compact.source.slice(0,12000);events.push(compact);if(events.length>4096)events.shift();if(capturedTake){capturedTake=Takes.d_append(capturedTake,toBL(event));if(['play','pause','stop','resync'].includes(kind))capturedTake=capturedTake.assoc(R.kw('reproducible'),false).assoc(R.kw('omitted'),'Transport changed or scheduling lost time during capture');}};
  const observer=globalThis.PerformanceObserver?new PerformanceObserver(list=>{diagnostics.longTasks+=list.getEntries().length;}):null;
  try{observer?.observe({type:'longtask'});}catch{}
  let evaluatorClient=createEvaluator(moduleURL('live-worker.mjs'));
  function evaluator(){if(disposed)return null;if(evaluatorClient?.closed())evaluatorClient=createEvaluator(moduleURL('live-worker.mjs'));return evaluatorClient;}
  let auditionState=null,auditionEngine=null,auditionTimer=null,auditionEnd=0,auditionDecks=[];
  let readyVM=null,sourcePromise=null,shaderSource=null,liveN=0,patterns=new Map(),pending=[],recording=null,rendering=false;
  const views=new Set(),files=new Map(),decks={},urls=new Set(), handles=new Map(),offlineRenders=new Set();
  const notice=(message,playingValue=playing)=>{if(disposed)return;for(const v of views)v.status(message);api.dispatch({type:'pelagic/status',message,playing:playingValue});};
  const alive=()=>{if(disposed)throw new Error('Package was unloaded');};
  function unlock(){alive();if(!ctx){ctx=audioContext();ctxWall=performance.now();audio=new AudioEngine(ctx,config);audio.prewarm();audio.startTelemetry(moduleURL('timing-worklet.mjs')).then(()=>{if(disposed)return;for(const v of views)if(v.shader?.worker)v.shader.connectClock(audio.graphicsClock());});for(const key of ['a','b'])decks[key]=new SampleDeck(audio,key);}ctx.resume();return audio;}
  async function sources(){if(!sourcePromise)sourcePromise=Promise.all(['pelagic.glsl','overtone.bl'].map(f=>readText(moduleURL(f))));return sourcePromise;}
  async function vm(){
    if(readyVM)return readyVM;
    const language=await api.language(),[,source]=await sources();alive();if(!language)throw new Error('Beam Lisp language failed to load');
    language.Env.declare_ns("pelagic.overtone");language.Env.in_ns("pelagic.overtone");
    language.evalString(source.replace("(ns pelagic.overtone)",""));
    for(const ns of ['overtone.live','shadertone.tone','av'])language.Env.declare_ns(ns);
    for(const name of Bridge.d_overtone_names)language.Env.intern('overtone.live',name,language.Env['fetch!']('pelagic.overtone',name));
    for(const [ns,bindings] of Bridge.d_live_bindings.entries())
      for(const [name,value] of bindings.entries())language.Env.intern(ns,name,value);
    readyVM=language;return language;
  }
  const revisionID=()=>model.get(R.kw('revision'));
  const controlModel=()=>({mode,playing,visual:active.visual,variation:active.variation,revision:revisionID(),past:{length:model.get(R.kw('past')).cnt},future:{length:model.get(R.kw('future')).cnt},
    snapshots:Object.fromEntries([...model.get(R.kw('snapshots')).entries()].map(([key])=>[key.fq??String(key),true]))});
  function current(){if(!ctx||!playing)return {time:pausedTime,beat:pausedBeat};
    const beat=beatOrigin+Math.max(0,ctx.currentTime-origin)*config.bpm/60;return {time:timeOrigin+Math.max(0,ctx.currentTime-origin),beat};}
  function applyConfig(values){for(const [control,value] of Object.entries(values))api.dispatch({type:"pelagic/control",control,value});}
  function configure(values){
    values=Object.fromEntries(Object.entries(values).filter(([key])=>key in defaults));
    if(Object.entries(values).every(([key,value])=>config[key]===value))return;
    const soundChanged=Object.entries(values).some(([key,value])=>!['scene','freeze'].includes(key)&&config[key]!==value);
    const old=current(),tempoChanged=values.bpm!==undefined&&values.bpm!==config.bpm;Object.assign(config,values);
    if(playing&&tempoChanged){timeOrigin=old.time;origin=ctx.currentTime;beatOrigin=old.beat;nextTime=ctx.currentTime+Math.max(0,nextStep/4-old.beat)*60/config.bpm;}
    if(soundChanged){audio?.configure(config);for(const d of Object.values(decks))d.configure();}
    if(!syncing){++restoreGeneration;active={...active,config:{...config}};model=model.assoc(R.kw('current'),toBL(active));if(!revision)scheduled=active;log('control',{values,state:active});}

  }
  function ack(phase){
    api.dispatch({type:'pelagic/revision',phase,revision:revisionID(),config:active.config});
    for(const v of views)v.revision?.(phase,revisionID(),revision?.beat);
  }
  function disarm(){
    for(const v of views)v.shader?.cancelState?.();
    if(revision?.armed&&revision.audioChanged){
      audio.cancelFrom(revision.time);nextStep=Math.round(revision.beat*4);nextTime=revision.time;audio.configure(active.config);
      for(const backup of revision.backups||[]){const elapsed=(ctx.currentTime-backup.capturedAt)*config.bpm/backup.bpm;decks[backup.deck].install({...backup,offset:backup.offset+elapsed},ctx.currentTime,playing);}
    }
  }
  function cancelRevision(){
    ++restoreGeneration;disarm();
    revision=null;model=Performance.d_cancel(model);scheduled=active;pending=[];ack('ACTIVE');
  }
  function applyRevision(){
    if(!revision?.armed||ctx.currentTime+0.0001<revision.time)return;
    const activationStarted=performance.now(),r=revision;if(!playing)installAssets(r,ctx.currentTime);model=Performance.d_activate(model,r.id);active=plain(model.get(R.kw('current')));
    timeOrigin=playing?current().time-Math.max(0,ctx.currentTime-r.time):pausedTime;beatOrigin=r.beat;origin=r.time;config={...active.config};scheduled=active;patterns=new Map(Object.entries(active.patterns));
    revision=null;pending=[];if(r.audioChanged)audio?.configure(config,r.time);
    for(const v of views){v.shader?.setState?.(active,r.beat,r.time,r.id,playing);v.frozen=false;}
    if(r.source)lastSource=r.source;avExpected=r.time;log('active',{revision:r.id,state:active,source:r.source||lastSource});announcement=r.id;if(!playing){ack('ACTIVE');announcement=null;}diagnostics.activation.push(performance.now()-activationStarted);if(diagnostics.activation.length>256)diagnostics.activation.shift();
  }
  // Reserve native audio independently of the next editable musical boundary.
  const lookAhead=()=>4;
  function queueModel(candidate,quantize='bar',preview=false,assetChanges=null,source=null){
    const value={pending:plain(candidate.get(R.kw('pending')))},state=value.pending?.state;
    if(!state)throw new Error('No pending performance state');
    validateState(state);
    for(const pattern of Object.values(state.patterns))for(const bundle of pattern.plan.bundles)for(const voice of bundle.voices)freezeGraph(voice.graph);
    for(const v of views)v.shader?.validateState?.(state);
    if(preview){
      for(const [key,ref] of Object.entries(state.assets||{}))if(!decks[key]?.buffer||decks[key].hash!==ref.hash)throw new Error('Relink audition asset '+(ref.name||key));
      const staged=Audition.d_stage(model,candidate,source);stopAudition();auditionState=staged;
      auditionEngine=new AudioEngine(ctx,state.config,{level:.15});auditionEngine.prewarm();
      const before=ctx.currentTime+.08,duration=plain(Audition.d_duration(state.config.bpm));
      let step=Math.floor(current().beat*4),time=before;auditionEnd=before+duration;
      for(const [key,ref] of Object.entries(state.assets||{})){
        const deck=new SampleDeck(auditionEngine,key);auditionDecks.push(deck);
        deck.install({...ref,buffer:decks[key].buffer,offset:decks[key].position()},before,true);
      }
      const pump=()=>{
        if(disposed||!auditionEngine)return;
        if(ctx.currentTime>auditionEnd+1){stopAudition();return;}
        if(!admitWork('audition',playing,playing?nextTime-ctx.currentTime:Infinity))return;
        const started=performance.now();
        while(time<Math.min(auditionEnd,ctx.currentTime+.5)&&performance.now()-started<4){
          const projected=playbackVoices(state,step,auditionEngine.serial,scoreVoices(Performance.d_score_index(step)),{a:!!state.assets?.a,b:!!state.assets?.b});
          for(const item of projected)auditionEngine.trigger(item.voice,time+item.offset*60/state.config.bpm/4);
          step++;time+=60/state.config.bpm/4;
        }
      };
      auditionTimer=setInterval(()=>{try{pump();}catch(error){stopAudition();notice('Audition stopped · '+errorText(error));}},25);pump();
      log('audition',{baseRevision:revisionID(),duration});notice('Audition · quiet monitor · active performance unchanged');
      return {ok:true,preview:true,baseRevision:revisionID(),duration};
    }
    const sameAudio=Performance.d_audio_equivalent$Q?Performance.d_audio_equivalent$Q(candidate.get(R.kw('pending')).get(R.kw('state')),model.get(R.kw('current'))):['config','patterns','assets','variation'].every(key=>JSON.stringify(state[key])===JSON.stringify(active[key]));
    const audioChanged=!sameAudio||!!assetChanges?.length;
    const inheritedAssets=revision?.originalAssetChanges||[];disarm();++restoreGeneration;
    model=candidate;scheduled=active;
    const quantum=quantize==='beat'?1:quantize==='phrase'?16:4;
    const beat=playing?Performance.d_boundary(current().beat,quantum,1.15*config.bpm/60):pausedBeat;
    if(playing&&audioChanged&&nextStep/4>=beat){const target=origin+(beat-beatOrigin)*60/config.bpm;audio.cancelFrom(target);nextStep=Math.round(beat*4);nextTime=target;}
    revision={id:value.pending.id,beat,state,assetChanges:assetChanges??inheritedAssets,originalAssetChanges:assetChanges??inheritedAssets,audioChanged,source,armed:!playing||!audioChanged,time:playing?origin+(beat-beatOrigin)*60/config.bpm:ctx?.currentTime||0};pending=[revision];
    if(playing&&!audioChanged)for(const v of views)v.shader?.armState?.(state,beat,revision.time,revision.id);
    log('queued',{revision:revision.id,targetBeat:beat,audioChanged});ack(playing&&!revision.armed?'QUEUED':'ARMED');
    if(!playing)applyRevision();return {ok:true,revision:value.pending.id,targetBeat:beat};
  }
  function queueEdits(edits,options={}){if(!revision)syncAssets();return queueModel(Performance.d_stage(options.preview?Performance.d_cancel(model):model,toBL(edits)),options.quantize,options.preview,null,options.source);}
  function stopAudition(forget=false){clearInterval(auditionTimer);auditionTimer=null;for(const deck of auditionDecks)deck.dispose();auditionDecks=[];auditionEngine?.dispose();auditionEngine=null;if(forget)auditionState=null;}
  function commitAudition(quantize='bar'){
    if(!auditionState)throw new Error('No staged audition');
    const candidate=Audition.d_commit(auditionState,model),source=auditionState.get(R.kw('source'));
    const result=queueModel(candidate,quantize,false,null,source);stopAudition(true);log('audition-commit',{source});return result;
  }
  function validateState(state){
    for(const [key,value] of Object.entries(defaults))if(typeof state.config[key]!==typeof value)throw new Error('Missing or invalid configuration '+key);
    if(JSON.stringify(state).length>256000)throw new Error('Performance state exceeds 256 KB');
    validateEdit({kind:'configure',values:state.config});
    for(const pattern of Object.values(state.patterns))validateEdit(pattern,state.config.bpm);
    for(const [deck,ref] of Object.entries(state.assets||{}))if(!['a','b'].includes(deck)||ref.deck!==deck||!/^[a-f0-9]{64}$/.test(ref.hash)||!Number.isFinite(ref.bpm)||ref.bpm<40||ref.bpm>240||!Number.isFinite(ref.cue)||ref.cue<0||![0,1,2,4,8].includes(ref.loopBeats))throw new Error('Invalid snapshot audio reference');
    const v=state.visual;
    if(!Number.isFinite(v.beats)||v.beats<.25||v.beats>64)throw new Error('Transition length must be .25–64 beats');
    for(const [key,lo,hi] of [['mix',0,1],['intensity',.1,2],['symmetry',3,16],['feedback',0,.7],['palette',0,1]])if(!Number.isFinite(v[key])||v[key]<lo||v[key]>hi)throw new Error('Invalid visual '+key);
    if(!['crossfade','dissolve','iris'].includes(v.transition))throw new Error('Unknown transition');
    if(Object.keys(state.scenes).length>8)throw new Error('Scene limit is 8');
    for(const definition of Object.values(state.scenes)){
      if(typeof definition.shader!=='string'||definition.shader.length>100000)throw new Error('Scene needs inline GLSL (max 100 KB)');
      for(const [target,mapping] of Object.entries(definition.mappings||{})){
        if(!['zoom','accent','intensity','symmetry','feedback','palette'].includes(target)||!Array.isArray(mapping.signal)||mapping.signal.length!==3||!Number.isFinite(mapping.amount)||Math.abs(mapping.amount)>16)throw new Error('Invalid signal mapping');
        if(!['stem','deck','master'].includes(mapping.signal[0])||!['level','onset','pitch','bass','mid','high'].includes(mapping.signal[2]))throw new Error('Unknown signal');
      }
      for(const [key,value] of Object.entries(definition.controls||{}))if(!['zoom','accent','intensity','symmetry','feedback','palette'].includes(key)||!Number.isFinite(value))throw new Error('Invalid scene control');
    }
    for(const [key,lo,hi] of [['density',0,1],['transpose',-24,24],['seed',0,2147483646]])if(!Number.isFinite(state.variation[key])||state.variation[key]<lo||state.variation[key]>hi)throw new Error('Invalid variation '+key);
  }
  function schedule(){
    if(!playing||disposed)return;const preparationStart=performance.now();applyRevision();
    const reserved=scheduled;
    while(replayActivations.length&&replayActivations[0].time<=ctx.currentTime){
      const checkpoint=replayActivations.shift();model=model.assoc(R.kw('serial'),checkpoint.id).assoc(R.kw('pending'),toBL({id:checkpoint.id,state:checkpoint.state,history:'normal'}));
      revision=checkpoint;applyRevision();
    }
    if(replayActivations.length)scheduled=reserved;
    diagnostics.ticks++;
    if(nextTime<ctx.currentTime-.04){
      const skip=Math.ceil((ctx.currentTime-nextTime)/(60/scheduled.config.bpm/4));diagnostics.missed+=skip;
      log('resync',{skipped:skip});nextStep+=skip;nextTime+=skip*60/scheduled.config.bpm/4;
    }
    while(nextTime<ctx.currentTime+lookAhead()&&(mode==='performance'||nextStep<1024)&&continuePreparation(nextTime,ctx.currentTime,performance.now()-preparationStart)){
      if(revision&&!revision.armed&&nextStep/4>=revision.beat){
        revision.time=nextTime;revision.armed=true;scheduled=revision.state;
        for(const v of views)v.shader?.armState?.(scheduled,revision.beat,revision.time,revision.id);
        audio.configure(scheduled.config,nextTime);installAssets(revision,nextTime);ack('ARMED');log('armed',{revision:revision.id,time:nextTime});
      }
      while(replayQueue.length&&replayQueue[0].time<=nextTime){
        const event=replayQueue.shift(),state=event.state,id=event.id;
        const checkpoint={id,state,beat:event.beat,time:nextTime,armed:true,audioChanged:true,assetChanges:event.assetChanges,source:event.source};
        replayActivations.push(checkpoint);scheduled=state;audio.configure(state.config,nextTime);installAssets(checkpoint,nextTime);
      }
      const i=nextStep,c=scheduled.config;
      const voices=scoreVoices(mode==='performance'?Performance.d_score_index(i):i);
      const projected=playbackVoices(scheduled,i,audio.serial,voices,{a:!!decks.a?.buffer,b:!!decks.b?.buffer});
      for(const item of projected)audio.trigger(item.voice,nextTime+item.offset*60/c.bpm/4);
      nextStep++;nextTime+=60/c.bpm/4;
    }
    const preparationMs=performance.now()-preparationStart;preparationTurns[Math.min(2000,Math.round(preparationMs))]++;preparationTurnMax=Math.max(preparationTurnMax,preparationMs);
    for(const [key,id] of handles)if(!audio.voices.has(id))handles.delete(key);
    if(mode==='finite'&&nextStep>=1024&&ctx.currentTime>nextTime+8){stop();notice('The descent is complete. Everything returns as light.',false);}
  }
  function play(bar=0,continuous=false){unlock();replayQueue=[];replayActivations=[];cancelRevision();audio.stop();mode=continuous?'performance':'finite';pausedBeat=Math.max(0,bar*4);
    pausedTime=pausedBeat*60/config.bpm;timeOrigin=pausedTime;nextStep=Math.round(pausedBeat*4);beatOrigin=pausedBeat;origin=ctx.currentTime+.09;nextTime=origin;playing=true;
    if(continuous){for(const v of views)v.shader?.setState?.(active,pausedBeat);}else for(const v of views){if(v.shader){v.shader.visual=null;v.shader.transition=null;v.shader.compile(shaderSource||v.shader.baseSource);}}
    for(const v of views)v.shader?.reset?.();
    for(const d of Object.values(decks))if(d.buffer){d.offset=d.cue;d.play(origin);}
    clearInterval(timer);timer=setInterval(()=>{try{schedule();}catch(e){stop();notice(errorText(e),false);}},25);schedule();log('play',{mode});notice(continuous?'Continuous performance · audio clock locked':'Audio clock locked · 64 bars / four movements');
  }
  function stop(){if(playing)log('stop');replayQueue=[];replayActivations=[];const position=current();pausedTime=position.time;pausedBeat=position.beat;playing=false;clearInterval(timer);timer=null;audio?.stop();for(const d of Object.values(decks))d.stop();}
  function pause(){pausedBeat=current().beat;stop();cancelRevision();nextStep=Math.ceil(pausedBeat*4);log('pause');}
  function resume(){const beat=pausedBeat,time=pausedTime;play(beat/4,mode==='performance');timeOrigin=time;pausedTime=time;log('resume');}
  function validatePlan(plan){
    if(plan?.kind==='voice'){
      if(plan.stem!==undefined&&!['melody','bass','kick','hat','snare','atmosphere'].includes(plan.stem))throw new Error('Unknown voice stem');
      validateGraph(plan.graph);let count=0;
      const visit=node=>{if(++count>512)throw new Error('Voice graph budget is 512 nodes');if(!node||typeof node!=='object')return;
        if(node.ugen==='param'&&!Number.isFinite(plan.params?.[node.key]??node.default))throw new Error('Invalid control '+node.key);
        if(node.ugen==='div'&&(typeof node.inputs[1]!=='number'||!node.inputs[1]))throw new Error('Division requires a literal nonzero denominator');
        const numeric=value=>{const n=value?.ugen==='param'?(plan.params?.[value.key]??value.default):value;if(!Number.isFinite(n))throw new Error('Expected numeric envelope/ramp control');return n;};
        if(node.ugen==='env-gen')for(const key of (node.envelope.envelope==='adsr'?['attack','release','decay','sustain']:['attack','release']))if(numeric(node.envelope[key])<0)throw new Error('Envelope controls must be nonnegative');
        if(node.ugen==='line'||node.ugen==='x-line'){
          if(numeric(node.dur)<=0||numeric(node.dur)>30)throw new Error('Ramp duration must be 0–30 seconds');
          const from=numeric(node.from),to=numeric(node.to);if(node.ugen==='x-line'&&(from<=0||to<=0))throw new Error('x-line requires positive endpoints');
        }
        for(const child of Object.values(node)){if(Array.isArray(child))child.forEach(visit);else if(child&&typeof child==='object')visit(child);}
      };visit(plan.graph);
      if(!plan.params||Object.values(plan.params).some(v=>!Number.isFinite(v)))throw new Error('Instrument controls must be finite numbers');
      if(plan.params.dur!==undefined&&(plan.params.dur<=0||plan.params.dur>30))throw new Error('Voice duration must be 0–30 seconds');
      return;
    }
    if(plan?.kind==='bundle'){if(!Number.isFinite(plan.time)||plan.time<0)throw new Error('Bundle time must be nonnegative milliseconds');plan.voices.forEach(validatePlan);return;}
    if(plan?.kind==='play'){plan.bundles.forEach(validatePlan);return;}
    throw new Error('Expected an instrument voice, at bundle, or play plan');
  }
  function validateEdit(x,bpm=config.bpm){
    if(!x)return;
    switch(x.kind){
      case 'session':case 'commit':if(!Array.isArray(x.edits)||x.edits.length>64)throw new Error('Session needs at most 64 edits');x.edits.forEach(e=>validateEdit(e,bpm));break;
      case 'configure':for(const [k,v] of Object.entries(x.values)){if(!(k in defaults)||typeof v!==typeof defaults[k])throw new Error('Unknown configuration '+k);if(typeof v==='number'&&!Number.isFinite(v))throw new Error('Invalid configuration '+k);}
        for(const [key,lo,hi] of [['space',0,.9],['echo',0,.7],['master',0,1],['crossfade',0,1],['filter',.15,2],['swing',0,.45],['deck-a',0,1],['deck-b',0,1],['scene',-1,3],['eq-a-low',-18,12],['eq-a-mid',-18,12],['eq-a-high',-18,12],['eq-b-low',-18,12],['eq-b-mid',-18,12],['eq-b-high',-18,12]])if(x.values[key]!==undefined&&(x.values[key]<lo||x.values[key]>hi))throw new Error('Configuration out of range '+key);
        if(x.values.bpm!==undefined&&(x.values.bpm<60||x.values.bpm>180))throw new Error('BPM must be 60–180');break;
      case 'pattern':if(!['melody','bass','kick','hat','snare','atmosphere'].includes(x.stem))throw new Error('Unknown pattern stem');
        if(!Number.isInteger(x.beats)||x.beats<1||x.beats>64)throw new Error('Pattern length must be 1–64 beats');validatePlan(x.plan);
        if(x.plan.kind!=='play')throw new Error('Pattern requires a play plan');
        for(const b of x.plan.bundles)if(b.time>=(x.units==='beats'?x.beats:x.beats*60000/(x.bpm||bpm)))throw new Error('Pattern event outside loop');break;
      case 'voice':case 'bundle':case 'play':validatePlan(x);break;
      case 'shader':if(typeof x.source!=='string')throw new Error('Shader source must be a string');for(const [name,value] of Object.entries(x.options?.['user-data']||{}))validateEdit({kind:'uniform',name,value});break;
      case 'uniform':if(typeof x.name!=='string'||!/^[_A-Za-z][_A-Za-z0-9]*$/.test(x.name))throw new Error('Uniform requires a GLSL name');
        if(!(typeof x.value==='number'&&Number.isFinite(x.value))&&!(Array.isArray(x.value)&&x.value.length>=1&&x.value.length<=4&&x.value.every(Number.isFinite)))throw new Error('Uniform requires a finite scalar or 1–4 vector');break;
      case 'scene':case 'launch':case 'layer':if(x.name!==null&&(typeof x.name!=='string'||!/^[-_a-zA-Z0-9]{1,48}$/.test(x.name)))throw new Error('Invalid scene name');break;
      case 'variation':case 'visual':if(!x.values||typeof x.values!=='object')throw new Error('Expected values');break;
      case 'gesture':if(!['build','break','drop','release'].includes(x.name))throw new Error('Unknown gesture');break;
      case 'pattern-stop':if(!['melody','bass','kick','hat','snare','atmosphere'].includes(x.stem))throw new Error('Unknown stem');break;
      case 'undo':case 'redo':case 'cancel':case 'pause':case 'resume':case 'panic':break;
      case 'snapshot':case 'recall':if(typeof x.name!=='string'||!/^[-_a-zA-Z0-9]{1,48}$/.test(x.name))throw new Error('Invalid snapshot name');break;
      case 'stop':case 'perform':case 'shader-stop':case 'cue':break;
      case 'ctl':if(Object.keys(x.params).some(k=>!['amp','freq','cutoff','pan'].includes(k)))throw new Error('ctl supports :amp, :freq, :cutoff, :pan');break;
      case 'kill':break;
      default:throw new Error('Final expression must return a performance request; got '+x.kind);
    }
  }
  const voiceKey=v=>JSON.stringify(v);
  function trigger(v,time){const id=unlock().trigger(v,time);handles.set(voiceKey(v),id);return id;}
  function handle(v){return typeof v==="number"?v:handles.get(voiceKey(v));}
  const reversible=new Set(['pattern','pattern-stop','configure','scene','launch','layer','visual','variation','gesture','shader','uniform']);
  function request(x){
    unlock();applyRevision();
    if(x.kind==='audition-commit')return commitAudition(x.quantize);
    if(x.kind==='audition-cancel'){stopAudition(true);log('audition-cancel');notice('Audition cancelled · active performance unchanged');return {ok:true};}
    validateEdit(x);
    if(x.kind==='commit'||x.kind==='session'){
      const flatten=e=>['session','commit'].includes(e.kind)?e.edits.flatMap(flatten):[e];
      const edits=flatten(x);if(edits.some(e=>!reversible.has(e.kind)))throw new Error('A commit contains reversible edits only');
      return queueEdits(edits,x);
    }
    if(reversible.has(x.kind))return queueEdits([x]);
    switch(x.kind){
      case 'undo':case 'redo':return restoreCandidate(Performance.d_history(Performance.d_cancel(model),x.kind));
      case 'snapshot':syncAssets();model=Performance.d_snapshot(model,x.name);log('snapshot',{name:x.name});notice('Snapshot saved: '+x.name);return {ok:true};
      case 'recall':return restoreSnapshot(x.name);
      case 'cancel':cancelRevision();log('cancel');return {ok:true};
      case 'pause':pause();return {ok:true};case 'resume':resume();return {ok:true};
      case 'panic':stopAudition(true);cancelRevision();stop();audio?.cancelFrom(0);log('panic');notice('Panic · all voices stopped',false);return {ok:true};
      case 'perform':play(0,true);return {ok:true};case 'cue':play(Math.min(3,Math.max(0,x.movement))*16,mode==='performance');return {ok:true};
      case 'stop':stop();return {ok:true};
      case 'voice':trigger(x,ctx.currentTime+.04);break;
      case 'bundle':for(const v of x.voices)trigger(v,ctx.currentTime+.04+x.time/1000);break;
      case 'play':{const base=ctx.currentTime+.04;for(const b of x.bundles)for(const v of b.voices)trigger(v,base+b.time/1000);break;}
      case 'ctl':audio?.ctl(handle(x.voice),x.params);break;case 'kill':audio?.kill(handle(x.voice));break;
      case 'shader-stop':for(const v of views)v.frozen=true;break;
    }
    return {ok:true};
  }
  async function evaluate(source,options={}){
    if(options.preview)unlock();
    const id=++evalCount;const result=await evaluateImpl(source,options);if(id===evalCount)lastEvaluation={id,...result};return result;
  }
  async function evaluateImpl(source,options={}){
    if(disposed)return {ok:false,error:'Package was unloaded'};
    if(typeof source!=='string'||source.length>128000)return {ok:false,error:'Live buffer limit is 128 KB'};
    const generation=++evaluation,started=performance.now(),remote=evaluator(),language=remote?null:await vm();alive();
    if(generation!==evaluation)return {ok:false,error:'Superseded edit'};
    const ns='pelagic.live.session'+(++liveN),defined=[];
    if(language){ownedNamespaces.add(ns);language.Env.declare_ns(ns);language.Env.add_alias(ns,'o','overtone.live');language.Env.add_alias(ns,'t','shadertone.tone');}
    const pieces=blocks(source),edits=[];
    try{
      if(remote){edits.push(...await remote.request(pieces));alive();if(generation!==evaluation)return {ok:false,error:'Superseded edit'};edits.forEach(e=>validateEdit(e));}
      else for(const b of pieces){if(['beam-lisp','clojure','bl'].includes(b.language)){for(const form of language.readForms(b.code)){
        language.Env.in_ns(ns);const forms=form?.toArray?.();if(forms?.[1]&&['def','defn','defn-','definst','defsynth'].includes(forms[0]?.name||forms[0]?.fq?.split('/').at(-1)))defined.push(forms[1].name||forms[1].fq);
        const value=plain(language.evalForm(form));if(value?.kind){validateEdit(value);edits.push(value);}
      }}else if(['glsl','fragment'].includes(b.language))edits.push({kind:'shader',source:b.code});}
      const flatten=x=>['session','commit'].includes(x.kind)?x.edits.flatMap(flatten):[x];
      const all=edits.flatMap(flatten),changes=all.filter(e=>reversible.has(e.kind)),actions=all.filter(e=>!reversible.has(e.kind));
      if(options.preview&&actions.length)throw new Error('Preview supports reversible edits only');
      let result={ok:true};
      if(changes.length)result=queueEdits(changes,{quantize:edits.find(e=>e.kind==='commit')?.quantize,preview:options.preview,source});
      for(const e of actions)request(e);
      diagnostics.compiles.push(performance.now()-started);if(diagnostics.compiles.length>256)diagnostics.compiles.shift();
      log('evaluate',{edits:all.length,source});
      notice(options.preview?'Audition ready · quiet monitor · commit or cancel':playing?'Live edit staged · next boundary':'Live definitions ready · press Play');
      return {...result,edits:all.length};
    }catch(e){if(generation!==evaluation)return {ok:false,error:'Superseded edit'};const error=errorText(e);notice('Edit rejected · '+error);log('rejected',{error});return {ok:false,error};}
    finally{
      if(language){
      language.Env.in_ns('user');
      for(const name of defined){language.Env.delete_key(new R.Tup([ns,name]));for(const role of ['link','meta','refer','import'])language.Env.delete_key(new R.Tup([R.kw(role),ns,name]));}
      for(const name of ['o','t'])language.Env.delete_key(new R.Tup([R.kw('alias'),ns,name]));
      language.Env.delete_key(new R.Tup([R.kw('ns'),ns]));ownedNamespaces.delete(ns);
      }
    }
  }
  async function waitWork(kind,signal=null){
    while(!admitWork(kind,playing,playing?nextTime-ctx.currentTime:Infinity)){
      signal?.throwIfAborted();await new Promise(resolve=>setTimeout(resolve,25));alive();
    }
    signal?.throwIfAborted();alive();
  }
  async function renderAudio(values=config,{seconds=null,sampleRate=44100,onProgress=()=>{},signal=null}={}){
    const c={...defaults,...values},duration=seconds??1024/4*60/c.bpm+10;
    if(!Number.isFinite(duration)||duration<=0||duration>600||![22050,44100,48000].includes(sampleRate))throw new Error('Invalid export duration or sample rate');
    // Cancellation belongs to the host IO lifetime; BL still owns admission.
    // OfflineAudioContext has no close/abort method. Release the graph now and
    // resume any outstanding suspension so the browser can retire its render.
    const controller=new AbortController();let engine=null,offline=null;
    const abort=()=>{controller.abort(new DOMException('Audio export cancelled','AbortError'));engine?.dispose();if(offline?.state==='suspended')offline.resume().catch(()=>{});};
    const job={abort};offlineRenders.add(job);signal?.addEventListener('abort',abort,{once:true});
    let rejectCancelled;
    const cancelled=new Promise((_,reject)=>{rejectCancelled=reject;});cancelled.catch(()=>{});
    const onAbort=()=>rejectCancelled(controller.signal.reason);
    controller.signal.addEventListener('abort',onAbort,{once:true});
    if(signal?.aborted)abort();
    const waiting=promise=>Promise.race([promise,cancelled]);
    try{
      await waiting(waitWork('export',controller.signal));
      offline=new OfflineAudioContext(2,Math.ceil(duration*sampleRate),sampleRate);engine=new AudioEngine(offline,c);
      engine.prewarm();onProgress('graph-ready');controller.signal.throwIfAborted();
      const state={config:c,patterns:{},variation:{density:1,transpose:0,seed:37}},stepSeconds=60/c.bpm/4;
      // Native DSP receives at most .25 seconds before the next admission gate.
      // Graph preparation shares the immutable score cache and compiled schema.
      const quantum=.25,barriers=[];
      for(let time=quantum;time<duration-.05;time+=quantum){
        const promise=offline.suspend(time);
        promise.then(()=>{if(controller.signal.aborted)offline.resume().catch(()=>{});},()=>{});
        barriers.push({time,promise});
      }
      let cursor=0;
      const fill=async until=>{
        let started=performance.now();
        while(cursor<1024&&cursor*stepSeconds<Math.min(until,duration-1)){
          controller.signal.throwIfAborted();alive();const time=cursor*stepSeconds;
          for(const item of playbackVoices(state,cursor,engine.serial,scoreVoices(cursor),{a:false,b:false}))
            engine.trigger(item.voice,time+item.offset*stepSeconds);
          cursor++;
          if(performance.now()-started>=4){await waiting(new Promise(resolve=>setTimeout(resolve,0)));await waiting(waitWork('export',controller.signal));started=performance.now();}
        }
      };
      await fill(exportWindow(playing));onProgress('first-chunk');controller.signal.throwIfAborted();
      const fadeStart=Math.max(0,duration-7);engine.output.gain.setValueAtTime(c.master,fadeStart);engine.output.gain.linearRampToValueAtTime(0,duration-.1);
      const rendered=offline.startRendering();rendered.catch(()=>{});
      for(const barrier of barriers){await waiting(barrier.promise);await waiting(waitWork('export',controller.signal));onProgress(barrier.time);await fill(barrier.time+exportWindow(playing));await waiting(offline.resume());}
      return await waiting(rendered);
    }finally{abort();signal?.removeEventListener('abort',abort);controller.signal.removeEventListener('abort',onAbort);engine?.dispose();offlineRenders.delete(job);}
  }
  async function exportAudio(){if(rendering)return;rendering=true;notice('Rendering the original score to stereo WAV…');try{const buffer=await renderAudio();alive();download(wav(buffer),'pelagic-original-score.wav','audio/wav');notice('Stereo WAV exported');}finally{rendering=false;}}
  function syncAssets(){
    const assets=Object.fromEntries(Object.entries(decks).filter(([,d])=>d.buffer&&d.hash).map(([deck,d])=>[deck,{deck,hash:d.hash,name:d.name,bpm:d.bpm,cue:d.cue,loopBeats:d.loopBeats}]));
    active={...active,assets};model=model.assoc(R.kw('current'),toBL(active));if(!revision)scheduled=active;
  }
  function session(){syncAssets();return {schema:'omega.pelagic',version:1,state:active,snapshots:plain(model.get(R.kw('snapshots'))),assets:Object.values(active.assets)};}
  async function prepareAssets(state){
    const changes=[],missing=[];
    for(const deck of ['a','b']){
      const ref=state.assets?.[deck];if(!ref){if(decks[deck]?.buffer)changes.push({deck,buffer:null,bpm:config.bpm});continue;}
      const file=await store.get('assets',ref.hash);alive();
      if(!file){missing.push(ref.name||ref.hash);continue;}
      const buffer=decks[deck]?.hash===ref.hash?decks[deck].buffer:await ctx.decodeAudioData(await file.arrayBuffer());alive();
      changes.push({...ref,deck,buffer});
    }
    return {changes,missing};
  }
  function installAssets(r,time){
    r.backups=[];for(const change of r.assetChanges||[]){const d=decks[change.deck];r.backups.push({deck:change.deck,buffer:d.buffer,hash:d.hash,name:d.name,bpm:d.bpm,cue:d.cue,loopBeats:d.loopBeats,offset:d.position(),capturedAt:ctx.currentTime});d.install(change,time,playing);}
    r.assetChanges=[];
  }
  function restoreSnapshot(name){return restoreCandidate(Performance.d_recall(Performance.d_cancel(model),name));}
  async function restoreCandidate(candidate){
    const generation=++restoreGeneration,state=plain(candidate.get(R.kw('pending'))).state;
    const prepared=await prepareAssets(state);alive();if(generation!==restoreGeneration)throw new Error('Restore superseded');
    const result=queueModel(candidate,'bar',false,prepared.changes);if(prepared.missing.length)notice('Snapshot staged · relink missing audio: '+prepared.missing.join(', '));
    return {...result,missing:prepared.missing};
  }
  async function loadSession(value){
    unlock();validateSession(value);const generation=++restoreGeneration;
    const state={...value.state,assets:Object.fromEntries((value.assets||[]).map(ref=>[ref.deck,ref]))};validateState(state);
    for(const snapshot of Object.values(value.snapshots||{}))validateState(snapshot);
    for(const v of views){v.shader?.validateState?.(state);for(const snapshot of Object.values(value.snapshots||{}))v.shader?.validateState?.(snapshot);}
    const prepared=await prepareAssets(state);alive();if(generation!==restoreGeneration)throw new Error('Restore superseded');
    const id=model.get(R.kw('serial'))+1,candidate=model.assoc(R.kw('serial'),id).assoc(R.kw('snapshots'),toBL(value.snapshots||{})).assoc(R.kw('pending'),toBL({id,state,history:'normal'}));
    const result=queueModel(candidate,'bar',false,prepared.changes);
    log('session-load',{missing:prepared.missing});notice(prepared.missing.length?'Session staged · relink missing audio: '+prepared.missing.join(', '):'Session staged');
    return {...result,missing:prepared.missing};
  }
  function captureTake(document){
    unlock();
    if(capturedTake){const finished=capturedTake;capturedTake=null;savedTake=null;savedTake=Takes.d_check(finished);notice('Take captured · replay or fork');return plain(savedTake);}
    if(!playing)throw new Error('Choose PERFORM before capturing a timeline');
    capturedTake=Takes.d_create(toBL(session()),toBL(document||{source:lastSource||'',path:'live-set.bl.org'}),
      toBL({...current(),audioTime:ctx.currentTime,mode}),toBL({shader:shaderSource,assets:Object.values(active.assets),sampleRate:ctx.sampleRate,activeSource:lastSource}));
    savedTake=null;notice('Capturing source, revisions and controls');return plain(capturedTake);
  }
  function takeManifest(){const take=capturedTake||savedTake;if(!take)throw new Error('Capture a take first');return Takes.d_check(take);}
  function saveManifest(){download(JSON.stringify(plain(takeManifest()),null,2),'pelagic-take.json','application/json');}
  function forkTake(){const source=Takes.d_fork_source(takeManifest());api.dispatch({type:'pelagic/fork',source});notice('Fork opened · undo returns to your source');return source;}
  async function replayTake(value=plain(takeManifest())){
    if(capturedTake)throw new Error('Finish capture before opening a take');
    const take=Takes.d_check(toBL(value));const base=plain(take.get(R.kw('base')));
    const checkpoints=plain(Takes.d_timeline(take));checkpoints.forEach(e=>validateState(e.state));
    const prepared=[];
    for(const event of checkpoints){const assets=await prepareAssets(event.state);alive();if(assets.missing.length)throw new Error('Relink take audio: '+assets.missing.join(', '));prepared.push(assets.changes);}
    pause();await loadSession(base);alive();const start=plain(take.get(R.kw('transport'))).beat;
    savedTake=take;lastSource=plain(take.get(R.kw('provenance'))).activeSource||null;
    play(start/4,true);const serial=model.get(R.kw('serial'));
    replayQueue=checkpoints.map((event,index)=>({...event,id:serial+index+1,time:origin+event['relative-time'],assetChanges:prepared[index]}));
    // play() reserves the base ahead; replay replaces that reservation once.
    audio.cancelFrom(origin);nextStep=Math.round(start*4);nextTime=origin;schedule();
    log('take-replay',{events:checkpoints.length});notice('Replaying captured state and controller timeline');return {events:checkpoints.length};
  }

  function explore(seed=active.variation.seed){
    explorations=plain(Explore.d_candidates(toBL(active),seed,4));
    notice('Four seeded alternatives · audition before committing');return explorations;
  }
  function auditionAlternative(index){
    const choice=explorations[index];if(!choice)throw new Error('Explore first');
    if(JSON.stringify(choice.base)!==JSON.stringify(active))throw new Error('Exploration is stale; generate from the current revision');
    return queueEdits([choice.edit],{preview:true,source:'(av/variation '+R.printStr(toBL(choice.variation))+')'});
  }
  function sourceRevision(){if(!lastSource)throw new Error('Evaluate source first');api.dispatch({type:'pelagic/source',source:lastSource});return lastSource;}
  async function exportTake(){
    if(!lastTake){const id=await store.get('takes','latest');if(!id)throw new Error('No saved take yet');const info=await store.get('takes',id);
      const chunks=[];for(let i=0;i<Math.max(info.chunks+2,2);i++){const chunk=await store.get('chunks',id+':'+i);if(!chunk){if(i<info.chunks)throw new Error('Missing recording chunk');break;}chunks.push(chunk);}if(!chunks.length)throw new Error('No recording chunks stored yet');download(new Blob(chunks,{type:info.mime}),info.complete===false?'pelagic-live-partial.webm':'pelagic-live.webm',info.mime);return;}
    download(await lastTake.blob({allowPartial:!!lastTake.error}),lastTake.error?'pelagic-live-partial.webm':'pelagic-live.webm',lastTake.mime);
  }
  async function stopRecording({save=true}={}){
    if(!recording)return lastTake?await lastTake.stop():null;
    const take=recording;recording=null;audio?.output.disconnect(take.dest);lastTake=take;
    const info=await take.stop();log('record-stop',{take:info});
    const manifest={schema:'omega.pelagic.take',version:1,...info,capture:take.capture,session:session(),events:events.slice(),diagnostics:report(),browser:navigator.userAgent,sampleRate:ctx.sampleRate};
    await store.put('takes',take.id,manifest);await store.put('takes','latest',take.id);
    if(save&&!disposed&&info.bytes<16*1024*1024)await exportTake();
    notice('Live take saved locally · '+Math.round(info.duration)+' seconds · '+(info.bytes/1e6).toFixed(1)+' MB');
    return manifest;
  }
  async function record(){
    if(recording)return stopRecording();if(recordPreparing)return;recordPreparing=true;unlock();
    try{
    const estimate=await navigator.storage?.estimate?.();alive();
    if(estimate?.quota&&estimate.quota-estimate.usage<32*1024*1024)throw new Error('Less than 32 MB recording storage available');
    const v=[...views][0];if(!v?.canvas)throw new Error('Open the stage to record');
    if(typeof v.canvas.captureStream!=='function'||typeof MediaRecorder==='undefined')throw new Error('Live recording is unavailable in this browser');
    if(v.shader.gl.isContextLost())throw new Error('Restore the stage before recording');
    const dest=ctx.createMediaStreamDestination();audio.output.connect(dest);
    const deadline=performance.now()+15000;
    // The latest-frame mailbox may replace a queued request. Capture must wait
    // for its dimensions to be submitted, rather than treating cancellation as success.
    while(true){const now=current();const submitted=await v.shader.draw({time:now.time,beat:now.beat,bpm:config.bpm,running:playing,animate:true,width:1280,height:720,audioFrame:audio?.visualFrame()});if(submitted!==false)break;if(disposed||v.shader.disposed||performance.now()>deadline){audio.output.disconnect(dest);throw new Error('Recording stage preparation timed out');}}
    const video=v.canvas.captureStream(30),stream=new MediaStream([...video.getVideoTracks(),...dest.stream.getAudioTracks()]);
    try{const take=new LiveTake(store,stream);take.capture={width:1280,height:720,requestedFPS:30,geometryScale:.75};take.dest=dest;take.start();recording=take;}catch(error){audio.output.disconnect(dest);stream.getTracks().forEach(track=>track.stop());throw error;}log('record-start',{id:recording.id});notice('Recording live mix + stage · chunks saved incrementally');
    }finally{recordPreparing=false;}
  }
  function report(){const total=diagnostics.frameHistogram.reduce((a,b)=>a+b,0),q=f=>{let sum=0;for(let i=0;i<diagnostics.frameHistogram.length;i++){sum+=diagnostics.frameHistogram[i];if(sum>=total*f)return i;}return 0;};
    const av=diagnostics.av.slice().sort((a,b)=>a-b);
    return {sourceAvailable:!!lastSource,take:capturedTake?'capturing':savedTake?'ready':'empty',explorations:explorations.map(c=>c.variation),replayRemaining:replayQueue.length+replayActivations.length,audition:auditionState?{status:auditionEngine?'playing':'staged',current:Audition.d_current$Q(auditionState,model),baseRevision:auditionState.get(R.kw('base-revision'))}:null,elapsedSeconds:(performance.now()-diagnostics.started)/1000,missedEvents:diagnostics.missed,schedulerTicks:diagnostics.ticks,longTasks:diagnostics.longTasks,
      frameP95:q(.95),frameP99:q(.99),framesOver100Percent:diagnostics.frameHistogram.slice(101).reduce((a,b)=>a+b,0)/Math.max(1,total)*100,
      audioClock:ctx?{sampleRate:ctx.sampleRate,baseLatency:ctx.baseLatency,outputLatency:ctx.outputLatency,outputTimestamp:ctx.getOutputTimestamp?.(),nativeSeconds:ctx.currentTime,wallSeconds:(performance.now()-ctxWall)/1000,rate:ctx.currentTime/Math.max(.001,(performance.now()-ctxWall)/1000)}:null,
      avSubmitP95Ms:av[Math.floor(av.length*.95)]??null,avSamples:av.length,avHandoffP95Ms:diagnostics.handoff.slice().sort((a,b)=>a-b)[Math.floor(diagnostics.handoff.length*.95)]??null,
      activationMaxMs:Math.max(0,...diagnostics.activation),renderMaxMs:Math.max(0,...diagnostics.render),
      compileP95:diagnostics.compiles.slice().sort((a,b)=>a-b)[Math.floor(diagnostics.compiles.length*.95)]||0,
      preparation:{...scoreVoices.stats(),nativeTurnP95Ms:preparationP95(),nativeTurnMaxMs:preparationTurnMax},resources:audio?.resources(),gpu:[...views][0]?.shader?.resources?.(),storageTransactions:store.pending,history:model.get(R.kw('past')).cnt,namespaces:ownedNamespaces.size,evaluator:evaluatorClient?'worker':'main',
      recording:recording?{bytes:recording.bytes,pendingBytes:recording.pendingBytes,chunks:recording.count,error:recording.error?.message}:null,
      audioTiming:audio?.timingReport(),avTiming:'audio-clock activation to render submission acknowledgment (worker round trip is an upper bound); physical output latency is not measured'};}
  const deckHTML=key=>`<section class="deck" data-deck="${key}"><div class="deck-head"><span class="deck-title">${key.toUpperCase()} / ${key==='a'?'ATMOSPHERE':'PULSE'}</span><label class="file-label">＋ AUDIO<input type="file" accept="audio/*" data-file="${key}" aria-label="Load audio into deck ${key.toUpperCase()}"></label></div><div class="file-name" data-file-name="${key}">${key==='a'?'harmonic field / D minor':'deep-house pulse / melodic fragments'}</div><div class="deck-meta"><button data-deck-op="play" data-deck-key="${key}" title="Play/pause imported audio">▶</button><button data-deck-op="cue" data-deck-key="${key}">CUE</button><button data-deck-op="set-cue" data-deck-key="${key}" title="Set cue at current sample position">SET</button><button data-deck-op="jog" data-value="-0.25" data-deck-key="${key}" title="Jog back">−¼</button><button data-deck-op="jog" data-value="0.25" data-deck-key="${key}" title="Jog forward">＋¼</button><label>LOOP<select data-loop="${key}" aria-label="Deck ${key.toUpperCase()} loop"><option value="0">OFF</option><option value="1">1</option><option value="2">2</option><option value="4">4</option><option value="8">8</option></select></label><label>BPM<input type="number" value="${defaults.bpm}" min="40" max="240" data-sample-bpm="${key}" aria-label="Deck ${key.toUpperCase()} source BPM"></label><button data-deck-op="clear" data-deck-key="${key}" title="Remove imported audio">×</button></div><div class="eq">${['low','mid','high'].map(b=>`<label>${b.toUpperCase()}<input type="range" min="-18" max="12" step=".5" value="0" data-control="eq-${key}-${b}" aria-label="Deck ${key.toUpperCase()} ${b} EQ"></label>`).join('')}</div><div class="level-row"><span>LEVEL</span><input type="range" min="0" max="1" step=".01" value=".9" data-control="deck-${key}" aria-label="Deck ${key.toUpperCase()} level"><div class="meter"><i data-meter="${key}"></i></div></div></section>`;
  function mount(root,dispatch){
    const shadow=root.shadowRoot||root.attachShadow({mode:'open'});root.dataset.pelagicStage='';
    const layoutCSS=document.createElement('link');layoutCSS.rel='stylesheet';layoutCSS.href=moduleURL('layout.css');document.head.append(layoutCSS);
    shadow.innerHTML=`<link rel="stylesheet" href="${moduleURL('style.css')}"><div class="app"><header class="header"><div><div class="brand">PELAGIC</div><div class="edition">OMEGA / PERFORMANCE INSTRUMENT 002</div></div><div class="clock"><b data-time>00:00</b><span data-bar>BAR 01 · ${defaults.bpm} BPM</span></div></header><div class="visual"><canvas aria-label="Audio-reactive Pelagic shader"></canvas><div class="corner"><span class="live-dot"></span>PROCEDURAL / SOUND → LIGHT</div><div class="visual-actions"><button data-command="pelagic/eval">EVALUATE ↵</button><button data-freeze>FREEZE</button><button data-fullscreen aria-label="Fullscreen stage">⛶</button></div><div class="caption"><div class="act">I / THE DESCENT</div><h1>BATHYMETRY</h1><p>a signal beneath the surface</p></div></div><nav class="timeline" aria-label="Movement cues">${movements.map((m,i)=>`<button data-cue="${i}">${String(i+1).padStart(2,'0')} / ${m.name}<span>${String(i*16+1).padStart(2,'0')}—${(i+1)*16} BARS</span></button>`).join('')}</nav><div class="transport"><button class="primary" data-command="pelagic/play">▶ PLAY THE DESCENT</button><button data-command="pelagic/stop">■ STOP</button><label>BPM <input type="number" min="60" max="180" value="${defaults.bpm}" data-control="bpm" aria-label="Performance BPM"></label><label>SCENE <select data-control="scene" aria-label="Visual scene"><option value="-1">NARRATIVE</option>${movements.map((m,i)=>`<option value="${i}">${m.name}</option>`).join('')}</select></label><div class="spacer"></div><button data-record>● REC</button><button data-export title="Export original score, with current mixer settings">SCORE WAV ↗</button></div><div class="decks">${deckHTML('a')}${deckHTML('b')}</div><div class="mixer"><label>FILTER<input type="range" min=".15" max="2" step=".01" value="1" data-control="filter" aria-label="Master filter"></label><label>CROSSFADE<input type="range" min="0" max="1" step=".01" value=".5" data-control="crossfade" aria-label="Equal-power crossfade"><div class="cross-label"><span>ATMOSPHERE</span><span>PULSE</span></div></label><label>SPACE<input type="range" min="0" max=".9" step=".01" value=".45" data-control="space" aria-label="Reverb space"></label></div><div class="mixer"><label>SWING<input type="range" min="0" max=".45" step=".01" value=".12" data-control="swing" aria-label="Swing"></label><label>ECHO<input type="range" min="0" max=".7" step=".01" value=".32" data-control="echo" aria-label="Echo feedback"></label><label>MASTER<input type="range" min="0" max="1" step=".01" value=".72" data-control="master" aria-label="Master volume"></label></div><footer class="bottom"><div class="stems">${['kick','bass','hat','snare','melody'].map(s=>`<button class="active" data-stem="${s}">${s.toUpperCase()}</button>`).join('')}</div><div class="status" role="status">Ready · a four-movement descent / headphones welcome</div></footer></div>`;
    const $=s=>shadow.querySelector(s),canvas=$('canvas');let raf=0,dead=false,freezeTime=null,init=null,contextLost=false;
    let controls=null,lastControls=0,nextFrame=0,lastTelemetry=-Infinity;
    const v={canvas,shader:null,frozen:false,revision(phase,id,targetBeat){controls?.update(controlModel(),{phase,revision:id,targetBeat,...report()});},status(s){$('.status').textContent=s;$('.status').classList.toggle('error',s.startsWith('Edit rejected'));}};views.add(v);
    controls=performanceControls(shadow,{request,notice,perform:()=>dispatch({type:'command',command:'pelagic/perform'}),
      mix:(control,value)=>dispatch({type:'pelagic/control',control,value}),
      capture:()=>dispatch({type:'pelagic/capture'}),manifest:saveManifest,fork:forkTake,replay:replayTake,explore,auditionAlternative,source:sourceRevision,
      save:()=>download(JSON.stringify(validateSession(session()),null,2),'pelagic-session.pelagic.json','application/json'),load:loadSession,take:exportTake});
    const lost=event=>{event.preventDefault();contextLost=true;pause();if(recording)stopRecording({save:false}).catch(()=>{});notice('GPU context lost · transport paused',false);};
    const restored=async()=>{if(dead||disposed)return;const [source]=await sources();if(!v.shader?.worker){v.shader?.dispose({lose:false});v.shader=new SceneStage(canvas);v.shader.compile(shaderSource||source);if(mode==='performance'){v.shader.validateState(active);v.shader.setState(active,pausedBeat);}}contextLost=false;notice('GPU restored · press RESUME',false);};
    canvas.addEventListener('webglcontextlost',lost);canvas.addEventListener('webglcontextrestored',restored);
    init=sources().then(([s])=>afterPaint(()=>{if(dead||disposed)return;v.shader=createStage(canvas,{lost,restored,error:e=>{pause();if(recording)stopRecording({save:false}).catch(()=>{});notice('Stage unavailable · '+e.message,false);}});v.shader.compile(shaderSource||s);if(v.shader.worker&&audio?.probe)v.shader.connectClock(audio.graphicsClock());if(mode==='performance'){v.shader.validateState(active);v.shader.setState(active,current().beat);}return Promise.resolve(v.shader.ready).then(()=>{if(!dead&&!disposed)frame();});})).catch(e=>{if(!dead&&!disposed)v.status('Stage unavailable · '+e.message);});
    function renderAt(time,options={}){
      if(ctx)applyRevision();
      const drawStarted=performance.now(),beat=options.beat??time*config.bpm/60,bar=beat/4,act=Math.min(3,Math.floor((bar%64)/16)),scene=config.scene<0?Math.max(0,Math.min(3,bar/16-.15)):config.scene;
      const breakdown=(bar>=28&&bar<32)||(bar>=52&&bar<56);
      const energy=bar<8?.1:breakdown?.25:bar<16?.65:bar<32?.85:bar<48?1:bar<60?.8:.1;
      const submitted=v.shader?.draw({time,beat,scene,energy,accent:Math.exp(-(beat%1)*8)*energy,audioTime:ctx?.currentTime||0,audioStamp:performance.timeOrigin+performance.now(),width:(recording||recordPreparing)?1280:undefined,height:(recording||recordPreparing)?720:undefined,audioFrame:options.analyser?null:audio?.visualFrame(),bpm:config.bpm,running:playing,animate:playing||(audio?.voices.size||0)>0||Object.values(decks).some(d=>d.running),...options});
      diagnostics.render.push(performance.now()-drawStarted);if(diagnostics.render.length>256)diagnostics.render.shift();
      if(avExpected!==null){const expected=avExpected;avExpected=null;diagnostics.handoff.push(Math.max(0,(ctx.currentTime-expected)*1000));if(diagnostics.handoff.length>4096)diagnostics.handoff.shift();const completed=ok=>{if(disposed||ok===false)return;diagnostics.av.push(Math.max(0,(ctx.currentTime-expected)*1000));if(diagnostics.av.length>4096)diagnostics.av.shift();};if(submitted?.then)submitted.then(completed);else completed();}
      if(announcement!==null){const id=announcement;announcement=null;setTimeout(()=>{if(!disposed){ack('ACTIVE');for(const view of views)view.status('Revision '+id+' active');}},0);}
      if(performance.now()-lastTelemetry<100)return submitted;lastTelemetry=performance.now();
      const selected=mode==='performance'?['bathymetry','current','cathedral','afterglow'].indexOf(active.visual.scene):act,m=movements[Math.max(0,selected)];setText($('.caption h1'),selected<0?active.visual.scene.toUpperCase():m.name);setText($('.caption p'),selected<0?'a live scene':m.subtitle);setText($('.caption .act'),selected<0?'LIVE / CUSTOM SCENE':['I / THE DESCENT','II / THE PULSE','III / THE OPENING','IV / THE RETURN'][selected]);
      setText($('[data-time]'),String(Math.floor(time/60)).padStart(2,'0')+':'+String(Math.floor(time%60)).padStart(2,'0'));setText($('[data-bar]'),`BAR ${String(Math.floor(bar)+1).padStart(2,'0')} · ${config.bpm} BPM`);
      if(mode!=='performance')shadow.querySelectorAll('[data-cue]').forEach(b=>b.classList.toggle('current',+b.dataset.cue===act));
      for(const key of ['a','b'])$(`[data-meter="${key}"]`).style.width=Math.min(100,(v.shader?.volume||0)*400*config['deck-'+key])+'%';
      return submitted;
    }
    function frame(){if(dead||disposed)return;if(!root.isConnected){raf=requestAnimationFrame(frame);return;}
      const stamp=performance.now();if(ctx)applyRevision();if(stamp<nextFrame-2&&avExpected===null){raf=requestAnimationFrame(frame);return;}
      nextFrame=Math.max(nextFrame+1000/60,stamp);if(lastFrame){diagnostics.frameHistogram[Math.min(1000,Math.max(0,Math.round(stamp-lastFrame)))]++;}lastFrame=stamp;
      const now=current(),clockStamp=performance.now();if(playing&&ctx){const delta=audibleTime(ctx,clockStamp)-ctx.currentTime;now.time=Math.max(0,now.time+delta);now.beat=Math.max(0,now.beat+delta*config.bpm/60);}if(ctx)applyRevision();if(config.freeze||v.frozen){freezeTime??=now.time;}else freezeTime=null;
      if(!contextLost&&((!config.freeze&&!v.frozen&&(playing||(audio?.voices.size||0)>0||Object.values(decks).some(d=>d.running))) || v.shader?.frames===0))renderAt(freezeTime??now.time,{beat:now.beat,stamp:performance.timeOrigin+clockStamp});else v.shader?.suspend?.();
      raf=requestAnimationFrame(frame);
      for(const key of ['a','b']){const button=$(`[data-deck-op="play"][data-deck-key="${key}"]`);button.classList.toggle('active',!!decks[key]?.running);setText(button,decks[key]?.running?'Ⅱ':'▶');}
      if(stamp-lastControls>500){controls.update(controlModel(),{phase:revision?(revision.armed?'ARMED':'QUEUED'):'ACTIVE',targetBeat:revision?.beat,mode,...report()});lastControls=stamp;}
      if(recording?.error)stopRecording({save:false}).catch(e=>notice('Recording stopped · '+e.message));
      const rec=$('[data-record]');rec.classList.toggle('recording',!!recording);setText(rec,recording?'■ SAVE REC':'● REC');
    }
    shadow.addEventListener('click',e=>{
      e.stopPropagation();const b=e.target.closest('button');if(!b)return;
      if(b.dataset.command)dispatch({type:'command',command:b.dataset.command});
      else if(b.dataset.cue!==undefined)dispatch({type:'pelagic/cue',movement:+b.dataset.cue});
      else if(b.dataset.stem)dispatch({type:'pelagic/control',control:b.dataset.stem,value:!config[b.dataset.stem]});
      else if(b.hasAttribute('data-freeze'))dispatch({type:'pelagic/control',control:'freeze',value:!config.freeze});
      else if(b.hasAttribute('data-fullscreen')){if(document.fullscreenElement)document.exitFullscreen();else $('.visual').requestFullscreen();}
      else if(b.hasAttribute('data-runtime'))dispatch({type:'pelagic/runtime'});
      else if(b.hasAttribute('data-export'))dispatch({type:'pelagic/export'});
      else if(b.hasAttribute('data-record'))dispatch({type:'pelagic/record'});
      else if(b.dataset.deckOp)dispatch({type:'pelagic/deck',deck:b.dataset.deckKey,op:b.dataset.deckOp,value:+b.dataset.value||0});
    });
    shadow.addEventListener('input',e=>{const x=e.target;if(x.dataset.control)dispatch({type:'pelagic/control',control:x.dataset.control,value:+x.value});});
    shadow.addEventListener('change',e=>{const x=e.target;if(x.dataset.file&&x.files[0]){const token=crypto.randomUUID();files.set(token,x.files[0]);dispatch({type:'pelagic/sample',deck:x.dataset.file,token});}
      if(x.dataset.loop)dispatch({type:'pelagic/deck',deck:x.dataset.loop,op:'loop',value:+x.value});
      if(x.dataset.sampleBpm)dispatch({type:'pelagic/deck',deck:x.dataset.sampleBpm,op:'bpm',value:+x.value});});
    // Proof methods are attached to the owned DOM node, removed with the view.
    root.pelagic={renderAt,renderAudio,evaluate,stats:()=>({playing,audioTime:ctx?.currentTime,nextStep,lastEvaluation,evalCount,voices:audio?.voices.size||0,context:ctx?.state||'none',audition:auditionState?{status:auditionEngine?'playing':'staged',current:Audition.d_current$Q(auditionState,model),baseRevision:auditionState.get(R.kw('base-revision'))}:null,frames:v.shader?.frames||0,recording:!!recording,patterns:Object.keys(scheduled.patterns),pending:pending.length,mode,time:current().time,beat:current().beat,revision:revisionID(),phase:revision?(revision.armed?'ARMED':'QUEUED'):'ACTIVE',resources:audio?.resources(),gpu:v.shader?.resources?.(),diagnostics:{missed:diagnostics.missed,ticks:diagnostics.ticks,longTasks:diagnostics.longTasks}}),ready:()=>init,compilerReady:()=>{alive();return evaluator()?.request(null)??vm();},
      request,session,loadSession,captureTake,takeManifest:()=>plain(takeManifest()),forkTake,replayTake,explore,auditionAlternative,sourceRevision,record,stopRecording,exportRecording:async writable=>{if(recording)await stopRecording({save:false});if(!lastTake)throw new Error('No take');await lastTake.exportTo(writable);},midi:()=>controls,model:()=>plain(model),events:()=>events.slice(),diagnostics:report,wav,soundtrackAnalysis,shader:()=>v.shader,engine:()=>audio,auditionEngine:()=>auditionEngine,config:()=>({...config}),decks:()=>decks};
    return {update(model){const state=model.state||defaults;if(state.revision===undefined||state.revision>=revisionID())configure(state);
      for(const [k,value] of Object.entries(state)){const el=$(`[data-control="${k}"]`);if(el&&shadow.activeElement!==el)el.value=value;}
      shadow.querySelectorAll('[data-stem]').forEach(b=>b.classList.toggle('active',!!config[b.dataset.stem]));$('[data-freeze]').classList.toggle('active',!!config.freeze);
      for(const key of ['a','b']){const name=decks[key]?.name;$(`[data-file-name="${key}"]`).textContent=name||(key==='a'?'harmonic field / D minor':'deep-house pulse / melodic fragments');}
    },dispose(){dead=true;canvas.removeEventListener('webglcontextlost',lost);canvas.removeEventListener('webglcontextrestored',restored);controls?.dispose();cancelAnimationFrame(raf);v.shader?.dispose();views.delete(v);layoutCSS.remove();delete root.dataset.pelagicStage;delete root.pelagic;shadow.replaceChildren();}};
  }
  const unobserve=observePackage('pelagic',()=>({diagnostics:report(),pool:preparationWorkers({observe:true}),playing,revision:revisionID(),pending:pending.length,preparing:scoreVoices.stats(),evaluator:!!evaluatorClient,graphics:[...views].some(v=>!!v.shader?.worker),audioContext:ctx?.state||'none'}),{'audition-cancel':()=>request({kind:'audition-cancel'})});
  return {mount,async effect(e){alive();switch(e.op){case 'play':configure(e.args);play();break;case 'stop':stop();notice('All voices stopped',false);break;
    case 'perform':configure(e.args);play(0,true);break;
    case 'request':try{request(e.args);}catch(error){notice('Edit rejected · '+errorText(error));}break;
    case 'configure':configure(e.args);break;case 'cue':play(e.args.bar,mode==='performance');break;
    case 'capture':captureTake(e.args);break;
    case 'evaluate':unlock();await evaluate(e.args.source,{preview:!!e.args.preview});break;
    case 'sample':{unlock();const {token,deck}=e.args,file=files.get(token);files.delete(token);if(!file)throw new Error('Audio file expired');const hash=await store.asset(file);alive();const result=await decks[deck].load(file);decks[deck].hash=hash;alive();log('asset',{deck,hash,name:file.name});notice(`Deck ${deck.toUpperCase()} · ${result.name} · set its source BPM, then play`);break;}
    case 'deck':unlock();decks[e.args.deck].action(e.args.op,e.args.value);break;
    case 'record':await record();break;case 'export':await exportAudio();break;
    default:throw new Error('Unknown Pelagic effect '+e.op);}},
    dispose(){unobserve();capturedTake=null;savedTake=null;explorations=[];replayQueue=[];disposed=true;++evaluation;stopAudition(true);scoreVoices.dispose();closeIdlePreparationWorkers({whenDrained:true});evaluatorClient?.dispose();observer?.disconnect();stop();if(recording){const take=recording;recording=null;take.stop().catch(()=>{}).finally(()=>store.close());}else store.close();
      for(const d of Object.values(decks))d.dispose();for(const job of offlineRenders)job.abort();offlineRenders.clear();audio?.dispose();ctx?.close();files.clear();handles.clear();pending=[];patterns.clear();for(const url of urls)URL.revokeObjectURL(url);
      for(const v of views)v.shader?.dispose();}
  };
}
