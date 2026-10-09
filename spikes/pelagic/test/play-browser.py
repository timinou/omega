#!/usr/bin/env python3
"""Real Play/Perform startup regression: worker and main-thread graphics, isolated origin."""
import functools,http.server,json,os,threading
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ.get('PELAGIC_LOCAL_OUT',ROOT/'dist/local'))
PROOF=Path(os.environ.get('PELAGIC_PLAY_PROOF',ROOT/'proof/play-start'));PROOF.mkdir(parents=True,exist_ok=True)
class Handler(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(OUT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
report={'checks':[],'errors':[]}
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(headless=True,executable_path=os.environ.get('CHROMIUM','/home/user/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'),args=['--no-sandbox','--use-gl=angle','--use-angle=gl','--enable-gpu','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'])
  for worker in [True,False]:
   context=browser.new_context(viewport={'width':1440,'height':1080})
   if not worker:context.add_init_script('HTMLCanvasElement.prototype.transferControlToOffscreen=undefined;')
   page=context.new_page();page.on('pageerror',lambda e:report['errors'].append(str(e)))
   page.goto(f'http://127.0.0.1:{server.server_port}/')
   q='document.querySelector(".view-host .view-body").pelagic'
   page.wait_for_function('window.blEd&&document.querySelector(".view-host .view-body")?.pelagic',timeout=90000)
   page.evaluate(q+'.ready()')
   source=page.evaluate('window.blEd.R.printStr(window.blEd.state().get(window.blEd.K("text")))')
   for mode in ['play','perform','play']:
    if mode=='play':
     page.locator('#input-sink').focus();page.keyboard.press('g');page.keyboard.press('p')
    else:page.get_by_role('button',name='▶ PERFORM',exact=True).click()
    page.wait_for_function(q+'.stats().resources?.triggered>0',timeout=20000)
    signal=page.evaluate('''async()=>{const e=document.querySelector('.view-host .view-body').pelagic.engine(),a=e.ctx.createAnalyser();e.monitor.connect(a);const x=new Float32Array(a.fftSize);let peak=0;try{for(let i=0;i<8;i++){await new Promise(r=>setTimeout(r,150));a.getFloatTimeDomainData(x);for(const v of x)peak=Math.max(peak,Math.abs(v));}return {peak,context:e.ctx.state};}finally{e.monitor.disconnect(a);}}''')
    assert signal['context']=='running' and signal['peak']>0.0001,signal
    echo=page.locator('#echo').inner_text();assert 'syntax error' not in echo,echo
    stats=page.evaluate(q+'.stats()');assert stats['playing'] and stats['resources']['triggered']>0,stats
    assert stats['mode']==('finite' if mode=='play' else 'performance'),stats
    report['checks'].append({'graphics':'worker' if worker else 'main','start':mode,'signal':signal,'triggered':stats['resources']['triggered'],'echo':echo})
    print('PASS',worker,mode,signal,flush=True)
   if worker:page.screenshot(path=str(PROOF/'used.png'))
   page.evaluate('window.oldEngine='+q+'.engine();window.oldShader='+q+'.shader()')
   page.locator('#input-sink').focus();page.keyboard.press(':');page.keyboard.insert_text('(ed/unuse "pelagic")');page.keyboard.press('Enter')
   page.wait_for_function('window.oldEngine.ctx.state==="closed"',timeout=30000)
   assert page.evaluate('window.oldEngine.disposed&&window.oldShader.disposed')
   assert page.evaluate('window.blEd.R.printStr(window.blEd.state().get(window.blEd.K("text")))')==source
   if worker:page.screenshot(path=str(PROOF/'unused.png'))
   context.close()
  assert not report['errors'],report['errors']
  browser.close()
finally:
 server.shutdown();server.server_close();(PROOF/'browser.json').write_text(json.dumps(report,indent=2)+'\n')
