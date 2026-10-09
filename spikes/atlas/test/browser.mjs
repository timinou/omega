// Drive the REAL bl-ed host in an isolated --offline --memory world.
import {chromium} from '../../browser/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
const port=Number(process.env.ATLAS_PORT||8831);if(port===8790)throw Error('Refusing live world');
const proof=path.resolve('spikes/atlas/proof');await fs.mkdir(proof,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.ATLAS_CHROMIUM||'/home/user/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1680,height:1050}});const errors=[];page.on('pageerror',e=>errors.push(String(e)));const photo=name=>page.screenshot({path:path.join(proof,name),fullPage:false});
async function cmd(s){await page.locator('#input-sink').focus();await page.keyboard.press(':');await page.waitForFunction(()=>blEd.state().get(blEd.K('mode')).name==='command');await page.keyboard.insertText(s);await page.keyboard.press('Enter');await page.waitForFunction(()=>blEd.state().get(blEd.K('mode')).name!=='command'&&!blEd.state().get(blEd.K('awaiting')));}
try{
 await page.goto(`http://127.0.0.1:${port}/?file=spikes/atlas/desk.bl.org&use=atlas`);
 await page.locator('.atlas h1').waitFor();await page.locator('.atlas').getByText('WAIT / RESEARCH',{exact:true}).waitFor();await photo('01-observatory.png');
 assert.equal(await page.locator('.pane.editor').count(),1);assert.equal(await page.locator('.atlas').count(),1);
 // Change the JSON title through real editor selection/paste; undo restores it.
 const titleRow=await page.evaluate(()=>[...blEd.state().get(blEd.K('text')).get(blEd.K('lines'))].findIndex(l=>l.includes('"title": "Artcraft × Adobe"')));
 await cmd('(ed/goto '+(titleRow+1)+')');await page.keyboard.press('x');await page.keyboard.insertText('  "title": "Editable source drives Atlas",\n');await page.locator('.atlas h1').filter({hasText:'Editable source drives Atlas'}).waitFor();await photo('13-live-notebook-edit.png');
 await page.keyboard.press('u');await page.locator('.atlas h1').filter({hasText:'Artcraft × Adobe'}).waitFor();await cmd('(ed/goto 1)');

 for(const [tab,name,contains] of [['scan','12-market-scan.png','Scan the neighborhood'],['signals','02-signals.png','Signal ledger'],['compare','03-comparison.png','Historical shock'],['evidence','04-evidence.png','Claims and their dependencies'],['decision','05-decision.png','Short payoff workbench'],['journal','06-journal.png','Decision memo draft']]){
  await page.locator(`nav [data-tab="${tab}"]`).click();await page.locator('.atlas').getByText(contains,{exact:false}).first().waitFor();await photo(name);
 }
 await page.locator('[data-memo]').fill('Wait for independent production parity and paid migration.');
 await page.locator('nav [data-tab="decision"]').click();await page.locator('[data-number="borrow"]').fill('12');await page.locator('[data-number="borrow"]').press('Tab');await page.waitForFunction(()=>document.querySelector('[data-number="borrow"]').value==='12');await photo('07-expensive-borrow.png');
 assert.equal(await page.evaluate(()=>blEd.state().get(blEd.K('pkg-state')).get('atlas').get('borrow')),12);
 await page.locator('nav [data-tab="journal"]').click();assert.match(await page.locator('[data-memo]').inputValue(),/paid migration/);
 const downloadPromise=page.waitForEvent('download');await page.locator('[data-export]').click();const download=await downloadPromise;await download.saveAs(path.join(proof,'decision-memo.bl.org'));assert.match(await fs.readFile(path.join(proof,'decision-memo.bl.org'),'utf8'),/"borrow": 12/);
 await page.locator('nav [data-tab="evidence"]').click();await page.locator('[data-evidence="E01"]').first().click();await page.locator('#e-E01.selected').waitFor();await photo('08-source-trace.png');
 await page.locator('nav [data-tab="journal"]').click();await page.locator('[data-research]').first().click();await page.waitForFunction(()=>blEd.state().get(blEd.K('minibuf')).get(blEd.K('package'))==='atlas');await photo('09-contextual-task.png');await page.keyboard.press('Escape');
 await page.setViewportSize({width:1050,height:850});await page.locator('nav [data-tab="overview"]').click();await photo('10-compact.png');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.setViewportSize({width:1680,height:1050});await cmd('(ed/unuse "atlas")');await page.waitForFunction(()=>!document.querySelector('.atlas'));await photo('11-unused.png');assert.equal(await page.locator('.pane.editor').count(),1);assert.equal(await page.locator('style').filter({hasText:'.atlas{'}).count(),0);
 assert.deepEqual(errors,[]);await fs.writeFile(path.join(proof,'browser.json'),JSON.stringify({ok:true,port,screens:13,interactions:['editable source + undo','market scan','tabs','assumptions','retained memo','Org export','evidence trace','owned task prompt','compact layout','unuse cleanup'],errors},null,2)+'\n');console.log('Atlas real-editor tour passed.');
}catch(e){await page.screenshot({path:path.join(proof,'failure.png')});console.error((await page.locator('body').innerText()).slice(-1800));throw e;}finally{await browser.close();}
