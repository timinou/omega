// Real disposable browser proof: manual launch/extension UI never attaches Playwright.
import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import http from 'node:http';
import {NativeBrowser} from '../native.mjs';import {Sessions} from '../sessions.mjs';import {Credentials} from '../credentials.mjs';
const config=JSON.parse(await fs.readFile(process.env.BROWSER_NATIVE_CONFIG||new URL('../.native/paths.json',import.meta.url),'utf8'));
const root=await fs.mkdtemp(path.join(os.tmpdir(),'omega-manual-isolation-'));
const site=http.createServer((req,res)=>{res.setHeader('content-type','text/html');res.end('<title>Manual isolation fixture</title><h1>Local fixture</h1>');});await new Promise(r=>site.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${site.address().port}/`;
const adapter=new NativeBrowser({root:path.join(root,'profiles'),env:{...config,...process.env}}),manager=new Sessions(path.join(root,'registry'),{adapter});
try{
 await manager.init();const s=await manager.open({id:'manual-isolation',url});let h=adapter.handles.get(s.kernelId);assert.equal(s.control,'human');assert.equal(h.browser,undefined);
 await new Credentials(manager).operation(s.id,'extensions');assert.equal(h.browser,undefined);const targets=await h.port.request({op:'cdp',method:'Target.getTargets'});assert.ok(targets.targetInfos.some(t=>t.url==='chrome://extensions/'));
 await manager.action(s.id,'resume');await manager.execute(s,['open',url]);assert.ok(h.browser.isConnected());await manager.execute(s,['eval','document.cookie="manualFixture=retained; Max-Age=3600; SameSite=Lax"']);
 const connection=h.browser;await manager.action(s.id,'pause');assert.equal(h.browser,null);assert.equal(connection.isConnected(),false);await h.port.request({op:'info'});assert.equal(s.status,'running');
 await assert.rejects(manager.execute(s,['eval','1']),/human control/);
 await manager.action(s.id,'save-profile');assert.equal(s.status,'closed');assert.ok(s.savedAt);
 await manager.open({id:s.id});h=adapter.handles.get(s.kernelId);assert.equal(h.browser,undefined);await manager.action(s.id,'resume');await manager.execute(s,['open',url]);assert.match((await manager.execute(s,['eval','document.cookie'])).result,/manualFixture=retained/);
 await manager.action(s.id,'pause');assert.equal(h.browser,null);
 console.log('PASS manual launch and extension controls never attach Playwright; agent attaches on demand; human handoff disconnects without closing Chromium; clean save/reopen retains cookie');
}finally{await manager.shutdown();await new Promise(r=>site.close(r));await fs.rm(root,{recursive:true,force:true});}
