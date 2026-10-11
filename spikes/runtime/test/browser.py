#!/usr/bin/env python3
"""Offline vertical: native ownership/jobs + browser reports + actual package lifecycle."""
import json,os,shutil,signal,socket,subprocess,tempfile,time,urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[3]
PROOF=ROOT/'spikes/runtime/proof';PROOF.mkdir(exist_ok=True)
FRONTEND=Path(os.environ['RUNTIME_FRONTEND'])
report={'checks':[],'errors':[]}
def checked(name):report['checks'].append(name);print(name,flush=True)
def command(page,source):
 page.locator('#input-sink').focus();page.keyboard.press(':');page.keyboard.insert_text(source);page.keyboard.press('Enter')
with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
with tempfile.TemporaryDirectory(prefix='omega-runtime-proof-') as temp:
 temp=Path(temp);world=temp/'world';world.mkdir();runtime=temp/'runtime';runtime.mkdir(mode=0o700)
 (world/'notes.bl.org').write_text('#+TITLE: Inspector notebook\n\nKeep this source intact.\n')
 (world/'spikes/pelagic').mkdir(parents=True)
 shutil.copy(ROOT/'spikes/pelagic/live-set.bl.org',world/'spikes/pelagic/live-set.bl.org')
 env={**os.environ,'RUNTIME_WORLD':str(world),'RUNTIME_PORT':str(port),'RUNTIME_FRONTEND':str(FRONTEND),'OMEGA_HOME':str(ROOT),'XDG_RUNTIME_DIR':str(runtime),'XDG_STATE_HOME':str(temp/'state'),'BL_GATEWAY':'off'}
 with (PROOF/'host.log').open('w') as output:
  host=subprocess.Popen([str(ROOT/'bin/bl'),'--cold','run',str(ROOT/'spikes/runtime/test/server.bl')],cwd=ROOT,env=env,stdout=output,stderr=subprocess.STDOUT,start_new_session=True)
  try:
   base=f'http://127.0.0.1:{port}/';deadline=time.monotonic()+180
   while True:
    if host.poll() is not None:raise RuntimeError((PROOF/'host.log').read_text())
    try:
     with urllib.request.urlopen(base,timeout=1) as response:
      if response.status==200:break
    except (OSError,TimeoutError):pass
    if time.monotonic()>deadline:raise TimeoutError((PROOF/'host.log').read_text())
    time.sleep(.1)
   with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path=os.environ.get('CHROMIUM','/home/user/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'),args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
    context=browser.new_context(viewport={'width':1600,'height':1100},accept_downloads=True)
    page=context.new_page();page.on('pageerror',lambda e:report['errors'].append(str(e)))
    page.goto(base+'?use=runtime&layout=runtime&file=notes.bl.org')
    page.get_by_role('heading',name='Owned work, in view').wait_for(timeout=90000)
    page.get_by_role('treeitem').filter(has_text='BEAM · PID').wait_for(timeout=30000)
    for name in ['Ownership','Active work','Health & timing','Builds & revisions','Selected item']:assert page.get_by_role('heading',name=name,exact=True).is_visible()
    checked('all five sections render live backend ownership')
    page.get_by_role('button',name='Start actor probe',exact=True).click()
    page.get_by_role('button',name='Cancel',exact=True).wait_for(timeout=10000)
    page.get_by_role('button',name='Cancel',exact=True).click()
    page.get_by_role('button',name='Inspector actor probe · cancelled',exact=True).wait_for(timeout=10000)
    page.get_by_role('button',name='Inspector actor probe · cancelled',exact=True).click()
    checked('real native actor job starts, progresses and cancels')
    with page.expect_download() as download:page.get_by_role('button',name='Export snapshot',exact=True).click()
    download.value.save_as(str(PROOF/'snapshot.json'))
    snapshot=json.loads((PROOF/'snapshot.json').read_text());assert snapshot['backend']['schema']=='omega.runtime.v1'
    assert snapshot['backend']['jobs'][0]['status']=='cancelled'
    checked('snapshot export contains actual native job evidence')
    page.get_by_role('button',name='Open candidate',exact=True).wait_for(timeout=15000)
    with page.expect_popup() as popup:page.get_by_role('button',name='Open candidate',exact=True).click()
    candidate=popup.value;candidate.wait_for_load_state();assert '/generations/' in candidate.url;candidate.close()
    checked('admitted candidate navigation opens a separate session')
    page.on('dialog',lambda dialog:dialog.accept())
    page.get_by_role('button',name='Stop watch',exact=True).click()
    page.get_by_text('not running',exact=True).wait_for(timeout=15000)
    checked('confirmed watcher stop keeps the host and inspector alive')
    count=[0]
    def requests(request):
     if '/api/intent' in request.url and 'runtime/snapshot' in (request.post_data or ''):count[0]+=1
    page.on('request',requests)
    page.get_by_role('button',name='Pause',exact=True).click();page.wait_for_timeout(1200);before=count[0];page.wait_for_timeout(2200);assert count[0]==before
    page.get_by_role('button',name='Resume',exact=True).click();page.wait_for_timeout(1600);assert count[0]>before
    checked('pause stops backend polling and resume restarts it')
    peer=context.new_page();peer.on('pageerror',lambda e:report['errors'].append(str(e)))
    peer.goto(base+'?use=pelagic&layout=pelagic&file=spikes/pelagic/live-set.bl.org')
    peer.wait_for_function('document.querySelector(".view-body")?.pelagic',timeout=90000)
    peer.get_by_role('button',name='▶ PERFORM',exact=True).click()
    peer.wait_for_function('document.querySelector(".view-body").pelagic.stats().playing')
    page.bring_to_front()
    page.get_by_role('treeitem').filter(has_text='Reported peer tab').wait_for(timeout=15000)
    page.get_by_text('pelagic · reported peer',exact=True).wait_for(timeout=15000)
    checked('another live PELAGIC tab reports package workers and timing')
    page.screenshot(path=str(PROOF/'used.png'),full_page=True)
    page.get_by_role('button',name='Open source',exact=True).click()
    page.wait_for_function('window.blEd.state().get(window.blEd.K("path"))==="runtime:source/src/omega/runtime.bl"')
    checked('selected native job navigates to read-only project source')
    command(page,'(ed/unuse "runtime")')
    page.get_by_role('heading',name='Owned work, in view').wait_for(state='detached',timeout=15000)
    assert peer.evaluate('document.querySelector(".view-body").pelagic.stats().playing')
    page.screenshot(path=str(PROOF/'unused.png'))
    checked('unuse restores the real editor without interrupting the other session')
    peer.bring_to_front();peer.evaluate('window.savedEngine=document.querySelector(".view-body").pelagic.engine()')
    peer.get_by_role('button',name='RUNTIME',exact=True).click()
    peer.get_by_role('heading',name='Owned work, in view').wait_for(timeout=30000)
    assert peer.evaluate('window.savedEngine===document.querySelector(".view-body").pelagic.engine()')
    peer.screenshot(path=str(PROOF/'pelagic-companion.png'))
    command(peer,'(ed/unuse "runtime")')
    peer.get_by_role('heading',name='Owned work, in view').wait_for(state='detached',timeout=15000)
    assert peer.evaluate('window.savedEngine===document.querySelector(".view-body").pelagic.engine()&&window.savedEngine.ctx.state==="running"')
    checked('companion inspector opens and unuses without replacing the live audio engine')
    peer.close();page.goto(base+'?use=runtime&layout=runtime&file=notes.bl.org');page.wait_for_timeout(7500)
    assert page.get_by_role('treeitem').filter(has_text='Reported peer tab').count()==0
    checked('departed peer expires from the ownership view')
    pocket=context.new_page();pocket.goto(base+'?use=present,dwim,workspace,places,references,buffers,workbench,mobile&layout=mobile&file=workspace:all')
    pocket.get_by_role('button',name='Host connected',exact=True).wait_for(timeout=90000)
    pocket.get_by_role('button',name='Host connected',exact=True).click()
    pocket.get_by_role('button',name='Runtime inspector',exact=True).click()
    pocket.get_by_role('heading',name='Owned work, in view').wait_for(timeout=30000)
    pocket.wait_for_function('''() => {const pane=document.querySelector('[data-pane="observatory"]'),r=pane.getBoundingClientRect();return r.width>300&&r.top>=0&&r.bottom<=innerHeight+1&&r.right<=innerWidth+1;}''')
    pocket.get_by_role('button',name='Refresh',exact=True).click(timeout=5000)
    pocket.screenshot(path=str(PROOF/'pocket-companion.png'))
    pocket.set_viewport_size({'width':390,'height':844})
    pocket.get_by_role('button',name='Refresh',exact=True).click(timeout=5000)
    assert pocket.evaluate('''() => {const r=document.querySelector('[data-pane="observatory"]').getBoundingClientRect();return r.width>300&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;}''')
    pocket.screenshot(path=str(PROOF/'pocket-narrow.png'))
    command(pocket,'(ed/unuse "runtime")');pocket.get_by_role('heading',name='Owned work, in view').wait_for(state='detached',timeout=15000)
    assert pocket.evaluate('window.blEd.F.d_editor_ids(window.blEd.frame()).toArray().map(x=>x.name).join(",")==="rail,task,file"')
    assert pocket.evaluate('document.querySelectorAll(\'link[href$="/runtime/layout.css"]\').length===0')
    assert pocket.get_by_role('button',name='Runtime inspector',exact=True).is_visible()
    checked('Pocket entry and unload retain all three editors')
    assert not report['errors'],report['errors'];context.close();browser.close()
  finally:
   if host.poll() is None:
    os.killpg(host.pid,signal.SIGTERM)
    try:host.wait(timeout=5)
    except subprocess.TimeoutExpired:os.killpg(host.pid,signal.SIGKILL);host.wait()
   (PROOF/'browser.json').write_text(json.dumps(report,indent=2)+'\n')
