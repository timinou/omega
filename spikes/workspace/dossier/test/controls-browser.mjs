import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright-core');
const base=process.env.DOSSIER_URL||'http://127.0.0.1:8792';
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:['--no-sandbox']});
const checks=[],errors=[];
try{
 const page=await browser.newPage({viewport:{width:1200,height:900}});page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/?file=workspace:all&use=mobile&layout=mobile');await page.waitForFunction(()=>window.blEd?.frame());
 await page.evaluate(()=>{const {R,K}=blEd;blEd.dispatch(R.hashMap(K('type'),K('mobile/document'),K('pane'),K('rail'),K('path'),'project:project/review.bl.org'));});
 await page.locator('.dossier-frame').waitFor();const frame=await(await page.locator('.dossier-frame').elementHandle()).contentFrame();
 await frame.locator('#doc').waitFor();
 await page.locator('[data-act="outline"]').click();await page.locator('[data-act="heading"]').filter({hasText:'Recorded evidence'}).click();
 await frame.locator('#s-recorded-evidence').waitFor({state:'visible'});checks.push('existing Outline navigates the rendered dossier');
 await page.locator('[data-act="find"]').click();await page.locator('[data-field="search"]').fill('Keep this flow');
 await frame.waitForFunction(()=>getSelection()?.toString()==='Keep this flow');checks.push('existing Find searches rendered text across sections');
 await frame.evaluate(()=>document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true})));
 await page.waitForFunction(()=>!document.querySelector('[data-act="ask-passage"]').disabled);checks.push('rendered selection reaches the existing source-anchored Ask action');
 await frame.locator('a[href="src"]').click();await page.locator('textarea[aria-label="Document source"]').waitFor();
 await page.locator('[data-act="edit-mode"]').click();await page.locator('.dossier-frame').waitFor({state:'visible'});checks.push('inner source link opens the same retained editor and Read returns');
 await frame.evaluate(()=>{location.hash='s-your-decision';});
 await frame.locator('form.fb .opt').first().click();await frame.locator('form.fb textarea').fill('This draft survives an authorization/network failure');
 await page.route('**/documents/**/rev',route=>route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({ok:false,message:'Access unavailable'})}));
 await frame.locator('#stamp').filter({hasText:'offline'}).waitFor();assert.equal(await frame.locator('form.fb textarea').inputValue(),'This draft survives an authorization/network failure');checks.push('failed refresh is honest and retains unsent feedback');
 await page.evaluate(()=>{const {R,K}=blEd;blEd.dispatch(R.hashMap(K('type'),K('command'),K('pane'),K('file'),K('command'),K('dossier/unload')));});
 await page.waitForFunction(()=>!document.querySelector('.dossier-frame'));checks.push('explicit dossier unload also restores the existing Pocket reader');
 assert.deepEqual(errors,[]);writeFileSync('spikes/workspace/dossier/proof/controls.json',JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors},null,2));
}finally{await browser.close();}
