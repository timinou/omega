#!/usr/bin/env python3
"""Drive the shared native frontend against a disposable real BEAM server."""
import json,os
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];PROOF=ROOT/'proof/preparation/server';PROOF.mkdir(parents=True,exist_ok=True)
url=os.environ.get('PELAGIC_SERVER_URL','http://127.0.0.1:8792/');assert ':8790' not in url,'Never test the live world'
report={'checks':[],'errors':[],'api':[]}
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(headless=True,executable_path=os.environ.get('CHROMIUM','/home/user/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'),args=['--no-sandbox','--use-gl=angle','--use-angle=gl','--enable-gpu','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'])
  page=browser.new_page(viewport={'width':1440,'height':1080});page.on('pageerror',lambda e:report['errors'].append(str(e)));page.on('request',lambda r:report['api'].append(r.url) if '/api/' in r.url else None)
  q='document.querySelector(".view-host .view-body").pelagic'
  page.goto(url+'?file=live-set.bl.org&use=pelagic&layout=pelagic')
  page.wait_for_function('window.blEd&&document.querySelector(".view-host .view-body")?.pelagic',timeout=90000)
  assert page.evaluate('globalThis.BL_DOCUMENTS===undefined');assert any('/api/doc?' in x for x in report['api']);report['checks'].append('server document transport remains active')
  page.evaluate(q+'.ready()');page.evaluate(q+'.compilerReady()');assert any(w.url.endswith('live-worker.mjs') for w in page.workers);assert page.evaluate(q+'.shader().worker');report['checks'].append('native BL evaluation and rendering workers in server mode')
  page.wait_for_function(q+'.diagnostics().preparation.done',timeout=30000);report['checks'].append('bounded worker score preparation completes')
  page.get_by_role('button',name='▶ PERFORM',exact=True).click();page.locator('#input-sink').focus();page.keyboard.press('Control+Enter');page.wait_for_function(q+'.stats().patterns.includes("melody")',timeout=30000);report['checks'].append('real C-Enter evaluates live patch during transport')
  page.wait_for_timeout(10000);report['metrics']=page.evaluate(q+'.diagnostics()');page.screenshot(path=str(PROOF/'used.jpg'),type='jpeg',quality=80)
  page.locator('#input-sink').focus();page.keyboard.press('G');page.keyboard.press('A');page.keyboard.press('Enter');page.keyboard.insert_text('# Saved by disposable server proof');page.keyboard.press('Escape');page.keyboard.press('Control+s')
  page.wait_for_function('document.querySelector("#echo").textContent.includes("saved")',timeout=30000);assert any('/api/save' in x for x in report['api']);report['checks'].append('editor saves through BEAM server')
  before=page.evaluate('window.blEd.R.printStr(window.blEd.state().get(window.blEd.K("text")))');page.locator('#input-sink').focus();page.keyboard.press(':');page.keyboard.insert_text('(ed/unuse "pelagic")');page.keyboard.press('Enter');page.wait_for_function('!document.querySelector(".view-host")',timeout=30000)
  assert page.evaluate('window.blEd.R.printStr(window.blEd.state().get(window.blEd.K("text")))')==before;page.wait_for_timeout(200);assert not any(w.url.endswith(('prepare-worker.mjs','render-worker.mjs','live-worker.mjs')) for w in page.workers);report['checks'].append('unuse preserves source and releases all package workers');page.screenshot(path=str(PROOF/'unused.jpg'),type='jpeg',quality=80)
  assert not report['errors'],report['errors'];browser.close();print(json.dumps(report,indent=2))
finally:(PROOF/'report.json').write_text(json.dumps(report,indent=2)+'\n')
