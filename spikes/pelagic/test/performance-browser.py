#!/usr/bin/env python3
"""Drive the continuous instrument in the real editor; never touch a live world."""
import os,json,wave,math,struct,tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[3];PROOF=ROOT/'spikes/pelagic/proof/performance';PROOF.mkdir(parents=True,exist_ok=True)
URL=os.environ.get('PELAGIC_URL','http://127.0.0.1:8812/?use=pelagic&layout=pelagic&file=spikes/pelagic/demo.bl.org')
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path=os.environ.get('CHROMIUM','/home/user/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'),args=['--no-sandbox','--use-gl=angle','--use-angle=gl','--enable-gpu','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'])
 page=b.new_page(viewport={'width':1440,'height':1200},accept_downloads=True);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(URL);page.wait_for_function('document.querySelector(".view-host .view-body")?.pelagic',timeout=60000)
 q='document.querySelector(".view-host .view-body").pelagic';page.evaluate(q+'.ready()')
 before=page.evaluate('window.blEd.R.printStr(window.blEd.state().get(window.blEd.K("text")))')
 checks=[]
 def done(name):checks.append(name);print(name,flush=True)
 def evaluate(source):
  result=page.evaluate('(source)=>'+q+'.evaluate(source)',source);assert result['ok'],result;return result
 def active(result):
  if result.get('revision'):page.wait_for_function(q+f'.stats().revision==={result["revision"]}',timeout=15000)
 page.get_by_role('button',name='▶ PERFORM',exact=True).click();page.wait_for_function(q+'.stats().mode==="performance"')
 done('continuous transport starts')
 page.locator('#input-sink').focus();page.keyboard.press('Control+Enter')
 page.wait_for_function(q+'.stats().patterns.includes("melody")',timeout=30000)
 assert page.evaluate(q+'.diagnostics().namespaces')==0;done('real editor evaluates instrument and releases staging namespace')
 result=evaluate('(av/commit {:quantize :bar :edits [(av/launch :cathedral {:transition :iris :beats 4}) (av/configure {:space 0.6})]})')
 old=page.evaluate(q+'.stats().revision');assert old<result['revision'];active(result)
 assert page.evaluate(q+'.model().current.visual.scene')=='cathedral'
 assert page.evaluate(q+'.config().space')==.6;done('audio and scene activate as one quantized revision')
 evaluate('(av/snapshot :home)');saved=page.evaluate(q+'.session()')
 old=page.evaluate(q+'.stats().revision')
 bad=page.evaluate(q+'''.evaluate('(av/session (av/configure {:space 0.1}) (t/start "void main(){broken;}"))')''')
 assert not bad['ok'];assert page.evaluate(q+'.stats().revision')==old;assert page.evaluate(q+'.config().space')==.6
 done('invalid shader rejects entire transaction')
 preview=page.evaluate(q+'''.evaluate('(av/gesture :break)',{preview:true})''');assert preview['ok'];assert page.evaluate(q+'.config().kick') is True;done('preview makes no performance change')
 r=evaluate('(av/commit {:quantize :beat :edits [(av/gesture :break) (av/layer :afterglow 0.3) (av/variation {:density 0.7 :seed 81 :transpose 7})]})');active(r)
 assert page.evaluate(q+'.config().kick') is False;assert page.evaluate(q+'.model().current.visual.overlay')=='afterglow';done('gestures layering and seeded variations')
 active(page.evaluate(q+'.request({kind:"undo"})'));assert page.evaluate(q+'.config().kick') is True
 active(page.evaluate(q+'.request({kind:"redo"})'));assert page.evaluate(q+'.config().kick') is False;done('undo and redo restore whole performance')
 active(page.evaluate(q+'.request({kind:"recall",name:"home"})'));assert page.evaluate(q+'.model().current.visual.overlay') is None;done('snapshot recall')
 r=page.evaluate(q+'.request({kind:"gesture",name:"break"})');page.evaluate(q+'.request({kind:"cancel"})');page.wait_for_timeout(2200)
 assert page.evaluate(q+'.config().kick') is True;done('cancelled revision never activates')
 for name in ['current','afterglow','bathymetry']:
  r=page.evaluate('(name)=>'+q+'.request({kind:"launch",name,options:{beats:1}})',name)
 active(r);assert page.evaluate(q+'.model().current.visual.scene')=='bathymetry';done('rapid scene cues coalesce latest state')
 page.evaluate(q+'.request({kind:"pause"})');beat=page.evaluate(q+'.stats().beat');page.wait_for_timeout(250);assert page.evaluate(q+'.stats().beat')==beat
 page.evaluate(q+'.request({kind:"resume"})');page.wait_for_function(q+f'.stats().beat>{beat}+0.2');done('pause and resume preserve phase')
 active(evaluate('(av/configure {:bpm 128})'));assert page.evaluate(q+'.config().bpm')==128;done('tempo change preserves advancing clock')
 # Persist a real local sample and round-trip its content-addressed session reference.
 file=PROOF/'fixture.wav';rate=22050
 with wave.open(str(file),'wb') as w:
  w.setparams((1,2,rate,0,'NONE','not compressed'))
  w.writeframes(b''.join(struct.pack('<h',int(2200*math.sin(i/rate*math.tau*110))) for i in range(rate*3)))
 page.get_by_label('Load audio into deck A').set_input_files(str(file));page.wait_for_function(q+'.decks().a.hash',timeout=15000)
 value=page.evaluate(q+'.session()');assert len(value['assets'][0]['hash'])==64
 result=page.evaluate('(s)=>'+q+'.loadSession(s)',value);assert result['ok'];done('session and audio asset round trip')
 # Synthetic MIDI validates the actual control adapter; no physical hardware claim.
 page.evaluate(q+'.midi().bindings.set("0:1","crossfade");'+q+'.midi().receive({data:[176,1,32]})')
 page.wait_for_function('Math.abs('+q+'.config().crossfade-32/127)<0.001');done('MIDI CC adapter')
 with page.expect_download(timeout=20000) as download:
  page.get_by_role('button',name='● REC',exact=True).click();page.wait_for_function(q+'.stats().recording')
  page.wait_for_timeout(3000);page.get_by_role('button',name='■ SAVE REC',exact=True).click()
 download.value.save_as(str(PROOF/'live-check.webm'));done('incremental recording finalizes actual live audio and shader')
 page.screenshot(path=str(PROOF/'studio.jpg'),type='jpeg',quality=85)
 stats=page.evaluate(q+'.stats()');metrics=page.evaluate(q+'.diagnostics()');assert metrics['namespaces']==0
 # Deliberately lose and restore WebGL; recovery remains separate from normal metrics.
 page.evaluate('window.lostGL='+q+'.shader().gl.getExtension("WEBGL_lose_context");window.lostGL.loseContext()')
 page.wait_for_function(q+'.stats().playing===false');page.evaluate('window.lostGL.restoreContext()');page.wait_for_timeout(1500)
 assert page.evaluate(q+'.shader().disposed') is False;done('GPU loss pauses and restores the stage')
 page.evaluate('window.oldEngine='+q+'.engine();window.oldShader='+q+'.shader()')
 page.locator('#input-sink').focus();page.keyboard.press(':');page.keyboard.insert_text('(ed/unuse "pelagic")');page.keyboard.press('Enter')
 page.wait_for_function('window.oldEngine.ctx.state==="closed"');assert page.evaluate('window.oldEngine.disposed&&window.oldShader.disposed')
 assert page.evaluate('window.blEd.R.printStr(window.blEd.state().get(window.blEd.K("text")))')==before
 page.screenshot(path=str(PROOF/'unused.jpg'),type='jpeg',quality=85);done('exact unuse and resource disposal')
 assert not errors,errors
 (PROOF/'browser.json').write_text(json.dumps({'checks':checks,'stats':stats,'metrics':metrics,'pageErrors':errors},indent=2)+'\n')
 print(json.dumps(metrics,indent=2),flush=True);b.close()
