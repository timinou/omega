#!/usr/bin/env python3
"""Exercise a caller-owned offline Omega host; never save or activate a world package."""
import json,os,urllib.parse
from pathlib import Path
from playwright.sync_api import sync_playwright
URL=os.environ['PELAGIC_SESSION_URL']
assert urllib.parse.urlparse(URL).port not in (None,8790), 'Use an isolated development host'
PROOF=Path(os.environ.get('PELAGIC_SESSION_PROOF',Path(__file__).resolve().parents[1]/'proof/session-launch'))
PROOF.mkdir(parents=True,exist_ok=True)
WORLD=Path(__file__).resolve().parents[3]/'.omega/packages.edn'
world_before=WORLD.read_bytes() if WORLD.exists() else None
Q='document.querySelector(".view-host .view-body").pelagic'
report={'checks':[],'errors':[]}
def command(page,source):
 page.locator('#input-sink').focus();page.keyboard.press(':');page.keyboard.insert_text(source);page.keyboard.press('Enter')
def signal(page):
 return page.evaluate('''async()=>{const e=document.querySelector('.view-host .view-body').pelagic.engine(),a=e.ctx.createAnalyser();e.monitor.connect(a);const x=new Float32Array(a.fftSize);let peak=0;try{for(let i=0;i<8;i++){await new Promise(r=>setTimeout(r,150));a.getFloatTimeDomainData(x);for(const v of x)peak=Math.max(peak,Math.abs(v));}return {peak,context:e.ctx.state};}finally{e.monitor.disconnect(a);}}''')
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path=os.environ.get('CHROMIUM','/home/user/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'),args=['--no-sandbox','--use-gl=angle','--use-angle=gl','--enable-gpu','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'])
 context=b.new_context(viewport={'width':1440,'height':1080})
 first=context.new_page();second=context.new_page()
 for page in [first,second]:
  page.on('pageerror',lambda e:report['errors'].append(str(e)))
  page.goto(URL);page.wait_for_function('window.blEd&&document.querySelector(".view-host .view-body")?.pelagic',timeout=90000)
  page.evaluate(Q+'.ready()');page.evaluate(Q+'.compilerReady()')
 first.locator('#input-sink').focus();first.keyboard.press('g');first.keyboard.press('p')
 second.get_by_role('button',name='▶ PERFORM',exact=True).click()
 for page in [first,second]:
  page.wait_for_function(Q+'.stats().resources?.triggered>0',timeout=20000)
  value=signal(page);assert value['context']=='running' and value['peak']>.0001,value
  report['checks'].append({'session':len(report['checks'])+1,'signal':value})
 first.screenshot(path=str(PROOF/'used.png'))
 source=first.evaluate('window.blEd.R.printStr(window.blEd.state().get(window.blEd.K("text")))')
 first.evaluate('window.oldEngine='+Q+'.engine();window.oldShader='+Q+'.shader()')
 command(first,'(ed/unuse "pelagic")')
 first.wait_for_function('window.oldEngine.ctx.state==="closed"',timeout=30000)
 assert first.evaluate('window.oldEngine.disposed&&window.oldShader.disposed')
 assert first.evaluate('window.blEd.R.printStr(window.blEd.state().get(window.blEd.K("text")))')==source
 first.screenshot(path=str(PROOF/'unused.png'))
 value=signal(second);assert value['context']=='running' and value['peak']>.0001,value
 assert second.evaluate(Q+'.stats().playing')
 report['checks'].append({'unloadOneSessionPreservesOther':True,'remainingSignal':value})
 # Same host, plain editor: PELAGIC is absent until explicitly loaded.
 plain=context.new_page();plain.on('pageerror',lambda e:report['errors'].append(str(e)))
 base=URL.split('?')[0];plain.goto(base+'?file=spikes/pelagic/live-set.bl.org')
 plain.wait_for_function('window.blEd',timeout=90000)
 assert plain.locator('.view-host .view-body').count()==0
 command(plain,'(ed/use "pelagic")')
 plain.wait_for_function('window.blEd.R.printStr(window.blEd.state().get(window.blEd.K("packages"))).includes("pelagic")',timeout=30000)
 command(plain,'(ed/layout "pelagic")')
 plain.wait_for_function('document.querySelector(".view-host .view-body")?.pelagic',timeout=30000)
 report['checks'].append({'plainSessionLoadsPackageExplicitly':True})
 catalog=context.new_page();catalog.on('pageerror',lambda e:report['errors'].append(str(e)))
 catalog.goto(base+'?file=package:catalog&use=packages')
 catalog.get_by_role('heading',name='Your desk, in any world').wait_for(timeout=90000)
 card=catalog.locator('article').filter(has=catalog.get_by_role('heading',name='pelagic',exact=True))
 card.get_by_role('button',name='Load & open',exact=True).wait_for(timeout=30000)
 catalog.screenshot(path=str(PROOF/'catalog.png'))
 command(catalog,'(ed/unuse "packages")')
 catalog.get_by_role('heading',name='Your desk, in any world').wait_for(state='detached',timeout=30000)
 catalog.screenshot(path=str(PROOF/'catalog-unused.png'))
 catalog.goto(base+'?file=package:catalog&use=packages')
 card=catalog.locator('article').filter(has=catalog.get_by_role('heading',name='pelagic',exact=True))
 card.get_by_role('button',name='Load & open',exact=True).click()
 catalog.wait_for_function('document.querySelector(".view-host .view-body")?.pelagic',timeout=30000)
 catalog.wait_for_function('window.blEd.state().get(window.blEd.K("path"))==="spikes/pelagic/live-set.bl.org"',timeout=30000)
 assert (WORLD.read_bytes() if WORLD.exists() else None)==world_before, 'Session package loading changed world activation'
 report['checks'].append({'catalogLoadsDocumentAndLayoutWithoutWorldActivation':True})
 assert not report['errors'],report
 b.close()
(PROOF/'browser.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
