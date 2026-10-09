import {chromium} from '../../browser/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';import fs from 'node:fs/promises';
const browser=await chromium.launch({headless:true,executablePath:'/home/user/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const a='http://127.0.0.1:8856',b='http://127.0.0.1:8857';
const intent=async(base,intent,args={})=>{const r=await fetch(base+'/api/intent',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({intent,args})});return r.json();};
try{
 await page.goto(a+'/?file=package:catalog&use=packages');await page.getByRole('heading',{name:'Your desk, in any world'}).waitFor();
 await page.locator('article').filter({has:page.getByRole('heading',{name:'atlas',exact:true})}).getByRole('button',{name:'Load & open'}).waitFor();
 await page.screenshot({path:'spikes/packages/proof/01-catalog.png'});
 await page.locator('article').filter({has:page.getByRole('heading',{name:'atlas',exact:true})}).getByRole('button',{name:'Load & open'}).click();
 await page.locator('.atlas h1').waitFor({timeout:30000});
 await page.screenshot({path:'spikes/packages/proof/02-atlas-loaded.png'});
 const ca=await intent(a,'package/catalog'),cb=await intent(b,'package/catalog');
 assert.equal(ca.packages.find(x=>x.name==='atlas').active,true);assert.equal(cb.packages.find(x=>x.name==='atlas').active,false);
 // Unuse is the same public editor command available from the minibuffer.
 const command=async text=>page.evaluate(text=>{const {dispatch,R,K}=window.blEd;const ev=(...xs)=>R.hashMap(...xs);dispatch(ev(K('type'),K('key'),K('key'),':'));dispatch(ev(K('type'),K('text'),K('text'),text));dispatch(ev(K('type'),K('key'),K('key'),'Enter'));},text);
 await command('(ed/unuse "atlas")');await page.waitForFunction(()=>!document.querySelector('.atlas'));
 await page.screenshot({path:'spikes/packages/proof/03-atlas-unloaded.png'});
 assert.equal((await intent(a,'package/catalog')).packages.find(x=>x.name==='atlas').active,true);
 await command('(ed/cmd "packages/open")');await page.getByRole('heading',{name:'Your desk, in any world'}).waitFor();
 const card=page.locator('article').filter({has:page.getByRole('heading',{name:'atlas',exact:true})});await card.getByRole('button',{name:'Disable world'}).click();
 await page.waitForFunction(()=>[...document.querySelectorAll('.packages article')].some(x=>x.querySelector('h2')?.textContent==='atlas'&&x.textContent.includes('WORLD DISABLED')));
 assert.equal((await intent(a,'package/catalog')).packages.find(x=>x.name==='atlas').active,false);
 const response=await fetch(a+'/api/doc?path=spikes/atlas/desk.bl.org');assert.equal((await response.json()).ok,true);
 await command('(ed/unuse "packages")');await page.waitForFunction(()=>!document.querySelector('.packages'));
 await page.screenshot({path:'spikes/packages/proof/04-manager-unloaded.png'});
 assert.deepEqual(errors,[]);
 await fs.writeFile('spikes/packages/proof/browser.json',JSON.stringify({checks:['catalog in real bl-ed','load Atlas with backend and entry notebook','independent second world','unuse Atlas removes view and keeps world activation','disable world retains evidence','unuse manager restores editor'],errors},null,2)+'\n');
 console.log('6 browser lifecycle checks passed');
}finally{await browser.close();}
