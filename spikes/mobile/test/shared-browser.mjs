// Two independent clients of the real, isolated shared host. No demo server.
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {existsSync,readdirSync,writeFileSync,mkdirSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
const base=process.env.POCKET_TEST_URL,root=process.env.POCKET_TEST_ROOT;
assert.ok(base&&root&&root.startsWith('/tmp/'));assert.ok(!base.includes(':8790'));
const proof=new URL('../proof/shared-world/',import.meta.url).pathname;mkdirSync(proof,{recursive:true});
const cache=path.join(homedir(),'.cache/ms-playwright');
const executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||readdirSync(cache).filter(x=>/^chromium-\d+$/.test(x)).sort((a,b)=>+b.split('-')[1]-+a.split('-')[1]).map(x=>path.join(cache,x,'chrome-linux64/chrome')).find(existsSync);
const browser=await chromium.launch({headless:true,executablePath});
const desktop=await browser.newContext({viewport:{width:1440,height:1000}}),phone=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const a=await desktop.newPage(),b=await phone.newPage(),errors=[];
for(const page of [a,b]){page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.stack||e.message));}
const ui=p=>p.locator('[data-pane="phone"]'),click=(p,act)=>ui(p).locator(`button[data-act="${act}"]`).first().click();
const doc=async address=>{const r=await desktop.request.get(base+'/api/doc?path='+encodeURIComponent(address));const d=await r.json();assert.equal(d.ok,true,JSON.stringify(d));return d;};
const intent=async(name,args)=>{const r=await desktop.request.post(base+'/api/intent',{data:{intent:name,args}});return r.json();};
const pane=async(p,id)=>p.evaluate(id=>{const ed=blEd.F.d_editor(blEd.frame(),blEd.K(id));return{path:ed.get(blEd.K('path')),text:ed.get(blEd.K('text')).get(blEd.K('lines')).toArray().join('\n'),saved:ed.get(blEd.K('saved-text')).get(blEd.K('lines')).toArray().join('\n'),data:ed.get(blEd.K('doc'))?.get(blEd.K('data'))};},id);
const openTask=async(p,title)=>{await click(p,'work');await ui(p).locator('[data-act="open-task"]').filter({hasText:title}).first().click();await ui(p).locator('h1.task-title').filter({hasText:title}).waitFor();};
const openDocument=async(p,address)=>{const expected=await doc(address);await click(p,'commands');await ui(p).locator('[data-field="address"]').fill(address);await ui(p).locator('form[data-form="open"] button').click();await p.waitForFunction(({address,rev})=>{const ed=blEd.F.d_editor(blEd.frame(),blEd.K('file'));return ed.get(blEd.K('path'))===address&&ed.get(blEd.K('doc'))?.get(blEd.K('rev'))===rev;},{address,rev:expected.rev});await ui(p).locator('.reader').waitFor();};
const create=async(p,goal)=>{await click(p,'work');await click(p,'new');await ui(p).locator('[data-field="new-place"]').selectOption('test');await ui(p).locator('[data-field="new-goal"]').fill(goal);await ui(p).locator('form[data-form="new"] button[type="submit"]').click();await ui(p).locator('.task-title').filter({hasText:goal}).waitFor();return(await pane(p,'task')).path;};
const waitText=async(p,text)=>ui(p).getByText(text,{exact:false}).filter({visible:true}).first().waitFor();
const checks=[];
try{
 const url=base+'/?file=workspace:all&use=present,dwim,workspace,places,references,buffers,workbench,mobile&layout=mobile';
 await Promise.all([a.goto(url),b.goto(url)]);
 await Promise.all([waitText(a,'Host connected'),waitText(b,'Host connected')]);
 assert.equal((await intent('place/put',{text:`{:id "test" :name "Test" :root ${JSON.stringify(root)}}`})).ok,true);
 // Start on desktop, answer on both clients; exactly one reply survives.
 const taskPath=await create(a,'Desktop work');await openTask(b,'Desktop work');
 await Promise.all([ui(a).locator('.question-card').waitFor(),ui(b).locator('.question-card').waitFor()]);
 const taskDoc=await doc(taskPath),ask=taskDoc.objects.find(o=>o.type==='omega/msg').key;
 const results=await Promise.all([intent('msg/answer',{msg:ask,text:'yes'}),intent('msg/answer',{msg:ask,text:'no'})]);
 assert.equal(results[0].ok,true);assert.equal(results[0].reply,results[1].reply);
 await Promise.all([waitText(a,'Offline run finished'),waitText(b,'Offline run finished')]);
 await Promise.all([ui(a).locator('.question-card').waitFor({state:'detached'}),ui(b).locator('.question-card').waitFor({state:'detached'})]);
 checks.push('desktop task, same ID, shared answer/result, concurrent answer resolves once');
 // A phone task remains alive while the phone loses its network.
 const phoneTask=await create(b,'Phone work');await ui(b).locator('.question-card').waitFor();
 const reply=ui(b).locator('[data-field="reply"]');await reply.fill('Retained through disconnection');
 await phone.setOffline(true);await waitText(b,'Offline · draft retained');
 assert.equal(await ui(b).locator('[data-act="send"]').isDisabled(),true);await openTask(a,'Phone work');
 const phoneDoc=await doc(phoneTask),phoneAsk=phoneDoc.objects.find(o=>o.type==='omega/msg').key;
 await intent('msg/answer',{msg:phoneAsk,text:'yes'});await waitText(a,'Offline run finished');
 await phone.setOffline(false);await waitText(b,'Offline run finished');assert.equal(await reply.inputValue(),'Retained through disconnection');
 assert.equal((await pane(a,'task')).path,phoneTask);
 await b.reload();await waitText(b,'Host connected');await openTask(b,'Phone work');assert.equal(await ui(b).locator('[data-field="reply"]').inputValue(),'Retained through disconnection');checks.push('phone task, disconnected view, host continues, retained reply, revision convergence');
 // Existing editor prompts remain usable through native phone controls.
 await click(b,'commands');await ui(b).locator('[data-field="command-pane"]').selectOption('task');
 await ui(b).locator('[data-field="command-query"]').fill('desk/link');await ui(b).locator('[data-name="desk/link"]').click();
 await ui(b).locator('[data-field="prompt"]').fill('i');await ui(b).locator('form[data-form="prompt"] button').click();
 await ui(b).locator('[data-field="prompt"]').fill('long.bl.org');await ui(b).locator('form[data-form="prompt"] button').click();
 await ui(b).locator('form[data-form="prompt"]').waitFor({state:'detached'});
 await ui(b).locator('.reader').waitFor();
 assert.ok((await doc('links:task/'+phoneTask.split(':')[1])).objects.some(o=>o.key==='work:test/long.bl.org'));
 checks.push('native overlay drives the existing multi-step reference prompt');
 await click(b,'commands');await ui(b).locator('[data-field="command-pane"]').selectOption('file');
 await ui(b).locator('[data-field="eval-code"]').fill('(+ 1 2)');await ui(b).locator('form[data-form="eval"] button[value="editor"]').click();
 await ui(b).locator('pre[role="status"]').filter({hasText:'3'}).waitFor();await click(b,'dismiss');
 checks.push('editor Lisp loads and evaluates through the ordinary command API');
 // Actual long document reading independent of the task conversation.
 await openDocument(b,'work:test/long.bl.org');await click(b,'outline');
 await ui(b).locator('[data-act="heading"]').filter({hasText:'Section 18'}).click();
 const scroll=await ui(b).locator('.mobile-scroll').evaluate(x=>x.scrollTop);assert.ok(scroll>1000,scroll);
 await click(b,'find');await ui(b).locator('[data-field="search"]').fill('needle');await click(b,'find-next');
 assert.ok(await ui(b).locator('.reader-line.match').count()>0);
 await ui(b).locator('[data-act="document-link"]').first().click();await waitText(b,'Linked document');await click(b,'document-back');
 await b.waitForFunction(()=>blEd.F.d_editor(blEd.frame(),blEd.K('file')).get(blEd.K('path'))==='work:test/long.bl.org');
 assert.equal((await pane(b,'file')).path,'work:test/long.bl.org');
 assert.ok(await ui(b).locator('.mobile-scroll').evaluate(x=>x.scrollTop)>1000);
 // Select a rendered line through the browser selection API, then use Ask.
 const selected=ui(b).locator('[data-row="3"]');await selected.scrollIntoViewIfNeeded();
 await selected.evaluate(el=>{const r=document.createRange();r.selectNodeContents(el);const s=window.getSelection();s.removeAllRanges();s.addRange(r);el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));});
 assert.equal(await b.evaluate(()=>window.getSelection().toString()),'Selected words for the model.');
 await click(b,'ask-passage');await ui(b).locator('[data-field="new-place"]').selectOption('test');
 await ui(b).locator('[data-field="new-goal"]').fill('Explain selected text');await ui(b).locator('form[data-form="new"] button[type="submit"]').click();
 await ui(b).locator('.task-title').filter({hasText:'Explain selected text'}).waitFor();
 const selectedTask=await doc((await pane(b,'task')).path);assert.equal(selectedTask.data.cwd,root);assert.equal(selectedTask.data.home.path,'work:test/long.bl.org');
 assert.match(selectedTask.text,/Selected passage from/);
 checks.push('long document outline, search, follow/back reading position, explicit checked passage and cwd');
 await ui(b).locator('.question-card').waitFor();await click(b,'actions');await click(b,'cancel-task');await click(b,'confirm-cancel');
 await ui(b).locator('.question-card').waitFor({state:'detached'});
 assert.equal((await doc((await pane(b,'task')).path)).data['task-status'],'cancelled');
 checks.push('cancel closes the task and removes its actionable question');
 // Both editors retain overlapping drafts, and neither publication overwrites.
 await Promise.all([openDocument(a,'work:test/shared.bl.org'),openDocument(b,'work:test/shared.bl.org')]);
 await click(b,'edit-mode');await ui(b).locator('[data-field="file"]').fill('Phone overlapping draft\n');
 await click(a,'edit-mode');await ui(a).locator('[data-field="file"]').fill('Desktop overlapping draft\n');
 await click(a,'publish');await a.waitForFunction(()=>blEd.F.d_editor(blEd.frame(),blEd.K('file')).get(blEd.K('saved-text')).get(blEd.K('lines')).toArray().join('\n')==='Desktop overlapping draft\n');
 await waitText(b,'overlaps');assert.equal(await ui(b).locator('[data-field="file"]').inputValue(),'Phone overlapping draft\n');
 await click(b,'publish');await waitText(b,'Not published');assert.equal((await doc('work:test/shared.bl.org')).text,'Desktop overlapping draft\n');
 checks.push('shared buffer revisions, overlapping drafts retained, stale publication refused');
 await b.screenshot({path:path.join(proof,'02-conflict-phone.png')});
 // Commands and the live machine share the same host, including full world data.
 await click(a,'commands');await ui(a).locator('[data-field="eval-code"]').fill('(count (omega.task/all world))');
 await ui(a).locator('form[data-form="eval"] button[value="machine"]').click();
 await ui(a).locator('pre[role="status"]').filter({hasText:'3'}).waitFor();
 await ui(a).locator('[data-field="eval-code"]').fill('(def pocket-proof 41)');
 await ui(a).locator('form[data-form="eval"] button[value="machine"]').click();
 await ui(a).locator('pre[role="status"]').filter({hasText:'41'}).waitFor();
 await click(b,'commands');await ui(b).locator('[data-field="eval-code"]').fill('(inc pocket-proof)');
 await ui(b).locator('form[data-form="eval"] button[value="machine"]').click();
 await ui(b).locator('pre[role="status"]').filter({hasText:'42'}).waitFor();await click(b,'dismiss');
 checks.push('machine evaluation sees the shared task world');
 await click(a,'dismiss');await a.screenshot({path:path.join(proof,'01-used-desktop.png')});
 await click(a,'host');await click(a,'unload');await a.waitForFunction(()=>!document.documentElement.classList.contains('omega-mobile'));
 assert.equal(await a.locator('[data-mobile-resource]').count(),0);assert.equal(await a.locator('.pane.editor').count(),1);
 await a.screenshot({path:path.join(proof,'03-unused-desktop.png')});
 assert.equal(await ui(b).locator('[data-field="file"]').inputValue(),'Phone overlapping draft\n');
 assert.equal(await b.locator('.omega-mobile').count(),1);
 assert.equal((await doc(phoneTask)).ok,true);checks.push('exact mobile unuse on desktop preserves phone and host world');
 assert.deepEqual(errors,[]);writeFileSync(path.join(proof,'browser.json'),JSON.stringify({checks,browserErrors:errors},null,2)+'\n');console.log(JSON.stringify({checks}));
}catch(error){await Promise.all([a.screenshot({path:path.join(proof,'failure-desktop.png')}),b.screenshot({path:path.join(proof,'failure-phone.png')})]);console.error(await ui(b).innerText());throw error;}finally{await browser.close();}
