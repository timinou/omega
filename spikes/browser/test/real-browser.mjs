// Actual local Chromium proof: storage survives mode restart, not merely mock calls.
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Sessions} from '../sessions.mjs';
const server=http.createServer((q,r)=>{r.setHeader('content-type','text/html');r.end('<title>Omega browser storage proof</title><h1>Browser handoff fixture</h1>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const root=await fs.mkdtemp(path.join(os.tmpdir(),'omega-browser-real-'));
const manager=new Sessions(root);await manager.init();
try {
 const s=await manager.open({id:'handoff',url:`http://127.0.0.1:${server.address().port}/`});
 await manager.run(s,['eval','document.cookie="omega_proof=present; SameSite=Lax"; localStorage.setItem("omega-proof","present"); true']);
 await manager.switchMode(s,'headful');
 let proof=await manager.run(s,['eval','document.cookie.includes("omega_proof=present") && localStorage.getItem("omega-proof")==="present"']);
 assert.equal(proof.result,true,'headful restored cookies and localStorage');
 await manager.switchMode(s,'headless');
 proof=await manager.run(s,['eval','document.cookie.includes("omega_proof=present") && localStorage.getItem("omega-proof")==="present"']);
 assert.equal(proof.result,true,'headless restored cookies and localStorage');
 await manager.action('handoff','close');await manager.action('handoff','forget');
 console.log(JSON.stringify({ok:true,modeSequence:['headless','headful','headless'],storageRestored:true,closed:true,forgotten:true,events:s.events},null,2));
}finally{await manager.shutdown();server.close();await fs.rm(root,{recursive:true,force:true});}
