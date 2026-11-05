import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync} from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright-core');
const base=process.env.DOSSIER_URL||'http://127.0.0.1:8796';
assert.ok(!base.includes(':8790'));
const proof='spikes/workspace/dossier/proof';mkdirSync(proof,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:['--no-sandbox']});
const errors=[],checks=[];
try{
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(e.message));
 const api=async(intent,args)=>{const r=await page.request.post(base+'/api/intent',{data:{intent,args}});const j=await r.json();assert.equal(j.ok,true,JSON.stringify(j));return j;};
 const tasks=async()=>{const j=await(await page.request.get(base+'/api/doc?path=workspace:all')).json();return j.objects.filter(o=>o.type==='omega/task');};
 await page.goto(base+'/?use=mobile&layout=mobile&file=workspace:all&pocket=document&at='+encodeURIComponent('project:project/ordinary.bl.org'));
 await page.locator('.dossier-frame').waitFor();const frame=()=>page.frameLocator('.dossier-frame');
 await frame().locator('#doc h1').waitFor();
 const baseline=await tasks(),before=baseline.length,beforeIds=new Set(baseline.map(t=>t.key));
 await frame().locator('a.side-sec[href="#s-review-decisions"],nav.chips a[href="#review-decisions"]').filter({visible:true}).first().click();
 for(const id of ['q1','q2']){const form=frame().locator(`form.fb[data-id="${id}"]`);if(!await form.locator('.opt').first().evaluate(el=>el.classList.contains('on')))await form.locator('.opt').first().click();await form.locator('textarea').fill('Saved independently');await form.locator('button.send').click();await form.locator('.fb-state').filter({hasText:'answered'}).waitFor();}
 assert.equal((await tasks()).length,before);checks.push('two independent answer saves create no task');console.log(checks.at(-1));
 await frame().locator('a.side-sec[href="#s-the-plan"],nav.chips a[href="#the-plan"]').filter({visible:true}).first().click();
 const custom=frame().locator('[data-source-from]').filter({hasText:'deliberately not a dossier'}).last();
 const mappedFrame=await(await page.locator('.dossier-frame').elementHandle()).contentFrame();await mappedFrame.evaluate(()=>{location.hash='all'});await custom.waitFor({state:'visible'});await custom.click();await page.locator('[data-act="document-task"]').click();
 await page.locator('[data-screen="launch"]').waitFor();console.log('composer opened');await page.locator('.launch-origin').waitFor();
 await page.locator('[data-act="document-scope"][data-value="part"]').click();
 await page.waitForFunction(()=>blEd.F.d_editor(blEd.frame(),blEd.K('rail')).get(blEd.K('pkg-state')).get('mobile').get(blEd.K('selection')).get(blEd.K('scope'))==='part');
 await page.locator('.launch-origin details').click();assert.match(await page.locator('.origin-preview').textContent(),/begin_custom/);
 await page.locator('[data-act="document-scope"][data-value="section"]').click();await page.locator('.launch-origin summary').filter({hasText:'A detail'}).waitFor();
 await page.locator('[data-act="document-scope"][data-value="document"]').click();await page.locator('.launch-origin summary').filter({hasText:'Work from any Org document'}).waitFor();
 await page.locator('[data-field="new-goal"]').fill('Read this context and tell me what the next useful step is.');
 if(await page.locator('.launch-origin details').getAttribute('open')!==null)await page.locator('.launch-origin summary').click();
 await page.screenshot({path:proof+'/task-01-mobile-composer.png'});checks.push('unknown component, innermost section and whole-file scope use the existing composer');
 await page.locator('[data-act="document-scope"][data-value="part"]').click();await page.locator('.launch-origin summary').filter({hasText:'An unfamiliar component'}).waitFor();
 await page.locator('[data-act="launch-start"]').click();await page.locator('[data-screen="task"]').waitFor();
 await page.waitForFunction(()=>blEd.F.d_editor(blEd.frame(),blEd.K('task')).get(blEd.K('doc'))?.get(blEd.K('data'))?.get(blEd.K('origin')));
 const created=(await tasks()).find(t=>!beforeIds.has(t.key)&&t.origin?.scope==='part');assert.ok(created);assert.match(created.origin.text,/begin_custom/);checks.push('ordinary task is created with captured provenance and appears in Work');
 await page.locator('[data-act="work"]').last().click();await page.locator(`[data-act="task-origin"][data-task="${created.key}"]`).waitFor();
 await page.screenshot({path:proof+'/task-02-mobile-work.png'});
 await page.locator(`[data-act="task-origin"][data-task="${created.key}"]`).click();await frame().locator('.source-origin').waitFor();assert.match(await frame().locator('.source-origin').textContent(),/deliberately not a dossier/);checks.push('Work source link reveals the exact original component');
 await page.screenshot({path:proof+'/task-03-mobile-source.png'});
 const readingFrame=await(await page.locator('.dossier-frame').elementHandle()).contentFrame();await readingFrame.evaluate(()=>scrollTo(0,0));
 await page.evaluate(()=>{const {R,K}=blEd;blEd.dispatch(R.hashMap(K('type'),K('mobile/connection'),K('pane'),K('rail'),K('online'),true,K('checked'),Date.now()));});
 await page.waitForTimeout(200);assert.equal(await readingFrame.evaluate(()=>scrollY),0);checks.push('returning to an origin does not keep pulling the reader back during updates');
 // Repeated prose uses actual DOM source ranges, not the first matching sentence.

 const iframe=await(await page.locator('.dossier-frame').elementHandle()).contentFrame();
 await iframe.evaluate(()=>{location.hash='all';});
 const paragraphs=frame().locator('p[data-source-from]').filter({hasText:'The same sentence appears twice.'});assert.equal(await paragraphs.count(),2);
 await paragraphs.last().evaluate(el=>{const r=document.createRange();r.selectNodeContents(el);getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));});
 await page.waitForFunction(()=>blEd.F.d_editor(blEd.frame(),blEd.K('rail')).get(blEd.K('pkg-state')).get('mobile')?.get(blEd.K('selection'))?.get(blEd.K('start'))>30);
 checks.push('selecting repeated prose retains its second source location');
 await page.setViewportSize({width:1440,height:1000});await page.locator('[data-act="document-task"]').click();await page.locator('.launch-origin').waitFor();await page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));await page.screenshot({path:proof+'/task-04-desktop-composer.png'});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.locator('[data-act="launch-close"]').click();await page.locator('.dossier-frame').waitFor();
 await page.evaluate(()=>{const {R,K}=blEd;blEd.dispatch(R.hashMap(K('type'),K('mobile/eval'),K('pane'),K('file'),K('text'),'(ed/unuse "document-tasks")'));});
 await page.waitForFunction(()=>!document.querySelector('[data-act="document-task"]'));
 await page.screenshot({path:proof+'/task-05-package-unused.png'});checks.push('unloading the generic task package removes its reader action');
 assert.deepEqual(errors,[]);
 writeFileSync(proof+'/document-tasks-browser.json',JSON.stringify({checks,errors,task:created.key,passed:true},null,2));console.log(JSON.stringify({checks,errors,passed:true},null,2));
}finally{await browser.close();}
