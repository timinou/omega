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
 else if(/^\/[a-z-]+\.mjs$/.test(req.url)){res.setHeader('Content-Type','text/javascript');res.end(readFileSync(new URL('../host/'+req.url.slice(1),import.meta.url)));}
 else if(req.url.startsWith('/api/doc')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,text:req.url.includes('launch:identity')?JSON.stringify({root:'/tmp/test',db:'/tmp/test/db',live:false}):''}));}
 else res.end('<!doctype html><html><head></head><body><div id="rail"></div><div id="task"></div><div id="file"></div></body></html>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const cache=path.join(homedir(),'.cache/ms-playwright');
const executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||readdirSync(cache).filter(x=>/^chromium-\d+$/.test(x)).sort((a,b)=>+b.split('-')[1]-+a.split('-')[1]).map(x=>path.join(cache,x,'chrome-linux64/chrome')).find(existsSync);
const browser=await chromium.launch({headless:true,executablePath}),page=await browser.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.stack));
const start=async(at=123)=>page.evaluate(async at=>{
 const {createHost}=await import('/host.mjs');
 window.ms={rail:{role:'rail',path:'workspace:all',state:{screen:'task',tab:'conversation','task-path':'task:1',connection:{online:true}},objects:[],text:''},task:{role:'task',path:'task:1',draft:'',data:{desk:'task','task-id':'1','task-at':at,'task-status':'done','task-title':'Task'},state:{},text:'',objects:[]},file:{role:'file',path:'work:test/doc',revision:'1',text:'Selected words\nNext line',state:{},objects:[]}};
 window.host=createHost({dispatch(e){if(e.type==='mobile/draft')ms.task.draft=e.text;if(e.type==='mobile/selection')ms.rail.state.selection=e.selection;if(e.type==='mobile/connection')ms.rail.state.connection={online:e.online,checked:e.checked};if(e.type==='mobile/new-field')(ms.rail.state.new??={})[e.field]=e.value;if(e.type==='mobile/field')ms.rail.state[e.field]=e.value;if(e.type==='mobile/modal')ms.rail.state.modal=e.value;if(e.type==='mobile/nav')Object.assign(ms.rail.state,{screen:e.screen,'task-path':e.screen==='task'?e.path:ms.rail.state['task-path']});if(e.type==='mobile/document'){Object.assign(ms.rail.state,{screen:'document','file-path':e.path});ms.file.path=e.path;}window.update();}});
 window.views=Object.fromEntries(['rail','task','file'].map(k=>[k,host.mount(document.getElementById(k))]));
 window.update=()=>{for(const k of ['task','file','rail'])views[k].update(ms[k]);};update();
},at);
const dispose=()=>page.evaluate(()=>{Object.values(views).forEach(v=>v.dispose());host.dispose();});
try{
 await page.goto(`http://127.0.0.1:${server.address().port}`);await start();
 await page.waitForTimeout(100);
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
 await page.evaluate(()=>{ms.rail.state.screen='document';update();});
 await page.locator('.reader-line').first().evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));});
 assert.equal(await page.evaluate(()=>window.getSelection().toString()),'Selected words','Ask selection preserves native copy');
 assert.equal(await page.locator('[data-act="ask-passage"]').isDisabled(),false);
 await dispose();assert.equal(await page.locator('[data-mobile-resource]').count(),0);
 assert.deepEqual(errors,[]);
 console.log('host browser: retained replies, task identity, native selection, disposal passed');
}finally{await browser.close();await new Promise(r=>server.close(r));}
