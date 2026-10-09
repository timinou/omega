// Same browser worker and compiled BL modules on Node Workers. CPU time separates
// active computation from the host's substantial wall-clock scheduling/I/O noise.
import {Worker as NodeWorker} from 'node:worker_threads';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,copyFileSync,symlinkSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {prepareScore} from '../host/prepare.mjs';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'..');
if(process.argv[2]==='--one'){
 const mode=process.argv[3],stage=mkdtempSync(join(tmpdir(),'pelagic-native-cpu-'));
 const local=resolve(process.env.PELAGIC_LOCAL_OUT||join(root,'dist/local')),pkg=join(stage,'pkg/pelagic');
 mkdirSync(join(pkg,'actor/out'),{recursive:true});symlinkSync(join(local,'out'),join(stage,'out'),'dir');
 for(const name of ['prepare-worker.mjs','values.mjs'])copyFileSync(join(local,'pkg/pelagic',name),join(pkg,name));
 for(const name of ['host.mjs','native.mjs','out/prepare.mjs'])copyFileSync(join(local,'pkg/pelagic/actor',name),join(pkg,'actor',name));
 const bootstrap=join(stage,'realm.mjs');
 writeFileSync(bootstrap,`import {parentPort,workerData} from 'node:worker_threads';
 import {readFile} from 'node:fs/promises';
 globalThis.self=globalThis;const listeners=[];
 self.addEventListener=(name,fn)=>{if(name==='message')listeners.push(fn);};
 self.postMessage=value=>parentPort.postMessage(value);
 globalThis.fetch=async url=>({ok:true,json:async()=>JSON.parse(await readFile(url,'utf8'))});
 await import(workerData.module);
 parentPort.on('message',data=>{for(const fn of listeners)fn({data});});`);
 let ended;
 class BrowserWorker extends NodeWorker{
  constructor(){super(pathToFileURL(bootstrap),{workerData:{module:pathToFileURL(join(pkg,'prepare-worker.mjs')).href}});}
  addEventListener(name,fn){this.on(name,value=>fn(name==='message'?{data:value}:{message:value.message}));}
  terminate(){ended=super.terminate();return ended;}
 }
 const before=process.cpuUsage(),started=performance.now();
 const source=prepareScore(i=>{throw new Error('Unexpected fallback: '+i);},()=>new BrowserWorker(),{budgetMs:mode==='actor-fixed'?0:4,delay:0});
 try{
  source.start();
  while(!source.stats().done){if(source.stats().error)throw new Error(source.stats().error);if(performance.now()-started>90000)throw new Error('Preparation deadline');await new Promise(r=>setTimeout(r,2));}
  await ended;
  const cpu=process.cpuUsage(before),stats=source.stats();
  const data=JSON.stringify(Array.from({length:1024},(_,i)=>source(i)));
  console.log(JSON.stringify({...stats,benchmark:mode,cpuMs:(cpu.user+cpu.system)/1000,peakRssKiB:process.resourceUsage().maxRSS,bytes:Buffer.byteLength(data),digest:createHash('sha256').update(data).digest('hex')}));
 }finally{source.dispose();await ended;rmSync(stage,{recursive:true,force:true});}
}else{
 const modes=(process.env.PELAGIC_BENCH_MODES||'actor,actor-fixed').split(','),results=[];
 const repeats=Number(process.env.PELAGIC_BENCH_REPEATS||3);
 for(let repeat=0;repeat<repeats;repeat++)for(const mode of [...modes.slice(repeat%modes.length),...modes.slice(0,repeat%modes.length)]){
  const run=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--one',mode],{encoding:'utf8',timeout:120000});
  if(run.status!==0)throw new Error(run.stderr||run.stdout||String(run.error));
  const value={...JSON.parse(run.stdout),repeat};results.push(value);console.log(JSON.stringify(value));
 }
 if(new Set(results.map(x=>x.digest)).size!==1)throw new Error('Score outputs differ');
 const proof=resolve(process.env.PELAGIC_PREPARATION_PROOF||join(root,'proof/native-actors/final'));
 mkdirSync(proof,{recursive:true});writeFileSync(join(proof,'cpu.json'),JSON.stringify({node:process.version,results},null,2)+'\n');
}
