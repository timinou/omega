// Opt-in real Kernel smoke test. Creates and deletes only a fresh test profile.
// Never uses the user's running world, existing profiles or real credentials.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Sessions,safeError} from '../sessions.mjs';
if(!process.env.KERNEL_API_KEY){console.error('Real Kernel proof requires KERNEL_API_KEY in the host environment. No cloud browser was created.');process.exit(2);}
const root=await fs.mkdtemp(path.join(os.tmpdir(),'omega-kernel-live-'));
const m=new Sessions(root,{namespace:'omega-proof-'+Date.now()});await m.init();let s;
try{
 s=await m.open({id:'persistence',task:'synthetic-proof',url:'https://example.com'});
 await m.execute(s,['eval','document.cookie="omega_fixture=present; Secure; SameSite=Lax"; localStorage.setItem("omega-fixture","present"); true']);
 const before=s.kernelId;assert.ok((await m.live(s.id)).liveURL);await m.action(s.id,'pause');assert.equal(s.kernelId,before);
 await m.action(s.id,'save-profile');assert.equal(s.status,'closed');await m.open({id:s.id});
 const result=await m.run(s,['eval','({cookie:document.cookie.includes("omega_fixture=present"),storage:localStorage.getItem("omega-fixture"),url:location.href,ua:navigator.userAgent})']);
 assert.equal(result.result.cookie,true);assert.equal(result.result.storage,'present');assert.equal(result.result.url,'https://example.com/');assert.doesNotMatch(result.result.ua,/HeadlessChrome/);
 await m.action(s.id,'close');await m.action(s.id,'forget');
 const proof={ok:true,provider:'kernel',sameSessionDuringHandoff:true,profileRestored:true,regularBrowser:true,forgotten:true,onePassword:'Requires human account approval; not exercised by this synthetic test.'};
 await fs.mkdir(new URL('../proof/kernel/',import.meta.url),{recursive:true});await fs.writeFile(new URL('../proof/kernel/cloud.json',import.meta.url),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
}catch(e){console.error(safeError(e));process.exitCode=1;}
finally{if(s&&!['closed','forgotten'].includes(s.status))await m.action(s.id,'close').catch(()=>{});if(s?.status==='closed')await m.action(s.id,'forget').catch(()=>{});await m.shutdown();await fs.rm(root,{recursive:true,force:true});}
