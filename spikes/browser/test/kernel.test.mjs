import {test} from 'node:test';
import assert from 'node:assert/strict';
import Kernel from '@onkernel/sdk';
import {KernelBrowser} from '../kernel.mjs';
import {safeError} from '../sessions.mjs';
test('official SDK sends lifecycle bodies and auth only to the configured API',async()=>{
 const requests=[],profile={id:'p-1',name:'omega-test',updated_at:new Date(1000).toISOString()};
 const client=new Kernel({apiKey:'test-only-key',baseURL:'https://api.kernel.test',maxRetries:0,fetch:async(url,init)=>{
  const pathname=new URL(url).pathname,body=init.body?JSON.parse(init.body):undefined;requests.push({pathname,method:init.method,body,authorization:new Headers(init.headers).get('authorization')});
  let value=pathname.startsWith('/profiles/')?profile:pathname==='/vaults'?{id:'v-1'}:pathname==='/browsers'&&init.method==='GET'?[]:{session_id:'k-1',browser_live_view_url:'https://view.onkernel.com/private'};
  return new Response(init.method==='DELETE'?null:JSON.stringify(value),{status:init.method==='DELETE'?204:200,headers:{'content-type':'application/json','x-has-more':'false'}});
 }});
 const adapter=new KernelBrowser({client,env:{}}),s={id:'test',profile:'omega-test',remoteName:'omega-test-1',idleSeconds:300};
 await adapter.create(s,'https://example.com');await adapter.close('k-1');
 assert.ok(requests.every(r=>r.authorization==='Bearer test-only-key'));
 const create=requests.find(r=>r.pathname==='/browsers'&&r.method==='POST');assert.deepEqual(create.body.profile,{id:'p-1',save_changes:true});assert.deepEqual(create.body.vaults,[{id:'v-1'}]);assert.equal(create.body.headless,false);assert.ok(requests.some(r=>r.pathname==='/browsers/k-1'&&r.method==='DELETE'));
});
test('missing key fails explicitly without launching any local browser',()=>{assert.throws(()=>new KernelBrowser({env:{}}).api(),/Set KERNEL_API_KEY/);});
test('provider error bodies and capability URLs are not exposed in diagnostics',()=>{assert.doesNotMatch(safeError({status:401,error:{code:'unauthorized'},message:'Bearer secret https://x/token'}),/secret|token/);assert.doesNotMatch(safeError(Error('wss://x/private-token')),/private-token/);});
