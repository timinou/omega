#!/usr/bin/env python3
"""Play the standalone patch through the real editor and retain both layouts."""
import os, json
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[3]
proof = root / 'spikes/pelagic/proof/performance/example'
proof.mkdir(parents=True, exist_ok=True)
url = os.environ.get('PELAGIC_EXAMPLE_URL', 'http://127.0.0.1:8812/?use=pelagic&layout=pelagic&file=spikes/pelagic/live-set.bl.org')
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=os.environ.get('CHROMIUM', '/home/user/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'), args=['--no-sandbox', '--use-gl=angle', '--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'])
    page = browser.new_page(viewport={'width': 1440, 'height': 1200})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(url)
    q = 'document.querySelector(".view-host .view-body").pelagic'
    page.wait_for_function('document.querySelector(".view-host .view-body")?.pelagic', timeout=60000)
    page.evaluate(q + '.ready()')
    before = page.evaluate('window.blEd.R.printStr(window.blEd.state().get(window.blEd.K("text")))')
    assert 'Performance 002' in before
    page.get_by_role('button', name='▶ PERFORM', exact=True).click()
    page.locator('#input-sink').focus()
    page.keyboard.press('Control+Enter')
    page.wait_for_function(q + '.model().current.visual.intensity===1.65', timeout=30000)
    assert page.evaluate(q + '.stats().patterns.includes("melody")')
    assert page.evaluate(q + '.model().current.visual.scene') == 'cathedral'
    assert page.evaluate(q + '.diagnostics().namespaces') == 0
    page.wait_for_timeout(8000)
    page.screenshot(path=str(proof / 'studio.jpg'), type='jpeg', quality=90)
    result = {'url': url, 'stats': page.evaluate(q + '.stats()'), 'pageErrors': errors}
    page.evaluate('window.exampleEngine=' + q + '.engine();window.exampleStage=' + q + '.shader()')
    page.locator('#input-sink').focus()
    page.keyboard.press(':')
    page.keyboard.insert_text('(ed/unuse "pelagic")')
    page.keyboard.press('Enter')
    page.wait_for_function('window.exampleEngine.ctx.state==="closed"')
    assert page.evaluate('window.exampleStage.disposed')
    assert page.evaluate('window.blEd.R.printStr(window.blEd.state().get(window.blEd.K("text")))') == before
    page.screenshot(path=str(proof / 'unused.jpg'), type='jpeg', quality=85)
    assert not errors, errors
    result['unuse'] = 'source retained; audio closed; graphics disposed'
    (proof / 'report.json').write_text(json.dumps(result, indent=2) + '\n')
    print('Standalone patch active through C-Enter; exact unuse passed.')
    browser.close()
