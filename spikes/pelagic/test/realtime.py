#!/usr/bin/env python3
"""Own static server; sustained audio/video pressure with CPU evidence."""
import os,json,threading,http.server,functools,time,subprocess
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
  started=time.monotonic();next_edit=started;index=0;recorded=False;record_end=None;stalls=0;invalid=False;typed=False
  report['stalls']=[]
  while time.monotonic()-started<SECONDS:
   if time.monotonic()>=next_edit:
    scene=['cathedral','current','afterglow','bathymetry'][index%4]
    source=f'(av/commit {{:quantize :beat :edits [(av/launch :{scene} {{:beats 1}}) (av/layer :afterglow 0.2)]}})'
    value=page.evaluate('(source)=>'+q+'.evaluate(source)',source);assert value['ok'],value
    report['phases'].append({'elapsed':time.monotonic()-started,'edit':index,'metrics':page.evaluate(q+'.diagnostics()')})
    m=report['phases'][-1]['metrics'];print('phase',index,'UI',m['frameP95'],'worker',(m.get('gpu')or{}).get('frameP95'),'work',(m.get('gpu')or{}).get('workP95Ms'),'AV',(m.get('gpu')or{}).get('avSubmitP95Ms'),flush=True)
    index+=1;next_edit+=10
   elapsed=time.monotonic()-started
   if not recorded and elapsed>SECONDS*.2:
    page.evaluate(q+'.record()');recorded=True;record_end=elapsed+min(15,SECONDS*.2)
   if record_end is not None and elapsed>record_end:
    report['take']=page.evaluate(q+'.stopRecording({save:false})');record_end=None
    with page.expect_download(timeout=30000) as download:
     page.evaluate('''async()=>{const p=document.querySelector(".view-host .view-body").pelagic,chunks=[];await p.exportRecording({write:chunk=>chunks.push(chunk),close(){}});const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(chunks,{type:'video/webm'}));a.download='capture.webm';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}''')
    download.value.save_as(str(PROOF/'capture.webm'))
   if stalls<2 and elapsed>SECONDS*(stalls+1)/3:
    graphics=next((w for w in page.workers if w.url.endswith('/render-worker.mjs')),None)
    duration=[250,500][stalls]
    if graphics:
     graphics.evaluate('(duration)=>{self.pelagicStallProbe={before:self.pelagicDiagnostics().frames,start:performance.timeOrigin+performance.now()};setTimeout(()=>{self.pelagicStallProbe.after=self.pelagicDiagnostics().frames;self.pelagicStallProbe.end=performance.timeOrigin+performance.now();},duration);}',duration)
    blocked=page.evaluate('(duration)=>{const start=performance.timeOrigin+performance.now(),until=performance.now()+duration;while(performance.now()<until){}return {start,end:performance.timeOrigin+performance.now()};}',duration)
    if graphics:
     probe=graphics.evaluate('self.pelagicStallProbe')
     if 'after' not in probe:
      page.wait_for_timeout(100);probe=graphics.evaluate('self.pelagicStallProbe')
     report['stalls'].append({'mainThreadMs':duration,'main':blocked,'worker':probe})
     assert probe.get('after',0)>probe['before']+3,report['stalls'][-1]
    else:report['stalls'].append({'mainThreadMs':duration,'main':blocked,'worker':None})
    stalls+=1
   if not invalid and elapsed>SECONDS*.5:
    revision=page.evaluate(q+'.stats().revision')
    bad=page.evaluate(q+".evaluate('(av/session (av/configure {:space 0.1}) (t/start \"void main(){broken;}\"))')")
    assert not bad['ok'];assert page.evaluate(q+'.stats().revision')==revision;report['atomicShaderFailure']=True;invalid=True
   if not typed and elapsed>SECONDS*.7:
    page.locator('#input-sink').focus();page.keyboard.press('Escape');page.keyboard.press('i');page.keyboard.type('; pressure test typing\n',delay=10);page.keyboard.press('Escape');typed=True
   page.wait_for_timeout(500)
  if PROFILE:
   profile=session.send('Profiler.stop')['profile'];(PROOF/'cpu.json').write_text(json.dumps(profile))
  report['metrics']=page.evaluate(q+'.diagnostics()');report['stats']=page.evaluate(q+'.stats()')
  metrics=report['metrics'];gpu=metrics.get('gpu') or {}
  report['budgets']={'workP95Within16ms':gpu.get('workP95Ms',1e9)<=16,'workerCadenceP95Within60Hz':gpu.get('frameP95',1e9)<=16.67,'workerAVSubmissionP95Within16ms':(gpu.get('avSubmitP95Ms') or 1e9)<=16,'avAcknowledgementP95Within16ms':(metrics.get('avSubmitP95Ms') or 1e9)<=16,'zeroMissedAudioEvents':metrics['missedEvents']==0}
  if (PROOF/'capture.webm').exists():
   report['video']=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','stream=codec_name,width,height','-of','json',str(PROOF/'capture.webm')]))
   video=next(s for s in report['video']['streams'] if 'width' in s);assert (video['width'],video['height'])==(1280,720),video
  page.screenshot(path=str(PROOF/'used.jpg'),type='jpeg',quality=80)
  # Unhandled worker failure is injected after collecting normal performance data.
  for worker in page.workers:
   if worker.url.endswith('/render-worker.mjs'):
    worker.evaluate("setTimeout(()=>{throw new Error('Injected graphics worker failure');},0)")
    page.wait_for_function(q+'.shader().disposed&&'+q+'.stats().playing===false',timeout=20000);report['workerFailureStopsTransport']=True;break
  page.get_by_role('button',name='■ STOP',exact=True).click()
  before_unuse=page.evaluate('window.blEd.R.printStr(window.blEd.state().get(window.blEd.K("text")))')
  page.locator('#input-sink').focus();page.keyboard.press(':');page.keyboard.insert_text('(ed/unuse "pelagic")');page.keyboard.press('Enter');page.wait_for_function('!document.querySelector(".view-host")',timeout=30000)
  page.screenshot(path=str(PROOF/'unused.jpg'),type='jpeg',quality=80)
  assert page.evaluate('window.blEd.R.printStr(window.blEd.state().get(window.blEd.K("text")))')==before_unuse
  report['sourcePreserved']=True;report['unloaded']=True;assert not report['errors'],report['errors'];assert metrics['missedEvents']==0,metrics;browser.close()
finally:
 server.shutdown();server.server_close();(PROOF/'report.json').write_text(json.dumps(report,indent=2)+'\n')
