import {test} from 'node:test';
import assert from 'node:assert/strict';
import {imp} from './paths.mjs';
test('local compiled BL boundary converts data and preserves numeric results', {skip:!process.env.PELAGIC_OUT}, async()=>{
 const [R,B,Bridge,J,Hash]=await Promise.all(['rt','pelagic.browser','pelagic.bridge','interop','ed.hash'].map(imp));
 for(const text of ['', 'hello', 'é', '💧', 'A💧é'])assert.equal(Hash.d_string_hash(text),R.strHash(text));
 const browser=J.requireNamespace('pelagic.browser');
 assert.equal(browser['to-js'](R.flt(.125)),.125);
 assert.deepEqual(browser['to-js'](R.hashMap(R.kw('notes'),R.vec(60,64))),{notes:[60,64]});
 assert.equal(B.d_to_bl({space:.45}).get(R.kw('space')).v,.45);
 assert.equal(typeof Bridge.d_live_bindings.get('av').get('pattern-stop'),'function');
 assert.throws(()=>browser['to-js'](R.dec(15,1)),/decimal/);
 assert.equal(await browser['read-text']('data:text/plain,local'),'local');
 const fetch=globalThis.fetch;
 try { globalThis.fetch=async()=>new Response('missing',{status:404});
   await assert.rejects(browser['read-text']('missing.glsl'),/Cannot load/);
 } finally {globalThis.fetch=fetch;}
 const prior=globalThis.AudioContext;
 try {globalThis.AudioContext=class {constructor(options){this.options=options;}};
   assert.deepEqual(browser['audio-context']().options,{latencyHint:'interactive'});
 } finally {if(prior)globalThis.AudioContext=prior;else delete globalThis.AudioContext;}
 const node={textContent:'old'};B.d_set_text(node,'new');assert.equal(node.textContent,'new');
});

test('BL worker client correlates replies, bounds requests and rejects all work on disposal', {skip:!process.env.PELAGIC_OUT}, async()=>{
 const [R,W]=await Promise.all(['rt','js.worker'].map(imp));
 const prior=globalThis.Worker,workers=[];
 class FakeWorker {
  listeners=new Map();sent=[];terminated=false;
  constructor(url,options){this.url=url;this.options=options;workers.push(this);}
  addEventListener(type,fn){this.listeners.set(type,fn);}
  postMessage(data){this.sent.push(data);}
  terminate(){this.terminated=true;}
  emit(type,data){this.listeners.get(type)({data});}
 }
 globalThis.Worker=FakeWorker;
 try {
  const client=W.d_client('worker.mjs'),worker=workers[0];
  const first=client.request(R.hashMap(R.kw('notes'),R.vec(60,64))),second=client.request(null);
  assert.deepEqual(worker.options,{type:'module'});
  assert.deepEqual(worker.sent[0].value,{notes:[60,64]});
  worker.emit('message',{id:worker.sent[1].id,value:'second'});
  worker.emit('message',{id:worker.sent[0].id,value:'first'});
  assert.deepEqual(await Promise.all([first,second]),['first','second']);
  const bad=client.request(null);worker.emit('message',{id:worker.sent.at(-1).id,error:'bad patch'});
  await assert.rejects(bad,/bad patch/);assert.equal(client.closed(),false);
  const pending=Array.from({length:32},()=>client.request(null));
  await assert.rejects(client.request(null),/limit/);
  const rejected=Promise.all(pending.map(p=>assert.rejects(p,/disposed/)));
  client.dispose();await rejected;
  assert.equal(worker.terminated,true);assert.equal(client.closed(),true);
  await assert.rejects(client.request(null),/closed/);
  const broken=W.d_client('broken.mjs'),transport=workers.at(-1);
  const waiting=broken.request(null),failed=assert.rejects(waiting,/bootstrap failed/);
  transport.emit('message',{id:transport.sent[0].id,error:'bootstrap failed',fatal:true});
  await failed;assert.equal(broken.closed(),true);assert.equal(transport.terminated,true);
 } finally {if(prior)globalThis.Worker=prior;else delete globalThis.Worker;}
});


test('preloaded namespace functions and macro helpers boot without source compilation', {skip:!process.env.PELAGIC_OUT}, async()=>{
 const [R,Repl,Cache]=await Promise.all(['rt','repl','boot-cache'].map(imp));
 assert.ok(Cache.PRELOADS.some(([ns,names])=>ns==='pelagic.overtone'&&names.includes('sin-osc')));
 const vm=await Repl.start(()=>{throw new Error('Boot cache must not fetch source');});
 assert.ok(vm.report.every(r=>r.cached&&!r.failed.length),JSON.stringify(vm.report));
 vm.Env.declare_ns('preload.proof');vm.Env.in_ns('preload.proof');
 const values=vm.evalString('(pelagic.overtone/definst proof-voice [freq 440] (pelagic.overtone/sin-osc freq)) (proof-voice 220)');
 assert.ok(values);
 const {releaseNamespace}=await imp('interop');releaseNamespace('preload.proof');
 vm.Env.in_ns('user');
});

test('BL worker server waits for boot, serializes data and reports fatal boot failure', {skip:!process.env.PELAGIC_OUT}, async()=>{
 const [R,W]=await Promise.all(['rt','js.worker'].map(imp));
 const prior=globalThis.self,replies=[],listeners=new Map();
 globalThis.self={addEventListener(type,fn){listeners.set(type,fn);},postMessage(value){replies.push(value);}};
 try {
  let finish;const ready=new Promise(resolve=>finish=resolve);
  W.d_serve(ready,value=>value);
  listeners.get('message')({data:{id:1,value:{notes:[60,64]}}});
  listeners.get('message')({data:{id:2,value:'next'}});
  await new Promise(resolve=>setTimeout(resolve,0));assert.deepEqual(replies,[]);
  finish();await new Promise(resolve=>setTimeout(resolve,0));
  assert.deepEqual(replies,[{id:1,value:{notes:[60,64]}},{id:2,value:'next'}]);
  W.d_serve(Promise.reject(new Error('bootstrap failed')),value=>value);
  listeners.get('message')({data:{id:3,value:null}});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.deepEqual(replies.at(-1),{id:3,fatal:true,error:'bootstrap failed'});
 } finally {if(prior)globalThis.self=prior;else delete globalThis.self;}
});

test('compiled BL projects realm clocks and bounds adaptive rendering with hysteresis', {skip:!process.env.PELAGIC_OUT}, async()=>{
 const J=await imp('interop');await imp('pelagic.browser');const b=J.requireNamespace('pelagic.browser');
 const project=b['project-clock'],scale=b['render-scale'];
 assert.deepEqual(project(10,20,120,true,100000,100250),{time:10.25,beat:20.5});
 assert.deepEqual(project(10,20,120,false,100000,105000),{time:10,beat:20});
 assert.deepEqual(project(10,20,120,true,100000,99000),{time:10,beat:20});
 assert.equal(scale(1,16.67,3),1);assert.equal(scale(.25,40,20),.25);
 assert.equal(scale(.5,16.67,7),.5);assert.equal(scale(.5,30,3),.425);
 assert.equal(scale(.5,16.67,13),.425);assert.equal(scale(.5,16.67,3),.51);
});

test('compiled score cache retains native graphs, evicts bounded entries and preserves muted score behavior', {skip:!process.env.PELAGIC_OUT}, async()=>{
 const [R,B,S,J]=await Promise.all(['rt','pelagic.browser','pelagic.score','interop'].map(imp));
 let calls=0;const cached=B.d_score_source(index=>{calls++;return R.vec(index);},null);
 assert.deepEqual(cached(1),[1]);assert.equal(cached(1),cached(1));assert.equal(calls,1);
 for(let i=2;i<=1025;i++)cached(i);cached(1);assert.equal(calls,1026);
 const score=B.d_score_source(S.d_step,S.d_defaults),plain=J.blToJS;
 const stem=v=>({lantern:'melody',tide:'atmosphere',air:'air'})[v.synth]||v.synth;
 for(const index of [0,64,128,130,132,134,191,255,514,766,896,1023]){
  for(const disabled of ['kick','bass','hat','snare','melody']){
   const config=S.d_defaults.assoc(R.kw(disabled),false);
   assert.deepEqual(score(index).filter(v=>stem(v)!==disabled),plain(S.d_step(index,config)),`${index}:${disabled}`);
  }
 }
});

test('audible clock extrapolates fresh output timestamps and rejects stale or ahead samples', {skip:!process.env.PELAGIC_OUT}, async()=>{
 const J=await imp('interop');await imp('pelagic.browser');const audible=J.requireNamespace('pelagic.browser')['audible-time'];
 class Clock{currentTime=4;getOutputTimestamp(){return {contextTime:3.9,performanceTime:1000};}}
 const context=new Clock();
 assert.equal(audible(context,1050),3.9499999999999997);
 assert.equal(audible(context,1500),4);assert.equal(audible(context,3000),4);assert.equal(audible(context,900),4);
 assert.equal(audible(new(class{currentTime=4;})(),1050),4);
});

test('BL audio equivalence isolates visual revisions while preserving every sound-affecting field', {skip:!process.env.PELAGIC_OUT}, async()=>{
 const [R,P]=await Promise.all(['rt','pelagic.performance'].map(imp));
 const state=P.d_initial().get(R.kw('current'));
 assert.equal(P.d_audio_equivalent$Q(state,state.assoc(R.kw('visual'),R.hashMap(R.kw('scene'),'afterglow'))),true);
 for(const field of ['config','patterns','assets','variation'])assert.equal(P.d_audio_equivalent$Q(state,state.assoc(R.kw(field),R.hashMap(R.kw('changed'),true))),false,field);
});

test('native BL preparation uses the same score and yields only after securing its safety reserve',{skip:!process.env.PELAGIC_OUT},async()=>{
 const [B,Score]=await Promise.all(['pelagic.browser','pelagic.score'].map(imp));
 for(const start of [0,128,448,640,1008]){
  const chunk=B.d_score_chunk(start,16);assert.equal(chunk.length,16);
  for(let i=0;i<16;i++)assert.deepEqual(chunk[i],B.d_to_js(Score.d_step(start+i,Score.d_defaults)));
 }
 assert.equal(B.d_continue_preparation$Q(0.9,0,100),true);
 assert.equal(B.d_continue_preparation$Q(2,0,3),true);
 assert.equal(B.d_continue_preparation$Q(2,0,4),false);
});
