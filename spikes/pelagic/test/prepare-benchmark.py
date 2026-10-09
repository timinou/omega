#!/usr/bin/env python3
"""Same compiled BL kernel, main thread versus native worker versus BL actors."""
import functools,http.server,threading,json,os
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=Path(os.environ.get('PELAGIC_LOCAL_OUT',ROOT/'dist/local'));PROOF=Path(os.environ.get('PELAGIC_PREPARATION_PROOF',ROOT/'proof/preparation'));PROOF.mkdir(parents=True,exist_ok=True)
class Handler(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
 def translate_path(self,path):
  prefix='/pkg/pelagic/actor/'
  if path.startswith(prefix):
   relative=path[len(prefix):].split('?')[0]
   if relative in ['host.mjs','native.mjs','out/prepare.mjs','out/prepare-bridge.mjs']:return str(ROOT/'dist/actor'/relative)
  return super().translate_path(path)
 def do_GET(self):
  if self.path=='/benchmark':
   self.send_response(200);self.send_header('Content-type','text/html');self.end_headers();self.wfile.write(b'<!doctype html><title>BL preparation measurement</title>');return
  super().do_GET()
s=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(OUT)));threading.Thread(target=s.serve_forever,daemon=True).start()
results=[];errors=[]
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(headless=True,executable_path=os.environ.get('CHROMIUM','/home/user/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'),args=['--no-sandbox'])
  for repeat in range(int(os.environ.get('PELAGIC_BENCH_REPEATS','3'))):
   for mode in os.environ.get('PELAGIC_BENCH_MODES','main,cooperative,worker,actor-bridge,actor,prebuilt').split(','):
    page=browser.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.goto(f'http://127.0.0.1:{s.server_port}/benchmark')
    value=page.evaluate('''async mode=>{
     const [P,Score,B]=await Promise.all([import('/pkg/pelagic/prepare.mjs'),import('/out/pelagic.score.mjs'),import('/pkg/pelagic/values.mjs')]);
     const base=B.createScoreSource(Score.d_step,Score.d_defaults),gaps=[];let last=performance.now();
     const heartbeat=setInterval(()=>{const now=performance.now();gaps.push(now-last);last=now;},5);
     const before=performance.now();let source,stats;
     try{
      if(mode==='main'||mode==='cooperative'){for(let i=0;i<1024;i++){base(i);if(mode==='cooperative'&&i%16===15)await new Promise(r=>setTimeout(r,0));}source=base;stats={elapsedMs:performance.now()-before};}
      else {source=P.prepareScore(base,()=>new Worker('/pkg/pelagic/prepare-worker.mjs',{type:'module'}),{mode,delay:0});source.start();
       while(!source.stats().done){if(source.stats().error)throw new Error(source.stats().error);if(performance.now()-before>60000)throw new Error('Benchmark timed out');await new Promise(r=>setTimeout(r,5));}stats=source.stats();}
      await new Promise(r=>setTimeout(r,30));clearInterval(heartbeat);
      const data=JSON.stringify(Array.from({length:1024},(_,i)=>source(i)));
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(data))),x=>x.toString(16).padStart(2,'0')).join('');
      gaps.sort((a,b)=>a-b);return {mode,...stats,heartbeatP95Ms:gaps[Math.floor((gaps.length-1)*.95)],heartbeatMaxMs:Math.max(...gaps),bytes:data.length,digest};
     }finally{clearInterval(heartbeat);source?.dispose?.();}
    }''',mode)
    value['repeat']=repeat;results.append(value);print(json.dumps(value),flush=True);page.close()
  browser.close()
 assert not errors,errors
 assert len({r['digest'] for r in results})==1,'Score outputs differ'
finally:
 s.shutdown();s.server_close();(PROOF/'benchmark.json').write_text(json.dumps({'results':results,'errors':errors},indent=2)+'\n')
