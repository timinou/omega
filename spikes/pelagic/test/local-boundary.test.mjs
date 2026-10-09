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
