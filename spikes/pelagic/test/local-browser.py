#!/usr/bin/env python3
"""Static-only proof: no BEAM/world process and no /api requests allowed."""
import os,json,threading,http.server,functools
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[3]
OUT=Path(os.environ.get('PELAGIC_LOCAL_OUT',ROOT/'spikes/pelagic/dist/local'))
PROOF=Path(os.environ.get('PELAGIC_LOCAL_PROOF',ROOT/'spikes/pelagic/proof/local'));PROOF.mkdir(parents=True,exist_ok=True)
class Handler(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  if self.path.startswith('/api/'):
   api.append(self.path);self.send_error(503,'No server API in this test');return
  super().do_GET()
 def do_POST(self):
  api.append(self.path);self.send_error(503,'No server API in this test')
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(OUT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
url=f'http://127.0.0.1:{server.server_port}/'
checks=[];errors=[];api=[];metrics={}
def done(name):checks.append(name);print(name,flush=True)
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(headless=True,executable_path=os.environ.get('CHROMIUM','/home/user/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'),args=['--no-sandbox','--use-gl=angle','--use-angle=gl','--enable-gpu','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'])
  context=browser.new_context(viewport={'width':1440,'height':1080},accept_downloads=True)
  context.add_init_script('window.liveWorkers=new Set();const NativeWorker=Worker;window.Worker=class extends NativeWorker{constructor(...args){super(...args);liveWorkers.add(this);}terminate(){liveWorkers.delete(this);return super.terminate();}};')
  page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  context.route('**/api/**',lambda route:(api.append(route.request.url),route.abort()))
  page.goto(url)
  q='document.querySelector(".view-host .view-body").pelagic'
  page.wait_for_function('window.blEd && document.querySelector(".view-host .view-body")?.pelagic',timeout=90000)
  page.evaluate(q+'.ready()')
  page.evaluate(q+'.compilerReady()')
  page.screenshot(path=str(PROOF/'01-used.png'));done('real editor loads PELAGIC from static bundle')
  assert page.evaluate('window.blHost.lang.state')=='idle'
  assert page.evaluate(q+'.diagnostics().evaluator')=='worker'
  done('preloaded live BL compiler runs in a worker; main compiler stays lazy')
  page.get_by_role('button',name='▶ PERFORM',exact=True).click()
  native=page.evaluate(q+'.evaluate(\'(ns ^:js pelagic.live.worker-session) (av/configure {:space (js/Math.max 0.1 0.2)})\')')
  assert native['ok'],native
  done('native JS interop compiles in the worker with unchanged BL patch APIs')
  page.wait_for_function(q+'.stats().nextStep>4 && '+q+'.stats().context==="running"',timeout=15000)
  page.locator('#input-sink').focus();page.keyboard.press('Control+Enter')
  page.wait_for_function(q+'.stats().patterns.includes("melody")',timeout=45000)
  assert page.evaluate(q+'.diagnostics().namespaces')==0
  done('real C-Enter evaluates bundled patch during browser audio transport')
  bad=page.evaluate('(q)=>document.querySelector(".view-host .view-body").pelagic.evaluate(q)','(av/configure {:space 0.1}')
  assert bad['ok'] is False and bad['error']!='[object Object]',bad
  done('invalid live BL retains performance with a readable error')
  responsive=page.evaluate("""async()=>{
   const host=document.querySelector('.view-host .view-body').pelagic;
   let beats=0,last=performance.now(),maxGap=0;
   const timer=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-last);last=now;beats++;},10);
   try {
    const first=host.evaluate('(loop [n 0 sum 0] (if (< n 2000000) (recur (inc n) (+ sum n)) (av/configure {:space 0.21})))');
    await new Promise(resolve=>setTimeout(resolve,30));
    const second=host.evaluate('(av/configure {:space 0.22})');
    const results=await Promise.all([first,second]);return {beats,maxGap,results};
   } finally {clearInterval(timer);}
  }""")
  metrics['workerHeartbeat']={'beats':responsive['beats'],'maxGapMs':responsive['maxGap']}
  assert responsive['beats']>=3,responsive
  assert responsive['results'][0]['error']=='Superseded edit',responsive
  assert responsive['results'][1]['ok'],responsive
  done('worker evaluation keeps main-thread heartbeats running; latest edit wins')
  leaked=page.evaluate(q+'.evaluate(\'(defn temporary-live-fn [] 0.4) (throw "cleanup proof")\')')
  assert not leaked['ok'],leaked
  recovered=page.evaluate(q+'.evaluate(\'(av/configure {:space (temporary-live-fn)})\')')
  assert not recovered['ok'] and 'temporary-live-fn' in recovered['error'],recovered
  done('failed evaluation releases temporary definitions and worker remains usable')
  page.get_by_role('button',name='■ STOP',exact=True).click()
  page.locator('#input-sink').focus();page.keyboard.press('G');page.keyboard.press('A');page.keyboard.press('Enter');page.keyboard.insert_text('# Saved locally by the static bundle proof');page.keyboard.press('Escape');page.keyboard.press('Control+s')
  page.wait_for_function('async()=> (await BL_DOCUMENTS.read("live-set.bl.org")).text.includes("Saved locally by the static bundle proof")')
  done('real editor save persists source locally')
  page.evaluate('()=>{window.originalLocalSave=BL_DOCUMENTS.save;BL_DOCUMENTS.save=async()=>{throw new Error("quota proof");};}')
  page.locator('#input-sink').focus();page.keyboard.press('G');page.keyboard.press('A');page.keyboard.press('Enter');page.keyboard.insert_text('# Retained local draft');page.keyboard.press('Escape');page.keyboard.press('Control+s')
  page.wait_for_function('document.querySelector("#echo").textContent.includes("draft retained")')
  assert page.evaluate('window.blEd.R.printStr(window.blEd.state().get(window.blEd.K("text"))).includes("Retained local draft")')
  assert not page.evaluate('async()=> (await BL_DOCUMENTS.read("live-set.bl.org")).text.includes("Retained local draft")')
  page.evaluate('BL_DOCUMENTS.save=window.originalLocalSave;delete window.originalLocalSave;')
  page.keyboard.press('Control+s')
  page.wait_for_function('async()=> (await BL_DOCUMENTS.read("live-set.bl.org")).text.includes("Retained local draft")')
  done('local save failure retains the draft and retry persists it')
  result=page.evaluate('''async()=>{
   const {localDocuments}=await import('./local/documents.mjs');
   const db=await localDocuments({}, {name:'pelagic-cas-proof'});
   const initial=await db.save({path:'scratch.bl',text:'first',base:null});
   const writes=await Promise.all([db.save({path:'scratch.bl',text:'a',base:initial.rev}),db.save({path:'scratch.bl',text:'b',base:initial.rev})]);
   let row=await db.read('scratch.bl');
   for(let i=0;i<40;i++){await db.save({path:'scratch.bl',text:String(i),base:row.rev});row=await db.read('scratch.bl');}
   db.close();return {success:writes.filter(x=>x.ok).length,conflict:writes.filter(x=>x.conflict).length,history:row.history.length};
  }''')
  assert result=={'success':1,'conflict':1,'history':32},result
  done('atomic local revisions reject concurrent stale saves; history stays bounded')
  page.reload();page.wait_for_function('window.blEd && window.blEd.R.printStr(window.blEd.state().get(window.blEd.K("text"))).includes("Saved locally by the static bundle proof")',timeout=90000)
  done('reload restores the saved editor source')
  page.evaluate('navigator.serviceWorker.ready')
  page.wait_for_function('navigator.serviceWorker.controller!==null',timeout=30000)
  context.set_offline(True);page.reload()
  page.wait_for_function('window.blEd && document.querySelector(".view-host .view-body")?.pelagic',timeout=90000)
  page.evaluate(q+'.ready()');page.evaluate(q+'.compilerReady()')
  done('complete application reloads offline from its own asset cache')
  page.locator('#input-sink').focus();page.keyboard.press(':');page.keyboard.insert_text('(ed/unuse "pelagic")');page.keyboard.press('Enter')
  page.wait_for_function('!document.querySelector(".view-host")')
  assert page.evaluate('window.blEd.R.printStr(window.blEd.state().get(window.blEd.K("text"))).includes("Saved locally by the static bundle proof")')
  page.wait_for_function('liveWorkers.size===0',timeout=5000)
  page.screenshot(path=str(PROOF/'02-unused.png'));done('real ed/unuse removes stage and preserves source offline')
  assert not api,api
  assert not errors,errors
  done('zero server API requests and zero uncaught browser errors')
  browser.close()
finally:
 server.shutdown();server.server_close()
 (PROOF/'report.json').write_text(json.dumps({'checks':checks,'errors':errors,'apiRequests':api,'metrics':metrics},indent=2)+'\n')
