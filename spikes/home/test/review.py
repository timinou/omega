#!/usr/bin/env python3
"""Exercise the actual read-only review server; no world or frontend build."""
import json,os,signal,socket,subprocess,tempfile,time
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.parse import urljoin
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[3];PROOF=ROOT/'spikes/home/proof'
with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
with tempfile.TemporaryDirectory(prefix='omega-home-review-') as temp:
 env={**os.environ,'BL_GATEWAY':'off','XDG_STATE_HOME':temp}
 with (PROOF/'review.log').open('w') as log:
  child=subprocess.Popen([str(ROOT/'bin/bl'),'--cold','runtime.review','--','--port',str(port)],cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
  try:
   base=f'http://127.0.0.1:{port}';deadline=time.monotonic()+90
   while True:
    try:
     with urlopen(base,timeout=1) as r:assert r.status==200
     break
    except Exception:
     assert child.poll() is None and time.monotonic()<deadline;time.sleep(.2)
   checks=[]
   with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM',str(Path.home()/'.cache/ms-playwright/chromium-1243/chrome-linux64/chrome')),args=['--no-sandbox'])
    page=browser.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(base);assert page.locator('#milestones button').count()==8
    page.get_by_role('link',name='Home prototype').click();page.wait_for_function('!document.querySelector("#native").textContent.includes("Loading")')
    page.get_by_text('Native WebView journey',exact=True).click()
    assert page.locator('#native').is_visible()
    assert 'native renderer submits real frames' in page.locator('#native').inner_text(), {'url':page.url,'native':page.locator('#native').inner_text(),'errors':errors,'response':page.request.get(urljoin(page.url,'native.json')).text()[:400]}
    for button in page.locator('#shots button').all():
     button.click();page.wait_for_function('shot.complete&&shot.naturalWidth>0');checks.append(button.inner_text())
    for link in page.locator('a').all():
     with urlopen(link.get_attribute('href') if link.get_attribute('href').startswith('http') else urljoin(page.url,link.get_attribute('href'))) as r:assert r.status==200
    with urlopen(Request(base+'/spikes/home/proof/browser.webm',headers={'Range':'bytes=0-255'})) as r:assert r.status==206 and len(r.read())==256
    page.screenshot(path=str(PROOF/'review.png'));assert not errors,errors;browser.close()
   (PROOF/'review.json').write_text(json.dumps({'views':checks,'milestoneTabs':8,'nativeAcceptanceVisible':True,'tutorialLinks':True,'videoRange':True,'errors':errors},indent=2)+'\n')
  finally:
   if child.poll() is None:os.killpg(child.pid,signal.SIGTERM)
   child.wait(timeout=15)
