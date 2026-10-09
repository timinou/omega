import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {startBrowserHost} from '../serve.mjs';
import {Sessions} from '../sessions.mjs';
import {fixture} from './fixture.mjs';
test('host serves private live capability only to its panel; metadata, documents and artifacts remain separated',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'omega-kernel-host-'));const f=fixture(),manager=new Sessions(root+'.private',{adapter:f.adapter});
 const host=await startBrowserHost({root,manager,port:0});
 try{
  const s=await manager.open({id:'test'});
  const live=host.url+'/browser/live/test';assert.equal((await fetch(live)).status,403);
  assert.equal((await fetch(live,{headers:{'x-omega-browser':'human','sec-fetch-site':'cross-site'}})).status,403);
  const privateView=await (await fetch(live,{headers:{'x-omega-browser':'human'}})).json();assert.match(privateView.liveURL,/private-live-token/);
  const publicData=await (await fetch(host.url+'/browser/sessions')).text();assert.doesNotMatch(publicData,/private-live-token|private-cdp-token|vaultId/);
  const doc=await (await fetch(host.url+'/api/doc?path=browser:test')).json();assert.match(doc.text,/Kernel profile/);assert.doesNotMatch(doc.text,/private-live-token/);
  assert.equal((await fetch(host.url+'/browser/credentials/test',{method:'POST',headers:{origin:'https://evil.example','content-type':'application/json','x-omega-browser':'human'},body:'{"verb":"connect"}'})).status,403);
  assert.equal((await fetch(host.url+'/browser/artifact/test/../sessions.json')).status,400);
  const view=await fetch(host.url+'/browser/view/test');assert.match(view.headers.get('content-security-policy'),/frame-ancestors 'self'/);assert.match(await view.text(),/Link 1Password/);
 }finally{await host.stop();await fs.rm(root,{recursive:true,force:true});await fs.rm(root+'.private',{recursive:true,force:true});}
});
