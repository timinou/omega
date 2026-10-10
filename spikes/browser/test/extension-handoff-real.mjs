// Disposable Chromium with extension code only: no user profile or vault data.
import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {NativeBrowser} from '../native.mjs';import {Sessions} from '../sessions.mjs';import {setOnePassword} from '../extension-control.mjs';
const extension=process.env.BROWSER_PROOF_EXTENSION;if(!extension)throw Error('Set BROWSER_PROOF_EXTENSION to installed 1Password extension code (not profile data)');
const config=JSON.parse(await fs.readFile(new URL('../.native/paths.json',import.meta.url),'utf8'));
const root=await fs.mkdtemp(path.join(os.tmpdir(),'omega-extension-handoff-'));const wrapper=path.join(root,'chromium');const quote=x=>"'"+x.replaceAll("'","'\\''")+"'";
await fs.writeFile(wrapper,`#!/bin/sh\nexec ${quote(config.CHROMIUM)} ${quote('--load-extension='+path.resolve(extension))} "$@"\n`,{mode:0o700});
const adapter=new NativeBrowser({root:path.join(root,'profiles'),env:{...config,CHROMIUM:wrapper}}),manager=new Sessions(path.join(root,'registry'),{adapter});
try{
 await manager.init();const s=await manager.open({id:'handoff',url:'https://example.com'});let h=adapter.handles.get(s.kernelId);
 assert.deepEqual(await setOnePassword(h.port,true),{installed:true,enabled:true});assert.equal(h.browser,undefined);
 for(let i=0;i<3;i++){
  await manager.action(s.id,'resume');assert.deepEqual(await setOnePassword(h.port,false),{installed:true,enabled:false});
  await manager.execute(s,['eval','1']);assert.ok(h.browser.isConnected());const connection=h.browser;
  await manager.action(s.id,'pause');assert.equal(h.browser,null);assert.equal(connection.isConnected(),false);assert.deepEqual(await setOnePassword(h.port,true),{installed:true,enabled:true});
 }
 await manager.action(s.id,'resume');await manager.action(s.id,'save-profile');await manager.open({id:s.id});h=adapter.handles.get(s.kernelId);assert.deepEqual(await setOnePassword(h.port,true),{installed:true,enabled:true});assert.equal(h.browser,undefined);
 console.log('PASS real 1Password enabled for human, disabled before automation, repeated handoffs, no Playwright during human control, saved disabled profile re-enables on manual reopen');
}finally{await manager.shutdown();await fs.rm(root,{recursive:true,force:true});}
