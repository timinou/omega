#!/usr/bin/env python3
"""Paired observer workload on one warmed real package; raw samples retained."""
import functools,http.server,threading,json,os
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=Path(os.environ['PELAGIC_LOCAL_OUT']);PROOF=Path(os.environ.get('PELAGIC_BENCH_PROOF',ROOT/'proof/milestone-6'));PROOF.mkdir(parents=True,exist_ok=True)
class Handler(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(OUT)));threading.Thread(target=server.serve_forever,daemon=True).start()
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path='/home/user/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
  page=browser.new_page(viewport={'width':1440,'height':1000});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  q='document.querySelector(".view-host .view-body").pelagic';page.goto(f'http://127.0.0.1:{server.server_port}/');page.wait_for_function(q.replace('.pelagic','?.pelagic'),timeout=90000);page.evaluate(q+'.ready()');page.evaluate(q+'.compilerReady()');page.get_by_role('button',name='▶ PERFORM',exact=True).click();page.wait_for_function(q+'.diagnostics().preparation.done',timeout=60000);page.wait_for_timeout(3000)
  cdp=page.context.new_cdp_session(page);cdp.send('Performance.enable');cpu_before={x['name']:x['value'] for x in cdp.send('Performance.getMetrics')['metrics']}
  result=page.evaluate('''async()=>{
   const O=await import('./out/js.observation.mjs'),p=document.querySelector('.view-host .view-body').pelagic;
   const percentile=(xs,q)=>xs.length?[...xs].sort((a,b)=>a-b)[Math.floor((xs.length-1)*q)]:null,rows=[];
   for(let repetition=0;repetition<5;repetition++)for(const mode of repetition%2?['active','paused','absent']:['absent','paused','active']){
    let deliveries=0;const dispose=mode==='absent'?()=>{}:O.d_subscribe(()=>deliveries++,{interval:1000,active:()=>mode==='active'});
    await new Promise(r=>setTimeout(r,1000));const raw=[],frames=[],start=performance.now(),before=p.diagnostics();let last=start,frame=start,raf;
    const timer=setInterval(()=>{const now=performance.now();raw.push(now-last);last=now;},8);
    const tick=now=>{frames.push(now-frame);frame=now;raf=requestAnimationFrame(tick);};raf=requestAnimationFrame(tick);
    const exportStart=performance.now();await p.renderAudio(undefined,{seconds:.25,sampleRate:22050});const exportMs=performance.now()-exportStart;
    await new Promise(r=>setTimeout(r,4000));clearInterval(timer);cancelAnimationFrame(raf);dispose();const after=p.diagnostics();
    rows.push({repetition,mode,warmupMs:1000,durationMs:performance.now()-start,rawHeartbeatMs:raw,rawFrameMs:frames,deliveries,exportMs,jsHeapBytes:performance.memory?.usedJSHeapSize??null,heartbeatP50:percentile(raw,.5),heartbeatP95:percentile(raw,.95),heartbeatP99:percentile(raw,.99),frameP95:percentile(frames,.95),missedDelta:after.missedEvents-before.missedEvents,longTasksDelta:after.longTasks-before.longTasks,metrics:after});
   }
   return {rows,userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,physicalLatencyMeasured:false};
  }''')
  cpu_after={x['name']:x['value'] for x in cdp.send('Performance.getMetrics')['metrics']};result['pageCpuTotalsSeconds']={k:cpu_after[k]-cpu_before.get(k,0) for k in ['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration'] if k in cpu_after};result['cpuScope']='Page renderer totals across all trials; excludes Worker processes and physical output. Per-trial JS heap is Chromium estimate.'
  assert not errors,errors
  result['errors']=errors;result['description']='Five paired repetitions, counterbalanced absent/paused/active observer, warm score cache, continuous transport, one identical 0.25-second offline render per trial. Software clocks only.'
  (PROOF/'paired-observer.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps([{k:v for k,v in row.items() if k in ['repetition','mode','heartbeatP95','frameP95','missedDelta','exportMs','deliveries']} for row in result['rows']],indent=2));browser.close()
finally:server.shutdown();server.server_close()
