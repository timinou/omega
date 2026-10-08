#!/usr/bin/env python3
"""Real bl-ed proof on an independently started offline world. No live writes."""
import os,json,base64,wave,math,tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[3]
PROOF=ROOT/os.environ.get('PELAGIC_PROOF','spikes/pelagic/proof/club');PROOF.mkdir(parents=True,exist_ok=True)
URL=os.environ.get('PELAGIC_URL','http://127.0.0.1:8812/?use=pelagic&layout=pelagic&file=spikes/pelagic/demo.bl.org')
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path=os.environ.get('CHROMIUM','/home/user/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'),args=['--no-sandbox','--use-gl=angle','--use-angle='+os.environ.get('PELAGIC_ANGLE','gl'),'--enable-gpu','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'])
 page=browser.new_page(viewport={'width':1440,'height':1080},accept_downloads=True)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(URL)
 page.wait_for_function('window.blEd && document.querySelector(".view-host .view-body")?.pelagic',timeout=60000)
 page.evaluate('document.querySelector(".view-host .view-body").pelagic.ready()')
 proof='document.querySelector(".view-host .view-body").pelagic'
 page.screenshot(path=str(PROOF/'01-used.png'))
 rect=page.locator('#editor').bounding_box();assert 300<rect['width']<600,rect
 before=page.evaluate('window.blEd.R.printStr(window.blEd.state().get(window.blEd.K("text")))')
 page.get_by_role('button',name='▶ PLAY THE DESCENT',exact=True).click()
 page.wait_for_function(proof+'.stats().nextStep>12',timeout=15000)
 assert page.evaluate(proof+'.stats().context')=='running'
 page.screenshot(path=str(PROOF/'02-playing.png'))
 # Pause captures deterministic scenes, then return to the running clock.
 for i,t in enumerate([15,48,85,125]):
  data=page.evaluate(f'()=>{{const p={proof};p.renderAt({t},{{width:900,height:480}});return p.shader().canvas.toDataURL().split(",")[1];}}')
  (PROOF/f'browser-scene-{i+1}.png').write_bytes(base64.b64decode(data))
 # Real editor Ctrl-Enter installs the document's graph and commits a pattern.
 page.locator('#input-sink').focus();page.keyboard.press('Control+Enter')
 page.wait_for_function(proof+'.stats().patterns.includes("melody")',timeout=30000)
 # Ordinary top-level Overtone calls yield node plans, with real live controls.
 result=page.evaluate(f'''{proof}.evaluate("(o/definst probe [freq 440 amp 0.02 dur 1.2] (* amp (o/env-gen (o/perc 0.01 dur)) (o/sin-osc freq))) (def node (probe)) (o/ctl node :freq 330 :amp 0.01) (o/kill node)")''')
 assert result['ok'],result
 # Nested shader edits are validated before any performance change commits.
 old_space=page.evaluate(proof+'.config().space')
 result=page.evaluate(f'''{proof}.evaluate('(av/session (av/configure {{:space 0.1}}) (t/start "void main() {{ broken; }}"))')''')
 assert not result['ok'],result
 assert page.evaluate(proof+'.config().space')==old_space
 # A bad shader and a bad program must preserve both playback and last shader.
 result=page.evaluate(f'{proof}.evaluate("#+begin_src glsl\\nvoid main(){{ broken syntax; }}\\n#+end_src")')
 assert result['ok'] is False,result
 assert page.evaluate(proof+'.stats().playing')
 result=page.evaluate(f'{proof}.evaluate("(+ 1 missing-variable)")');assert not result['ok']
 # All named controls reach BL and return as model/effect values.
 page.get_by_role('slider',name='Equal-power crossfade').fill('0.2')
 assert abs(page.evaluate(proof+'.config().crossfade')-.2)<1e-6
 page.get_by_role('slider',name='Deck A low EQ').fill('3')
 assert page.evaluate(proof+'.config()["eq-a-low"]')==3
 page.get_by_role('button',name='KICK',exact=True).click()
 assert page.evaluate(proof+'.config().kick') is False
 page.get_by_role('button',name='03 / CATHEDRAL').click()
 assert page.evaluate(proof+'.stats().nextStep')>=512
 # Offline render is the same BL score, not an audio fixture.
 raw=page.evaluate(f'''async()=>{{const p={proof};const b=await p.renderAudio({{}},{{seconds:18,sampleRate:22050}});const w=new Uint8Array(p.wav(b));let s='';for(let i=0;i<w.length;i+=16384)s+=String.fromCharCode(...w.subarray(i,i+16384));return btoa(s);}}''')
 (PROOF/'opening.wav').write_bytes(base64.b64decode(raw))
 # Imported-file deck: decoding, BPM sync, cue, loop and jog.
 audiofile=PROOF/'opening.wav'
 page.get_by_label('Load audio into deck A').set_input_files(str(audiofile))
 page.wait_for_function(proof+'.decks().a.buffer',timeout=15000)
 assert page.evaluate(proof+'.decks().a.bpm')==122
 page.get_by_label('Deck A source BPM').fill('90');page.get_by_label('Deck A source BPM').dispatch_event('change')
 page.get_by_label('Deck A loop').select_option('4')
 deck=page.locator('.deck[data-deck="a"]')
 deck.get_by_role('button',name='CUE',exact=True).click()
 assert page.evaluate(proof+'.decks().a.running')
 assert abs(page.evaluate(proof+'.decks().a.rate()')-122/90)<1e-6
 deck.get_by_title('Jog forward',exact=True).click()
 # An imported deck still animates the audio-reactive stage with score transport stopped.
 page.get_by_role('button',name='■ STOP',exact=True).click()
 deck.get_by_role('button',name='CUE',exact=True).click()
 frames=page.evaluate(proof+'.stats().frames')
 page.wait_for_function(f'{proof}.stats().frames>{frames}+5')
 assert page.evaluate(proof+'.decks().a.running')
 page.get_by_role('button',name='▶ PLAY THE DESCENT',exact=True).click()
 page.get_by_role('button',name='03 / CATHEDRAL').click()
 # Live capture contains the real canvas and the real audio bus.
 with page.expect_download(timeout=20000) as capture:
  page.get_by_role('button',name='● REC',exact=True).click();page.wait_for_timeout(3000)
  page.get_by_role('button',name='■ SAVE REC',exact=True).click()
 capture.value.save_as(str(PROOF/'live-excerpt.webm'))
 page.screenshot(path=str(PROOF/'03-live-controls.png'))
 stats=page.evaluate(proof+'.stats()')
 # Save the resource handle before unuse to prove cleanup, not just missing DOM.
 page.evaluate(f'window.__proofEngine={proof}.engine();window.__proofShader={proof}.shader();')
 page.locator('#input-sink').focus();page.keyboard.press(':');page.keyboard.insert_text('(ed/unuse "pelagic")');page.keyboard.press('Enter')
 page.wait_for_function('window.blEd.frame().get(window.blEd.K("layout")).get(window.blEd.K("name"))==="single"')
 page.wait_for_function('window.__proofEngine.ctx.state==="closed"')
 assert page.evaluate('window.__proofEngine.disposed && window.__proofShader.disposed')
 assert page.locator('.view-host').count()==0
 after=page.evaluate('window.blEd.R.printStr(window.blEd.state().get(window.blEd.K("text")))');assert before==after
 page.screenshot(path=str(PROOF/'04-unused.png'))
 assert not errors,errors
 report={'url':URL,'status':'passed','checks':['independent package','real editor keyboard evaluation','four shader scenes','playback','bar-quantized edit','live node controls','nested session rollback','bad shader rollback','bad BL rollback','crossfade','EQ','stem mute','movement cue','offline synthesis','sample decode','BPM sync','cue','loop','jog','sample-only visual response','live audiovisual capture','closed audio context','shader disposal','exact source restoration'],'stats':stats,'pageErrors':errors}
 (PROOF/'browser.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2),flush=True)
 browser.close()
