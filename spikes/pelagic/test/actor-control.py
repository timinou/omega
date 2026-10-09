#!/usr/bin/env python3
"""Actor/native preparation control: demand, stale credits, cancel and restart."""
import functools,http.server,threading,json,os
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];PROOF=Path(os.environ.get('PELAGIC_PREPARATION_PROOF',ROOT/'proof/preparation'));PROOF.mkdir(parents=True,exist_ok=True)
class Handler(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
 def translate_path(self,path):
  prefix='/pkg/pelagic/actor/'
  if path.startswith(prefix):
   relative=path[len(prefix):].split('?')[0]
   if relative in ['host.mjs','native.mjs','out/prepare.mjs','out/prepare-bridge.mjs']:return str(ROOT/'dist/actor'/relative)
  return super().translate_path(path)
 def do_GET(self):
  if self.path=='/control':
   self.send_response(200);self.send_header('Content-type','text/html');self.end_headers();self.wfile.write(b'<!doctype html><title>Actor control proof</title>');return
  super().do_GET()
s=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT/'dist/local')));threading.Thread(target=s.serve_forever,daemon=True).start()
results=[]
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(headless=True,executable_path=os.environ.get('CHROMIUM','/home/user/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'),args=['--no-sandbox'])
  for mode in ['worker','worker-slice','actor-bridge','actor-fixed','actor','prebuilt']:
   page=browser.new_page();page.goto(f'http://127.0.0.1:{s.server_port}/control')
   result=page.evaluate('''async mode=>{
    const worker=new Worker('/pkg/pelagic/prepare-worker.mjs',{type:'module'}),events=[];
    worker.onmessage=({data})=>events.push({...data,at:performance.now()});
    const wait=async fn=>{const end=performance.now()+20000;while(!fn()){const error=events.find(e=>e.op==='error');if(error)throw new Error(error.error);if(performance.now()>end)throw new Error('Control test timed out: '+JSON.stringify(events));await new Promise(r=>setTimeout(r,5));}return fn();};
    try{
     worker.postMessage({op:'init',mode});await wait(()=>events.find(e=>e.op==='ready'));
     const busyBefore=performance.now();worker.postMessage({op:'prepare',id:1});worker.postMessage({op:'ping',id:6});await wait(()=>events.find(e=>e.op==='chunk'));const busyPong=await wait(()=>events.find(e=>e.op==='pong'&&e.id===6));
     await new Promise(r=>setTimeout(r,100));if(events.filter(e=>e.op==='chunk').length!==1)throw new Error('Unbounded preparation');
     const before=performance.now();worker.postMessage({op:'ping',id:7});const pong=await wait(()=>events.find(e=>e.op==='pong'&&e.id===7));
     worker.postMessage({op:'credit',id:999});await new Promise(r=>setTimeout(r,50));if(events.filter(e=>e.op==='chunk').length!==1)throw new Error('Stale credit advanced job');
     worker.postMessage({op:'credit',id:1});await wait(()=>events.find(e=>e.op==='chunk'&&e.start===events.find(e=>e.op==='chunk').rows.length));
     worker.postMessage({op:'cancel',id:1});await wait(()=>events.find(e=>e.op==='cancelled'));
     worker.postMessage({op:'prepare',id:2});await wait(()=>events.find(e=>e.op==='chunk'&&e.id===2&&e.start===0));
     worker.postMessage({op:'credit',id:1});await new Promise(r=>setTimeout(r,50));if(events.filter(e=>e.op==='chunk'&&e.id===2).length!==1)throw new Error('Cancelled credit advanced replacement');
     return {mode,busyPingMs:busyPong.at-busyBefore,pingMs:pong.at-before,bounded:true,cancelled:true,restarted:true,staleCreditsIgnored:true};
    }finally{worker.terminate();}
   }''',mode)
   results.append(result);print(json.dumps(result),flush=True);page.close()
  browser.close()
finally:s.shutdown();s.server_close();(PROOF/'control.json').write_text(json.dumps(results,indent=2)+'\n')
