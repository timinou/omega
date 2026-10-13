#!/usr/bin/env python3
"""Actual root Home task, disposable world, browser and private native window."""
import json,os,re,signal,socket,subprocess,tempfile,time
from pathlib import Path
from urllib.request import urlopen,Request
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[3];PROOF=ROOT/'spikes/home/proof';PROOF.mkdir(exist_ok=True)
checks=[];errors=[]
def checked(s):checks.append(s);print(s,flush=True)
with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
assert port!=8790
with tempfile.TemporaryDirectory(prefix='omega-home-proof-') as temp:
 temp=Path(temp);runtime=temp/'runtime';runtime.mkdir(mode=0o700);work=temp/'work';work.mkdir();(work/'README.bl.org').write_text('#+TITLE: Home acceptance\n\nA private working place.\n')
 env={**os.environ,'XDG_RUNTIME_DIR':str(runtime),'XDG_STATE_HOME':str(temp/'state'),'BL_GATEWAY':'off'}
 sway=None;host_started=False
 def run(*args,good=True,timeout=600):
  r=subprocess.run([str(ROOT/'bin/bl'),*args],cwd=ROOT,env=env,capture_output=True,text=True,timeout=timeout)
  with (PROOF/'launch.log').open('a') as f:f.write(r.stdout+r.stderr)
  assert (r.returncode==0)==good,(args,r.returncode,r.stdout,r.stderr)
  return r
 base=f'http://127.0.0.1:{port}'
 def intent(name,args):
  with urlopen(Request(base+'/api/intent',data=json.dumps({'intent':name,'args':args}).encode(),headers={'Content-Type':'application/json'}),timeout=30) as r:return json.load(r)
 def doc(path):
  with urlopen(base+'/api/doc?path='+path,timeout=10) as r:return json.load(r)
 try:
  cfg=temp/'sway.cfg';cfg.write_text('output HEADLESS-1 resolution 1400x900 position 0 0\ndefault_border none\nfocus_follows_mouse no\nseat * hide_cursor 1\nswaybg_command -\n')
  log=(PROOF/'sway.log').open('w')
  sway=subprocess.Popen(['sway','-d','-c',str(cfg)],env={**env,'WAYLAND_DISPLAY':'','WLR_BACKENDS':'headless','WLR_LIBINPUT_NO_DEVICES':'1','WLR_RENDERER':'pixman'},stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
  deadline=time.monotonic()+30
  while True:
   text=(PROOF/'sway.log').read_text();m=re.search("Running compositor on wayland display '([^']+)'",text)
   if m:break
   assert time.monotonic()<deadline,text[-3000:];time.sleep(.1)
  display=m[1];sock=next(runtime.glob('sway-ipc.*.sock'))
  env.update({'WAYLAND_DISPLAY':display,'GDK_BACKEND':'wayland','OMEGA_PROBE_DISPLAY':display,'OMEGA_PROBE_WIDTH':'1400','OMEGA_PROBE_HEIGHT':'900','SWAYSOCK':str(sock),'HOME_TEST_URL':base,'HOME_TEST_PROOF':str(PROOF),'LIBGL_ALWAYS_SOFTWARE':'1'})
  (PROOF/'launch.log').write_text('')
  run('omega','--','--browser','--demo','--port',str(port),'--db',str(temp/'db'));host_started=True
  identity=doc('launch:identity')['text']
  run('omega','--','--browser','--live','--port',str(port),'--db',str(temp/'db'),good=False)
  assert doc('launch:identity')['text']==identity
  checked('actual root Home task starts a private durable scripted world; incompatible mode is refused')
  assert intent('place/put',{'text':f'{{:id "home-proof" :name "Private studio" :root {json.dumps(str(work))}}}'})['ok']
  opened=intent('task/open',{'goal':'Continue this piece','title':'Continue this piece','path':'place:home-proof'});assert opened['ok'],opened
  task_path=opened.get('path') or 'task:'+opened['id']
  with sync_playwright() as p:
   browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM',str(Path.home()/'.cache/ms-playwright/chromium-1243/chrome-linux64/chrome')),args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
   context=browser.new_context(viewport={'width':1400,'height':1000},record_video_dir=str(PROOF/'raw'),record_video_size={'width':1400,'height':1000})
   page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
   page.goto(base+'/?use=home&layout=home&file=workspace:all');page.locator('.omega-home h1').wait_for()
   try:page.get_by_role('button',name='Continue this piece',exact=False).first.wait_for()
   except Exception:
    page.screenshot(path=str(PROOF/'failure.png'));(PROOF/'failure.json').write_text(json.dumps({'workspace':doc('workspace:all'),'home':page.locator('.omega-home').evaluate('(e)=>e.outerHTML'),'objects':page.evaluate('blEd.R.printStr(blEd.state().get(blEd.K("obj-index")))'),'errors':errors},indent=2));raise
   assert page.locator('iframe').count()==0;page.screenshot(path=str(PROOF/'01-home.png'))
   checked('Home projects actual tasks and places; no unopened editor viewers are allocated')
   page.get_by_role('button',name='Continue this piece',exact=False).first.click()
   frame=page.frame_locator('[data-pane="work"] iframe');frame.locator('.question-card').wait_for(timeout=60000)
   reply=frame.locator('[data-field="reply"]');reply.fill('Keep this unfinished thought')
   page.screenshot(path=str(PROOF/'02-work.png'))
   assert page.locator('.omega-home nav [data-activity="home"]').evaluate('(b)=>{const r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}')
   page.locator('.omega-home nav [data-activity="home"]').click();assert page.locator('[data-pane="work"]').get_attribute('aria-hidden')=='true'
   assert page.locator('[data-pane="work"]').evaluate('(e)=>e.inert')
   page.locator('.omega-home nav [data-activity="work"]').click();assert reply.input_value()=='Keep this unfinished thought'
   checked('Continue opens the existing task; Home return retains its draft and makes hidden panes inert')
   page.locator('.omega-home nav [data-activity="music"]').click();music=page.frame_locator('[data-pane="music"] iframe');music.get_by_role('button',name='▶ PERFORM',exact=True).wait_for(timeout=90000)
   mf=page.locator('[data-pane="music"] iframe').element_handle().content_frame();q='document.querySelector(".view-host .view-body").pelagic'
   mf.evaluate(q+'.ready()');mf.wait_for_function(q+'.diagnostics().preparation.done || '+q+'.diagnostics().preparation.error',timeout=60000)
   preparation=mf.evaluate(q+'.diagnostics().preparation');(PROOF/'preparation.json').write_text(json.dumps(preparation,indent=2)+'\n');assert preparation['done'],preparation
   music.get_by_role('button',name='▶ PERFORM',exact=True).click();mf.wait_for_function(q+'.stats().playing&&'+q+'.stats().context==="running"',timeout=15000)
   mf.evaluate('window.retainedEngine='+q+'.engine();window.retainedActor='+q+';window.retainedRevision='+q+'.stats().revision')
   page.screenshot(path=str(PROOF/'03-pelagic.png'))
   page.locator('.omega-home nav [data-activity="home"]').click();page.wait_for_timeout(300)
   assert mf.evaluate('window.retainedEngine.ctx.state')=='running';page.locator('.omega-home nav [data-activity="music"]').click()
   assert mf.evaluate(q+'.engine()===window.retainedEngine&&'+q+'===window.retainedActor')
   checked('Pelagic keeps the same playing engine and editor viewer through Home return')
   music.get_by_role('button',name='RUNTIME',exact=True).click();music.get_by_role('heading',name='Owned work, in view').wait_for(timeout=30000);assert mf.evaluate(q+'.engine()===window.retainedEngine')
   page.screenshot(path=str(PROOF/'04-inspector.png'));checked('existing companion inspector opens beside the retained instrument')
   page.locator('.omega-home nav [data-activity="home"]').click();page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(PROOF/'05-narrow.png'));page.set_viewport_size({'width':1400,'height':1000})
   page.evaluate('''()=>{const b=blEd;b.dispatch(b.R.hashMap(b.K('type'),b.K('key'),b.K('key'),':'));b.dispatch(b.R.hashMap(b.K('type'),b.K('text'),b.K('text'),'(ed/unuse "home")'));b.dispatch(b.R.hashMap(b.K('type'),b.K('key'),b.K('key'),'Enter'));}''')
   page.wait_for_function('!document.querySelector(".omega-home")');assert page.locator('iframe').count()==0;page.screenshot(path=str(PROOF/'06-unused.png'))
   checked('real editor unuse removes Home and its viewers while retaining workspace source')
   video=page.video;context.close();video.save_as(str(PROOF/'browser.webm'));browser.close()
  assert not errors,errors
  env['HOME_TEST_TASK']=task_path
  run('run',str(ROOT/'spikes/home/test/native.bl'),timeout=300)
  checked('actual native WebView journey completes on the private compositor')
  assert doc('launch:identity')['text']==identity;assert doc(task_path)['data']['task-title']=='Continue this piece'
  checked('closing native window preserves the shared host and existing task')
 finally:
  if host_started:
   try:run('omega.stop',timeout=30)
   except Exception as e:print('cleanup:',e,flush=True)
  for proc in Path('/proc').iterdir():
   if proc.name.isdigit():
    try:
     if f'XDG_RUNTIME_DIR={runtime}'.encode()+b'\0' in (proc/'environ').read_bytes() and b'BeamLisp' in (proc/'cmdline').read_bytes():os.kill(int(proc.name),signal.SIGTERM)
    except (FileNotFoundError,PermissionError,ProcessLookupError):pass
  if sway and sway.poll() is None:os.killpg(sway.pid,signal.SIGTERM);sway.wait(timeout=15)
  (PROOF/'browser.json').write_text(json.dumps({'checks':checks,'errors':errors,'privateWorld':True,'physicalDevice':False},indent=2)+'\n')
