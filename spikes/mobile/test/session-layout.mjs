// Session chrome in the real editor, on an offline disposable world only.
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {existsSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
const base=process.env.POCKET_TEST_URL,root=process.env.POCKET_TEST_ROOT;
assert.equal(base,'http://127.0.0.1:8792');assert.ok(root?.startsWith('/tmp/'));
const proof=new URL('../proof/session-layout/',import.meta.url).pathname;mkdirSync(proof,{recursive:true});
const cache=path.join(homedir(),'.cache/ms-playwright');
const executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||readdirSync(cache).filter(x=>/^chromium-\d+$/.test(x)).sort((a,b)=>+b.split('-')[1]-+a.split('-')[1]).map(x=>path.join(cache,x,'chrome-linux64/chrome')).find(existsSync);
const browser=await chromium.launch({headless:true,executablePath});
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),p=await context.newPage(),errors=[],checks=[];
p.on('pageerror',e=>errors.push(e.stack));
const ui=p.locator('[data-pane="phone"]'),click=act=>ui.locator(`button[data-act="${act}"]`).first().click();
const doc=async address=>(await(await context.request.get(base+'/api/doc?path='+encodeURIComponent(address))).json());
const intent=async(name,args)=>{const r=await(await context.request.post(base+'/api/intent',{data:{intent:name,args}})).json();assert.equal(r.ok,true,JSON.stringify(r));return r;};
const shot=name=>p.screenshot({path:path.join(proof,name+'.png')});
try{
 await intent('place/put',{text:`{:id "design" :name "Design" :root ${JSON.stringify(root)}}`});
 const opened=await intent('task/open',{title:'Review the project brief',goal:'Read the complete project brief and tell me what is important. Keep the goals, open questions, and proposed next steps clear.\n\nExplain how the conversation, supporting files, and file review fit together. Keep the full prompt here while using the short session title in the header.',path:'place:design'});
 for(const [id,kind,file,block] of [['review','output','review.bl.org',null],['brief','input','linked.bl.org','one'],['brief-section','input','linked.bl.org','two']]){
  await intent('links/put',{text:`{:id "layout-${id}" :from {:task "${opened.id}"} :kind :${kind} :to {:path "work:design/${file}"${block?` :block "${block}"`:''}}}`});
 }
 const before=await doc('work:design/review.bl.org');
 const saved=await(await context.request.post(base+'/api/save',{data:{path:'work:design/review.bl.org',text:'First line\nChanged detail\nLast line\n',base:before.rev,client:'layout-proof','client-seq':1}})).json();assert.equal(saved.ok,true,JSON.stringify(saved));
 await p.goto(base+'/?file=workspace:all&use=present,dwim,workspace,places,references,buffers,workbench,mobile&layout=mobile');
 await ui.getByText('Host connected').waitFor();
 await ui.locator('[data-act="open-task"][data-path="'+opened.path+'"]').click();
 await ui.locator('.mobile-header .task-title').filter({hasText:'Review the project brief'}).waitFor();
 await ui.locator('.question-card').waitFor();
 assert.equal(await ui.locator('.session-place-name').innerText(),'Design');
 assert.equal(await ui.locator('.mobile-content .task-title,.mobile-content .tabs').count(),0);
 assert.equal(await ui.locator('.bottom-nav').count(),0);
 assert.equal(await ui.locator('[data-act="tab-plan"] .tab-count').innerText(),'3');
 assert.equal(await ui.locator('[data-act="tab-changes"] .tab-count').innerText(),'1');
 await ui.locator('.question-card').waitFor();
 await shot('03-conversation');checks.push('real session header, linked place, three unique session files (including home) and one edited file, absent bottom navigation');
 const top=await ui.locator('.tabs').evaluate(e=>e.getBoundingClientRect().top);
 await ui.locator('.mobile-scroll').evaluate(e=>e.scrollTop=200);
 assert.equal(await ui.locator('.tabs').evaluate(e=>e.getBoundingClientRect().top),top);
 await click('context');await ui.getByRole('heading',{name:'Context',exact:true}).waitFor();assert.match(await ui.locator('[role="dialog"]').innerText(),/Design/);assert.ok((await ui.locator('[role="dialog"]').innerText()).includes(root));await shot('04-context');await click('dismiss');
 await click('tab-plan');await ui.locator('.artifact-list').waitFor();assert.equal(await ui.locator('.bottom-nav').count(),0);await shot('05-files');
 await click('tab-changes');await ui.locator('.change-card').first().waitFor();assert.equal(await ui.locator('.bottom-nav').count(),0);assert.equal(await ui.locator('.diff .added').filter({hasText:'Changed detail'}).count(),1);await shot('14-review');
 await click('tab-conversation');await ui.locator('[data-field="reply"]').fill('Keep this draft while I check the files.');await click('tab-plan');await click('tab-conversation');assert.equal(await ui.locator('[data-field="reply"]').inputValue(),'Keep this draft while I check the files.');
 checks.push('pinned tabs, textual context sheet, working Files and Changes views, retained composer draft');
 for(const [width,height] of [[320,740],[844,390],[1440,1000]]){
  await p.setViewportSize({width,height});assert.ok(await p.evaluate(()=>document.body.scrollWidth<=innerWidth));assert.ok((await ui.locator('.tabs').boundingBox()).height<=44);assert.equal(await ui.locator('.bottom-nav').count(),0);await shot('session-'+width);
 }
 await p.setViewportSize({width:390,height:844});
 await click('work');assert.equal(await ui.locator('.bottom-nav').isVisible(),true);assert.equal(await ui.locator('.bottom-nav').evaluate(e=>getComputedStyle(e).animationName),'nav-return');await p.waitForTimeout(200);await shot('06-back');
 for(const screen of ['places','buffers']){await click(screen);assert.equal(await ui.locator('.bottom-nav').isVisible(),true);}
 await p.setViewportSize({width:844,height:390});assert.equal(await ui.locator('.bottom-nav').isVisible(),true);
 await p.emulateMedia({reducedMotion:'reduce'});assert.equal(await ui.locator('.bottom-nav').evaluate(e=>getComputedStyle(e).animationName),'none');
 checks.push('320px, landscape and desktop session geometry; returning navigation; navigation on other pages; reduced motion');
 await p.setViewportSize({width:390,height:844});await click('host');await click('unload');await p.waitForFunction(()=>!document.documentElement.classList.contains('omega-mobile'));assert.equal(await p.locator('[data-mobile-resource]').count(),0);assert.equal(await p.locator('.pane.editor').count(),1);await shot('13-unused');
 assert.deepEqual(errors,[]);checks.push('real package unuse restores one editor and removes its host resources');
 writeFileSync(path.join(proof,'browser.json'),JSON.stringify({checks,errors,offline:true,port:8792},null,2)+'\n');console.log(JSON.stringify({checks}));
}catch(e){await shot('failure');console.error((await p.locator('body').innerText()).slice(-8000));throw e;}finally{await browser.close();}
