#!/usr/bin/env python3
"""Validate showcase links and audition complete patches on an isolated static origin."""
from pathlib import Path
import functools,http.server,threading,json,re,os
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
for doc in (root/'tutorials').glob('*.org'):
 for link in re.findall(r'\[\[file:([^\]]+)',doc.read_text()):
  assert (doc.parent/link).exists(),(doc.name,link)
class Handler(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=os.environ.get('PELAGIC_LOCAL_OUT',str(root/'dist/local'))))
threading.Thread(target=server.serve_forever,daemon=True).start()
report={'checks':[],'errors':[]}
try:
 with sync_playwright() as p:
  b=p.chromium.launch(headless=True,executable_path='/home/user/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',args=['--no-sandbox','--use-gl=angle','--use-angle=gl','--enable-gpu','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'])
  page=b.new_page();page.on('pageerror',lambda e:report['errors'].append(str(e)))
  page.goto(f'http://127.0.0.1:{server.server_port}/')
  q='document.querySelector(".view-host .view-body").pelagic'
  page.wait_for_function('window.blEd&&document.querySelector(".view-host .view-body")?.pelagic',timeout=90000)
  page.evaluate(q+'.ready()');page.evaluate(q+'.compilerReady()')
  page.get_by_role('button',name='▶ PERFORM',exact=True).click()
  for doc in sorted((root/'tutorials').glob('0[1236]-*.org')):
   source=doc.read_text();before=page.evaluate(q+'.model()')
   result=page.evaluate('(source)=>'+q+'.evaluate(source,{preview:true})',source)
   assert result['ok'],(doc.name,result)
   assert page.evaluate(q+'.model()')==before,doc.name
   page.evaluate(q+'.request({kind:"audition-cancel"})')
   report['checks'].append({'document':doc.name,'preview':result,'activeRevisionUnchanged':True})
   print(doc.name,'OK',flush=True)
  assert not report['errors'],report
  b.close()
finally:server.shutdown();server.server_close()
Path(os.environ.get('PELAGIC_TUTORIAL_PROOF',root/'tutorials/verification.json')).write_text(json.dumps(report,indent=2)+'\n')
