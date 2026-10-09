// Real bl-ed, package, native helper, headed Chromium and streamed desktop.
// Uses only an offline /tmp world and a synthetic localhost supplier.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {chromium} from 'playwright-core';
import {NativeBrowser} from '../native.mjs';
import {Sessions} from '../sessions.mjs';
import {startBrowserHost} from '../serve.mjs';
import {executable} from './executable.mjs';
const root=process.env.NATIVE_PROOF_ROOT||'/tmp/omega-native-editor-proof',upstream=process.env.NATIVE_PROOF_UPSTREAM||'http://127.0.0.1:8838';
assert.ok(root.startsWith('/tmp/'));assert.notEqual(new URL(upstream).port,'8790');
const site=http.createServer((req,res)=>{res.setHeader('content-type','text/html; charset=utf-8');res.end('<!doctype html><title>Local supplier account</title><style>body{font:20px system-ui;padding:30px}input{font:inherit;padding:10px}</style><h1>Local supplier account</h1><p>Real native Chromium · synthetic localhost test site</p><label>Operator <input id="operator"></label>');});
await new Promise(r=>site.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${site.address().port}/`;
await fs.mkdir(root,{recursive:true});let demo=await fs.readFile(new URL('../demo.bl.org',import.meta.url),'utf8');demo=demo.replace(/:url https:\/\/ora-ventures.com\/?/,`:url ${url}`);await fs.writeFile(path.join(root,'demo.bl.org'),demo);
const privateRoot=await fs.mkdtemp(path.join(os.tmpdir(),'omega-native-editor-private-'));
const adapter=new NativeBrowser({root:path.join(privateRoot,'profiles')}),manager=new Sessions(path.join(privateRoot,'registry'),{adapter});
const host=await startBrowserHost({root,manager,upstream,port:0});
const browser=await chromium.launch({executablePath:await executable(),headless:true});
const proof=new URL('../proof/native/',import.meta.url);await fs.mkdir(proof,{recursive:true});let page;
try{
 page=await browser.newPage({viewport:{width:1600,height:1050}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(host.url+'/?file=demo.bl.org&use=present,browser');await page.waitForFunction(()=>window.blEd);
 await page.waitForFunction(()=>blEd.state().get(blEd.K('text')).get(blEd.K('lines')).toArray().some(l=>l.startsWith('#+begin_browser')));
 await page.evaluate(()=>{const {dispatch,R,K,state}=blEd,lines=state().get(K('text')).get(K('lines')).toArray(),row=lines.findIndex(l=>l.startsWith('#+begin_browser'));dispatch(R.hashMap(K('type'),K('click'),K('pos'),R.vec(row,0)));dispatch(R.hashMap(K('type'),K('key'),K('key'),'C-Enter'));});
 await page.waitForFunction(()=>blEd.frame().get(blEd.K('layout')).get(blEd.K('name'))==='browser-observe');
 const panel=page.frameLocator('iframe[data-embed-source]'),desktop=panel.frameLocator('#viewport iframe');
 await desktop.locator('html[data-connected="true"]').waitFor();
 await desktop.locator('canvas').evaluate(c=>new Promise((resolve,reject)=>{const start=Date.now();const check=()=>{const pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let painted=0;for(let i=3;i<pixels.length;i+=400)if(pixels[i])painted++;if(painted>100)return resolve();if(Date.now()-start>15000)return reject(Error('Streamed framebuffer did not paint'));setTimeout(check,50);};check();}));
 const native=adapter.handles.get(manager.get('manual').kernelId).browser.contexts()[0].pages().at(-1);await native.waitForSelector('#operator');
 const input=await native.locator('#operator').boundingBox(),[left,top]=await native.evaluate(()=>[(outerWidth-innerWidth)/2,outerHeight-innerHeight]),canvas=desktop.locator('canvas'),box=await canvas.boundingBox();
 await canvas.click({position:{x:(left+input.x+input.width/2)*box.width/1280,y:(top+input.y+input.height/2)*box.height/900}});await page.keyboard.press('Shift+H');await page.keyboard.type('uman in bl-ed');await native.waitForFunction(()=>document.querySelector('#operator').value==='Human in bl-ed');
 await page.screenshot({path:new URL('02-editor-human.png',proof).pathname});
 await desktop.locator('html').evaluate(e=>e.dataset.proofIdentity='same-viewer');const handoffStarted=performance.now();
 const before=manager.get('manual').kernelId;await panel.locator('#control').click();await panel.locator('#state').filter({hasText:'Omega has control'}).waitFor();assert.equal(manager.get('manual').kernelId,before);
 await desktop.locator('html[data-connected="true"][data-control="agent"]').waitFor();assert.equal(await desktop.locator('html').getAttribute('data-proof-identity'),'same-viewer');const handoffMs=Math.round(performance.now()-handoffStarted);await page.screenshot({path:new URL('03-editor-omega.png',proof).pathname});
 await panel.locator('#control').click();await desktop.locator('html[data-control="human"]').waitFor();assert.equal(await desktop.locator('html').getAttribute('data-proof-identity'),'same-viewer');
 await panel.locator('[data-action="save-profile"]').click();await panel.locator('#state').filter({hasText:'closed'}).waitFor();assert.ok(manager.get('manual').savedAt);await page.screenshot({path:new URL('04-editor-saved.png',proof).pathname});
 await panel.locator('[data-action="open"]').click();await desktop.locator('html[data-connected="true"]').waitFor();assert.notEqual(manager.get('manual').kernelId,before);
 await panel.locator('#credentials summary').click();assert.equal(await panel.locator('#native-credentials').isVisible(),true);assert.equal(await panel.locator('#kernel-credentials').isVisible(),false);
 // Exercise the local extension-manager control without downloading or unlocking
 // a password manager during an automated synthetic proof.
 await panel.locator('[data-auth="extensions"]').click();await adapter.handles.get(manager.get('manual').kernelId).browser.contexts()[0].pages().at(-1).waitForURL('chrome://extensions/');
 await adapter.handles.get(manager.get('manual').kernelId).browser.contexts()[0].pages().at(-1).locator('extensions-manager').waitFor();
 await page.waitForTimeout(500); // Let the independently streamed final screenshot catch up.
 await page.screenshot({path:new URL('05-editor-extensions.png',proof).pathname});
 await page.locator('#input-sink').focus();await page.keyboard.press(':');await page.keyboard.insertText('(ed/unuse "browser")');await page.keyboard.press('Enter');
 await page.waitForFunction(()=>blEd.frame().get(blEd.K('layout')).get(blEd.K('name'))==='single');assert.equal(await page.locator('iframe[data-embed-source]').count(),0);assert.equal(await page.locator('.pane.editor').count(),1);
 await page.screenshot({path:new URL('06-editor-after-unuse.png',proof).pathname});assert.deepEqual(errors,[]);
 const result={ok:true,realEditor:true,realNativeDesktop:true,realInput:true,sameBrowserHandoff:true,sameViewerHandoff:true,handoffMs,saveAndReopen:true,nativeExtensionManager:true,unuseRestoresEveryPane:true,noPageErrors:true,onePasswordAccountVerified:false};await fs.writeFile(new URL('editor.json',proof),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(e){await page?.screenshot({path:'/tmp/omega-native-editor-failure.png'});throw e;}
finally{await browser.close();await host.stop();site.closeAllConnections();await new Promise(r=>site.close(r));await fs.rm(privateRoot,{recursive:true,force:true});}
