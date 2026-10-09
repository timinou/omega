#!/usr/bin/env python3
"""Own static server; sustained audio/video pressure with CPU evidence."""
import os,json,threading,http.server,functools,time
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[3]
OUT=Path(os.environ.get('PELAGIC_LOCAL_OUT',ROOT/'spikes/pelagic/dist/local'))
PROOF=Path(os.environ.get('PELAGIC_REALTIME_PROOF',ROOT/'spikes/pelagic/proof/realtime'));PROOF.mkdir(parents=True,exist_ok=True)
SECONDS=int(os.environ.get('PELAGIC_REALTIME_SECONDS','60'))
PROFILE=os.environ.get('PELAGIC_PROFILE','0')=='1'
class Handler(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(OUT)));threading.Thread(target=server.serve_forever,daemon=True).start()
report={'seconds':SECONDS,'profiled':PROFILE,'errors':[],'phases':[]}
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(headless=True,executable_path=os.environ.get('CHROMIUM','/home/user/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'),args=['--no-sandbox','--use-gl=angle','--use-angle=gl','--enable-gpu','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'])
  page=browser.new_page(viewport={'width':1440,'height':1080});page.on('pageerror',lambda e:report['errors'].append(str(e)))
  page.goto(f'http://127.0.0.1:{server.server_port}/')
  q='document.querySelector(".view-host .view-body").pelagic'
  page.wait_for_function('window.blEd&&document.querySelector(".view-host .view-body")?.pelagic',timeout=90000)
  page.evaluate(q+'.ready()');page.evaluate(q+'.compilerReady()')
  page.get_by_role('button',name='▶ PERFORM',exact=True).click()
  page.locator('#input-sink').focus();page.keyboard.press('Control+Enter')
  page.wait_for_function(q+'.stats().patterns.includes("melody")',timeout=30000)
  session=page.context.new_cdp_session(page)
  if PROFILE:session.send('Profiler.enable');session.send('Profiler.start')
  started=time.monotonic();next_edit=started;index=0
  while time.monotonic()-started<SECONDS:
   if time.monotonic()>=next_edit:
    scene=['cathedral','current','afterglow','bathymetry'][index%4]
    source=f'(av/commit {{:quantize :beat :edits [(av/launch :{scene} {{:beats 1}}) (av/layer :afterglow 0.2)]}})'
    value=page.evaluate('(source)=>'+q+'.evaluate(source)',source);assert value['ok'],value
    report['phases'].append({'elapsed':time.monotonic()-started,'edit':index,'metrics':page.evaluate(q+'.diagnostics()')})
    print('phase',index,'frameP95',report['phases'][-1]['metrics']['frameP95'],flush=True)
    index+=1;next_edit+=10
   page.wait_for_timeout(500)
  if PROFILE:
   profile=session.send('Profiler.stop')['profile'];(PROOF/'cpu.json').write_text(json.dumps(profile))
  report['metrics']=page.evaluate(q+'.diagnostics()');report['stats']=page.evaluate(q+'.stats()')
  page.get_by_role('button',name='■ STOP',exact=True).click()
  page.screenshot(path=str(PROOF/'used.jpg'),type='jpeg',quality=80)
  page.locator('#input-sink').focus();page.keyboard.press(':');page.keyboard.insert_text('(ed/unuse "pelagic")');page.keyboard.press('Enter');page.wait_for_function('!document.querySelector(".view-host")',timeout=30000)
  page.screenshot(path=str(PROOF/'unused.jpg'),type='jpeg',quality=80)
  report['unloaded']=True;assert not report['errors'],report['errors'];browser.close()
finally:
 server.shutdown();server.server_close();(PROOF/'report.json').write_text(json.dumps(report,indent=2)+'\n')
