#!/usr/bin/env python3
"""Drive the actual package in an isolated offline Omega host; never port 8790."""
import json, os, time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
PROOF=ROOT/'proof/gen';PROOF.mkdir(parents=True,exist_ok=True)
URL=os.environ.get('PELAGIC_GEN_URL','http://127.0.0.1:8792/?use=pelagic&layout=pelagic-gen&file=composer.bl.org')
assert ':8790' not in URL
REPORT={'url':URL,'checks':[],'errors':[],'live_model':False}
Q='document.querySelector(".view-host .view-body").pelagic'
STATE='''(()=>{const {R,K}=window.blEd;return window.blEd.state().get(K('pkg-state')).get('pelagic').get(K('composer'));})()'''
def run():
 with sync_playwright() as p:
  browser=p.chromium.launch(headless=True,executable_path=os.environ.get('CHROMIUM','/home/user/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'),args=['--no-sandbox','--use-gl=angle','--use-angle=gl','--enable-gpu','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'])
  context=browser.new_context(viewport={'width':1440,'height':1080},accept_downloads=True)
  page=context.new_page();page.on('pageerror',lambda e:REPORT['errors'].append(str(e)))
  page.goto(URL);page.wait_for_function('window.blEd&&document.querySelector("[data-pelagic-compose]")',timeout=120000)
  page.evaluate(Q+'.ready()');page.evaluate(Q+'.compilerReady()')
  def state(key):return page.evaluate(f'window.blEd.R.printStr({STATE}.get(window.blEd.K({json.dumps(key)})))')
  def source():return page.evaluate('window.blEd.R.printStr(window.blEd.state().get(window.blEd.K("text")))')
  def phase(value,timeout=30000):
   accepted=[value]+(['active'] if value=='queued' else [])
   try:page.wait_for_function(f'{json.dumps(accepted+["failed"])}.includes({STATE}.get(window.blEd.K("phase")))',timeout=timeout)
   except Exception:
    page.screenshot(path=str(PROOF/'failure.png'))
    raise AssertionError(f'Timed out awaiting {value}; phase='+state('phase')+'; error='+state('error')+'; runtime='+str(page.evaluate(Q+'.stats()')))
   actual=page.evaluate(f'{STATE}.get(window.blEd.K("phase"))')
   if actual not in accepted:
    page.screenshot(path=str(PROOF/'failure.png'))
    raise AssertionError(f'Expected {value}, got {actual}: '+state('error'))
  def done(name):REPORT['checks'].append(name);print(name,flush=True)
  original=source()
  page.get_by_role('button',name='Start the example',exact=True).click()
  page.wait_for_function(Q+'.stats().playing&&'+Q+'.stats().patterns.includes("melody")',timeout=45000)
  page.get_by_role('button',name='Select melody function',exact=True).click()
  assert state('selection').find('(defn melody')>=0
  page.screenshot(path=str(PROOF/'01-selected.png'))
  page.get_by_role('button',name='Note 2, MIDI 69, beat 3',exact=True).click()
  assert '[2 (+ root 7) 0.38]' in state('selection')
  page.get_by_role('button',name='Parent form',exact=True).click()
  assert ':kind "vector"' in state('selection')
  page.get_by_role('button',name='Select melody function',exact=True).click()
  page.locator('#input-sink').focus();page.keyboard.press('g');page.keyboard.press('a')
  assert page.locator('#phrase-intent').evaluate('(x)=>x.getRootNode().activeElement===x')
  done('music marks, source selection, structural parent and g a share one target')
  if os.environ.get('PELAGIC_GEN_LIVE')=='1':
   page.locator('#phrase-intent').fill('Make this melody more syncopated. Keep eight beats, root and seed parameters, and D minor harmony. Use plain decimal literals.')
   page.get_by_role('button',name='Generate variation',exact=True).click();phase('ready',130000)
   REPORT['live_model']=True;REPORT['live_provider']=page.locator('.candidate-provider').inner_text()
   REPORT['live_candidate']=state('candidate')
   page.screenshot(path=str(PROOF/'02-live-generated.png'))
   assert 'Demo' not in REPORT['live_provider']
   page.get_by_role('button',name='Discard candidate',exact=True).click()
   done('real configured model returns BL that passes browser compilation and graph validation')
  page.get_by_role('combobox',name='Generation provider',exact=True).select_option('demo')
  base=page.evaluate(Q+'.stats().revision')
  page.locator('#phrase-intent').fill('Make this more syncopated; keep the same harmony.')
  page.get_by_role('button',name='Generate variation',exact=True).click();phase('ready')
  assert source()==original;assert page.evaluate(Q+'.stats().revision')==base
  assert page.locator('[data-candidate-notes] .phrase-note').count()==6
  page.screenshot(path=str(PROOF/'03-candidate.png'))
  page.locator('#phrase-intent').fill('Less busy; retain the last two notes.')
  page.get_by_role('button',name='Generate variation',exact=True).click();phase('ready')
  assert page.locator('[data-candidate-notes] .phrase-note').count()==4
  assert page.locator('.candidate-versions button').count()>=2
  # Select the previous version and prove it can still enter the audition path.
  page.locator('.candidate-versions button').nth(-2).click()
  assert page.locator('[data-candidate-notes] .phrase-note').count()==6
  done('refinement retains versions; selecting an older candidate never changes source or playback')
  page.locator('[data-audition]').click();phase('audition',45000)
  assert source()==original;assert page.evaluate(Q+'.stats().revision')==base
  assert page.evaluate(Q+'.stats().audition.current')
  page.evaluate(Q+'.request({kind:"configure",values:{filter:1.1}})')
  page.wait_for_function('document.querySelector("[data-pelagic-compose]").shadowRoot.querySelector("[data-commit]").disabled')
  page.wait_for_function(Q+'.stats().phase==="ACTIVE"',timeout=20000)
  page.locator('[data-audition]').click();phase('audition',45000)
  assert page.evaluate(Q+'.stats().audition.current')
  done('an intervening performance edit disables commit until the candidate is auditioned again')
  REPORT['audition_peak_rms']=page.evaluate('''async()=>{const e=document.querySelector('.view-host .view-body').pelagic.auditionEngine(),a=e.ctx.createAnalyser(),samples=new Float32Array(1024);a.fftSize=1024;e.monitor.connect(a);let peak=0;for(let i=0;i<45;i++){a.getFloatTimeDomainData(samples);peak=Math.max(peak,Math.sqrt(samples.reduce((n,x)=>n+x*x,0)/samples.length));await new Promise(r=>setTimeout(r,25));}e.monitor.disconnect(a);a.disconnect();return peak;}''')
  assert REPORT['audition_peak_rms']>0.000001
  done('candidate audition produces a measured non-silent signal on its separate monitor bus')
  page.screenshot(path=str(PROOF/'04-audition.png'))
  page.locator('[data-commit]').click();phase('queued')
  REPORT['queued_receipt']=page.evaluate(Q+'.events().filter(e=>e.kind==="queued").at(-1)')
  assert REPORT['queued_receipt']['targetBeat']>REPORT['queued_receipt']['beat']
  assert REPORT['queued_receipt']['targetBeat']%4==0
  assert source()!=original
  page.screenshot(path=str(PROOF/'05-queued.png'))
  phase('active',20000)
  assert page.evaluate(Q+'.stats().revision')>base
  REPORT['committed_revision']=page.evaluate(Q+'.stats().revision')
  page.screenshot(path=str(PROOF/'06-active.png'))
  done('audition preserves active history; commit updates the draft and activates at a future bar')
  page.get_by_role('button',name='Undo last phrase commit',exact=True).click();phase('reverted')
  assert source()==original
  page.wait_for_function(Q+'.stats().phase==="ACTIVE"',timeout=20000)
  done('undo restores source and the previous performance through the same revision scheduler')
  # A model-shaped response with an invalid event must fail before a live edit.
  def invalid(route):route.fulfill(status=200,content_type='application/json',body=json.dumps({'ok':True,'replacement':'(defn melody [root seed] [[9 root 1]])','provider':'test invalid fixture','attempts':1}))
  page.route('**/api/intent',invalid)
  page.get_by_role('button',name='Select melody function',exact=True).click()
  page.locator('#phrase-intent').fill('Invalid response contract test')
  revision=page.evaluate(Q+'.stats().revision')
  page.get_by_role('button',name='Generate variation',exact=True).click();phase('failed')
  assert source()==original;assert page.evaluate(Q+'.stats().revision')==revision
  page.unroute('**/api/intent',invalid)
  done('invalid generated music leaves source and the active performance unchanged')
  # Cancellation remains an ordinary BL transition, with late reply suppression.
  held_routes=[]
  def hold(route):held_routes.append(route)
  page.route('**/api/intent',hold)
  page.locator('#phrase-intent').fill('Cancellation contract test')
  page.get_by_role('button',name='Generate variation',exact=True).click();phase('generating')
  page.get_by_role('button',name='Cancel generation',exact=True).click();phase('idle')
  for route in held_routes:route.abort()
  page.unroute('**/api/intent',hold);assert source()==original
  done('cancel returns control immediately and drops the request-owned candidate')
  page.set_viewport_size({'width':640,'height':1000});page.wait_for_timeout(500)
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  assert page.get_by_role('button',name='Select melody function',exact=True).is_visible()
  page.screenshot(path=str(PROOF/'07-narrow.png'));page.set_viewport_size({'width':1440,'height':1080})
  done('narrow layout preserves the real source pane and reachable phrase controls')
  REPORT['stats']=page.evaluate(Q+'.stats()')
  before_unuse=source();cursor=page.evaluate('window.blEd.R.printStr(window.blEd.state().get(window.blEd.K("sels")))')
  page.evaluate('window.oldGenEngine='+Q+'.engine();window.oldGenShader='+Q+'.shader()')
  page.locator('#input-sink').focus();page.keyboard.press(':');page.keyboard.insert_text('(ed/unuse "pelagic")');page.keyboard.press('Enter')
  page.wait_for_function('window.oldGenEngine.ctx.state==="closed"')
  assert page.evaluate('window.oldGenEngine.disposed&&window.oldGenShader.disposed')
  assert not page.locator('[data-pelagic-compose]').count();assert source()==before_unuse
  assert page.evaluate('window.blEd.R.printStr(window.blEd.state().get(window.blEd.K("sels")))')==cursor
  page.screenshot(path=str(PROOF/'08-unused.png'))
  done('real unuse closes audio/graphics and removes the workspace while preserving source and cursor')
  assert not REPORT['errors'],REPORT['errors']
  context.close();browser.close()
try:run()
finally:(PROOF/'browser.json').write_text(json.dumps(REPORT,indent=2)+'\n')
