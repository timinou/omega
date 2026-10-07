import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Sessions,validId,publicURL} from '../sessions.mjs';
async function fixture() {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'browser-contract-'));const calls=[];
  const m=new Sessions(root,{run:async(s,a)=>{
    calls.push(a);
    if(a[0]==='snapshot')return {snapshot:'- heading "Test"'};
    if(a[0]==='screenshot')await fs.writeFile(a[1],'png');
    if(a[0]==='state' && a[1]==='save')await fs.writeFile(a[2],'{"cookies":[]}');
    if(a[0]==='get')return {url:'https://example.com/'};
    if(a[0]==='tab' && a[1]==='list')return {tabs:[{url:'https://example.com/'}]};
    return {};
  }});await m.init();return {m,root,calls};
}
test('IDs cannot escape private storage; URLs cannot carry credentials',()=>{
 assert.equal(validId('../auth'),false);assert.throws(()=>publicURL('file:///etc/passwd'));
 assert.throws(()=>publicURL('https://user:secret@example.com'));assert.equal(validId('ora-t1'),true);
});
test('task ownership, lifecycle and private artifacts',async()=>{
 const {m,root}=await fixture();try {
 const s=await m.open({id:'ora',task:'t-1',url:'https://example.com'});
 assert.equal(m.tasks.get('t-1'),'ora');assert.equal(s.mode,'headless');assert.equal(s.status,'running');
 await assert.rejects(m.open({id:'ora',task:'t-2'}),/another task/);
 assert.equal((await fs.stat(root)).mode & 0o777,0o700);
 await m.action('ora','pause');assert.equal(s.control,'human');assert.equal(s.auth,'needs-human');
 await m.action('ora','resume');assert.equal(s.auth,'unknown');
 await assert.rejects(m.action('ora','forget'),/Close/);
 await m.action('ora','close');assert.equal(s.status,'closed');await m.action('ora','forget');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('mode switching saves state before close, uses fresh launch identity and restores tabs',async()=>{
 const {m,root,calls}=await fixture();const display=process.env.DISPLAY;process.env.DISPLAY=':test';
 try {
 const s=await m.open({id:'ora',url:'https://example.com'});const identity=s.agentSession;calls.length=0;
 await m.switchMode(s,'headful');assert.notEqual(s.agentSession,identity);assert.equal(s.mode,'headful');
 assert.deepEqual(calls.slice(0,3).map(a=>a.slice(0,2)),[['tab','list'],['state','save'],['close']]);
 assert.deepEqual(calls[3].slice(0,2),['--headed','--state']);
 assert.equal((await fs.stat(path.join(s.dir,'auth-state.json'))).mode & 0o777,0o600);
 assert.equal(s.events.at(-2).type,'mode/switched');
 }finally{if(display===undefined)delete process.env.DISPLAY;else process.env.DISPLAY=display;await fs.rm(root,{recursive:true,force:true});}
});
test('no desktop means a mode refusal leaves the running browser intact',async()=>{
 const {m,root}=await fixture();const d=process.env.DISPLAY,w=process.env.WAYLAND_DISPLAY;
 delete process.env.DISPLAY;delete process.env.WAYLAND_DISPLAY;
 try {const s=await m.open({id:'ora'});await assert.rejects(m.switchMode(s,'headful'),/display|DISPLAY/);assert.equal(s.status,'running');assert.equal(s.mode,'headless');}
 finally{if(d!==undefined)process.env.DISPLAY=d;if(w!==undefined)process.env.WAYLAND_DISPLAY=w;await fs.rm(root,{recursive:true,force:true});}
});
test('a host restart does not overwrite retained artifacts for the same logical ID',async()=>{
 const {m,root}=await fixture();
 try {
 const first=await m.open({id:'ora'});
 const second=new Sessions(root,{run:m.run});await second.init();
 const reopened=await second.open({id:'ora'});
 assert.equal(first.dir,reopened.dir);
 assert.notEqual(first.frame,reopened.frame);
 assert.equal(reopened.artifacts.length,4);
 assert.ok(await fs.stat(path.join(first.dir,first.frame)));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('a screenshot failure is visible but does not discard readable page evidence',async()=>{
 const {m,root}=await fixture();const original=m.run;
 m.run=async(s,a)=>{if(a[0]==='screenshot')throw Error('capture unavailable');return original(s,a);};
 try {
 const s=await m.open({id:'ora'});assert.equal(s.status,'running');
 assert.equal(s.frame,undefined);assert.equal(s.artifacts[0].kind,'snapshot');
 assert.equal(s.events.at(-1).type,'artifact/capture-failed');
 assert.equal(await m.navigate(s,'https://example.com'),'- heading "Test"');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('watch refresh keeps one mutable image and leaves navigation artifacts intact',async()=>{
 const {m,root}=await fixture();
 try {
 const s=await m.open({id:'ora'});const original=s.frame;
 await m.action('ora','watch');await m.refreshFrame(s);await m.refreshFrame(s);
 assert.equal(s.frame,'watch-viewport.png');
 assert.equal(s.artifacts.filter(a=>a.name==='watch-viewport.png').length,1);
 assert.ok(s.artifacts.some(a=>a.name===original));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('explicit saved storage survives restart and can be forgotten without claiming login validity',async()=>{
 const {m,root,calls}=await fixture();try{
 const s=await m.open({id:'saved'});await m.action('saved','save-profile');assert.equal(s.profile,'saved-storage');
 const fresh=new Sessions(root,{run:m.run});await fresh.init();assert.equal(fresh.get('saved').status,'closed');assert.equal(fresh.get('saved').auth,'unknown');
 await fresh.open({id:'saved'});assert.ok(calls.some(a=>a.includes('--state')));await fresh.action('saved','close');await fresh.action('saved','forget');
 assert.equal(fresh.get('saved').profile,'ephemeral');await assert.rejects(fs.access(path.join(s.dir,'auth-state.json')));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('watching a closed session does not silently start another browser',async()=>{
 const {m,root,calls}=await fixture();try{await m.open({id:'closed'});await m.action('closed','close');const before=calls.length;await assert.rejects(m.action('closed','watch'),/closed/);assert.equal(calls.length,before);}finally{await fs.rm(root,{recursive:true,force:true});}
});
