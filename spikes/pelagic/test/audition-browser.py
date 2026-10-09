#!/usr/bin/env python3
"""Safe audition in the real editor, isolated static world, with monitor audio."""
import functools,http.server,threading,json,os,time,subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=Path(os.environ.get('PELAGIC_LOCAL_OUT',ROOT/'dist/local'));PROOF=Path(os.environ.get('PELAGIC_AUDITION_PROOF',ROOT/'proof/actor-consolidation/audition'));PROOF.mkdir(parents=True,exist_ok=True)
class Handler(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(OUT)));threading.Thread(target=server.serve_forever,daemon=True).start()
report={'checks':[],'errors':[]};q='document.querySelector(".view-host .view-body").pelagic'
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(headless=True,executable_path=os.environ.get('CHROMIUM','/home/user/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'),args=['--no-sandbox','--use-gl=angle','--use-angle=gl','--enable-gpu','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'])
  context=browser.new_context(viewport={'width':1440,'height':1200},accept_downloads=True,record_video_dir=str(PROOF/'raw'),record_video_size={'width':1440,'height':1200})
  started=time.monotonic();page=context.new_page();page.on('pageerror',lambda e:report['errors'].append(str(e)))
  page.goto(f'http://127.0.0.1:{server.server_port}/');page.wait_for_function('window.blEd&&document.querySelector(".view-host .view-body")?.pelagic',timeout=90000)
  page.evaluate(q+'.ready()');before=page.evaluate('window.blEd.R.printStr(window.blEd.state().get(window.blEd.K("text")))');page.evaluate(q+'.compilerReady()')
  page.get_by_role('button',name='▶ PERFORM',exact=True).click();page.evaluate(q+'.request({kind:"cue",movement:1})');page.locator('summary',has_text='SESSION / MAPPINGS').click();page.wait_for_timeout(500)
  offset=time.monotonic()-started
  page.evaluate('''()=>{const p=document.querySelector('.view-host .view-body').pelagic,engine=p.engine(),dest=engine.ctx.createMediaStreamDestination();engine.monitor.connect(dest);const recorder=new MediaRecorder(dest.stream,{mimeType:'audio/webm'}),chunks=[];recorder.ondataavailable=e=>chunks.push(e.data);recorder.start();window.auditionDemo={dest,recorder,chunks,engine};}''')
  def done(name):report['checks'].append(name);print(name,flush=True)
  base=page.evaluate(q+'.model()');preview=page.evaluate(q+'''.evaluate('(av/gesture :break)',{preview:true})''');assert preview['ok'],preview
  assert page.evaluate(q+'.model()')==base;assert page.evaluate(q+'.stats().audition.status')=='playing';done('audition keeps active revision and history unchanged')
  page.evaluate(q+'.auditionEngine().monitor.connect(window.auditionDemo.dest)');page.wait_for_timeout(2000)
  page.screenshot(path=str(PROOF/'used.jpg'),type='jpeg',quality=85)
  page.evaluate('window.oldPreview='+q+'.auditionEngine();'+q+'.request({kind:"audition-cancel"})');assert page.evaluate('window.oldPreview.disposed');assert page.evaluate(q+'.model()')==base;done('cancel disposes the preview bus and leaves active sound unchanged')
  preview=page.evaluate(q+'''.evaluate('(av/configure {:space 0.6})',{preview:true})''');assert preview['ok'],preview
  page.evaluate(q+'.auditionEngine().monitor.connect(window.auditionDemo.dest)');page.wait_for_timeout(500)
  result=page.evaluate(q+'.request({kind:"audition-commit"})');assert result['targetBeat']>page.evaluate(q+'.stats().beat')
  page.wait_for_function(q+f'.stats().revision==={result["revision"]}',timeout=15000);assert page.evaluate(q+'.config().space')==.6;done('commit activates atomically on a future musical boundary')
  preview=page.evaluate(q+'''.evaluate('(av/configure {:space 0.4})',{preview:true})''');assert preview['ok'],preview
  page.evaluate(q+'.request({kind:"configure",values:{filter:1.1}})')
  stale=page.evaluate('''()=>{try{document.querySelector('.view-host .view-body').pelagic.request({kind:'audition-commit'});return '';}catch(e){return e.message||String(e);}}''');assert 'stale' in stale.lower(),stale;done('an intervening edit makes the old audition uncommittable')
  page.evaluate(q+'.request({kind:"audition-cancel"})');revision=page.evaluate(q+'.stats().revision');space=page.evaluate(q+'.config().space')
  bad=page.evaluate(q+'''.evaluate('(av/session (av/configure {:space 0.1}) (t/start "void main(){broken;}"))',{preview:true})''');assert not bad['ok'];assert page.evaluate(q+'.stats().revision')==revision;assert page.evaluate(q+'.config().space')==space;done('invalid shader retains the active revision and sound')
  # A small offline export overlaps playback and uses the same native schema.
  exported=page.evaluate(q+'.renderAudio(undefined,{seconds:2,sampleRate:22050}).then(b=>({frames:b.length,rate:b.sampleRate}))');assert exported['frames']==44100;done('bounded offline export completes while playback continues')
  report['stats']=page.evaluate(q+'.stats()');report['metrics']=page.evaluate(q+'.diagnostics()')
  with page.expect_download(timeout=30000) as download:
   page.evaluate('''async()=>{const d=window.auditionDemo;await new Promise(r=>{d.recorder.onstop=r;d.recorder.stop();});d.engine.monitor.disconnect(d.dest);const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(d.chunks,{type:'audio/webm'}));a.download='monitor.webm';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);d.dest.stream.getTracks().forEach(t=>t.stop());}''')
  download.value.save_as(str(PROOF/'monitor.webm'))
  page.evaluate('window.oldEngine='+q+'.engine();window.oldShader='+q+'.shader()');page.locator('#input-sink').focus();page.keyboard.press(':');page.keyboard.insert_text('(ed/unuse "pelagic")');page.keyboard.press('Enter');page.wait_for_function('window.oldEngine.ctx.state==="closed"')
  assert page.evaluate('window.oldEngine.disposed&&window.oldShader.disposed');assert page.evaluate('window.blEd.R.printStr(window.blEd.state().get(window.blEd.K("text")))')==before
  page.screenshot(path=str(PROOF/'unused.jpg'),type='jpeg',quality=85);done('real editor unload closes all owned resources and preserves source')
  assert not report['errors'],report['errors'];video=page.video;context.close();video.save_as(str(PROOF/'editor.webm'));browser.close()
  run=subprocess.run(['ffmpeg','-y','-ss',str(offset),'-i',str(PROOF/'editor.webm'),'-i',str(PROOF/'monitor.webm'),'-map','0:v','-map','1:a','-c:v','libvpx','-b:v','700k','-c:a','libopus','-shortest',str(PROOF/'safe-audition.webm')],capture_output=True,text=True);assert run.returncode==0,run.stderr
finally:
 server.shutdown();server.server_close();(PROOF/'browser.json').write_text(json.dumps(report,indent=2)+'\n')
