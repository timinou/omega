import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Sessions} from '../sessions.mjs';
import {Credentials} from '../credentials.mjs';
import {fixture} from './fixture.mjs';
async function setup(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'omega-credentials-test-'));const f=fixture(),m=new Sessions(root,{adapter:f.adapter});await m.init();const s=await m.open({id:'login'});const c=new Credentials(m);t.after(async()=>{await m.shutdown();await fs.rm(root,{recursive:true,force:true});});return {...f,m,s,c,root};}
test('1Password is explicitly linked, approved and filled without receiving credential values',async t=>{const {c,items,calls,root}=await setup(t);const link=await c.operation('login','connect');assert.equal(link.action.name,'1password_oauth');items.get('1password-account').state.status='connected';const requested=await c.operation('login','request');assert.equal(requested.action.name,'1password_access_approval');assert.equal((await c.operation('login','status')).status,'ready');const result=await c.operation('login','fill');assert.equal(result.status,'fill_submitted');const fill=calls.find(c=>c[0]==='items.performOperation'&&c[2].type==='1pw_fill')[2];assert.equal(fill.page_url,'https://example.com/');assert.ok(fill.browser_id);assert.doesNotMatch(await fs.readFile(path.join(root,'sessions.json'),'utf8'),/secret-approval|secret-request|integration_key|access_token/);});
test('credential actions are blocked under agent control',async t=>{const {m,c}=await setup(t);await m.action('login','resume');await assert.rejects(c.operation('login','connect'),/human control/);});
test('hosted collection defines write-only fields and never accepts values from the panel',async t=>{const {c,calls}=await setup(t);const result=await c.operation('login','collect',{password:'must-not-be-stored'});assert.equal(result.action.name,'collect');const body=calls.find(c=>c[0]==='items.upsert')[2];assert.ok(body.spec.fields.every(f=>f.sensitive&&!('value'in f)));assert.doesNotMatch(JSON.stringify(calls),/must-not-be-stored/);});
test('lost or uncertain 1Password fill cannot be submitted twice in the same browser',async t=>{const {c,sdk,items}=await setup(t);await c.operation('login','connect');items.get('1password-account').state.status='connected';await c.operation('login','request');await c.operation('login','status');const operation=sdk.vaults.items.performOperation;sdk.vaults.items.performOperation=async(k,b)=>{if(b.type==='1pw_fill')throw Object.assign(Error('network lost'),{status:502});return operation(k,b);};await assert.rejects(c.operation('login','fill'));await assert.rejects(c.operation('login','fill'),/uncertain/);});
test('saved login fill checks readiness and binds selectors to the actual origin',async t=>{
  const {c,items,calls}=await setup(t);await c.operation('login','collect');
  const entry=[...items.values()].find(i=>i.spec.provider==='kernel');
  await assert.rejects(c.operation('login','fill-kernel',{username:'#user',password:'#pass'}),/not ready/);
  entry.available_operations=[{type:'fill'}];
  await c.operation('login','fill-kernel',{username:'#user',password:'#pass',url:'https://evil.example'});
  const request=calls.find(c=>c[0]==='items.performOperation'&&c[2].type==='fill')[2];
  assert.equal(request.page_url,'https://example.com/');assert.deepEqual(request.fields,[{field:'username',selector:'#user'},{field:'password',selector:'#pass'}]);
});
