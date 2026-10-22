#!/usr/bin/env python3
"""Real-editor input latency, retained DOM, request feedback and live Gen."""
import json, os, time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
PROOF=ROOT/'proof/workbench/responsiveness'
PROOF.mkdir(exist_ok=True)
URL=os.environ.get('PELAGIC_WORKBENCH_URL','http://127.0.0.1:8792/?use=pelagic&layout=pelagic-gen&file=composer.bl.org')
assert ':8790' not in URL
S="window.blEd.state().get(window.blEd.K('pkg-state')).get('pelagic').get(window.blEd.K('workbench'))"
report={'url':URL,'checks':[],'errors':[]}
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path=os.environ.get('CHROMIUM','/home/user/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'),args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1440,'height':1000})
    page.on('pageerror',lambda e:report['errors'].append(str(e)))
    if os.environ.get('PELAGIC_HOST_SOURCE')=='1':
        page.route('**/pkg/pelagic/workbench.mjs',lambda route:route.fulfill(path=str(ROOT/'host/workbench.mjs'),content_type='text/javascript'))
    page.goto(URL)
    page.wait_for_function('window.blEd&&document.querySelector("[data-pelagic-workbench]")',timeout=120000)
    def keys(sequence):
        page.locator('#input-sink').focus()
        for key in sequence.split():page.keyboard.press(key)
    def ready():
        page.wait_for_function("!['generating','checking'].includes("+S+".get(window.blEd.K('phase')))",timeout=90000)
        assert not page.evaluate(S+".get(window.blEd.K('error'))")
    page.get_by_role('button',name='Select kick-pattern',exact=True).click()
    keys('g a')
    local=page.locator('.view-prompt');text=local.get_by_role('textbox',name='Local request')
    text.focus()
    text.evaluate('''el=>{
      window.heldPrompt=el;window.renderNotifications=0;
      window.retainedRows=[...document.querySelectorAll('#editor .line[data-row]')];
      window.removeFrameObserver=window.blEd.observe(()=>window.renderNotifications++);
      window.inputPaint=[];
      el.addEventListener('input',()=>{const at=performance.now();requestAnimationFrame(()=>window.inputPaint.push(performance.now()-at));});
    }''')
    start=time.perf_counter();text.press_sequentially('drunk drummer',delay=0,timeout=10000)
    report['thirteen_characters_ms']=round((time.perf_counter()-start)*1000,2)
    report['frames_during_typing']=page.evaluate('window.renderNotifications')
    page.wait_for_timeout(750)
    report['frames_after_idle']=page.evaluate('window.renderNotifications')
    assert text.input_value()=='drunk drummer'
    assert page.evaluate(S+".get(window.blEd.K('draft'))")==text.input_value()
    assert page.evaluate('window.heldPrompt.isConnected')
    assert page.evaluate('window.retainedRows.every(el=>el.isConnected)')
    report['input_to_paint_ms']=page.evaluate('window.inputPaint')
    assert report['thirteen_characters_ms']<1000,report
    assert report['frames_during_typing']<=1,report
    assert report['frames_after_idle']<=2,report
    report['checks'].append('continuous native typing does not dispatch/render once per key; source rows and focused textarea are retained')
    # An external state update must not overwrite the pending native draft.
    text.fill('keep this unsent draft')
    page.get_by_role('button',name='Select bass-pattern',exact=True).click()
    assert text.input_value()=='keep this unsent draft'
    keys('g v g q g v')
    assert page.get_by_role('textbox',name='Local request').input_value()=='keep this unsent draft'
    page.get_by_role('button',name='Close Session',exact=True).click()
    report['checks'].append('blur, selection and layout switches preserve a pending prompt draft')
    # Capture actual click-to-painted-frame latency, excluding browser-driver waits.
    page.evaluate('''()=>{window.selectionPaint=[];let at=null;
      document.addEventListener('click',e=>{if(e.composedPath().some(el=>el.classList?.contains('select-object')))at=performance.now();},true);
      window.blEd.observe(()=>{if(at!==null){window.selectionPaint.push(performance.now()-at);at=null;}});
    }''')
    for label in ['glass','low','pulse','kick-pattern','bass-pattern','melody']:
        page.get_by_role('button',name='Select '+label,exact=True).click()
    report['selection_to_paint_ms']=page.evaluate('window.selectionPaint')
    # Hold a provider request to verify the spinner advances and cancel is usable.
    held=[]
    page.route('**/api/intent',lambda route:held.append(route))
    page.get_by_role('button',name='Select kick-pattern',exact=True).click()
    keys('g a');local=page.locator('.view-prompt');text=local.get_by_role('textbox',name='Local request')
    text.fill('make it like a drunk drummer making a simple polyrhythm')
    text.press('Enter')
    page.wait_for_timeout(1500)
    assert local.get_by_role('button',name='Generating · 1s',exact=True).count() or local.locator('.submit').inner_text().startswith('Generating · ')
    page.screenshot(path=str(PROOF/'01-request-progress.png'))
    local.get_by_role('button',name='Cancel request',exact=True).click()
    assert page.evaluate(S+".get(window.blEd.K('phase'))")=='idle'
    for route in held:
        try:route.abort()
        except Exception:pass
    page.unroute('**/api/intent')
    report['checks'].append('pending generation shows elapsed time and Cancel immediately releases the request')
    # Transport failures must leave the controls usable, with an inline error.
    page.route('**/api/intent',lambda route:route.fulfill(status=503,json={'ok':False,'message':'Provider unavailable (test)'}))
    text.press('Enter')
    page.wait_for_function(S+".get(window.blEd.K('phase'))==='idle'")
    assert page.evaluate(S+".get(window.blEd.K('error'))")=='Provider unavailable (test)'
    page.screenshot(path=str(PROOF/'02-request-error.png'))
    page.unroute('**/api/intent')
    report['checks'].append('failed transport returns to editable controls and displays its error')
    if os.environ.get('PELAGIC_WORKBENCH_LIVE')=='1':
        start=time.perf_counter();text.press('Enter');ready()
        report['live_change_seconds']=round(time.perf_counter()-start,3)
        report['live_change']=page.evaluate("()=>{const s="+S+",e=s.get(window.blEd.K('entries')).toArray().at(-1);return {status:e.get(window.blEd.K('status')),provider:e.get(window.blEd.K('provider')),summary:e.get(window.blEd.K('summary'))};}")
        assert report['live_change']['status']=='changed'
        assert 'Demo' not in report['live_change']['provider']
        page.screenshot(path=str(PROOF/'03-live-polyrhythm.png'))
        report['checks'].append('the exact reported polyrhythm request completes through real Gen and browser validation')
    # A one-line generated form changes the ornament's current-row style when
    # selecting another voice. Its native component must not be remounted.
    keys('Escape')
    page.get_by_role('button',name='Select kick-pattern',exact=True).click()
    page.get_by_role('button',name='Peek kick-pattern source',exact=True).click()
    code=page.get_by_role('textbox',name='Component source',exact=True)
    code.fill('(defn kick-pattern [root seed] [[0 0.22 0.25] [4 0.22 0.25]])')
    code.press('Tab')
    page.get_by_role('button',name='Peek kick-pattern source',exact=True).click()
    keys('g v')
    page.get_by_role('button',name='Select kick-pattern',exact=True).click()
    page.get_by_role('button',name='Select kick-pattern',exact=True).evaluate('el=>window.heldInlineKick=el')
    page.get_by_role('button',name='Select bass-pattern',exact=True).click()
    assert page.evaluate('window.heldInlineKick.isConnected')
    keys('u')
    report['checks'].append('inline component DOM survives a selection-style change on a one-line generated form')
    assert not report['errors'],report['errors']
    browser.close()
(PROOF/'browser.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2),flush=True)
