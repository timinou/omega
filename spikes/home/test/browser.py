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
 temp=Path(temp)
 for mode,name in [('client-header','virtual-pointer.h'),('private-code','virtual-pointer.c')]:subprocess.run(['wayland-scanner',mode,str(ROOT/'spikes/home/test/virtual-pointer.xml'),str(temp/name)],check=True)
 flags=subprocess.check_output(['pkg-config','--cflags','--libs','wayland-client'],text=True).split()
 subprocess.run(['cc','-I',str(temp),str(ROOT/'spikes/home/test/pointer.c'),str(temp/'virtual-pointer.c'),'-o',str(temp/'pointer'),*flags],check=True)
 runtime=temp/'runtime';runtime.mkdir(mode=0o700);work=temp/'work';work.mkdir();(work/'README.bl.org').write_text('#+TITLE: Home acceptance\n\nA private working place.\n')
 env={**os.environ,'XDG_RUNTIME_DIR':str(runtime),'XDG_STATE_HOME':str(temp/'state'),'BL_GATEWAY':'off','HOME_POINTER_BIN':str(temp/'pointer')}
 sway=None;host_started=False
 def run(*args,good=True,timeout=600):
  r=subprocess.run([str(ROOT/'bin/bl'),*args],cwd=ROOT,env=env,capture_output=True,text=True,timeout=timeout)
  with (PROOF/'launch.log').open('a') as f:f.write(r.stdout+r.stderr)
  assert (r.returncode==0)==good,(args,r.returncode,r.stdout,r.stderr)
  return r
 def lifecycle():
  return json.loads(re.search(r'HOME_STATE=(.+)',run('run',str(ROOT/'spikes/home/test/state.bl')).stdout)[1])
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
  vm_before=re.search(r'HOME_VM=(\d+)',run('eval','(println (str \"HOME_VM=\" (System/pid)))').stdout)[1]
  before=lifecycle();env['HOME_LISTENER_PID']=before['listener'];(PROOF/'lifecycle-before.json').write_text(json.dumps(before,indent=2)+'\n')
  identity=doc('launch:identity')['text']
  (PROOF/'host-identity.txt').write_text(identity+'\n')
  run('omega','--','--browser','--live','--port',str(port),'--db',str(temp/'db'),good=False)
  assert doc('launch:identity')['text']==identity
  checked('actual root Home task starts a private durable scripted world; incompatible mode is refused')
  assert intent('place/put',{'text':f'{{:id "home-proof" :name "Private studio" :root {json.dumps(str(work))}}}'})['ok']
  opened=intent('task/open',{'goal':'Continue this piece','title':'Continue this piece','path':'place:home-proof'});assert opened['ok'],opened
  task_path=opened.get('path') or 'task:'+opened['id']
  if not os.environ.get('HOME_NATIVE_ONLY') and not os.environ.get('HOME_STOP_ONLY') and not os.environ.get('HOME_LAUNCH_ONLY'):
   with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM',str(Path.home()/'.cache/ms-playwright/chromium-1243/chrome-linux64/chrome')),args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
    context=browser.new_context(viewport={'width':1400,'height':1000},record_video_dir=str(PROOF/'raw'),record_video_size={'width':1400,'height':1000})
    page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(base+'/?use=home&layout=home&file=workspace:all');page.locator('.omega-home h1').wait_for()
    recovered='unavailable' in page.locator('.omega-home [data-status]').inner_text()
    if recovered:
     page.get_by_role('button',name='Refresh work').click();checked('cold Home document failure exposes a working Refresh control')
    try:page.get_by_role('button',name='Continue this piece',exact=False).first.wait_for(timeout=60000)
    except Exception:
     page.screenshot(path=str(PROOF/'failure.png'));(PROOF/'failure.json').write_text(json.dumps({'workspace':doc('workspace:all'),'home':page.locator('.omega-home').evaluate('(e)=>e.outerHTML'),'objects':page.evaluate('blEd.R.printStr(blEd.state().get(blEd.K("obj-index")))'),'errors':errors},indent=2));raise
    assert page.locator('iframe').count()==0;page.screenshot(path=str(PROOF/'01-home.png'))
    checked('Home projects actual tasks and places; no unopened editor viewers are allocated')
    if recovered:
     assert page.get_by_role('button',name='Refresh work').evaluate('(b)=>b===document.activeElement')
     for _ in range(4):page.keyboard.press('Shift+Tab')
    page.wait_for_function('document.activeElement?.dataset.activity===\"home\"')
    page.keyboard.press('Tab');assert page.evaluate('document.activeElement.dataset.activity')=='work'
    page.keyboard.press('Enter');page.wait_for_function('!!document.querySelector(\"[data-pane=work] iframe\")')
    page.locator('.omega-home nav [data-activity=home]').click()
    checked('Home supports Tab and Enter; activity return restores keyboard focus')
    page.get_by_role('button',name='Continue this piece',exact=False).first.click()
    frame=page.frame_locator('[data-pane="work"] iframe');frame.locator('.question-card').wait_for(timeout=60000)
    reply=frame.locator('[data-field="reply"]');reply.fill('Keep this unfinished thought')
    page.screenshot(path=str(PROOF/'02-work.png'))
    assert page.locator('.omega-home nav [data-activity="home"]').evaluate('(b)=>{const r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}')
    page.locator('.omega-home nav [data-activity="home"]').click();assert page.locator('[data-pane="work"]').get_attribute('aria-hidden')=='true'
    assert page.locator('[data-pane="work"]').evaluate('(e)=>e.inert')
    assert page.locator('[data-pane="work"] iframe').evaluate('(e)=>e.contentWindow.blHost.observation().watches')==0
    page.locator('.omega-home nav [data-activity="work"]').click();assert reply.input_value()=='Keep this unfinished thought'
    checked('Continue opens the existing task; Home return retains its draft and makes hidden panes inert')
    page.locator('.omega-home nav [data-activity="music"]').click();music=page.frame_locator('[data-pane="music"] iframe');music.get_by_role('button',name='▶ PERFORM',exact=True).wait_for(timeout=90000)
    mf=page.locator('[data-pane="music"] iframe').element_handle().content_frame();q='document.querySelector(".view-host .view-body").pelagic'
    mf.evaluate(q+'.ready()');mf.wait_for_function(q+'.diagnostics().preparation.done || '+q+'.diagnostics().preparation.error',timeout=60000)
    preparation=mf.evaluate(q+'.diagnostics().preparation');(PROOF/'preparation.json').write_text(json.dumps(preparation,indent=2)+'\n');assert preparation['done'],preparation
    music.get_by_role('button',name='▶ PERFORM',exact=True).click();mf.wait_for_function(q+'.stats().playing&&'+q+'.stats().context==="running"',timeout=15000)
    mf.wait_for_function(q+'.stats().frames>0&&'+q+'.stats().gpu.worker===true',timeout=30000)
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
  if not os.environ.get('HOME_STOP_ONLY'):
   if not os.environ.get('HOME_LAUNCH_ONLY'):
    run('--cold','run',str(ROOT/'spikes/home/test/native.bl'),timeout=300)
    checked('actual native WebView journey completes on the private compositor')
    assert doc('launch:identity')['text']==identity;assert doc(task_path)['data']['task-title']=='Continue this piece'
    checked('closing native window preserves the shared host and existing task')
    (PROOF/'lifecycle-window-closed.json').write_text(json.dumps(lifecycle(),indent=2)+'\n')
   # Exercise the shipping root native entry, including its cold display client
   # and an actual OS window-close event on our private compositor.
   with (PROOF/'native-entry.log').open('w') as native_log:
    started=time.monotonic()
    native=subprocess.Popen([str(ROOT/'bin/bl'),'omega','--','--demo','--port',str(port),'--db',str(temp/'db')],cwd=ROOT,env=env,stdout=native_log,stderr=subprocess.STDOUT,start_new_session=True)
    node=None
    def windows(tree):
     yield tree
     for child in tree.get('nodes',[])+tree.get('floating_nodes',[]):yield from windows(child)
    try:
     deadline=time.monotonic()+90
     while node is None:
      tree=json.loads(subprocess.check_output(['swaymsg','-s',str(sock),'-t','get_tree','-r'],env=env,text=True))
      node=next((n for n in windows(tree) if n.get('name')=='Omega' and n.get('pid')),None)
      assert native.poll() is None,(PROOF/'native-entry.log').read_text()
      assert time.monotonic()<deadline,'native root entry did not open a window'
      if node is None:time.sleep(.1)
     appeared=time.monotonic()-started
     assert str(node['pid'])!=vm_before
     assert f'XDG_RUNTIME_DIR={runtime}'.encode()+b'\0' in Path(f"/proc/{node['pid']}/environ").read_bytes()
     # Observe the shipping window itself, not only an instrumented sibling.
     # A fixed sleep captured Loading editor on a cold start. Screen OCR keeps
     # this check outside application code and waits for actual Home pixels.
     deadline=time.monotonic()+90
     while True:
      subprocess.run(['grim',str(PROOF/'native-entry.png')],env=env,check=True)
      screen=subprocess.run(['tesseract',str(PROOF/'native-entry.png'),'stdout','--psm','11'],env=env,capture_output=True,text=True,check=True).stdout
      if all(label in screen for label in ['Your work','Pelagic','Machine']):break
      assert native.poll() is None and time.monotonic()<deadline,screen
      time.sleep(.5)
     (PROOF/'native-entry-screen.txt').write_text(screen)
     painted=time.monotonic()-started
     subprocess.run(['swaymsg','-s',str(sock),f"[con_id={node['id']}] kill"],env=env,capture_output=True,check=True)
     assert native.wait(timeout=30)==0,(PROOF/'native-entry.log').read_text()
     assert doc('launch:identity')['text']==identity
     (PROOF/'native-entry.json').write_text(json.dumps({'windowAppearedSeconds':appeared,'homePaintedSeconds':painted,'windowClientPid':node['pid'],'backendVm':vm_before,'isolatedClient':True,'osCloseReturns':True,'hostPreserved':True,'physicalDevice':False},indent=2)+'\n')
     checked('shipping root native entry opens an isolated client; OS close preserves the host')
    finally:
     if native.poll() is None:
      if node:subprocess.run(['swaymsg','-s',str(sock),f"[con_id={node['id']}] kill"],env=env,capture_output=True)
      native.terminate();native.wait(timeout=15)

 finally:
  if host_started:
   try:
    stopped=time.monotonic();run(*(['run',str(ROOT/'spikes/home/test/shutdown.bl')] if os.environ.get('HOME_STOP_PROBE') else ['omega.stop']),timeout=300)
    vm_after=re.search(r'HOME_VM=(\d+)',run('eval','(println (str \"HOME_VM=\" (System/pid)))').stdout)[1];assert vm_after==vm_before
    after=lifecycle();(PROOF/'lifecycle-stopped.json').write_text(json.dumps(after,indent=2)+'\n')
    assert not after['owner'] and not after['previous-listener-alive'],after
    deadline=time.monotonic()+5
    while True:
     with socket.socket() as listener:
      listener.settimeout(1);closed=listener.connect_ex(('127.0.0.1',port))!=0
     if closed:break
     if time.monotonic()>=deadline:
      inodes=[]
      for table in ['/proc/net/tcp','/proc/net/tcp6']:
       for line in Path(table).read_text().splitlines()[1:]:
        fields=line.split()
        if int(fields[1].split(':')[-1],16)==port and fields[3]=='0A':inodes.append(fields[9])
      holders=[]
      for proc in Path('/proc').iterdir():
       if not proc.name.isdigit():continue
       try:
        if f'XDG_RUNTIME_DIR={runtime}'.encode()+b'\0' not in (proc/'environ').read_bytes():continue
        for fd in (proc/'fd').iterdir():
         if os.readlink(fd) in ['socket:['+inode+']' for inode in inodes]:
          holders.append({'pid':proc.name,'name':(proc/'comm').read_text().strip(),'fd':fd.name,'info':(proc/'fdinfo'/fd.name).read_text()})
       except (FileNotFoundError,PermissionError,ProcessLookupError):pass
      (PROOF/'socket-owners.json').write_text(json.dumps({'port':port,'inodes':inodes,'holders':holders},indent=2)+'\n')
      raise AssertionError('stopped listener still accepts connections')
     time.sleep(.1)
    checked('explicit stop retires the private world without killing the shared VM')
    (PROOF/'stop.json').write_text(json.dumps({'elapsedSeconds':time.monotonic()-stopped,'graceful':True,'vmBefore':vm_before,'vmAfter':vm_after,'listenerClosed':True},indent=2)+'\n')
   except Exception as e:errors.append('world stop: '+str(e));print('cleanup:',e,flush=True)
  for warm_log in (temp/'state').glob('**/warm-*.log'):
   (PROOF/'warm.log').write_bytes(warm_log.read_bytes())
  for proc in Path('/proc').iterdir():
   if proc.name.isdigit():
    try:
     if f'XDG_RUNTIME_DIR={runtime}'.encode()+b'\0' in (proc/'environ').read_bytes() and b'BeamLisp' in (proc/'cmdline').read_bytes():os.kill(int(proc.name),signal.SIGTERM)
    except (FileNotFoundError,PermissionError,ProcessLookupError):pass
  if sway and sway.poll() is None:os.killpg(sway.pid,signal.SIGTERM);sway.wait(timeout=15)
  (PROOF/('entry-launch.json' if os.environ.get('HOME_LAUNCH_ONLY') else 'shutdown.json' if os.environ.get('HOME_STOP_ONLY') else 'native-launch.json' if os.environ.get('HOME_NATIVE_ONLY') else 'browser.json')).write_text(json.dumps({'checks':checks,'errors':errors,'privateWorld':True,'physicalDevice':False},indent=2)+'\n')

assert not errors,errors
