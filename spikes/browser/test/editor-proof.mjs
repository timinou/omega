// Real bl-ed, real package and real host. Kernel service/live view are explicitly
// simulated here; this test cannot establish cloud or 1Password compatibility.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {startBrowserHost} from '../serve.mjs';
import {Sessions} from '../sessions.mjs';
import {fixture} from './fixture.mjs';
import {executable} from './executable.mjs';
const root=process.env.KERNEL_PROOF_ROOT || '/tmp/omega-kernel-editor-proof';
const upstream=process.env.KERNEL_PROOF_UPSTREAM || 'http://127.0.0.1:8836';
if(new URL(upstream).port==='8790')throw Error('Never test on the live world');
assert.ok(root.startsWith('/tmp/'),'proof requires an isolated /tmp root');
await fs.mkdir(root,{recursive:true});await fs.copyFile(new URL('../demo.bl.org',import.meta.url),path.join(root,'demo.bl.org'));
const state=await fs.mkdtemp(path.join(os.tmpdir(),'omega-kernel-proof-private-'));
const f=fixture(),manager=new Sessions(state,{adapter:f.adapter});
const host=await startBrowserHost({root,manager,upstream,port:0});
const browser=await chromium.launch({executablePath:await executable(),headless:true});
const proof=new URL('../proof/kernel/',import.meta.url);await fs.mkdir(proof,{recursive:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://fixture.onkernel.com/**',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><style>body{font:18px system-ui;background:#ecf0f4;color:#24334a;padding:30px}label{display:block;margin:20px 0}input{font:inherit;padding:10px}h1{font-size:27px}small{color:#7b2631}</style><small>Kernel live-view contract fixture · no cloud session</small><h1>Supplier account</h1><label>Operator <input id="operator"></label><p>Browser toolbar and 1Password are supplied by Kernel in production.</p><script>document.querySelector('input').disabled=new URL(location.href).searchParams.get('readOnly')==='true';parent.postMessage({type:'KERNEL_PLAYING'},new URL(document.referrer).origin)</script>`}));
 await page.goto(host.url+'/?file=demo.bl.org&use=present,browser');await page.waitForFunction(()=>window.blEd);
 // Drive C-Enter on the manual declaration through the editor's real key handler.
 await page.evaluate(()=>{const {dispatch,R,K,state}=blEd;const lines=state().get(K('text')).get(K('lines')).toArray();const row=lines.findIndex(l=>l.startsWith('#+begin_browser'));dispatch(R.hashMap(K('type'),K('click'),K('pos'),R.vec(row,0)));dispatch(R.hashMap(K('type'),K('key'),K('key'),'C-Enter'));});
 await page.waitForFunction(()=>blEd.frame().get(blEd.K('layout')).get(blEd.K('name'))==='browser-observe');
 const panel=page.frameLocator('iframe[data-embed-source]');await panel.locator('#control').waitFor();
 await panel.locator('#message').filter({hasText:'You have control'}).waitFor();
 const remote=panel.frameLocator('#viewport iframe');await remote.locator('#operator').fill('Fixture operator');
 assert.equal(await remote.locator('#operator').inputValue(),'Fixture operator');
 const remoteId=manager.get('manual').kernelId;
 await page.screenshot({path:new URL('01-human-live-panel.png',proof).pathname});
 // Rendering a document refresh must not remount the embedded browser.
 await panel.locator('#viewport iframe').evaluate(el=>el.dataset.proofIdentity='same-frame');
 await page.evaluate(()=>blEd.dispatch(blEd.R.hashMap(blEd.K('type'),blEd.K('resize'),blEd.K('height'),40,blEd.K('cols'),150)));
 assert.equal(await panel.locator('#viewport iframe').getAttribute('data-proof-identity'),'same-frame');
 await panel.locator('#control').click();await panel.locator('#state').filter({hasText:'Omega has control'}).waitFor();
 assert.equal(manager.get('manual').kernelId,remoteId);assert.equal(await remote.locator('#operator').isDisabled(),true);
 await page.screenshot({path:new URL('02-omega-live-panel.png',proof).pathname});
 await panel.locator('[data-action="save-profile"]').click();await panel.locator('#state').filter({hasText:'closed'}).waitFor();
 assert.ok(manager.get('manual').savedAt);await page.screenshot({path:new URL('03-saved-session.png',proof).pathname});
 await panel.locator('[data-action="open"]').click();await panel.locator('#state').filter({hasText:'running'}).waitFor();assert.notEqual(manager.get('manual').kernelId,remoteId);
 await panel.locator('#credentials summary').click();await panel.locator('[data-auth="connect"]').click();await panel.locator('#approval').waitFor({state:'visible'});assert.match(await panel.locator('#approval').getAttribute('href'),/secret-approval/);
 // Unload through the real command line; every pane and embedded frame disappears.
 await page.locator('#input-sink').focus();await page.keyboard.press(':');await page.keyboard.insertText('(ed/unuse "browser")');await page.keyboard.press('Enter');
 await page.waitForFunction(()=>blEd.frame().get(blEd.K('layout')).get(blEd.K('name'))==='single');
 assert.equal(await page.locator('iframe[data-embed-source]').count(),0);assert.equal(await page.locator('.pane.editor').count(),1);
 await page.screenshot({path:new URL('04-after-unuse.png',proof).pathname});
 assert.deepEqual(errors,[]);
 const result={ok:true,realEditor:true,provider:'Kernel SDK contract fixture',cloudVerified:false,onePasswordVerified:false,
   assertions:['C-Enter opens the package layout','live pane accepts input','stable iframe across render','same Kernel session during handoff','agent mode is read-only','save and reopen','human-only provider approval link','unuse removes every embedded pane','no browser JavaScript errors']};
 await fs.writeFile(new URL('editor.json',proof),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();await host.stop();await fs.rm(state,{recursive:true,force:true});}
