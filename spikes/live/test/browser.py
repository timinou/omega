#!/usr/bin/env python3
"""The actual editor, an offline world, and a continuously running harness."""
import json, os, signal, socket, subprocess, tempfile, time, urllib.parse, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[3]
PROOF=ROOT/'spikes/live/proof'
FRONTEND=Path(os.environ['LIVE_FRONTEND']).resolve()
PROOF.mkdir(exist_ok=True)
report={'checks':[], 'errors':[], 'frontend':str(FRONTEND)}
def checked(s):
 report['checks'].append(s)
 print(s,flush=True)
def command(page,s):
 page.locator('#input-sink').focus()
 page.keyboard.press('Escape')
 page.keyboard.press(':')
 page.keyboard.insert_text(s)
 page.keyboard.press('Enter')
def wait_for(f, seconds=120):
 end=time.monotonic()+seconds
 while time.monotonic()<end:
  value=f()
  if value:return value
  time.sleep(.2)
 raise AssertionError('condition did not become true')

with socket.socket() as sock:
 sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
with tempfile.TemporaryDirectory(prefix='omega-live-proof-') as temp:
 world=Path(temp)/'world';world.mkdir()
 (world/'notes.bl.org').write_text('#+TITLE: Live notebook\n\nKeep this notebook intact.\n')
 env={**os.environ,'LIVE_WORLD':str(world),'LIVE_PORT':str(port),'LIVE_FRONTEND':str(FRONTEND),'OMEGA_HOME':str(ROOT)}
 with (PROOF/'host.log').open('w') as log:
  host=subprocess.Popen([str(ROOT/'bin/bl'),'--cold','run',str(ROOT/'spikes/live/test/server.bl')],cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
  base=f'http://127.0.0.1:{port}/'
  def request(path,payload=None):
   data=None if payload is None else json.dumps(payload).encode()
   req=urllib.request.Request(base+path,data=data,headers={'Content-Type':'application/json'})
   with urllib.request.urlopen(req,timeout=180) as response:return json.load(response)
  def intent(name,args=None):
   result=request('api/intent',{'intent':'live/'+name,'args':args or {}})
   assert result['ok'],result
   return result
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
    page=browser.new_page(viewport={'width':1500,'height':1040},device_scale_factor=1)
    page.on('pageerror',lambda e:report['errors'].append(str(e)))
    page.goto(base+'?use=live,buffers,present,workspace&file=notes.bl.org')
    page.wait_for_function('window.blEd?.state')
    command(page,'(ed/cmd "live/open")')
    page.get_by_role('heading',name='Change the running world',exact=True).wait_for(timeout=60000)
    page.get_by_role('button',name='Start demonstration',exact=True).click()
    page.get_by_role('button',name='Open worker source',exact=True).wait_for(timeout=180000)
    first=snapshot();pid=first['current']['pid']
    checkpoint=first['history'][0]['id']
    checked('Live loads as a package beside the real editor and starts an owned native worker')
    page.get_by_role('button',name='Open worker source',exact=True).click()
    page.wait_for_function('window.blEd.state().get(window.blEd.K("path"))==="work:project/live-worker.bl"')
    wait_for(lambda:snapshot()['current']['value']>=2)
    command(page,'(ed/find "delta 1")')
    page.locator('#input-sink').focus();page.keyboard.press('c');page.keyboard.insert_text('delta 5');page.keyboard.press('Escape')
    page.keyboard.press('Control+s')
    wait_for(lambda:'delta 5' in request('api/doc?path=work%3Aproject%2Flive-worker.bl')['text'])
    assert snapshot()['current']['version']==1
    checked('An actual editor edit publishes into the shared buffer without changing running code')
    page.get_by_role('button',name='Rehearse published source',exact=True).click()
    page.get_by_role('button',name='Apply rehearsed change',exact=True).wait_for(timeout=120000)
    wait_for(lambda:snapshot().get('candidate',{}).get('result',{}).get('status')=='valid')
    before_apply=snapshot()['current']['value']
    page.get_by_role('button',name='Apply rehearsed change',exact=True).click()
    wait_for(lambda:snapshot()['current']['version']==2)
    wait_for(lambda:snapshot()['current']['value']>=before_apply+5)
    assert snapshot()['current']['pid']==pid
    page.screenshot(path=str(PROOF/'used.png'),full_page=True)
    checked('Rehearsal and publication preserve the native PID and world-owned traffic')
    # Use the same shared file publication endpoint for the invalid candidate.
    doc=request('api/doc?path=work%3Aproject%2Flive-worker.bl')
    bad=doc['text'].replace('(defn migrate [value] value)','(defn migrate [value] -1)')
    saved=request('api/save',{'path':'work:project/live-worker.bl','text':bad,'base':doc['rev'],'client':'proof-invalid','client-seq':1})
    assert saved['ok'],saved
    result=intent('rehearse')
    assert result['status']=='refused',result
    assert snapshot()['current']['version']==2
    checked('An invalid state conversion is refused while the old worker and original client traffic continue')
    # Return through the actual history action in the drawer, using its source checkpoint.
    page.get_by_role('button',name='Refresh',exact=True).click()
    original=page.locator(f'article[data-key="{checkpoint}"]')
    original.get_by_role('button',name='Rehearse this behavior',exact=True).click()
    wait_for(lambda:snapshot().get('candidate',{}).get('result',{}).get('status')=='valid')
    assert snapshot()['candidate']['return-of']==checkpoint
    before_return=snapshot()['current']['value']
    page.get_by_role('button',name='Apply rehearsed change',exact=True).click()
    wait_for(lambda:snapshot()['current']['version']==3)
    after=snapshot()
    assert after['current']['pid']==pid
    assert after['current']['value']>=before_return
    assert after['history'][0]['runtime']['return-of']==checkpoint
    assert not after['source-matches']
    checked('Choosing an earlier behavior creates a new version and preserves current work and later source edits')
    page.get_by_role('button',name='Changes',exact=True).click()
    page.wait_for_function('window.blEd.state().get(window.blEd.K("path")).startsWith("changes:")')
    changes=request('api/doc?path='+urllib.parse.quote(after['changes']))
    assert any(o.get('runtime',{}).get('return-of')==checkpoint for o in changes['objects'])
    page.screenshot(path=str(PROOF/'changes.png'),full_page=True)
    checked('The existing Changes document contains the same source and runtime operations')
    # A panel survives a switch to a full workspace and restores all of it on unload.
    command(page,'(ed/cmd "live/close")')
    command(page,'(ed/layout "workspace")')
    page.wait_for_function('''() => {const {F,K}=window.blEd;return F.d_editor(window.blEd.frame(),K("places"))?.get(K("path"))==="places:";}''')
    before=page.evaluate('''() => {const {F,R,K}=window.blEd,f=window.blEd.frame();return F.d_editor_ids(f).toArray().map(id=>[id.name,R.printStr(F.d_editor(f,id).get(K("text")))]);}''')
    command(page,'(ed/cmd "live/open")')
    page.get_by_role('heading',name='Change the running world',exact=True).wait_for()
    command(page,'(ed/unuse "live")')
    page.get_by_role('heading',name='Change the running world',exact=True).wait_for(state='detached')
    retained=page.evaluate('''() => {const {F,R,K}=window.blEd,f=window.blEd.frame();return F.d_editor_ids(f).toArray().map(id=>[id.name,R.printStr(F.d_editor(f,id).get(K("text")))]);}''')
    assert retained==before,([(p,len(t)) for p,t in before],[(p,len(t)) for p,t in retained])
    page.screenshot(path=str(PROOF/'unused.png'),full_page=True)
    checked('Unuse removes the drawer and preserves every workspace editor')
    intent('stop-harness')
    report['final']=snapshot()
    assert not report['errors'],report['errors']
    browser.close()
  finally:
   try:os.killpg(host.pid,signal.SIGTERM)
   except ProcessLookupError:pass
   try:host.wait(timeout=10)
   except subprocess.TimeoutExpired:os.killpg(host.pid,signal.SIGKILL);host.wait()
   (PROOF/'browser.json').write_text(json.dumps(report,indent=2)+'\n')
