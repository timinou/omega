// Run against a freshly seeded, isolated demo. Never the user's live world.
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {readdirSync,existsSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
const port=Number(process.env.MOBILE_PORT||8812);assert.notEqual(port,8790);
const base=`http://127.0.0.1:${port}`,proof=new URL('../proof/',import.meta.url).pathname;
const cache=path.join(homedir(),'.cache/ms-playwright');
const candidates=existsSync(cache)?readdirSync(cache).filter(n=>/^chromium-\d+$/.test(n)).sort((a,b)=>Number(b.split('-')[1])-Number(a.split('-')[1])).map(n=>path.join(cache,n,'chrome-linux64/chrome')):[];
const executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||candidates.find(existsSync);
const browser=await chromium.launch({headless:true,executablePath});
const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});
const page=await context.newPage(),errors=[],downloads=[];page.on('download',d=>downloads.push(d.suggestedFilename()));page.setDefaultTimeout(60000);page.setDefaultNavigationTimeout(60000);page.on('pageerror',e=>errors.push(e.message));
const ui=()=>page.locator('[data-pane="phone"]');
const click=act=>ui().locator(`[data-act="${act}"]`).first().tap();
const shot=name=>page.screenshot({path:path.join(proof,name+'.png')});
const wait=fn=>page.waitForFunction(fn,{},{timeout:60000});
const document=async address=>(await context.request.get(base+'/api/doc?path='+encodeURIComponent(address))).json();
const pathOf=pane=>page.evaluate(pane=>window.blEd.F.d_editor(blEd.frame(),blEd.K(pane)).get(blEd.K('path')),pane);
const untilText=async text=>ui().getByText(text,{exact:false}).filter({visible:true}).first().waitFor();
try{
 await page.goto(base+'/?file=workspace:all&use=present,dwim,workspace,places,references,buffers,workbench,mobile&layout=mobile');
 await untilText('Host connected');await untilText('Refresh the Omega board');await shot('01-work');
 assert.equal(await ui().locator('.task-card').count(),2);
 // Native inputs must keep focus rather than surrender to bl-ed's keyboard sink.
 await ui().locator('[data-act="open-task"]').filter({hasText:'Refresh the Omega board'}).tap();
 await untilText('A MOMENT OF YOUR ATTENTION');await untilText('I checked my working directory');
 await shot('02-conversation');
 const reply=ui().locator('[data-field="reply"]');await reply.fill('Keep this reply while I inspect the plan.');
 await reply.press('End');await reply.press('!');assert.match(await reply.inputValue(),/!$/);
 await click('tab-plan');await untilText('Two working directories');await shot('03-plan');
 assert.equal((await document('work:omega/board.bl.org')).text.includes('TODO'),true);
 await click('tab-conversation');assert.equal(await reply.inputValue(),'Keep this reply while I inspect the plan.!');
 await click('work');await untilText('Finish the Beam Lisp checklist');
 await ui().locator('[data-act="open-task"]').filter({hasText:'Finish the Beam Lisp checklist'}).tap();
 await ui().locator('h1').filter({hasText:'Finish the Beam Lisp checklist'}).waitFor();await untilText('A MOMENT OF YOUR ATTENTION');assert.equal(await reply.inputValue(),'');
 await reply.fill('A distinct Beam Lisp reply.');
 await click('work');await ui().locator('[data-act="open-task"]').filter({hasText:'Refresh the Omega board'}).tap();
 await ui().locator('h1').filter({hasText:'Refresh the Omega board'}).waitFor();await untilText('A MOMENT OF YOUR ATTENTION');assert.equal(await reply.inputValue(),'Keep this reply while I inspect the plan.!');
 // Working file: actual edit, dirty navigation guard, publication and retention.
 await click('actions');await click('working-file');await wait(()=>blEd.F.d_editor(blEd.frame(),blEd.K('file')).get(blEd.K('path'))==='work:omega/board.bl.org');await untilText('omega board');
 await click('edit-mode');const source=ui().locator('[data-field="file"]');
 await source.fill((await source.inputValue())+'\nA note from my phone.\n');
 await click('tab-changes');await untilText('Publish the file');
 assert.equal(await pathOf('file'),'work:omega/board.bl.org');
 await click('tab-plan');await page.route('**/api/save',route=>route.abort('failed'));await click('publish');await untilText('Not published');assert.deepEqual(downloads,[]);assert.equal(await ui().locator('[data-act="publish"]').count(),1);assert.equal((await document('work:omega/board.bl.org')).text.includes('A note from my phone.'),false);await page.unroute('**/api/save');await click('publish');await wait(()=>blEd.F.d_editor(blEd.frame(),blEd.K('file')).get(blEd.K('saved-text')).get(blEd.K('lines')).toArray().join('\n').includes('A note from my phone.'));console.log('file publication acknowledged');
 assert.match((await document('work:omega/board.bl.org')).text,/A note from my phone/);
 await shot('04-published-file');
 await click('tab-conversation');assert.equal(await reply.inputValue(),'Keep this reply while I inspect the plan.!');
 // Yes answers the actual message and keeps the independent reply draft.
 await click('yes');await untilText('Updated board.bl.org');
 assert.equal(await reply.inputValue(),'Keep this reply while I inspect the plan.!');
 assert.match((await document('work:omega/board.bl.org')).text,/DONE Check this folder/);
 await click('tab-changes');await untilText('Undo this edit');await shot('05-changes');
 await click('undo');await untilText('reverted');
 assert.match((await document('work:omega/board.bl.org')).text,/TODO Check this folder/);
 assert.match((await document('work:omega/board.bl.org')).text,/A note from my phone/);
 // Failed delivery keeps the draft. Offline disables writes and reconnects.
 await click('tab-conversation');
 await page.route('**/api/intent',route=>route.abort('failed'));
 await click('send');await untilText('Not sent');assert.equal(await reply.inputValue(),'Keep this reply while I inspect the plan.!');
 await page.unroute('**/api/intent');
 await page.route('**/api/doc?path=desk:welcome',route=>route.abort('failed'));
 await click('host');await click('reconnect');await untilText('Reconnecting');await shot('06-offline');
 await page.unroute('**/api/doc?path=desk:welcome');await click('reconnect');await untilText('Connected');
 // Place browsing and scope use real providers; new task needs only a goal.
 await click('places');await untilText('Your places');await shot('07-places');
 await ui().locator('[data-act="open-place"][data-path="place:omega"]').tap();await untilText('View tasks here');await shot('08-place');
 await click('new');await untilText('Start a little work.');await shot('09-new-task');
 await ui().locator('[data-field="new-place"]').selectOption('omega');
 await ui().locator('[data-field="new-goal"]').fill('Review the release notes from my phone.');
 await ui().locator('form[data-form="new"] button[type="submit"]').tap();await untilText('Review the release notes from my phone.');
 await wait(()=>blEd.F.d_editor(blEd.frame(),blEd.K('task')).get(blEd.K('doc')).get(blEd.K('data')).get(blEd.K('task-title'))==='Review the release notes from my phone.');
 const newTask=await document(await pathOf('task'));assert.equal(newTask.data.place,'omega');assert.match(newTask.data.cwd,/\/omega$/);
 await click('work');await click('scope');await ui().locator('[data-act="scope-choice"][data-path="workspace:beam-lisp"]').tap();
 await wait(()=>blEd.F.d_editor(blEd.frame(),blEd.K('rail')).get(blEd.K('path'))==='workspace:beam-lisp');
 assert.equal(await ui().locator('.task-card').count(),1);await shot('10-scoped-work');
 // Portrait phones, landscape, tablet, and desktop fit without horizontal scrolling.
 for(const [width,height] of [[320,740],[390,844],[430,932],[844,390],[768,1024],[1440,1000]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(150);
  const bounds=await ui().evaluate(root=>({scroll:root.scrollWidth,width:root.clientWidth,body:document.body.scrollWidth,viewport:innerWidth}));
  assert.ok(bounds.scroll<=bounds.width+1,JSON.stringify({width,...bounds}));assert.ok(bounds.body<=bounds.viewport+1);
  await shot(`11-responsive-${width}`);
 }
 await page.setViewportSize({width:390,height:844});await click('host');await shot('12-host');
 await click('unload');await wait(()=>!document.documentElement.classList.contains('omega-mobile'));
 assert.equal(await page.locator('[data-mobile-resource]').count(),0);assert.equal(await page.locator('.pane.editor').count(),1);
 await shot('13-unloaded');assert.deepEqual(errors,[]);
 console.log('PASS: phone UI, native input, retained per-task drafts, plan, file publication, dirty guard, real answer, selective undo, failed send, reconnect, places, scoped task creation, six viewport sizes, exact resource unload; no browser errors.');
}catch(error){await shot('failure');console.error(await ui().innerText());throw error;}finally{await browser.close();}
