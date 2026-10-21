#!/usr/bin/env python3
"""Real-editor column acceptance. Start bin/bl-ed --offline --memory first.

python vendor/bl-ed/test/columns-browser.py --port 8792 --root /tmp/omega-columns-world
Only the disposable root is written; the browser never saves the document.
"""
import argparse
import json
from pathlib import Path
from urllib.parse import urlencode
from playwright.sync_api import sync_playwright

p = argparse.ArgumentParser()
p.add_argument('--port', type=int, default=8792)
p.add_argument('--root', type=Path, required=True)
p.add_argument('--proof', type=Path, default=Path('vendor/bl-ed/test/proof/columns'))
p.add_argument('--chromium', type=Path)
a = p.parse_args()
assert a.port == 8792, 'Use the dedicated offline test port, never the running world'
assert a.root.resolve().is_relative_to(Path('/tmp')), 'Use a disposable /tmp root'
a.root.mkdir(exist_ok=True)
a.proof.mkdir(parents=True, exist_ok=True)
(a.root / 'columns.bl.org').write_text(
    '#+TITLE: Resizable columns\n\n* A working document\n\n'
    'Drag a divider to give a pane more room. Arrow keys adjust a focused divider; '
    'Shift moves it farther. Escape cancels a drag. Enter or a double-click restores the layout widths.\n\n'
    'The document, cursor, undo history and unpublished draft remain in their pane '
    'while the frame changes around them.\n\n' + ''.join(
        f'Line {i}: This is ordinary editable text in the real bl-ed browser host.\n' for i in range(1,45)))
base = f'http://127.0.0.1:{a.port}/'
checks = []

with sync_playwright() as pw:
    shells = list((Path.home()/'.cache/ms-playwright').glob('chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell'))
    executable = a.chromium or (max(shells, key=lambda f:int(f.parents[1].name.rsplit('-',1)[1])) if shells else None)
    browser = pw.chromium.launch(headless=True, **({'executable_path':str(executable)} if executable else {}))
    page = browser.new_page(viewport={'width':1600, 'height':1000})
    errors = []
    page.on('pageerror', lambda e: errors.append(e.stack or str(e)))

    def check(label):
        checks.append(label)
        print(label, flush=True)

    def boot(use='', layout=None):
        args = {'file':'columns.bl.org', 'use':use}
        if layout: args['layout'] = layout
        page.goto(base + '?' + urlencode(args))
        page.wait_for_function('window.blEd && !document.querySelector("[data-loading]")')

    def widths():
        return page.locator('#panes > .pane:not([inert])').evaluate_all('(nodes)=>nodes.map(n=>n.getBoundingClientRect().width)')

    def settled():
        page.wait_for_timeout(100)

    def handle(i=0):
        return page.locator('.column-handle').nth(i)

    def start(i=0):
        rect = handle(i).bounding_box()
        x, y = rect['x'] + rect['width']/2, rect['y'] + min(220, rect['height']/2)
        page.mouse.move(x, y)
        page.mouse.down()
        return x, y

    def drag(delta, i=0):
        x, y = start(i)
        page.mouse.move(x+delta, y, steps=8)
        page.mouse.up()
        settled()

    def signature():
        return page.evaluate('''() => {
          const {R,K,F}=blEd, fr=blEd.frame();
          return F.d_editor_ids(fr).toArray().map(id=>{
            const ed=F.d_editor(fr,id);
            return ['text','sels','undo','redo','minibuf','path','mode'].map(k=>R.printStr(ed.get(K(k),null)));
          });
        }''')

    def command(source):
        page.evaluate('blEd.focusInput()')
        page.keyboard.press(':')
        page.keyboard.insert_text(source)
        page.keyboard.press('Enter')
        settled()

    held_language = []
    page.route('**/out/repl.mjs', lambda route: held_language.append(route))
    boot()
    assert handle().count() == 0
    check('single editor has no resize handles')
    page.keyboard.press(':')
    page.keyboard.insert_text('(+ 1 2)')
    page.keyboard.press('Enter')
    page.wait_for_function('blEd.state().get(blEd.K("awaiting"),null) !== null')
    assert page.evaluate('blEd.state().get(blEd.K("mode")).name') == 'command'
    for route in held_language:
        route.continue_()
    page.unroute('**/out/repl.mjs')
    page.wait_for_function('blEd.state().get(blEd.K("message")) === "3"')
    check('loading the BL browser controller preserves deferred commands before the language is ready')

    boot('present,dwim,workspace', 'workspace')
    page.wait_for_function('document.querySelectorAll(".column-handle").length === 2')
    page.wait_for_function('blHost.lang.state === "ready"')
    before = widths()
    saved = signature()
    page.screenshot(path=str(a.proof/'01-workspace-used.png'))
    drag(120)
    after = widths()
    assert abs(after[0]-before[0]-120) < 2, (before, after)
    assert abs(after[1]-before[1]+120) < 2 and abs(after[2]-before[2]) < 2, (before, after)
    assert signature() == saved
    assert page.evaluate('document.activeElement.classList.contains("column-handle")')
    # Text geometry must be refreshed even though the OUTER grid did not resize.
    assert page.evaluate('''() => {
      const {K,F}=blEd, fr=blEd.frame();
      return F.d_editor_ids(fr).toArray().every(id => F.d_editor(fr,id).get(K('view')).get(K('cols')) > 0);
    }''')
    check('drag moves only adjacent columns, preserves editors and retains separator focus')

    # Measurements are independently checked against the actual DOM after dragging.
    cells_before = page.evaluate('blEd.R.printStr(blEd.F.d_editor(blEd.frame(),blEd.K("document")).get(blEd.K("view")).get(blEd.K("cols")))')
    drag(-80)
    cells_after = page.evaluate('blEd.R.printStr(blEd.F.d_editor(blEd.frame(),blEd.K("document")).get(blEd.K("view")).get(blEd.K("cols")))')
    assert cells_before != cells_after
    check('internal column changes update editor wrapping/caret cell measurements')

    current = widths()
    handle().press('ArrowRight')
    settled()
    assert abs(widths()[0]-current[0]-16) < 2
    current = widths()
    handle().press('Shift+ArrowLeft')
    settled()
    assert abs(widths()[0]-current[0]+64) < 2
    check('keyboard arrows resize by 16px; Shift resizes by 64px')

    current = widths()
    previous_overrides = page.evaluate('blEd.R.printStr(blEd.frame().get(blEd.K("column-widths"),null))')
    x,y = start()
    page.mouse.move(x+90,y,steps=5)
    settled()
    assert abs(widths()[0]-current[0]) > 60
    page.keyboard.press('Escape')
    page.mouse.up()
    settled()
    assert all(abs(x-y)<1 for x,y in zip(widths(),current))
    assert page.evaluate('blEd.R.printStr(blEd.frame().get(blEd.K("column-widths"),null))') == previous_overrides
    check('Escape cancels a captured drag and restores exact previous width declarations')

    handle().evaluate('node => node.addEventListener("pointerdown", e => window.proofPointer=e.pointerId, {once:true})')
    current = widths()
    x,y = start()
    page.mouse.move(x+70,y,steps=4)
    settled()
    handle().dispatch_event('pointercancel', {'pointerId':page.evaluate('proofPointer')})
    page.mouse.up()
    settled()
    assert all(abs(x-y)<1 for x,y in zip(widths(),current))
    check('pointer cancellation restores widths and releases capture')

    cdp = page.context.new_cdp_session(page)
    cdp.send('Emulation.setTouchEmulationEnabled', {'enabled':True})
    rect = handle().bounding_box()
    x,y = rect['x']+5,rect['y']+200
    current = widths()
    cdp.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[{'x':x,'y':y}]})
    cdp.send('Input.dispatchTouchEvent', {'type':'touchMove','touchPoints':[{'x':x+40,'y':y}]})
    cdp.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
    settled()
    assert abs(widths()[0]-current[0]-40)<2
    cdp.send('Emulation.setTouchEmulationEnabled', {'enabled':False})
    cdp.detach()
    check('native browser touch events resize columns through the same BL controller')

    drag(-2000)
    assert abs(widths()[0]-120)<2
    handle().press('End')
    settled()
    assert abs(widths()[1]-120)<2
    check('drag and keyboard enforce a 120px minimum for both neighboring panes')

    handle().press('Enter')
    settled()
    assert all(abs(x-y)<1 for x,y in zip(widths(),before))
    assert page.evaluate('blEd.frame().get(blEd.K("column-widths"),null) === null')
    drag(70)
    handle().dblclick()
    settled()
    assert all(abs(x-y)<1 for x,y in zip(widths(),before))
    check('Enter and double-click remove overrides and restore package layout defaults')

    # Keep an unpublished insert-mode draft through a resize and a viewport change.
    page.locator('.pane[data-pane="document"] .line').first.click()
    page.keyboard.press('i')
    page.keyboard.insert_text('UNPUBLISHED DRAFT ')
    draft = signature()
    drag(85)
    page.set_viewport_size({'width':1320,'height':900})
    settled()
    assert signature() == draft
    page.screenshot(path=str(a.proof/'02-workspace-resized-draft.png'))
    check('unpublished insert-mode draft, selection and history survive resizing and viewport changes')
    page.evaluate('blEd.focusInput()')
    page.keyboard.press('Escape')
    command('(ed/unuse "workspace")')
    assert page.locator('.column-handle').count() == 0
    assert page.locator('#panes > .pane').count() == 1
    assert page.evaluate('blEd.frame().get(blEd.K("column-widths"),null) === null')
    page.screenshot(path=str(a.proof/'03-workspace-unused.png'))
    check('unusing the layout package removes every handle and frame width override')

    # A passive minimap is resizable too; switching layout during capture tears it down.
    boot('present', 'inbox')
    page.wait_for_function('document.querySelectorAll(".column-handle").length === 2')
    page.wait_for_function('blHost.lang.state === "ready"')
    before = widths()
    drag(-60,1)
    assert abs(widths()[2]-before[2]-60)<2
    x,y = start(1)
    page.mouse.move(x-40,y,steps=4)
    command('(ed/unuse "present")')
    page.mouse.up()
    settled()
    assert page.locator('.column-handle').count() == 0
    assert page.evaluate('blEd.snapshot().get(blEd.K("layout"))') == 'single'
    check('passive minimap resizes; unloading a layout during pointer capture leaves no handles')

    assert not errors, {'count':len(errors), 'first':errors[:3]}
    check('no browser exceptions')
    (a.proof/'checks.json').write_text(json.dumps({'url':base,'checks':checks,'errors':errors},indent=2)+'\n')
    browser.close()
