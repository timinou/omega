import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright-core');
const base=process.env.DOSSIER_URL||'http://127.0.0.1:8792';
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:['--no-sandbox']});
const errors=[],checks=[];
try{
 for(const [name,viewport] of [['desktop',{width:1440,height:1000}],['phone',{width:390,height:844}]]){
  const page=await browser.newPage({viewport});page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/?use=home&layout=home&file=workspace:all');
  const iframe=await page.locator('[data-pane="work"] iframe').elementHandle(),work=await iframe.contentFrame();
  await work.waitForFunction(()=>window.blEd?.frame());
  await work.evaluate(()=>{const {R,K}=blEd;blEd.dispatch(R.hashMap(K('type'),K('mobile/document'),K('pane'),K('rail'),K('path'),'project:project/review.bl.org'));});
  await work.locator('.dossier-frame').waitFor();
  const dossier=work.frameLocator('.dossier-frame');await dossier.getByRole('link',{name:'Your decision',exact:false}).filter({visible:true}).first().click();
  await dossier.locator('form.fb .opt').first().waitFor();
  await page.screenshot({path:`spikes/workspace/dossier/proof/05-home-${name}.png`});
  checks.push(name+': original Home chrome, retained work editor, existing document reader');await page.close();
 }
 assert.deepEqual(errors,[]);writeFileSync('spikes/workspace/dossier/proof/home.json',JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors},null,2));
}finally{await browser.close();}
