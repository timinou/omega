#!/usr/bin/env python3
"""Approved interaction, driven in the real editor's isolated offline world."""
import json, os
from pathlib import Path
from playwright.sync_api import sync_playwright

PROOF=Path(__file__).resolve().parents[1]/'proof/workbench'
PROOF.mkdir(parents=True,exist_ok=True)
URL=os.environ.get('PELAGIC_WORKBENCH_URL','http://127.0.0.1:8792/?use=pelagic&layout=pelagic-gen&file=composer.bl.org')
assert ':8790' not in URL
S="window.blEd.state().get(window.blEd.K('pkg-state')).get('pelagic').get(window.blEd.K('workbench'))"
REPORT={'url':URL,'checks':[],'errors':[]}
def run():
 with sync_playwright() as p:
  browser=p.chromium.launch(headless=True,executable_path=os.environ.get('CHROMIUM','/home/user/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'),args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
  page=browser.new_page(viewport={'width':1440,'height':1080})
  page.on('pageerror',lambda e:REPORT['errors'].append(str(e)))
  page.goto(URL);page.wait_for_function('window.blEd&&document.querySelector("[data-pelagic-workbench]")',timeout=180000)
  page.evaluate("""async()=>{const T=await import('/out/ed.text.mjs'),R=window.blEd.R;
   window.wbPlain=function plain(x){if(x instanceof R.HMap)return Object.fromEntries([...x].map(([k,v])=>[k.fq||k,plain(v)]));
    if(x instanceof R.HSet)return [...x].map(plain);if(x instanceof R.Vec)return x.toArray().map(plain);if(x instanceof R.Kw)return x.fq;if(x instanceof R.Flt)return x.v;return x;};
   window.wbText=T.d_to_string;}""")
  def state():return page.evaluate('JSON.parse(JSON.stringify(window.wbPlain('+S+'),(k,v)=>v instanceof Set?[...v]:v))')
  def source():return page.evaluate("window.wbText(window.blEd.state().get(window.blEd.K('text')))")
  def api(expr):return page.evaluate("document.querySelector('[data-pelagic-workbench]').pelagicWorkspace."+expr)
  def done(name):REPORT['checks'].append(name);print(name,flush=True)
  def keys(text):
   page.locator('#input-sink').focus()
   for key in text.split():page.keyboard.press(key)
  def ready():
   page.wait_for_function("!['generating','checking'].includes("+S+".get(window.blEd.K('phase')))",timeout=150000)
   assert not state().get('error'),state().get('error')
  original=source()
  page.get_by_role('button',name='Select kick-pattern',exact=True).click()
  page.get_by_role('button',name='Select bass-pattern',exact=True).click(modifiers=['Shift'])
  assert len(state()['marks'])==2
  keys('g a');local=page.locator('.view-prompt')
  local.get_by_role('combobox',name='Request provider').select_option('demo')
  local.get_by_role('button',name='Ask about code',exact=True).click()
  local.get_by_role('textbox',name='Local request').fill('Why do these two voices enter at different times?')
  local.get_by_role('textbox',name='Local request').press('Enter');ready()
  assert source()==original;assert state()['entries'][-1]['status']=='answered'
  page.screenshot(path=str(PROOF/'01-local-question.png'))
  done('mixed component selection and local Ask leave source unchanged')
  keys('g q');session=page.locator('.workbench.view-session');session.wait_for()
  assert session.get_by_text('Why do these two voices enter at different times?',exact=True).count()>=1
  session.get_by_role('textbox',name='Session request').fill('And how does the envelope affect that?')
  session.get_by_role('textbox',name='Session request').press('Enter');ready()
  assert len(state()['entries'])==2;assert len({e['conversation'] for e in state()['entries']})==1;assert source()==original
  page.screenshot(path=str(PROOF/'02-session-conversation.png'))
  done('Session retains local exchanges and supports read-only conversational follow-ups')
  session.get_by_role('button',name='Change code',exact=True).click()
  session.get_by_role('textbox',name='Session request').fill('Give both patterns more space.')
  session.get_by_role('textbox',name='Session request').press('Enter');ready()
  changed=source();assert changed!=original;assert state()['entries'][-1]['status']=='changed'
  keys('u');assert source()==original
  keys('U');assert source()==changed
  page.screenshot(path=str(PROOF/'03-coordinated-change.png'))
  done('a question can become a coordinated Change; one undo and redo restore both patterns')
  session.get_by_role('textbox',name='Session request').fill('An unsent follow-up')
  keys('g v');assert state()['layout']=='inline';assert source()==changed
  assert session.get_by_role('textbox',name='Session request').input_value()=='An unsent follow-up'
  page.get_by_role('button',name='Close Session',exact=True).click()
  # Reveal the musical target through the regular package command, then peek its real source.
  page.get_by_role('button',name='Select bass-pattern',exact=True).click()
  page.get_by_role('button',name='Peek bass-pattern source',exact=True).click()
  assert state()['peeks']
  page.screenshot(path=str(PROOF/'04-inline-source-peek.png'))
  page.get_by_role('button',name='Peek bass-pattern source',exact=True).click()
  keys('g q');assert session.get_by_role('textbox',name='Session request').input_value()=='An unsent follow-up'
  page.screenshot(path=str(PROOF/'05-inline-with-session.png'))
  done('inline/split and source peek preserve the document, conversation and unsent draft')
  keys('g v');page.get_by_role('button',name='Close Session',exact=True).click()
  page.get_by_role('button',name='Play the current document',exact=True).click()
  page.wait_for_function("document.querySelector('[data-pelagic-workbench]').pelagicWorkspace.stats().patterns.includes('bass')",timeout=90000)
  page.wait_for_function("document.querySelector('[data-pelagic-workbench]').pelagicWorkspace.stats().phase==='ACTIVE'",timeout=20000)
  REPORT['audio_before_request']=api('stats()')
  page.get_by_role('button',name='Select glass',exact=True).click();keys('g a')
  local=page.locator('.view-prompt');local.get_by_role('button',name='Ask about code',exact=True).click()
  local.get_by_role('textbox',name='Local request').fill('Describe the attack of this instrument.')
  local.get_by_role('textbox',name='Local request').press('Enter');ready()
  REPORT['audio_after_request']=api('stats()');assert REPORT['audio_after_request']['playing']
  assert REPORT['audio_after_request']['revision']==REPORT['audio_before_request']['revision']
  assert source()==changed
  done('the actual three-track document plays and Ask preserves its audio revision')
  if os.environ.get('PELAGIC_WORKBENCH_LIVE')=='1':
   local.get_by_role('combobox',name='Request provider').select_option('gen')
   local.get_by_role('textbox',name='Local request').fill('Explain this instrument envelope in two short sentences.')
   local.get_by_role('textbox',name='Local request').press('Enter');ready()
   REPORT['live_ask']=state()['entries'][-1];assert 'Demo' not in REPORT['live_ask']['provider'];assert source()==changed
   keys('Escape');page.get_by_role('button',name='Select kick-pattern',exact=True).click()
   page.get_by_role('button',name='Select bass-pattern',exact=True).click(modifiers=['Shift']);keys('g a')
   local=page.locator('.view-prompt');local.get_by_role('button',name='Change code',exact=True).click()
   local.get_by_role('textbox',name='Local request').fill('Shift each event a quarter beat later, keeping eight beats and both function signatures. Keep notes and amplitudes the same.')
   local.get_by_role('textbox',name='Local request').press('Enter');ready()
   REPORT['live_change']=state()['entries'][-1];assert REPORT['live_change']['status']=='changed';assert 'Demo' not in REPORT['live_change']['provider'];assert source()!=changed
   page.screenshot(path=str(PROOF/'06-live-gen.png'))
   done('real Gen answers a question and produces a coordinated multi-target Change')
   keys('g q');session=page.locator('.workbench.view-session')
   page.get_by_role('button',name='Select glass',exact=True).click()
   session.get_by_role('button',name='Open exchange '+str(REPORT['live_ask']['id']),exact=True).click()
   page.screenshot(path=str(PROOF/'12-live-session.png'))
   page.get_by_role('button',name='Close Session',exact=True).click()
  page.get_by_role('button',name='Select glass',exact=True).click()
  page.get_by_role('button',name='Peek glass source',exact=True).click()
  peek=page.get_by_role('textbox',name='Component source',exact=True)
  original_instrument=peek.input_value()
  peek.fill('');assert '(defn bass-pattern' in source();assert peek.input_value()==''
  peek.fill('(o/definst glass [freq 440');assert '(defn bass-pattern' in source()
  peek.fill(original_instrument.replace('0.008','0.012'))
  assert '0.012' in source()
  page.get_by_role('spinbutton',name='glass amp',exact=True).fill('0.06')
  page.get_by_role('spinbutton',name='glass amp',exact=True).press('Tab')
  assert 'amp 0.06' in source();keys('u');assert 'amp 0.045' in source();assert '0.012' in source()
  keys('U');assert 'amp 0.06' in source()
  page.screenshot(path=str(PROOF/'10-editable-instrument.png'))
  done('source peek and instrument controls edit the same draft with ordinary undo/redo')
  page.get_by_role('button',name='Select glass',exact=True).click();keys('g j');keys('g m')
  page.get_by_role('button',name='Select bass-pattern',exact=True).click(modifiers=['Shift'])
  keys('g a');local=page.locator('.view-prompt');local.get_by_role('combobox',name='Request provider').select_option('demo')
  local.get_by_role('button',name='Ask about code',exact=True).click()
  local.get_by_role('textbox',name='Local request').fill('How does this code relate to the bass phrase?')
  before=source();local.get_by_role('textbox',name='Local request').press('Enter');ready()
  assert source()==before;assert len(state()['entries'][-1]['targets'])==2
  assert any(t['kind']=='symbol' for t in state()['entries'][-1]['targets'])
  page.screenshot(path=str(PROOF/'11-mixed-code-components.png'))
  keys('Escape');keys('Control+Enter')
  page.wait_for_function("document.querySelector('[data-pelagic-workbench]').pelagicWorkspace.stats().revision>"+str(REPORT['audio_after_request']['revision']),timeout=30000)
  REPORT['evaluated_revision']=api('stats()')['revision']
  done('code and components share a mixed request; normal evaluation publishes the edited music')
  keys(':');page.keyboard.type('(ed/find "(def metro")');page.keyboard.press('Enter')
  metro_row=next(i for i,line in enumerate(source().splitlines()) if '(def metro' in line)
  page.locator('.line[data-row="'+str(metro_row)+'"]').click(position={'x':2,'y':10})
  keys('g a');local=page.locator('.view-prompt');local.get_by_role('button',name='Ask about code',exact=True).click()
  local.get_by_role('textbox',name='Local request').fill('Explain how this metronome is used.')
  before=source();local.get_by_role('textbox',name='Local request').press('Enter');ready()
  assert source()==before;assert any(t['profile']=='code' for t in state()['entries'][-1]['targets'])
  keys('Escape');keys('g g');page.locator('.line[data-row="0"]').click();keys('g a')
  local=page.locator('.view-prompt');local.get_by_role('button',name='Ask about code',exact=True).click()
  local.get_by_role('textbox',name='Local request').fill('Give an overview of this buffer.')
  local.get_by_role('textbox',name='Local request').press('Enter');ready()
  assert state()['entries'][-1]['targets']==[];assert state()['entries'][-1]['snapshot']==source()
  keys('Escape');done('Ask supports code outside generation profiles and current-buffer questions without a selection')
  # Read actual documents from the offline host; visits retain package Session data.
  saved=source();keys('Control+s')
  page.wait_for_function("window.blEd.R.erlEq(window.blEd.state().get(window.blEd.K('text')),window.blEd.state().get(window.blEd.K('saved-text')))")
  def visit(path):
   page.evaluate("""async path=>{const doc=await(await fetch('/api/doc?path='+encodeURIComponent(path))).json(),R=window.blEd.R,K=window.blEd.K;
    window.blEd.dispatch(R.hashMap(K('type'),K('doc'),K('path'),path,K('text'),doc.text,K('rev'),doc.rev,K('visit?'),true,K('read-only?'),false,K('objects'),R.vec()));}""",path)
  keys('g q');visit('notes.bl.org');assert source().startswith('Session history survives')
  session=page.locator('.workbench.view-session');session.get_by_role('combobox',name='Request provider').select_option('demo')
  session.get_by_role('button',name='Ask about code',exact=True).click()
  session.get_by_role('textbox',name='Session request').fill('Explain the patterns we were discussing, using their captured code.')
  session.get_by_role('textbox',name='Session request').press('Enter');ready()
  assert state()['entries'][-1]['document']=='composer.bl.org';assert source().startswith('Session history survives')
  assert session.get_by_text('Captured code · composer.bl.org',exact=True).count()>0
  visit('composer.bl.org');assert source()==saved
  page.get_by_role('button',name='Close Session',exact=True).click()
  done('Session survives file visits and read-only questions can continue about captured code')
  keys('g q');page.set_viewport_size({'width':640,'height':1000});session=page.locator('.workbench.view-session');session.wait_for()
  page.screenshot(path=str(PROOF/'07-narrow-session.png'))
  assert session.get_by_role('textbox',name='Session request').is_visible()
  session.get_by_role('button',name='Close Session',exact=True).click()
  page.screenshot(path=str(PROOF/'08-narrow-document.png'))
  done('narrow Session opens as a focused drawer and returns to the working document')
  page.set_viewport_size({'width':1440,'height':1080});keys('g q')
  keys('Escape');page.evaluate("window.blEd.dispatch(window.blEd.R.hashMap(window.blEd.K('type'),window.blEd.K('key'),window.blEd.K('key'),':'))")
  # Use the real editor API for package unloading, with the language initialized.
  page.locator('#input-sink').focus();page.keyboard.type('(ed/unuse "pelagic")');page.keyboard.press('Enter')
  page.wait_for_function("!document.querySelector('[data-pelagic-workbench]')",timeout=60000)
  page.screenshot(path=str(PROOF/'09-unused.png'))
  assert source();done('unuse removes every owned view and leaves the ordinary source editor')
  assert not REPORT['errors'],REPORT['errors']
  REPORT['frame_timing']=page.evaluate('window.blEdStats()')
  browser.close()
try:run()
finally:(PROOF/'browser.json').write_text(json.dumps(REPORT,indent=2))
