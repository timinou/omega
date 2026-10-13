#!/usr/bin/env python3
"""Drive the adaptive workbench in a disposable real world; never port 8790."""
import json,os,signal,socket,subprocess,tempfile,time
from pathlib import Path
from urllib.request import Request,urlopen
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'spikes/home/proof/workbench';OUT.mkdir(parents=True,exist_ok=True)
results={'privateWorld':True,'physicalDevice':False,'checks':[],'errors':[],'geometry':[],'timings':{}}
def check(message):results['checks'].append(message);print(message,flush=True)
with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
assert port!=8790
with tempfile.TemporaryDirectory(prefix='omega-workbench-') as temp:
 temp=Path(temp);runtime=temp/'runtime';runtime.mkdir(mode=0o700);work=temp/'work';work.mkdir()
 (work/'README.bl.org').write_text('#+title: A working buffer\n\n* An inspectable document\n\nRead, evaluate and return.\n\n#+begin_src beam-lisp\n(+ 1 2)\n#+end_src\n')
 env={**os.environ,'XDG_STATE_HOME':str(temp/'state'),'XDG_RUNTIME_DIR':str(runtime),'BL_GATEWAY':'off'}
 base=f'http://127.0.0.1:{port}';started=False
 def run(*args):
  r=subprocess.run([str(ROOT/'bin/bl'),*args],cwd=ROOT,env=env,capture_output=True,text=True,timeout=600)
  with (OUT/'launch.log').open('a') as f:f.write(r.stdout+r.stderr)
  assert r.returncode==0,(args,r.returncode,r.stdout,r.stderr);return r
 def intent(name,args):
  with urlopen(Request(base+'/api/intent',data=json.dumps({'intent':name,'args':args}).encode(),headers={'Content-Type':'application/json'}),timeout=30) as r:return json.load(r)
 try:
  stamp=time.monotonic();run('omega','--','--browser','--demo','--port',str(port),'--db',str(temp/'db'));started=True;results['timings']['hostAdmissionSeconds']=time.monotonic()-stamp
  warm=[]
  for _ in range(3):
   stamp=time.monotonic();run('omega','--','--browser','--demo','--port',str(port),'--db',str(temp/'db'));warm.append((time.monotonic()-stamp)*1000)
  results['timings']['warmCompatibleAttachMs']=warm
  assert intent('place/put',{'text':f'{{:id "studio" :name "Studio" :root {json.dumps(str(work))}}}'})['ok']
  task=intent('task/open',{'title':'Review the project brief','goal':'Read the project brief and keep the context clear.','path':'place:studio'});assert task['ok']
  second=intent('task/open',{'title':'Prepare the performance','goal':'Check the performance.','path':'place:studio'});assert second['ok']
  with sync_playwright() as p:
   browser=p.chromium.launch(executable_path=str(Path.home()/'.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'),args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
   context=browser.new_context(viewport={'width':1400,'height':900},record_video_dir=str(OUT/'raw'),record_video_size={'width':1400,'height':900})
   page=context.new_page();page.on('pageerror',lambda e:results['errors'].append(str(e)))
   try:
    stamp=time.monotonic();page.goto(base+'/?use=home&layout=home&file=workspace:all');page.locator('.workbench-header').wait_for(timeout=90000)
    frame=page.frame_locator('[data-pane=work] iframe');frame.locator('.mobile-app').wait_for(timeout=90000)
    frame.locator('[data-act=open-task]').filter(has_text='Review the project brief').wait_for(timeout=60000)
    page.wait_for_function("(()=>{const d=document.querySelector('[data-pane=work] iframe')?.contentDocument,h=d?.querySelector('.mobile-header');return h&&getComputedStyle(h).display==='none';})()")
    results['timings']['workReadySeconds']=time.monotonic()-stamp
    page.screenshot(path=str(OUT/'01-work-desktop.png'));check('launch enters real Work under one adaptive chrome')
    assert page.locator('iframe').count()==1
    for width,height in [(390,844),(320,740),(844,390)]:
     page.set_viewport_size({'width':width,'height':height});page.wait_for_timeout(150)
     box=page.locator('[data-pane=work] iframe').bounding_box();results['geometry'].append({'width':width,'frame':box});assert abs(box['width']-width)<=1,box
     assert page.locator('[data-pane=work] iframe').evaluate('(e)=>{const r=e.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e;}'),'chrome covers the working surface'
     assert not frame.locator('.mobile-header').is_visible();assert not frame.locator('.bottom-nav').is_visible()
     page.screenshot(path=str(OUT/f'work-{width}.png'))
    check('phone and landscape content use full width with one navigation system')
    page.set_viewport_size({'width':1400,'height':900});frame.locator('[data-act=open-task]').filter(has_text='Review the project brief').click()
    frame.locator('[data-field=reply]').wait_for(timeout=60000);frame.locator('[data-field=reply]').fill('Keep this unfinished thought')
    frame.locator('.workbench-preview-list').wait_for();page.screenshot(path=str(OUT/'02-task-desktop.png'))
    check('desktop selection opens a real task with a following work list')
    page.get_by_role('button',name='Actions',exact=True).click()
    frame.locator('[data-act=object-action][data-command="desk/source"]').wait_for()
    assert page.locator('.workbench-header').evaluate('(e)=>e.closest("section").inert')
    frame.locator('[data-act=object-action][data-command="desk/source"]').click()
    assert 'task:' in frame.locator('[role=dialog]').inner_text()
    frame.locator('button[data-act=dismiss]').first.click()
    page.wait_for_function('document.activeElement?.getAttribute("aria-label")==="Actions"')
    check('typed actions inspect the real source and restore parent trigger focus')
    page.evaluate('document.documentElement.style.setProperty("--snow","rgb(241, 239, 233)")')
    page.wait_for_function('document.querySelector("[data-pane=work] iframe").contentDocument.documentElement.style.getPropertyValue("--snow").trim()==="rgb(241, 239, 233)"')
    page.evaluate('document.documentElement.style.removeProperty("--snow")')
    check('shared theme changes propagate into retained working surfaces')
    frame.locator('[data-workbench-filter]').fill('Review')
    wf=page.locator('[data-pane=work] iframe').element_handle().content_frame()
    wf.evaluate("()=>{window.retainedFilter=document.querySelector('[data-workbench-filter]');const b=blEd;b.dispatch(b.R.hashMap(b.K('type'),b.K('mobile/field'),b.K('field'),'slot-proof',b.K('value'),true,b.K('pane'),b.K('rail')));}")
    page.wait_for_timeout(50)
    assert wf.evaluate("retainedFilter===document.querySelector('[data-workbench-filter]')&&document.activeElement===retainedFilter")
    frame.locator('[data-workbench-filter]').fill('')
    check('live child reconciliation preserves the exact focused work filter in its owned slot')
    page.get_by_role('button',name='Buffers',exact=True).first.click();frame.get_by_role('heading',name='Buffers',exact=True).wait_for()
    frame.get_by_role('button',name='Pelagic',exact=False).wait_for();page.screenshot(path=str(OUT/'03-buffers.png'))
    frame.locator('[data-parent-buffer=music]').click();music=page.frame_locator('[data-pane=music] iframe');music.get_by_role('button',name='▶ PERFORM',exact=True).wait_for(timeout=90000)
    mf=page.locator('[data-pane=music] iframe').element_handle().content_frame();q='document.querySelector(".view-host .view-body").pelagic'
    mf.evaluate(q+'.ready()');mf.wait_for_function(q+'.diagnostics().preparation.done',timeout=90000)
    music.get_by_role('button',name='▶ PERFORM',exact=True).click();mf.wait_for_function(q+'.stats().playing&&'+q+'.stats().context==="running"',timeout=30000)
    mf.evaluate('window.retainedInstrument='+q+';window.retainedEngine='+q+'.engine()');page.screenshot(path=str(OUT/'04-pelagic.png'))
    page.locator('.workbench-status [data-screen=work]').click();frame.locator('[data-act=open-task]').filter(has_text='Review the project brief').click()
    assert frame.locator('[data-field=reply]').input_value()=='Keep this unfinished thought';assert mf.evaluate('retainedEngine.ctx.state')=='running'
    check('buffer switching preserves the exact draft and playing audio engine')
    page.get_by_role('button',name='Commands',exact=True).click();frame.locator('#open-address').fill('work:studio/README.bl.org');frame.locator('form[data-form=open]').get_by_role('button',name='Open',exact=True).click()
    frame.locator('.document').wait_for();assert 'An inspectable document' in frame.locator('.document').inner_text();page.screenshot(path=str(OUT/'05-document.png'))
    check('Commands opens the actual structured document buffer')
    page.get_by_role('button',name='Commands',exact=True).click();frame.locator('#eval-code').fill('(+ 1 2)');frame.locator('form[data-form=eval]').get_by_role('button',name='Editor',exact=True).click()
    frame.locator('[role=dialog] pre[role=status]').filter(has_text='3').wait_for();page.screenshot(path=str(OUT/'06-lisp.png'));frame.locator('button[data-act=dismiss]').first.click()
    check('real Lisp evaluates in the contextual editor and displays its result')
    page.get_by_role('button',name='Buffers',exact=True).first.click();frame.locator('[data-parent-buffer=machine]').click()
    machine=page.frame_locator('[data-pane=machine] iframe');machine.get_by_role('heading',name='Owned work, in view').wait_for(timeout=90000);page.screenshot(path=str(OUT/'07-runtime.png'))
    check('runtime inspection opens as a retained buffer in the same workbench')
    page.get_by_role('button',name='Evaluate Lisp',exact=True).click()
    runtime_frame=page.locator('[data-pane=machine] iframe').element_handle().content_frame()
    runtime_frame.evaluate("()=>{const b=blEd;for(const e of [{type:'text',text:'(+ 2 3)'},{type:'key',key:'Enter'}])b.dispatch(b.R.hashMap(...Object.entries(e).flatMap(([k,v])=>[b.K(k),k==='type'?b.K(v):v])));}")
    page.locator('.workbench-feedback').filter(has_text='5').wait_for()
    check('tool Lisp uses the real generic input sink and surfaces its result')
    page.locator('.workbench-status [data-screen=work]').click();page.set_viewport_size({'width':390,'height':844})
    frame.locator('[data-act=open-task]').filter(has_text='Review the project brief').click();assert frame.locator('[data-field=reply]').input_value()=='Keep this unfinished thought';page.screenshot(path=str(OUT/'08-task-phone.png'))
    page.set_viewport_size({'width':390,'height':500});page.screenshot(path=str(OUT/'09-task-short.png'))
    for width,height in [(320,740),(390,500),(844,390)]:
     page.set_viewport_size({'width':width,'height':height});page.wait_for_timeout(100)
     bounds=frame.locator('[data-field=reply]').bounding_box();assert bounds and bounds['x']>=0 and bounds['x']+bounds['width']<=width+1,bounds
     for b in page.locator('.workbench-header .workbench-actions button,.workbench-status nav button').all():assert b.bounding_box()['height']>=44
    check('composer stays within phone, short viewport and landscape bounds; global targets are at least 44px')
    page.set_viewport_size({'width':1400,'height':900})
    # Warm UI timings separate synchronous dispatch from the following paint opportunity.
    results['interaction']=page.evaluate("""async()=>{const rows=[];for(let i=0;i<40;i++){const stamp=performance.now();document.querySelector('.workbench-status [data-screen='+(['buffers','work'][i%2])+']').click();const dispatchMs=performance.now()-stamp;await new Promise(requestAnimationFrame);rows.push({dispatchMs,nextFrameMs:performance.now()-stamp});}return rows;}""")
    results['audioAfterNavigation']=mf.evaluate('retainedInstrument.diagnostics()')
    check('40 warm navigation samples recorded while the retained audio engine remains running')
    assert mf.evaluate('retainedEngine.ctx.state')=='running'
    frame.locator('[data-act=open-task]').filter(has_text='Prepare the performance').click();frame.locator('[data-field=reply]').fill('The brief is clear. Continue with the performance.');frame.locator('[data-act=send]').click()
    deadline=time.monotonic()+30
    while True:
     with urlopen(base+'/api/doc?path=task:'+second['id'],timeout=30) as response:document=json.load(response)
     if 'The brief is clear.' in document['text']:break
     assert time.monotonic()<deadline,document
     page.wait_for_timeout(100)
    check('a real task reply is sent through the existing actor-backed composer')
    # Exercise both navigation policies as BL configuration over the same views.
    page.evaluate('''()=>{const b=blEd;b.dispatch(b.R.hashMap(b.K('type'),b.K('home/profile'),b.K('profile'),'scoped'));}''')
    assert page.locator('.workbench-status nav button').count()==2;page.screenshot(path=str(OUT/'10-scoped.png'))
    page.evaluate('''()=>{const b=blEd;b.dispatch(b.R.hashMap(b.K('type'),b.K('home/profile'),b.K('profile'),'full'));}''')
    assert page.locator('.workbench-status nav button').count()==3;check('both navigation candidates reuse the same retained views and BL policy')
    page.set_viewport_size({'width':1400,'height':900});page.evaluate('''()=>{const b=blEd;for(const e of [{type:'key',key:':'},{type:'text',text:'(ed/unuse "home")'},{type:'key',key:'Enter'}])b.dispatch(b.R.hashMap(...Object.entries(e).flatMap(([k,v])=>[b.K(k),k==='type'?b.K(v):v])));}''')
    page.wait_for_function('!document.querySelector(".omega-workbench")');assert page.locator('iframe').count()==0;page.screenshot(path=str(OUT/'11-unused.png'));check('unuse retracts chrome, subscribers and viewers into the ordinary editor')
   except Exception:
    page.screenshot(path=str(OUT/'failure.png'));(OUT/'failure.html').write_text(page.content());raise
   finally:
    video=page.video;context.close();video.save_as(str(OUT/'journey.webm'));browser.close()
 finally:
  if started:
   stamp=time.monotonic();run('omega.stop');results['timings']['drainSeconds']=time.monotonic()-stamp
  for log in (temp/'state').glob('**/warm-*.log'):(OUT/'warm.log').write_bytes(log.read_bytes())
  for proc in Path('/proc').iterdir():
   if not proc.name.isdigit():continue
   try:
    if f'XDG_RUNTIME_DIR={runtime}'.encode()+b'\0' in (proc/'environ').read_bytes() and b'BeamLisp' in (proc/'cmdline').read_bytes():os.kill(int(proc.name),signal.SIGTERM)
   except (FileNotFoundError,PermissionError,ProcessLookupError):pass
  (OUT/'journey.json').write_text(json.dumps(results,indent=2)+'\n')
assert not results['errors'],results['errors']
for name in ['failure.html','failure.png']:(OUT/name).unlink(missing_ok=True)
