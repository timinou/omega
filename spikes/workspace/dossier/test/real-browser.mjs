const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright-core');
import {writeFileSync} from 'node:fs';
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(60000);
 const base='http://127.0.0.1:8792',address='project:project/UNIFICATION.bl.org';
 const d=await(await page.request.get(base+'/api/doc?path='+encodeURIComponent(address))).json();
 const view=await page.request.get(base+d.data.dossier.url);console.log('real dossier projection',view.status(),(await view.text()).length);
 if(view.status()!==200)throw new Error(await view.text());
 await page.goto(base+'/?file=workspace:all&use=mobile&layout=mobile');await page.waitForFunction(()=>window.blEd?.frame());
 await page.evaluate(address=>{const {R,K}=blEd;blEd.dispatch(R.hashMap(K('type'),K('mobile/document'),K('pane'),K('rail'),K('path'),address));},address);
 const frame=page.frameLocator('.dossier-frame');await frame.locator('#doc h1').waitFor({state:'visible'});
 const title=await frame.locator('#doc h1').textContent();await page.screenshot({path:'spikes/workspace/dossier/proof/03-real-dossier.png'});
 writeFileSync('spikes/workspace/dossier/proof/real.json',JSON.stringify({status:view.status(),title,rendered:true},null,2));console.log(title);
}finally{await browser.close();}
