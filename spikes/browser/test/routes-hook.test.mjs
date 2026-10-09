import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {startBrowserHost} from '../serve.mjs';
import {Sessions} from '../sessions.mjs';
import {fixture} from './fixture.mjs';
// The generic `routes` extension point: runs after Host/Origin checks, may answer or pass, never bypasses them.
test('routes hook answers its own paths after Host/Origin checks and passes everything else through',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'omega-routes-hook-'));const f=fixture(),manager=new Sessions(root+'.private',{adapter:f.adapter});
 const seen=[];
 const routes=async(req,res,url,ctx)=>{seen.push(url.pathname);if(url.pathname!=='/ext/ping')return false;ctx.json(res,200,{ok:true,sessions:ctx.manager===manager});return true;};
 const host=await startBrowserHost({root,manager,port:0,routes});
 try{
  const r=await fetch(host.url+'/ext/ping');assert.equal(r.status,200);assert.deepEqual(await r.json(),{ok:true,sessions:true});
  assert.equal((await fetch(host.url+'/browser/sessions')).status,200,'unclaimed paths fall through to the built-in routes');
  assert.ok(seen.includes('/browser/sessions'));
  const bad=await new Promise(res=>{const q=http.request(host.url+'/ext/ping',{headers:{host:'evil.example'}},m=>{m.resume();res(m.statusCode)});q.on('error',()=>res(0));q.end();});assert.notEqual(bad,200,'foreign Host never reaches the hook');
  const before=seen.length;
  const o=await fetch(host.url+'/ext/ping',{method:'POST',headers:{origin:'https://evil.example','content-type':'application/json'},body:'{}'});assert.equal(o.status,403);assert.equal(seen.length,before,'foreign Origin POST never reaches the hook');
 }finally{await host.stop();await fs.rm(root,{recursive:true,force:true});await fs.rm(root+'.private',{recursive:true,force:true});}
});
