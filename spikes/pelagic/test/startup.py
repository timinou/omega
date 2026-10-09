#!/usr/bin/env python3
"""Compare static bundles with fresh browser contexts; writes timings as JSON.
Usage: python3 test/startup.py dist/local [other/static/root]
The report is evidence, not a machine-dependent pass/fail threshold.
"""
import functools,http.server,json,os,statistics,sys,threading
from pathlib import Path
from playwright.sync_api import sync_playwright
class Handler(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
reports={}
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path=os.environ.get('CHROMIUM','/home/user/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'),args=['--no-sandbox','--use-gl=angle','--use-angle=gl','--enable-gpu','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'])
 try:
  for root in sys.argv[1:]:
   server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(Path(root).resolve())))
   threading.Thread(target=server.serve_forever,daemon=True).start()
   runs=[]
   try:
    for _ in range(3):
     context=browser.new_context(viewport={'width':1440,'height':1080})
     page=context.new_page()
     page.add_init_script('let editor;Object.defineProperty(window,"blEd",{configurable:true,get:()=>editor,set:value=>{editor=value;window.editorReadyMs=performance.now();}});window.longTasks=[];new PerformanceObserver(l=>longTasks.push(...l.getEntries().map(e=>({start:e.startTime,ms:e.duration})))).observe({type:"longtask",buffered:true});')
     page.goto(f'http://127.0.0.1:{server.server_port}/',wait_until='commit')
     host='document.querySelector(".view-host .view-body").pelagic'
     page.wait_for_function('window.blEd && document.querySelector(".view-host .view-body")?.pelagic',timeout=90000)
     editor=page.evaluate('editorReadyMs')
     graphics=page.evaluate(host+'.ready().then(()=>performance.now())')
     page.get_by_role('button',name='▶ PERFORM',exact=True).click()
     values=page.evaluate('''async()=>{
      const h=document.querySelector('.view-host .view-body').pelagic,times=[];
      for(let i=0;i<4;i++) {const start=performance.now(),r=await h.evaluate('(av/configure {:space 0.2})');if(!r.ok)throw new Error(r.error);times.push(performance.now()-start);if(i===0)await new Promise(resolve=>setTimeout(resolve,1000));}
      return {firstEval:times[0],repeatEval:times.slice(1),mainCompiler:blHost.lang.state,longTasks};
     }''')
     runs.append({'editor':editor,'graphics':graphics,**values});context.close()
    reports[root]={'runs':runs,'medianMs':{key:round(statistics.median(r[key] for r in runs),1) for key in ['editor','graphics','firstEval']},'repeatMedianMs':round(statistics.median(t for r in runs for t in r['repeatEval']),1)}
   finally:server.shutdown();server.server_close()
 finally:browser.close()
print(json.dumps(reports,indent=2))
