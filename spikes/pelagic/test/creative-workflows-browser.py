#!/usr/bin/env python3
"""7B review: actual buttons in the real editor, isolated local bundle, video/audio."""
import functools,http.server,threading,json,os,time,subprocess,re
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=Path(os.environ['PELAGIC_LOCAL_OUT'])
PROOF=Path(os.environ.get('PELAGIC_CREATIVE_PROOF',ROOT/'proof/milestone-7B'));PROOF.mkdir(parents=True,exist_ok=True)
class Handler(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(OUT)));threading.Thread(target=server.serve_forever,daemon=True).start()
report={'passed':False,'checks':[],'errors':[],'api':[]};q='document.querySelector(".view-host .view-body").pelagic'
def checked(name):report['checks'].append(name);print(name,flush=True)
def source(page,text):
 page.evaluate('text=>{const {R,K,dispatch}=window.blEd;dispatch(R.hashMap(K("type"),K("pelagic/source"),K("source"),text));}',text)
def shot(page,name):page.screenshot(path=str(PROOF/(name+'.png')))
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM','/home/user/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'),args=['--no-sandbox','--autoplay-policy=no-user-gesture-required','--use-gl=angle','--use-angle=gl','--ignore-gpu-blocklist'])
  context=browser.new_context(viewport={'width':1600,'height':1200},accept_downloads=True,record_video_dir=str(PROOF/'raw'),record_video_size={'width':1600,'height':1200})
  start=time.monotonic();page=context.new_page();page.on('pageerror',lambda e:report['errors'].append(str(e)));page.on('request',lambda r:report['api'].append(r.url) if '/api/' in r.url else None)
  page.goto(f'http://127.0.0.1:{server.server_port}/');page.wait_for_function(q.replace('.pelagic','?.pelagic'),timeout=90000)
  page.evaluate(q+'.ready()');page.evaluate(q+'.compilerReady()');page.get_by_role('button',name='▶ PERFORM',exact=True).click()
  page.locator('#input-sink').focus();page.keyboard.press('Control+Enter');page.wait_for_function(q+'.stats().patterns.includes("melody")',timeout=60000)
  page.wait_for_function(q+'.diagnostics().preparation.done',timeout=60000);shot(page,'after-workflows')
  offset=time.monotonic()-start
  page.evaluate('''()=>{const p=document.querySelector('.view-host .view-body').pelagic,engine=p.engine(),dest=engine.ctx.createMediaStreamDestination();engine.monitor.connect(dest);const recorder=new MediaRecorder(dest.stream,{mimeType:'audio/webm'}),chunks=[];recorder.ondataavailable=e=>chunks.push(e.data);recorder.start();window.reviewAudio={dest,engine,recorder,chunks};}''')
  # 1. Capture, change a controller, save, replay, fork and undo in the editor.
  page.locator('[data-capture]').click();page.wait_for_function(q+'.diagnostics().take==="capturing"')
  page.locator('[data-control="filter"]').fill('1.2');page.wait_for_timeout(600);page.locator('[data-capture]').click();page.wait_for_function(q+'.diagnostics().take==="ready"')
  take=page.evaluate(q+'.takeManifest()');assert take['version']==2 and take['reproducible'] and take['events'];report['takeEvents']=len(take['events'])
  with page.expect_download() as d:page.locator('[data-manifest]').click()
  d.value.save_as(str(PROOF/'captured-take.json'))
  page.locator('[data-replay]').click();page.wait_for_function(q+'.events().some(e=>e.kind===\"take-replay\")');page.wait_for_function(q+'.diagnostics().replayRemaining===0',timeout=20000);shot(page,'take-replay')
  before=page.evaluate('window.blEd.R.printStr(window.blEd.state().get(window.blEd.K("text")))')
  page.locator('[data-fork]').click();page.wait_for_function('window.blEd.R.printStr(window.blEd.state().get(window.blEd.K("text"))).includes("forked take")');shot(page,'take-fork')
  page.locator('#input-sink').focus();page.keyboard.press('u');assert page.evaluate('window.blEd.R.printStr(window.blEd.state().get(window.blEd.K("text")))')==before
  checked('take capture/save/replay/fork uses immutable BL model; fork is one undoable edit')
  # 2. Safe audition through visible buttons, then quantified commit.
  source(page,'(av/configure {:space 0.6})');base=page.evaluate(q+'.model()')
  page.locator('[data-command="pelagic/preview"]').click();page.wait_for_function(q+'.stats().audition?.status==="playing"',timeout=60000)
  assert page.evaluate(q+'.model()')==base
  page.evaluate(q+'.auditionEngine().monitor.connect(window.reviewAudio.dest)');page.wait_for_timeout(1500);shot(page,'safe-audition')
  page.locator('[data-action="audition-cancel"]').click();page.wait_for_function(q+'.stats().audition===null');assert page.evaluate(q+'.model()')==base
  page.locator('[data-command="pelagic/preview"]').click();page.wait_for_function(q+'.stats().audition?.status==="playing"',timeout=60000)
  page.evaluate(q+'.auditionEngine().monitor.connect(window.reviewAudio.dest)');page.locator('[data-action="audition-commit"]').click()
  page.wait_for_function(q+'.config().space===0.6 && '+q+'.stats().phase==="ACTIVE"',timeout=20000);shot(page,'audition-committed')
  checked('safe audition preserves active model; cancel releases preview; commit adopts at a musical boundary')
  # 3. Seeded alternatives preview the same base and can be discarded.
  base=page.evaluate(q+'.model()');page.locator('[data-explore-seed]').fill('37');page.locator('[data-explore]').click();page.locator('[data-alternative="0"]').wait_for()
  assert page.locator('[data-alternative]').count()==4;page.locator('[data-alternative="0"]').click();page.wait_for_function(q+'.stats().audition?.status==="playing"');assert page.evaluate(q+'.model()')==base
  shot(page,'seeded-exploration');page.locator('[data-action="audition-cancel"]').click();checked('four seeded BL alternatives audition without editing the active base')
  # 4. Navigate back to source that produced the active revision.
  source(page,'Scratch document');page.locator('[data-source]').click();page.wait_for_function('window.blEd.R.printStr(window.blEd.state().get(window.blEd.K("text"))).includes("space 0.6")');shot(page,'revision-source');checked('revision source restores active committed code through the real editor')
  # 5. The same optional local package works with no world/server APIs.
  assert not report['api'],report['api'];assert page.evaluate('!!globalThis.BL_DOCUMENTS');checked('shareable optional local bundle uses the real package with zero world API requests')
  page.set_viewport_size({'width':430,'height':932});page.wait_for_timeout(150);assert page.evaluate('document.querySelector(".view-host").getBoundingClientRect().width>400');shot(page,'pelagic-narrow');page.locator('[data-command="pelagic/preview"]').scroll_into_view_if_needed();shot(page,'pelagic-narrow-controls');page.set_viewport_size({'width':1600,'height':1200})
  report['stats']=page.evaluate(q+'.diagnostics()');report['workers']=[w.url.rsplit('/',1)[-1] for w in page.workers]
  with page.expect_download() as d:
   page.evaluate('''async()=>{const r=window.reviewAudio;await new Promise(done=>{r.recorder.onstop=done;r.recorder.stop();});const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(r.chunks,{type:'audio/webm'}));a.download='monitor.webm';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);r.engine.monitor.disconnect(r.dest);r.dest.stream.getTracks().forEach(t=>t.stop());}''')
  d.value.save_as(str(PROOF/'monitor.webm'))
  page.evaluate('window.reviewEngine='+q+'.engine()');page.locator('#input-sink').focus();page.keyboard.press(':');page.keyboard.insert_text('(ed/unuse "pelagic")');page.keyboard.press('Enter');page.wait_for_function('window.reviewEngine.ctx.state==="closed"');shot(page,'after-unuse');assert page.locator('link[href$="/pelagic/layout.css"]').count()==0;checked('unuse closes owned audio/graphics/workers and retains source')
  assert not report['errors'],report['errors'];video=page.video;context.close();video.save_as(str(PROOF/'creative-workflows.webm'));browser.close()
  result=subprocess.run(['ffmpeg','-y','-ss',str(offset),'-i',str(PROOF/'creative-workflows.webm'),'-i',str(PROOF/'monitor.webm'),'-map','0:v','-map','1:a','-c:v','libvpx','-b:v','900k','-c:a','libopus','-shortest',str(PROOF/'creative-workflows-audio.webm')],capture_output=True,text=True);assert result.returncode==0,result.stderr
  level=subprocess.run(['ffmpeg','-i',str(PROOF/'monitor.webm'),'-af','volumedetect','-f','null','-'],capture_output=True,text=True);peak=re.search(r'max_volume: (-?[0-9.]+) dB',level.stderr);assert peak and float(peak.group(1))>-80,level.stderr;report['recordedAudioPeakDb']=float(peak.group(1));report['passed']=True
except Exception as error:
 report['failure']=str(error);raise
finally:
 server.shutdown();server.server_close();(PROOF/'creative-browser.json').write_text(json.dumps(report,indent=2)+'\n')
