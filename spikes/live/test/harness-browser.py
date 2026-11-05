#!/usr/bin/env python3
"""Pocket and desktop control the same offline worker and retain their editors."""
import json,os,signal,socket,subprocess,tempfile,time,urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[3]
PROOF=ROOT/'spikes/live/proof/harness';PROOF.mkdir(parents=True,exist_ok=True)
FRONTEND=Path(os.environ['LIVE_FRONTEND']).resolve()
viewports=json.loads(os.environ.get('LIVE_VIEWPORTS','[[320,740],[390,844],[844,390],[1024,768]]'))
provider=os.environ.get('LIVE_PROVIDER','claude')
report={'provider':provider,'checks':[],'errors':[],'frontend':str(FRONTEND),'viewports':viewports}
def checked(s):report['checks'].append(s);print(s,flush=True)
def wait_for(f,seconds=150):
 end=time.monotonic()+seconds
 while time.monotonic()<end:
  if result:=f():return result
  time.sleep(.2)
 raise AssertionError('condition did not become true')
with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
with tempfile.TemporaryDirectory(prefix='omega-live-mobile-') as temp:
 world=Path(temp)/'world';world.mkdir()
 env={**os.environ,'LIVE_WORLD':str(world),'LIVE_PORT':str(port),'LIVE_FRONTEND':str(FRONTEND),'OMEGA_HOME':str(ROOT)}
 with (PROOF/'host.log').open('w') as log:
  host=subprocess.Popen([str(ROOT/'bin/bl'),'--cold','run',str(ROOT/'spikes/live/test/server.bl')],cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
  base=f'http://127.0.0.1:{port}/'
  def request(path,payload=None):
   req=urllib.request.Request(base+path,data=None if payload is None else json.dumps(payload).encode(),headers={'Content-Type':'application/json'})
   with urllib.request.urlopen(req,timeout=180) as response:return json.load(response)
  def intent(name,args=None):
   r=request('api/intent',{'intent':'live/'+name,'args':args or {}})
   assert r['ok'],r
   return r
  def snapshot():return intent('snapshot')
  try:
   def ready():
    if host.poll() is not None:raise RuntimeError((PROOF/'host.log').read_text())
    try:return request('api/doc?path=live%3Aoverview')['ok']
    except (OSError,TimeoutError):return False
   wait_for(ready,180)
   with sync_playwright() as pw:
    launch={'headless':True,'args':['--no-sandbox']}
    if os.environ.get('LIVE_CHROMIUM'):launch['executable_path']=os.environ['LIVE_CHROMIUM']
    browser=pw.chromium.launch(**launch)
    desktop=browser.new_page(viewport={'width':1440,'height':1000})
    phone_context=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
    phone=phone_context.new_page()
    for page in [desktop,phone]:page.on('pageerror',lambda e:report['errors'].append(e.stack or str(e)))
    desktop.goto(base+'?use=live,buffers,present,workspace&file=live:overview')
    desktop.get_by_role('heading',name='Change the running world',exact=True).wait_for(timeout=90000)
    phone.goto(base+'?use=present,dwim,workspace,places,references,buffers,workbench,mobile&layout=mobile&file=workspace:all')
    ui=phone.locator('[data-pane="phone"]')
    ui.get_by_text('Host connected',exact=True).first.wait_for(timeout=90000)
    def open_live():
     ui.locator('button[data-act="buffers"]').last.click()
     ui.locator('button[data-act="tool"][data-value="live"]').click()
     phone.get_by_role('heading',name='Change the running world',exact=True).wait_for(timeout=30000)
    def geometry():
     return phone.locator('[data-pane="live-panel"]').evaluate('''e=>{
      const r=e.getBoundingClientRect(),host=e.querySelector('.view-body');
      return {x:r.x,y:r.y,width:r.width,height:r.height,viewport:innerWidth,viewportHeight:innerHeight,
       horizontalOverflow:host.scrollWidth>host.clientWidth+1};}''')
    open_live()
    phone.get_by_role('button',name='Start demonstration',exact=True).click()
    phone.get_by_role('button',name='Open worker source',exact=True).wait_for(timeout=180000)
    initial=snapshot();pid=initial['current']['pid'];checkpoint=initial['history'][0]['id']
    phone.get_by_role('button',name={'claude':'Claude','codex':'Codex','deepseek':'DeepSeek'}[provider],exact=True).click()
    phone.get_by_role('button',name='Run harness',exact=True).click()
    def waiting():
     s=snapshot()
     if (s.get('task') or {}).get('status') in ['failed','cancelled']:
      raise AssertionError(s['task'])
     p=(s.get('candidate') or {}).get('proposal') or {}
     return s if p.get('status')=='needs-decision' and s['task']['status']=='idle' else None
    pending=wait_for(waiting,300)
    task_id=pending['task']['id'];proposal=pending['candidate']['id']
    assert pending['current']['version']==1 and pending['current']['pid']==pid
    assert 'delta 5' in request('api/doc?path=work%3Aproject%2Flive-worker.bl')['text']
    assert any(o.get('task')==task_id and o.get('cell') for o in pending['history'])
    checked('A real provider edits through CodeMode, rehearses, and parks the same Omega task for a decision')
    for width,height in viewports:
     phone.set_viewport_size({'width':width,'height':height})
     box=geometry();assert abs(box['x'])<1 and abs(box['y'])<1 and abs(box['width']-width)<1 and abs(box['height']-height)<1 and not box['horizontalOverflow'],box
     assert phone.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
    phone.set_viewport_size({'width':390,'height':844})
    checked('Real proposal controls fit phone portrait, landscape and tablet viewports')
    phone.get_by_role('button',name='Open harness task',exact=True).click()
    ui.get_by_role('button',name='Apply',exact=True).wait_for(timeout=30000)
    ui.get_by_role('button',name='Apply',exact=True).scroll_into_view_if_needed()
    phone.screenshot(path=str(PROOF/'phone-review.png'))
    d=request('api/doc?path=task%3A'+task_id)['data'];turn_count=len(d['turns'])
    assert any(p.get('text')=='apply '+proposal for p in d['proposals']),d['proposals']
    time.sleep(1.2)
    assert len(request('api/doc?path=task%3A'+task_id)['data']['turns'])==turn_count
    draft='Keep this direction while I inspect the proposal.'
    ui.locator('#mobile-reply').fill(draft)
    ui.locator('button[data-act="work"]').first.click();open_live()
    phone.get_by_role('button',name='Open harness task',exact=True).click()
    assert ui.locator('#mobile-reply').input_value()==draft
    checked('Pocket shows exact proposal choices and retains the task reply without polling the model')
    before=snapshot()['current']['value']
    ui.get_by_role('button',name='Apply',exact=True).click()
    def finished():
     s=snapshot()
     if (s.get('task') or {}).get('status') in ['failed','cancelled']:
      raise AssertionError(s['task'])
     return s if s['task']['status']=='done' else None
    applied=wait_for(finished,300)
    p=next(p for p in applied['proposals'] if p['id']==proposal)
    report['proposal']=p;report['task']=applied['task']
    report['turns']=request('api/doc?path=task%3A'+task_id)['data']['turns']
    assert applied['task']['id']==task_id and applied['current']['pid']==pid
    assert applied['current']['version']==2 and applied['current']['value']>=before
    assert p['status']=='applied' and p['verification']['status']=='passed'
    assert p['verification']['observed-delta']==5
    assert applied['task']['cost']['input']>0
    assert applied['task']['run']['live']['provider']==provider
    phone.screenshot(path=str(PROOF/'phone-completed.png'))
    desktop.get_by_role('heading',name='Change the running world',exact=True).scroll_into_view_if_needed()
    desktop.screenshot(path=str(PROOF/'desktop-live.png'))
    checked('Tapping Apply resumes the same real task, which publishes, verifies old-client behavior and finishes')
    replay=intent('apply',{'candidate':proposal});assert replay['reconciled']
    assert snapshot()['current']['version']==2
    checked('Retrying the exact publication returns its receipt without executing it again')
    desktop.locator(f'article[data-key="{checkpoint}"]').get_by_role('button',name='Rehearse this behavior',exact=True).click()
    wait_for(lambda:(snapshot().get('candidate') or {}).get('result',{}).get('status')=='valid')
    before=snapshot()['current']['value']
    desktop.get_by_role('button',name='Apply rehearsed change',exact=True).click()
    wait_for(lambda:snapshot()['current']['version']==3)
    assert snapshot()['current']['value']>=before and snapshot()['current']['pid']==pid
    desktop.get_by_role('button',name='Changes',exact=True).click()
    desktop.screenshot(path=str(PROOF/'changes.png'))
    checked('Desktop returns to earlier behavior through shared Changes, retaining accepted work')
    wait_for(lambda:phone.evaluate("""()=>{const {F,K}=window.blEd;return F.d_editor(window.blEd.frame(),K('task')).get(K('doc'))?.get(K('data'))?.get(K('task-status'))==='done';}"""))
    ui.locator('button[data-act="work"]').first.click();open_live()
    # Compare within one JS turn: asynchronous task-document refreshes must
    # not be mistaken for text changed by unuse itself.
    retention=phone.evaluate("""()=>{const {F,K,R,dispatch}=window.blEd;
     const snapshot=()=>F.d_editor_ids(window.blEd.frame()).toArray().map(id=>{
      const ed=F.d_editor(window.blEd.frame(),id);
      return [id.name,ed.get(K('path')),R.printStr(ed.get(K('text'))),
       R.printStr(ed.get(K('pkg-state'))?.get('mobile')?.get(K('drafts'))??null)];});
     const before=snapshot();
     dispatch(R.hashMap(K('type'),K('key'),K('key'),':'));
     dispatch(R.hashMap(K('type'),K('text'),K('text'),'(ed/unuse "live")'));
     dispatch(R.hashMap(K('type'),K('key'),K('key'),'Enter'));
     const after=snapshot(),liveRemaining=F.d_editor_ids(window.blEd.frame()).toArray().some(id=>
      F.d_editor(window.blEd.frame(),id).get(K('packages')).toArray().some(p=>p.get(K('name'))==='live'));
     return {before,after,liveRemaining};}""")
    report['retention']=retention
    assert retention['before']==retention['after'] and not retention['liveRemaining'],retention
    phone.get_by_role('heading',name='Change the running world',exact=True).wait_for(state='detached')
    phone.screenshot(path=str(PROOF/'unuse.png'))
    checked('Unusing Live restores Pocket and every retained editor after real model work')
    report['proposal']=p;report['task']=applied['task'];report['final']=snapshot()
    assert not report['errors'],report['errors']
    browser.close()
  finally:
   try:os.killpg(host.pid,signal.SIGTERM)
   except ProcessLookupError:pass
   try:host.wait(timeout=10)
   except subprocess.TimeoutExpired:os.killpg(host.pid,signal.SIGKILL);host.wait()
   (PROOF/'browser.json').write_text(json.dumps(report,indent=2)+'\n')
