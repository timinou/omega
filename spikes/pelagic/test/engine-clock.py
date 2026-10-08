#!/usr/bin/env python3
"""Compare native DSP clock progress with graphics frozen and two latency hints."""
from pathlib import Path
import json,os,time
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[3];results=[]
with sync_playwright() as p:
 for hint in ['interactive','playback']:
  b=p.chromium.launch(headless=True,executable_path=os.environ.get('CHROMIUM','/home/user/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'),args=['--no-sandbox','--use-gl=angle','--use-angle=gl','--enable-gpu','--autoplay-policy=no-user-gesture-required'])
  page=b.new_page(viewport={'width':1440,'height':1200})
  page.add_init_script('const NativeContext=window.AudioContext;window.AudioContext=class extends NativeContext{constructor(options){super({...options,latencyHint:'+json.dumps(hint)+'});}};')
  page.goto('http://127.0.0.1:8812/?use=pelagic&layout=pelagic&file=spikes/pelagic/demo.bl.org');q='document.querySelector(".view-host .view-body").pelagic'
  page.wait_for_function('document.querySelector(".view-host .view-body")?.pelagic',timeout=60000);page.evaluate(q+'.ready()');page.get_by_role('button',name='▶ PERFORM',exact=True).click()
  page.evaluate('window.blEd.dispatch(window.blEd.R.hashMap(window.blEd.K("type"),window.blEd.K("pelagic/control"),window.blEd.K("control"),"freeze",window.blEd.K("value"),true))')
  page.wait_for_timeout(1000);start=page.evaluate(q+'.engine().ctx.currentTime');wall=time.monotonic();page.wait_for_timeout(30000)
  elapsed=time.monotonic()-wall;end=page.evaluate(q+'.engine().ctx.currentTime');d=page.evaluate(q+'.diagnostics()')
  results.append({'latencyHint':hint,'wallSeconds':elapsed,'audioSeconds':end-start,'clockRate':(end-start)/elapsed,'diagnostics':d,'loadAverage':os.getloadavg()});b.close();print(hint,results[-1]['clockRate'],flush=True)
(root/'spikes/pelagic/proof/performance/engine-clock.json').write_text(json.dumps(results,indent=2)+'\n')
