import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright-core');
const base=process.env.DOSSIER_URL||'https://work.tailcb5318.ts.net:18061';
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:['--no-sandbox']});
const failures=[],errors=[];
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(45000);
 page.on('pageerror',e=>{errors.push(e.message);console.log('page error',e.message)});
 page.on('response',async r=>{if(r.status()>=400&&r.url().includes('/api/')){const message=await r.text().catch(()=>null);failures.push({url:r.url(),status:r.status(),message});console.log('API failure',r.url(),message)}});
 await page.goto(base+'/');
 await page.locator('nav button[data-screen="places"]').click();
 const work=await(await page.locator('[data-pane="work"] iframe').elementHandle()).contentFrame();
 await work.locator('[data-act="open-place"][data-path="place:project"]').click();
 await work.locator('[data-act="place-tab"][data-value="files"]').click();
 await work.locator('[data-act="open-file"][data-path="work:project/acceptance.bl.org"]').click();
 const dossier=work.frameLocator('.dossier-frame');await dossier.locator('#doc h1').waitFor({state:'visible'});
 console.log('opened',await dossier.locator('#doc h1').textContent());
 await dossier.locator('nav.chips a[href="#your-decision"]:visible,a.side-sec[href="#s-your-decision"]:visible').first().click();
 await dossier.locator('form.fb .opt').first().click();await dossier.locator('form.fb textarea').fill('Public URL round trip verified');await dossier.locator('form.fb button.send').click();await dossier.locator('.fb-state').filter({hasText:'answered'}).waitFor();
 await work.locator('[data-act="edit-mode"]').click();const source=work.locator('textarea[aria-label="Document source"]');await source.fill((await source.inputValue())+'\nPublic UI publication check.\n');await work.locator('[data-act="publish"]').click();await work.waitForFunction(()=>{const e=blEd.F.d_editor(blEd.frame(),blEd.K('file'));return blEd.R.eqv(e.get(blEd.K('text')),e.get(blEd.K('saved-text')))});
 await work.locator('[data-act="edit-mode"]').click();await dossier.locator('form.fb').waitFor({state:'visible'});
 await page.screenshot({path:'spikes/workspace/dossier/proof/public-journey.png'});
 assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);writeFileSync('spikes/workspace/dossier/proof/public-journey.json',JSON.stringify({base,failures,errors,passed:true},null,2));console.log('PUBLIC JOURNEY PASSED');
}finally{await browser.close();}
