#!/usr/bin/env python3
"""Actual compiled actor pool: repeated leases, fair independent jobs, cancellation."""
import functools,http.server,json,os,threading
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ['PELAGIC_LOCAL_OUT'])
PROOF=Path(os.environ.get('PELAGIC_PREPARATION_PROOF',ROOT/'proof/shared-compute'))
PROOF.mkdir(parents=True,exist_ok=True)
class Handler(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  if self.path=='/pool-proof':
   self.send_response(200);self.send_header('Content-type','text/html');self.end_headers();self.wfile.write(b'<!doctype html><title>Shared actor pool proof</title>');return
  super().do_GET()
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(OUT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(headless=True,executable_path=os.environ.get('CHROMIUM','/home/user/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'),args=['--no-sandbox'])
  page=browser.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(f'http://127.0.0.1:{server.server_port}/pool-proof')
  result=page.evaluate('''async()=>{
   const P=await import('/pkg/pelagic/compute-worker.mjs'),url='/pkg/pelagic/prepare-worker.mjs';
   const wait=async fn=>{const deadline=performance.now()+20000;while(!fn()){if(performance.now()>deadline)throw new Error('Pool deadline '+JSON.stringify(P.preparationWorkers()));await new Promise(r=>setTimeout(r,1));}};
   const factory=()=>new Worker(url,{type:'module'}),cancel=[],chunks=[],gaps=[];let last=performance.now();
   const heartbeat=setInterval(()=>{const now=performance.now();gaps.push(now-last);last=now;},5);
   const lease=async()=>{const worker=P.createPreparationWorker(url,factory),events=[];
    worker.addEventListener('message',({data})=>events.push(data));worker.addEventListener('error',e=>{throw new Error(e.message);});
    worker.postMessage({op:'init',budgetMs:4});await wait(()=>events.some(e=>e.op==='ready'));return {worker,events};};
   try{
    for(let i=0;i<100;i++){
     const a=await lease();a.worker.postMessage({op:'prepare',id:1});await wait(()=>a.events.some(e=>e.op==='chunk'));
     // Time-bounded packets have variable lengths; compare a fixed score prefix.
     const rows=[],graphs=new Map();let consumed=0;
     while(rows.length<16){
      await wait(()=>a.events.filter(e=>e.op==='chunk').length>consumed);
      const packet=a.events.filter(e=>e.op==='chunk')[consumed++];
      if(packet.start!==rows.length)throw new Error('Noncontiguous score packet');
      rows.push(...packet.rows);for(const graph of packet.graphs)graphs.set(graph.id,graph);
      if(rows.length<16)a.worker.postMessage({op:'credit',id:1});
     }
     // Compare rows independently of newly discovered graphs beyond the prefix.
     chunks.push(JSON.stringify(rows.slice(0,16)));
     const start=performance.now();a.worker.terminate();await wait(()=>P.preparationWorkers().resetting===0);cancel.push(performance.now()-start);
     if(P.preparationWorkers().active!==0)throw new Error('Lease leaked');
    }
    if(new Set(chunks).size!==1)throw new Error('Pooled jobs changed score prefix');
    const complete=async()=>{
     const a=await lease(),rows=[],graphs=new Map();let consumed=0;
     a.worker.postMessage({op:'prepare',id:1});
     while(rows.length<1024){
      await wait(()=>a.events.filter(e=>e.op==='chunk').length>consumed);
      const packet=a.events.filter(e=>e.op==='chunk')[consumed++];
      if(packet.start!==rows.length)throw new Error('Noncontiguous full score');
      rows.push(...packet.rows);for(const graph of packet.graphs)graphs.set(graph.id,graph);
      a.worker.postMessage({op:'credit',id:1});
     }
     await wait(()=>a.events.some(e=>e.op==='done'));a.worker.terminate();
     await wait(()=>P.preparationWorkers().resetting===0);
     return JSON.stringify({rows,graphs:[...graphs.values()]});
    };
    const full=await complete();if(full!==await complete())throw new Error('Complete pooled scores differ');
    const a=await lease(),b=await lease();a.worker.postMessage({op:'prepare',id:1});b.worker.postMessage({op:'prepare',id:1});
    await wait(()=>a.events.some(e=>e.op==='chunk')&&b.events.some(e=>e.op==='chunk'));
    // Read the real actor registry through the physical Worker boundary.
    P.preparationWorkers({observe:true});
    await wait(()=>P.preparationWorkers().actors.some(w=>w.available&&w.snapshot.resources.length>=3));
    const observed=P.preparationWorkers().actors[0];
    if(!observed.snapshot.resources.some(row=>row.owner!==null&&row.owner!==undefined))throw new Error('Owned preparation edge missing '+JSON.stringify(observed));
    a.worker.terminate();await wait(()=>P.preparationWorkers().resetting===0);
    b.worker.postMessage({op:'credit',id:1});await wait(()=>b.events.filter(e=>e.op==='chunk').length===2);
    b.worker.terminate();await wait(()=>P.preparationWorkers().resetting===0);
    const pooled=P.preparationWorkers();if(pooled.created!==1||pooled.forced!==0)throw new Error('Pool did not reuse cleanly '+JSON.stringify(pooled));
    await new Promise(r=>setTimeout(r,100));P.closeIdlePreparationWorkers();
    const sorted=xs=>[...xs].sort((a,b)=>a-b),percentile=(xs,q)=>sorted(xs)[Math.floor((xs.length-1)*q)];
    const data=new TextEncoder().encode(full),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),x=>x.toString(16).padStart(2,'0')).join('');
    return {cycles:100,completeScores:2,scoreRows:1024,observed,pooled,final:P.preparationWorkers(),cancelP50Ms:percentile(cancel,.5),cancelP95Ms:percentile(cancel,.95),cancelP99Ms:percentile(cancel,.99),cancelMaxMs:Math.max(...cancel),heartbeatP50Ms:percentile(gaps,.5),heartbeatP95Ms:percentile(gaps,.95),heartbeatP99Ms:percentile(gaps,.99),heartbeatMaxMs:Math.max(...gaps),digest,independentSessions:true};
   }finally{clearInterval(heartbeat);P.closeIdlePreparationWorkers();}
  }''')
  assert not errors,errors
  assert result['final']['workers']==0,result
  print(json.dumps(result,indent=2));(PROOF/'pool.json').write_text(json.dumps(result,indent=2)+'\n')
  browser.close()
finally:server.shutdown();server.server_close()
