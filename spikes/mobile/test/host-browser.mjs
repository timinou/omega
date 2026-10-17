// Browser-only host contracts. The full shared-world test also covers these.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright-core';
const host=readFileSync(process.env.HOST_TEST_MODULE||new URL('../host/host.mjs',import.meta.url));
const server=createServer((req,res)=>{
 if(req.url==='/host.mjs'){res.setHeader('Content-Type','text/javascript');res.end(host);}
 else if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');res.end(readFileSync(new URL('../host/style.css',import.meta.url)));}
 else if(/^\/[a-z-]+\.mjs$/.test(req.url)){res.setHeader('Content-Type','text/javascript');res.end(readFileSync(new URL('../host/'+req.url.slice(1),import.meta.url)));}
 else if(req.url.startsWith('/api/doc')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,text:req.url.includes('launch:identity')?JSON.stringify({root:'/tmp/test',db:'/tmp/test/db',live:false}):''}));}
 else res.end('<!doctype html><html><head><style>#rail{height:100dvh}body{margin:0}</style></head><body><div id="rail"></div><div id="task"></div><div id="file"></div></body></html>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const cache=path.join(homedir(),'.cache/ms-playwright');
const executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||readdirSync(cache).filter(x=>/^chromium-\d+$/.test(x)).sort((a,b)=>+b.split('-')[1]-+a.split('-')[1]).map(x=>path.join(cache,x,'chrome-linux64/chrome')).find(existsSync);
const browser=await chromium.launch({headless:true,executablePath}),page=await browser.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.stack));
const start=async(at=123,screen='task')=>page.evaluate(async ({at,screen})=>{
 const {createHost}=await import('/host.mjs');
 window.ms={rail:{role:'rail',path:'workspace:all',state:{screen,tab:'conversation','task-path':screen==='task'?'task:1':undefined,connection:{online:true}},objects:[],text:''},task:{role:'task',path:'task:1',draft:'',data:{desk:'task','task-id':'1','task-at':at,'task-status':'done','task-title':'Task'},state:{},text:'',objects:[]},file:{role:'file',path:'work:test/doc',revision:'1',text:'Selected words\nNext line',state:{},objects:[]}};
 window.events=[];window.host=createHost({dispatch(e){events.push(e);if(e.type==='mobile/draft')ms.task.draft=e.text;if(e.type==='mobile/selection')ms.rail.state.selection=e.selection;if(e.type==='mobile/connection')ms.rail.state.connection={online:e.online,checked:e.checked};if(e.type==='mobile/new-field')(ms.rail.state.new??={})[e.field]=e.value;if(e.type==='mobile/field')ms.rail.state[e.field]=e.value;if(e.type==='mobile/modal')ms.rail.state.modal=e.value;if(e.type==='mobile/nav')Object.assign(ms.rail.state,{screen:e.screen,'task-path':e.screen==='task'?e.path:ms.rail.state['task-path']});if(e.type==='mobile/document'){Object.assign(ms.rail.state,{screen:'document','file-path':e.path});ms.file.path=e.path;}window.update();}});
 window.views=Object.fromEntries(['rail','task','file'].map(k=>[k,host.mount(document.getElementById(k))]));
 window.update=()=>{for(const k of ['rail','task','file'])views[k].update(ms[k]);};update();
},{at,screen});
const dispose=()=>page.evaluate(()=>{Object.values(views).forEach(v=>v.dispose());host.dispose();});
try{
 await page.goto(`http://127.0.0.1:${server.address().port}`);await start(123,'work');
 assert.equal(await page.locator('.mobile-app').count(),1,'the rail can render before any task model arrives');
 await page.evaluate(()=>{ms.rail.state.screen='task';ms.rail.state['task-path']='task:1';update();});
 await page.waitForTimeout(100);
 await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>{ms.task.data['task-title']='Review the project brief';ms.task.data['place-name']='Research';ms.task.data.cwd='/tmp/test/research';ms.task.data.artifacts=[{path:'work:test/brief.org',kind:'input'},{path:'work:test/brief.org',block:'section',kind:'input'},{path:'work:test/output.org',kind:'output'}];ms.task.data['changed-files']=['work:test/output.org'];update();});
 assert.equal(await page.locator('.mobile-header .task-title').innerText(),'Review the project brief');
 assert.equal(await page.locator('.mobile-content .task-title,.mobile-content .tabs').count(),0,'session chrome lives outside the scrolling content');
 assert.equal(await page.locator('[data-act="tab-plan"] .tab-count').innerText(),'2','anchored references count as one file');
 assert.equal(await page.locator('[data-act="tab-changes"] .tab-count').innerText(),'1','only recorded edits count');
 assert.equal(await page.locator('.bottom-nav').count(),0,'session reserves no bottom navigation space');
 await page.locator('.session-place').click();assert.match(await page.locator('[role="dialog"]').innerText(),/Research[\s\S]*\/tmp\/test\/research/);await page.locator('button[data-act="dismiss"]').first().click();
 await page.evaluate(()=>{ms.task.text='A long conversation\n'.repeat(300);update();});
 const tabsTop=await page.locator('.tabs').evaluate(e=>e.getBoundingClientRect().top);
 await page.locator('.mobile-scroll').evaluate(e=>e.scrollTop=400);
 assert.equal(await page.locator('.tabs').evaluate(e=>e.getBoundingClientRect().top),tabsTop,'tabs stay pinned while reading');
 for(const tab of ['plan','changes']){await page.evaluate(tab=>{ms.rail.state.tab=tab;update();},tab);assert.equal(await page.locator('.bottom-nav').count(),0);assert.equal(await page.locator('.task-title').innerText(),'Review the project brief');}
 await page.locator('[aria-label="Back to Work"]').click();
 assert.equal(await page.locator('.bottom-nav').isVisible(),true);
 assert.equal(await page.locator('.bottom-nav').evaluate(e=>getComputedStyle(e).animationName),'nav-return');
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.bottom-nav').evaluate(e=>getComputedStyle(e).animationName),'none');await page.emulateMedia({reducedMotion:'no-preference'});
 await page.evaluate(()=>{ms.rail.state.screen='task';ms.rail.state.tab='conversation';ms.task.text='';update();});
 await page.setViewportSize({width:320,height:740});assert.equal(await page.evaluate(()=>document.body.scrollWidth<=innerWidth),true,'session header and badges fit narrow screens');
 await page.setViewportSize({width:390,height:844});
 await page.locator('[data-field="reply"]').fill('Keep this reply');
 await page.locator('[data-field="reply"]').focus();
 await page.evaluate(()=>{
  document.getElementById('rail').addEventListener('blur',()=>{ms.rail.message='Focus changed';update();},{capture:true,once:true});
  ms.task.text='An update while a native field has focus';update();
 });
 assert.deepEqual(errors,[],'native focus events cannot reenter DOM replacement');
 await dispose();await start();await page.waitForTimeout(100);
 assert.equal(await page.locator('[data-field="reply"]').inputValue(),'Keep this reply','a reply survives host recreation in the same tab');
 await dispose();await start(456);await page.waitForTimeout(100);
 assert.equal(await page.locator('[data-field="reply"]').inputValue(),'','a recreated task cannot inherit an old draft');
 await page.evaluate(()=>{ms.task.text='* model · 2\n#+begin_src beam-lisp :id 1/2\n(read "AGENTS.md")\n#+end_src\n#+RESULTS: 1/2\n: text\n';update();});
 await page.locator('.execution summary').click();
 const disclosure=await page.locator('.execution').elementHandle();
 await page.evaluate(()=>{ms.rail.state.connection.checked=Date.now();update();});
 assert.equal(await page.locator('.execution').evaluate(e=>e.open),true,'execution remains expanded across background updates');
 assert.equal(await disclosure.evaluate(e=>e.isConnected),true,'execution retains its DOM identity');
 await page.evaluate(()=>{ms.task.data.turns=[{n:1,role:'user',content:[{type:'text',text:'A full prompt'}]},{n:2,role:'assistant',content:[{type:'text',text:'## Answer\n\n**Readable** with `code`.\n\n- First\n- Second'}]}];ms.task.data['task-result']='## Answer\n\n**Readable** with `code`.\n\n- First\n- Second';update();});
 assert.equal(await page.locator('.message.agent h2').innerText(),'Answer','typed turns render structured responses');
 assert.equal(await page.locator('.message.agent strong').innerText(),'Readable');
 assert.equal(await page.locator('.message.agent li').count(),2);
 assert.equal(await page.locator('.result-card').count(),0,'one canonical response');
 // The thin prompt follows the visible user turn in both scroll directions.
 await page.evaluate(()=>{
  ms.task.data.turns=[
   {n:1,role:'user',content:[{type:'text',text:'First prompt <safe>\nKeep the second line out of the strip.'}]},
   {n:2,role:'assistant',content:[{type:'text',text:'First response\n\n'.repeat(80)}]},
   {n:3,role:'user',content:[{type:'text',text:'Next prompt '+ 'long '.repeat(50)+'\nMore details'}]},
   {n:4,role:'assistant',content:[{type:'text',text:'Second response\n\n'.repeat(80)}]},
   {n:5,role:'user',content:[{type:'tool-result',id:'only-tool',content:'Not a human prompt'}]}
  ];update();document.querySelector('.mobile-scroll').scrollTop=0;
 });
 const prompt=page.locator('.conversation-prompt');
 await page.waitForFunction(()=>document.querySelector('.conversation-prompt')?.textContent==='First prompt <safe>');
 assert.ok((await prompt.boundingBox()).height<=24,'prompt is one thin line');
 assert.equal(await prompt.locator('safe').count(),0,'prompt text is escaped');
 const promptTop=(await prompt.boundingBox()).y;
 await page.locator('.message.human').nth(1).evaluate(el=>{
  const scroll=el.closest('.mobile-scroll');scroll.scrollTop+=el.getBoundingClientRect().top-scroll.getBoundingClientRect().top+2;
 });
 await page.waitForFunction(()=>document.querySelector('.conversation-prompt')?.textContent.startsWith('Next prompt'));
 assert.equal((await prompt.boundingBox()).y,promptTop,'prompt stays fixed');
 assert.ok(!(await prompt.innerText()).includes('More details'),'only the first line appears');
 await page.evaluate(()=>{ms.rail.state.connection.checked=Date.now();update();});
 assert.match(await prompt.innerText(),/^Next prompt/,'background updates preserve the current prompt');
 await page.evaluate(()=>document.querySelector('.mobile-scroll').scrollTop=1e9);
 await page.waitForTimeout(50);
 assert.match(await prompt.innerText(),/^Next prompt/,'tool results never replace the user prompt');
 await page.evaluate(()=>document.querySelector('.mobile-scroll').scrollTop=0);
 await page.waitForFunction(()=>document.querySelector('.conversation-prompt')?.textContent==='First prompt <safe>');
 await page.evaluate(()=>{ms.rail.state.tab='plan';update();});
 assert.equal(await prompt.count(),0,'Files has no conversation prompt');
 await page.evaluate(()=>{ms.rail.state.tab='conversation';ms.task.data.turns=[];ms.task.text='* you · 1\nSource prompt\nSecond line\n* model · 2\nAnswer\n';update();});
 assert.equal(await prompt.innerText(),'Source prompt','source-only conversations also pin user messages');
 await page.evaluate(()=>{ms.task.data.turns=[{n:1,role:'assistant',content:[{type:'text',text:'No user message yet'}]}];update();});
 assert.equal(await prompt.isVisible(),false,'no empty strip without a user prompt');
 await page.evaluate(()=>{ms.task.data.turns=[{n:1,role:'user',content:[{type:'text',text:'A full prompt'}]}];update();});
 await page.evaluate(()=>{ms.task.objects=[{type:'omega/msg',key:'q-1',message:'Which route?'}];ms.task.data.questions=[{id:'q-1',data:{choices:[{label:'Keep',value:'keep'},{label:'Replace',value:'replace'}]}}];update();});
 assert.equal(await page.locator('[data-act="choice"]').count(),2,'typed choices retain their actual semantics');await page.locator('[data-act="choice"]').first().click();assert.equal(await page.evaluate(()=>events.filter(e=>e.type==='mobile/send').at(-1).answer),'keep');
 await page.evaluate(()=>{ms.task.objects=[];ms.task.data.questions=[];update();});

 await page.evaluate(()=>{ms.task.data.turns.push({n:3,role:'assistant',content:[{type:'tool-use',id:'full',name:'eval',input:{code:'(read \"brief.org\")'}}]},{n:4,role:'user',content:[{type:'tool-result',id:'full',content:'<script>danger()</script>\n'+('Full evidence\n'.repeat(200))}]});update();});
 await page.locator('[data-key="step:full"] summary').click();
 assert.equal(await page.locator('.tool-result').innerText().then(x=>x.includes('Full evidence\n'.repeat(199))),true,'execution shows the full recorded result');
 assert.equal(await page.locator('.tool-result script').count(),0,'model evidence remains escaped');

 await page.evaluate(()=>{ms.rail.state.screen='places';update();});
 assert.equal(await page.locator('[data-act="add-place"]').count(),1,'places exposes attachment');
 await page.evaluate(()=>{ms.rail.state.modal='place';ms.rail.message='Could not save place: missing directory';update();});
 assert.equal(await page.locator('[role="dialog"] [role="alert"]').count(),1,'form errors appear inside the active dialog');
 await page.evaluate(()=>{ms.rail.state.modal=null;ms.rail.message=null;update();});

 await page.evaluate(()=>{ms.rail.state.screen='task';update();});
 await page.evaluate(()=>{ms.task.data.home={path:'omega:scratch',block:'1'};ms.task.data.artifacts=[{kind:'home',path:'omega:scratch'}];update();});
 await page.locator('[data-act="tab-changes"]').click();
 assert.equal(await page.evaluate(()=>events.filter(e=>e.type==='mobile/tab').at(-1).path),undefined,'source home is not a changed file');
 await page.evaluate(()=>{ms.rail.state.tab='changes';ms.file.path='changes:work:test/unrelated.org';ms.file.objects=[{type:'buffer/op',key:'old',row:2,old:'Old',new:'New'}];update();});
 assert.equal(await page.locator('.change-card').count(),0,'another task cannot inherit an unrelated review');
 await page.evaluate(()=>{ms.rail.state.tab='conversation';ms.file.path='work:test/doc';ms.file.objects=[];update();});


 await page.evaluate(()=>{ms.rail.state.modal='commands';update();});
 await page.locator('[data-field="address"]').fill('work:test/slowly-typed.org');
 await page.evaluate(()=>{ms.rail.state.connection.checked=Date.now()+1;update();});
 assert.equal(await page.locator('[data-field="address"]').inputValue(),'work:test/slowly-typed.org','unfinished address survives background updates');
 await page.locator('.sheet button').last().focus();await page.keyboard.press('Tab');
 assert.equal(await page.evaluate(()=>!!document.activeElement.closest('[role="dialog"]')),true,'modal contains keyboard focus');
 await page.keyboard.press('Escape');assert.equal(await page.locator('[role="dialog"]').count(),0,'Escape dismisses sheet');
 await page.evaluate(()=>{ms.rail.state.modal='new';ms.rail.state.places=[{place:'test',title:'Test'}];update();});
 await page.locator('[data-field="new-goal"]').fill('An unsent goal');
 await dispose();await start(456);await page.waitForTimeout(100);
 await page.evaluate(()=>{ms.rail.state.modal='new';ms.rail.state.places=[{place:'test',title:'Test'}];update();});
 assert.equal(await page.locator('[data-field="new-goal"]').inputValue(),'An unsent goal','new work survives host recreation');
 await page.evaluate(()=>{ms.rail.state.modal=null;update();});
 await page.evaluate(()=>{ms.task={...ms.task,path:'links:task/1',text:'References opened by a native command',data:{},'read-only':true};update();});
 assert.equal(await page.locator('.reader').innerText(),'References opened by a native command','native command navigation exposes its resulting document');
 assert.equal(await page.locator('.mobile-header .task-title').innerText(),'Task','reference reading keeps its session title');
 await page.locator('[data-act="tab-conversation"]').click();assert.equal(await page.evaluate(()=>events.filter(e=>e.type==='mobile/nav').at(-1).path),'task:1','Conversation returns from a reference to its session');
 await page.evaluate(()=>{ms.rail.state.screen='document';update();});
 await page.locator('.reader-line').first().evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));});
 assert.equal(await page.evaluate(()=>window.getSelection().toString()),'Selected words','Ask selection preserves native copy');
 assert.equal(await page.locator('[data-act="ask-passage"]').isDisabled(),false);
 assert.equal(await page.locator('[data-act="copy-passage"]').isDisabled(),false,'selected passage enables Copy without destroying the native range');
 await dispose();assert.equal(await page.locator('[data-mobile-resource]').count(),0);
 assert.deepEqual(errors,[]);
 console.log('host browser: retained replies, task identity, native selection, disposal passed');
}finally{await browser.close();await new Promise(r=>server.close(r));}
