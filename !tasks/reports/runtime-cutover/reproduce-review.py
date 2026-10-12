#!/usr/bin/env python3
"""Private read-only native review launcher and eight-tab browser acceptance."""
import os,json,socket,subprocess,tempfile,time,signal
from pathlib import Path
from urllib.request import urlopen,Request
from urllib.error import HTTPError
from urllib.parse import urljoin
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[3];proof=root/'!tasks/reports/runtime-cutover';checks=[];errors=[]
with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
assert port!=8790
with tempfile.TemporaryDirectory(prefix='omega-review-proof-') as temp:
 runtime=Path(temp)/'runtime';runtime.mkdir(mode=0o700)
 env={**os.environ,'XDG_RUNTIME_DIR':str(runtime),'XDG_STATE_HOME':temp+'/state','BL_GATEWAY':'off'}
 with (proof/'viewer.log').open('w') as output:
  process=subprocess.Popen([str(root/'bin/bl'),'--cold','runtime.review','--','--port',str(port)],cwd=root,env=env,stdout=output,stderr=subprocess.STDOUT,start_new_session=True)
  try:
   base=f'http://127.0.0.1:{port}/';deadline=time.monotonic()+120
   while True:
    if process.poll() is not None:raise RuntimeError((proof/'viewer.log').read_text())
    try:
     with urlopen(base,timeout=1) as r:assert r.status==200
     break
    except OSError:
     if time.monotonic()>deadline:raise TimeoutError((proof/'viewer.log').read_text())
     time.sleep(.1)
   for path in ['env.bl','src/omega/task.bl','api/intent']:
    try:urlopen(Request(base+path,data=b'{}' if path=='api/intent' else None));raise AssertionError(path)
    except HTTPError as e:assert e.code==404,(path,e.code)
   checks.append('root BL task serves only review evidence; app source and world writes unavailable')
   with urlopen(base+'!tasks/reports/runtime-cutover/README.bl.org') as r:assert r.status==200 and r.headers['content-type'].startswith('text/plain')
   with urlopen(Request(base+'spikes/pelagic/proof/milestone-7B/audition/safe-audition.webm',headers={'Range':'bytes=0-1023'})) as r:assert r.status==206 and len(r.read())==1024
   checks.append('walkthrough is readable text; native static leaf supports video byte ranges')
   with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM',str(Path.home()/'.cache/ms-playwright/chromium-1243/chrome-linux64/chrome')),args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1440,'height':1000});page.on('pageerror',lambda e:errors.append(str(e)));page.on('response',lambda r:errors.append(f'{r.status} {r.url}') if r.status>=400 else None)
    page.goto(base);page.locator('nav button').first.wait_for();assert page.locator('nav button').count()==8
    for i in range(8):
     button=page.locator('nav button').nth(i);label=button.inner_text();button.click();src=page.locator('#report').get_attribute('src');frame=page.locator('#report').element_handle().content_frame();frame.wait_for_url(urljoin(page.url,src));frame.locator('h1').wait_for();page.wait_for_timeout(400)
     assert frame.locator('img').evaluate_all('(xs)=>xs.every(x=>x.complete&&x.naturalWidth>0)'),label
     checks.append(label+' opens with its recorded images')
    page.screenshot(path=str(proof/'index-review.png'))
    for name,path,selector in [('measurements','spikes/pelagic/proof/milestone-6/report.html','#rows tr'),('creative','spikes/pelagic/proof/milestone-7B/report.html','img'),('pocket','spikes/mobile/proof/milestone-7B/report.html','img')]:
     page.goto(base+path);page.locator(selector).first.wait_for();page.wait_for_timeout(700);page.screenshot(path=str(proof/(name+'-review.png')),full_page=True)
     if name=='measurements':
      assert page.locator('#rows tr').count()==15;page.get_by_role('button',name='active',exact=True).click();assert page.locator('#rows tr').count()==5
     else:
      for button in page.locator('nav button').all():button.click();page.wait_for_timeout(100);assert page.locator('img').evaluate_all('(xs)=>xs.every(x=>x.complete&&x.naturalWidth>0)')
    assert not errors,errors
    (proof/'report-browser.json').write_text(json.dumps({'compiler':'25f5e799','checks':checks,'errors':errors},indent=2)+'\n');browser.close()
  finally:
   if process.poll() is None:os.killpg(process.pid,signal.SIGTERM)
   process.wait(timeout=20)
   for proc in Path('/proc').iterdir():
    if proc.name.isdigit():
     try:
      if f'XDG_RUNTIME_DIR={runtime}'.encode()+b'\0' in (proc/'environ').read_bytes() and b'BeamLisp' in (proc/'cmdline').read_bytes():os.kill(int(proc.name),signal.SIGTERM)
     except (FileNotFoundError,PermissionError,ProcessLookupError):pass
print(json.dumps({'checks':checks,'errors':errors},indent=2))
