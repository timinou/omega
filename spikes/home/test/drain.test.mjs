import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('stop releases held observers and drains an accepted write',{timeout:90000},async t=>{
 const reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 assert.notEqual(port,8790);
 const child=spawn('bin/bl',['--cold','run','spikes/home/test/drain.bl','--',String(port)],{cwd:process.cwd(),detached:true,stdio:['ignore','pipe','pipe']});
 let logs='';for(const stream of [child.stdout,child.stderr])stream.on('data',b=>logs+=b);
 t.after(()=>{try{process.kill(-child.pid,'SIGTERM');}catch(e){if(e.code!=='ESRCH')throw e;}});
 async function until(label){const deadline=Date.now()+70000;while(!logs.includes(label)){assert.equal(child.exitCode,null,logs);assert.ok(Date.now()<deadline,logs);await sleep(20);}}
 await until('READY');const base=`http://127.0.0.1:${port}`;
 const poll=fetch(base+'/api/rev?path=proof:held&since=same');await until('REV_WAITING');
 const intent=name=>fetch(base+'/api/intent',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({intent:name,args:{}})});
 const write=intent('proof/write');await until('WRITE_ACCEPTED');assert.equal((await intent('proof/stop')).status,200);
 assert.equal((await poll).status,200);assert.equal((await write).status,200);await until('DRAIN_MS=');
 assert.match(logs,/WRITE_FINISHED/);const ms=Number(logs.match(/DRAIN_MS=(\d+)/)[1]);assert.ok(ms<3000,logs);
 console.log(`held poll + accepted 600 ms write drained in ${ms} ms`);
});
