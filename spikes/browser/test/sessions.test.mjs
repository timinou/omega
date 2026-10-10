import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Sessions,validId,publicURL,publicSession} from '../sessions.mjs';
import {fixture} from './fixture.mjs';
async function setup(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'omega-kernel-test-'));const f=fixture();const m=new Sessions(root,{adapter:f.adapter});await m.init();t.after(async()=>{await m.shutdown();await fs.rm(root,{recursive:true,force:true});});return {...f,m,root};}
test('IDs and credential-bearing URLs are rejected',()=>{assert.equal(validId('../auth'),false);assert.throws(()=>publicURL('file:///etc/passwd'));assert.throws(()=>publicURL('https://user:password@example.com'));});
test('Kernel receives a headed regular browser, full writer profile and scoped vault',async t=>{const {m,calls,root}=await setup(t);const s=await m.open({id:'ora',task:'t-1',url:'https://example.com'});const [,body]=calls.find(c=>c[0]==='browsers.create');assert.equal(body.headless,false);assert.equal(body.stealth,false);assert.equal(body.kiosk_mode,false);assert.equal(body.profile.save_changes,true);assert.equal(body.timeout_seconds,300);assert.equal(body.vaults.length,1);assert.equal(s.provider,'kernel');assert.equal((await fs.stat(root)).mode&0o777,0o700);assert.equal(s.artifacts.length,2);await assert.rejects(m.open({id:'ora',task:'t-2'}),/another task/);});
test('simultaneous opens provision exactly one browser; same profile has one writer',async t=>{const {m,calls}=await setup(t);const [a,b]=await Promise.all([m.open({id:'ora'}),m.open({id:'ora'})]);assert.equal(a.kernelId,b.kernelId);assert.equal(calls.filter(c=>c[0]==='browsers.create').length,1);await assert.rejects(m.open({id:'other',profile:a.profile}),/writer/);});
test('handoff serializes with in-flight automation and blocks queued model input',async t=>{const {m}=await setup(t);const s=await m.open({id:'ora',task:'t-1'});let release;const gate=new Promise(r=>release=r);const active=m.lock(s,()=>gate);const pause=m.action(s.id,'pause');const input=m.execute(s,['click','@e1']);release();await active;await pause;await assert.rejects(input,/paused/);assert.equal(s.control,'human');await m.action(s.id,'resume');assert.equal(s.auth,'unknown');});
test('host handoff must succeed before control changes; failed restrictions block automation',async t=>{
  const {m,adapter}=await setup(t);const s=await m.open({id:'handoff'});let fail=true;
  adapter.setControl=async(session,control)=>{assert.equal(session.control,control==='agent'?'human':'agent');if(fail)throw Error('Restriction failed');};
  await assert.rejects(m.action(s.id,'resume'),/Restriction failed/);assert.equal(s.control,'human');
  await assert.rejects(m.execute(s,['eval','1']),/human control/);
  fail=false;await m.action(s.id,'resume');assert.equal(s.control,'agent');
  fail=true;await assert.rejects(m.action(s.id,'pause'),/Restriction failed/);assert.equal(s.control,'agent');
  fail=false;await m.action(s.id,'pause');assert.equal(s.control,'human');
});
test('a desk can route a Kernel session through a host that also owns native browsers',async t=>{
 const {m,adapter}=await setup(t);adapter.kind='native';adapter.shutdown=async()=>{};adapter.providerFor=id=>id==='remote'?'kernel':'native';
 const remote=await m.open({id:'remote'});assert.equal(remote.provider,'kernel');
 const live=await m.live(remote.id);assert.match(live.liveURL,/^https:/);assert.equal(live.session.provider,'kernel');
 const local=await m.open({id:'local'});assert.equal(local.provider,'native');
});
test('save closes through Kernel and waits for profile state before reopening restored tabs',async t=>{const {m,calls}=await setup(t);const s=await m.open({id:'ora'}),id=s.kernelId;await m.action('ora','save-profile');assert.equal(s.status,'closed');assert.ok(s.savedAt);assert.ok(calls.find(c=>c[0]==='browsers.delete'&&c[1]===id));await m.open({id:'ora'});const body=calls.filter(c=>c[0]==='browsers.create').at(-1)[1];assert.equal(body.start_url,undefined,'do not discard restored tabs');assert.equal(body.profile.save_changes,true);});
test('pending save blocks reopen until persistence is acknowledged',async t=>{const {m,adapter}=await setup(t);const s=await m.open({id:'ora'});const saved=adapter.saved.bind(adapter);adapter.saved=async()=>{throw Error('save pending');};await assert.rejects(m.action('ora','save-profile'),/pending/);assert.equal(s.status,'saving');await assert.rejects(m.open({id:'ora'}),/pending/);adapter.saved=saved;await m.action('ora','reconnect');assert.equal(s.status,'closed');});
test('host restart reattaches the exact browser and defaults to human control',async t=>{const {m,adapter,root,calls}=await setup(t);const s=await m.open({id:'ora',task:'t-1'}),id=s.kernelId;await m.shutdown();const fresh=new Sessions(root,{adapter});await fresh.init();assert.equal(fresh.get('ora').kernelId,id);assert.equal(fresh.get('ora').control,'human');assert.equal(fresh.tasks.get('t-1'),undefined);assert.equal(fresh.get('ora').task,null);assert.equal(calls.filter(c=>c[0]==='browsers.create').length,1);await fresh.shutdown();});
test('live capabilities stay out of public metadata and disk registry',async t=>{const {m,root}=await setup(t);const s=await m.open({id:'ora'});const live=await m.live('ora');assert.match(live.liveURL,/readOnly=false/);await m.action('ora','resume');assert.match((await m.live('ora')).liveURL,/readOnly=true/);const stored=await fs.readFile(path.join(root,'sessions.json'),'utf8');assert.doesNotMatch(stored,/private-live-token|private-cdp-token|secret-approval/);assert.doesNotMatch(JSON.stringify(publicSession(s)),/kernelId|liveURL|vaultId/);});
test('forget deletes profile and credential vault only after close; retains evidence',async t=>{const {m,calls}=await setup(t);const s=await m.open({id:'ora',task:'t-1'});await assert.rejects(m.action('ora','forget'),/Close/);await m.action('ora','close');await m.action('ora','forget');assert.equal(s.status,'forgotten');assert.ok(calls.some(c=>c[0]==='vaults.delete'));assert.ok(calls.some(c=>c[0]==='profiles.delete'));assert.ok(await fs.stat(path.join(s.dir,s.artifacts[0].name)));});
test('a lost create response is reconciled by name without a second browser',async t=>{const {m,sdk,calls}=await setup(t);const create=sdk.browsers.create;sdk.browsers.create=async body=>{await create(body);throw Error('transport lost');};const s=await m.open({id:'ora'});assert.equal(s.status,'running');assert.equal(calls.filter(c=>c[0]==='browsers.create').length,1);});
test('one private registry cannot be opened by two hosts',async t=>{const {m,root,adapter}=await setup(t);await assert.rejects(new Sessions(root,{adapter}).init(),/running host/);assert.equal(m.sessions.size,0);});
test('reconnect recognizes an expired browser even when Kernel returns 404',async t=>{
  const {m,sdk,profiles}=await setup(t);const s=await m.open({id:'expired'});
  profiles.get(s.profile).updated_at=new Date(s.saveBaseline+1000).toISOString();
  sdk.browsers.retrieve=async()=>{throw Object.assign(Error('gone'),{status:404});};
  await m.action(s.id,'reconnect');assert.equal(s.status,'closed');assert.ok(s.savedAt);
});
test('live polling detects Kernel idle expiry instead of returning a stale viewer URL',async t=>{
 const {m,sdk,profiles}=await setup(t);const s=await m.open({id:'expired-view'});assert.ok((await m.live(s.id)).liveURL);
 profiles.get(s.profile).updated_at=new Date(s.saveBaseline+1000).toISOString();
 sdk.browsers.retrieve=async()=>{throw Object.assign(Error('expired'),{status:404});};
 const live=await m.live(s.id);assert.equal(live.session.status,'closed');assert.equal(live.liveURL,undefined);assert.ok(s.savedAt);
});
test('uncertain deletion reconciles the original save baseline before retrying',async t=>{
  const {m,adapter}=await setup(t);const s=await m.open({id:'uncertain'}),close=adapter.close.bind(adapter);
  adapter.close=async id=>{await close(id);throw Object.assign(Error('lost response'),{status:502});};
  await assert.rejects(m.action(s.id,'close'));assert.equal(s.status,'disconnected');
  await m.action(s.id,'close');assert.equal(s.status,'closed');assert.ok(s.savedAt);
});
test('save after remote idle expiry keeps the launch baseline',async t=>{
  const {m,adapter,sdk,profiles}=await setup(t);const s=await m.open({id:'idle'}),baseline=s.saveBaseline;
  await adapter.close(s.kernelId);
  sdk.browsers.deleteByID=async()=>{throw Object.assign(Error('gone'),{status:404});};
  adapter.saved=async(name,since)=>{assert.equal(since,baseline);assert.ok(Date.parse(profiles.get(name).updated_at)>since);};
  await m.action(s.id,'save-profile');assert.equal(s.status,'closed');
});
