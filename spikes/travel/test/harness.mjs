// Isolated travel desk for tests: offline bl-ed (never 8790) + the travel host with the REAL native browser adapter.
import os from 'node:os';import path from 'node:path';import fs from 'node:fs/promises';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {startTravelHost} from '../serve.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),omega=path.resolve(here,'../../..');
export async function startDesk({edPort=18841,port=18842,base,searchFn,backend}={}){
 if([edPort,port].includes(8790))throw Error('Refusing the live world port');
 // Always serve freshly built package assets (stale vendor/bl-ed/web/pkg copies caused false failures). TRAVEL_SKIP_BUILD=1 to skip.
 if(process.env.TRAVEL_SKIP_BUILD!=='1'){const {execFileSync}=await import('node:child_process');execFileSync(path.join(here,'../build.sh'),{stdio:'pipe'});}
 base||=await fs.mkdtemp(path.join(os.tmpdir(),'travel-test-'));
 const world=path.join(base,'world'),state=path.join(base,'browser-state'),data=path.join(base,'travel-data');
 for(const d of [world,state,data])await fs.mkdir(d,{recursive:true});
 await fs.copyFile(path.join(here,'../trip.bl.org'),path.join(world,'trip.bl.org'));
 const native=path.join(omega,'spikes/browser/.native/paths.json');
 if(!process.env.BROWSER_NATIVE_CONFIG&&await fs.access(native).then(()=>true,()=>false))process.env.BROWSER_NATIVE_CONFIG=native;
 process.env.BROWSER_STATE_ROOT=state;process.env.BROWSER_BACKEND=backend||process.env.BROWSER_BACKEND||'native';
 const net=await import('node:net');
 for(const p of [edPort,port])if(!await new Promise(r=>{const s=net.createServer();s.once('error',()=>r(false));s.listen(p,'127.0.0.1',()=>s.close(()=>r(true)))}))throw Error('Port '+p+' is already in use; refusing to share a stale server with this isolated test');
 const ed=spawn(path.join(omega,'bin/bl-ed'),['--offline','--memory','--port',String(edPort),'--root',world],{cwd:world,env:{...process.env,OMEGA_HOME:omega},stdio:['ignore','pipe','pipe'],detached:true});
 let log='';ed.stdout.on('data',d=>log+=d);ed.stderr.on('data',d=>log+=d);
 const up=`http://127.0.0.1:${edPort}`;
 for(let i=0;i<120;i++){if(await fetch(up+'/').then(r=>r.ok,()=>false))break;if(ed.exitCode!=null)throw Error('bl-ed exited: '+log);await new Promise(r=>setTimeout(r,500));}
 const host=await startTravelHost({root:world,state,dataDir:data,upstream:up,port,...(searchFn?{searchFn}:{})});
 const stop=async()=>{await host.stop().catch(()=>{});const gone=new Promise(r=>ed.exitCode!=null?r():ed.once('exit',r));try{process.kill(-ed.pid,'SIGTERM')}catch{}
  await Promise.race([gone,new Promise(r=>setTimeout(r,5000))]);
  for(let i=0;i<20&&!await new Promise(r=>{const s=net.createServer();s.once('error',()=>r(false));s.listen(edPort,'127.0.0.1',()=>s.close(()=>r(true)))});i++)await new Promise(r=>setTimeout(r,250));};
 return {host,base,world,state,data,ed,url:host.url,stop,log:()=>log};
}
