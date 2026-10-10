// Explicit real headed native proof. Never uses user profiles or world 8790.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import {chromium} from 'playwright-core';
import WebSocket from 'ws';
import {NativeBrowser} from '../native.mjs';
import {Sessions} from '../sessions.mjs';
import {startBrowserHost} from '../serve.mjs';
import {executable} from './executable.mjs';
if(process.env.BROWSER_NATIVE_CONFIG){const config=JSON.parse(await fs.readFile(process.env.BROWSER_NATIVE_CONFIG,'utf8'));for(const [key,value]of Object.entries(config))process.env[key] ||= value;}
const displayBackend=process.env.BROWSER_DISPLAY_BACKEND||'wayland';
for(const name of ['BL_BROWSER_PORT','CHROMIUM',...(displayBackend==='wayland'?['SWAY','WAYVNC']:['XVFB','X11VNC'])])assert.ok(process.env[name],`Configure ${name} to run the real native proof`);
let proofPage;
const root=await fs.mkdtemp(path.join(os.tmpdir(),'omega-native-real-'));
const site=http.createServer((req,res)=>{res.setHeader('content-type','text/html; charset=utf-8');res.end('<!doctype html><title>Native localhost proof</title><style>body{font:20px system-ui;padding:30px}input{font:inherit;padding:10px}</style><h1>Local supplier fixture</h1><label>Operator <input id="operator"></label>');});
await new Promise(r=>site.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${site.address().port}/`;
const adapter=new NativeBrowser({root:path.join(root,'profiles-private')}),manager=new Sessions(path.join(root,'registry-private'),{adapter});
const host=await startBrowserHost({root:path.join(root,'docs'),manager,port:0});
const viewer=await chromium.launch({executablePath:await executable(),headless:true});
const proof=new URL(process.env.NATIVE_PROOF_DIR||'../proof/native/',import.meta.url);await fs.mkdir(proof,{recursive:true});
try{
 const started=performance.now();const s=await manager.open({id:'supplier',url}),id=s.kernelId;
 assert.equal(s.provider,'native');assert.equal(s.control,'human');
 const startupMs=performance.now()-started;const h=adapter.handles.get(id);
 assert.equal((await fs.stat(h.runtime)).mode&0o777,0o700);
 if(displayBackend==='x11'){
 assert.equal((await fs.stat(path.join(h.runtime,'client.auth'))).mode&0o777,0o600);
 // The X11 display must refuse clients without its private cookie.
 await new Promise((resolve,reject)=>{const socket=net.createConnection({path:'/tmp/.X11-unix/X'+h.info.display.slice(1)});socket.setTimeout(5000,()=>{socket.destroy();reject(Error('X11 authentication check timed out'));});socket.once('connect',()=>{const hello=Buffer.alloc(12);hello[0]=108;hello.writeUInt16LE(11,2);socket.write(hello);});socket.once('data',data=>{socket.destroy();try{assert.equal(data[0],0,'Unauthenticated X11 client accepted');resolve();}catch(e){reject(e);}});socket.once('error',reject);});
 }else{assert.equal(h.info.displayBackend,'wayland');assert.match(h.info.display,/^wayland-/);assert.equal(await fs.access(path.join(h.runtime,'client.auth')).then(()=>true,()=>false),false);}
 // Instrument this proof explicitly; native-manual-real proves uninstrumented human mode.
 assert.equal(h.browser,undefined);await adapter.connect(s);
 let context=h.browser.contexts()[0],page=context.pages().at(-1);
 await page.waitForSelector('#operator');
 assert.doesNotMatch(await page.evaluate(()=>navigator.userAgent),/HeadlessChrome/);
 const [left,top]=await page.evaluate(()=>[(outerWidth-innerWidth)/2,outerHeight-innerHeight]);
 const input=await page.locator('#operator').boundingBox();
 const outer=proofPage=await viewer.newPage({viewport:{width:1440,height:1000}});const errors=[];outer.on('pageerror',e=>errors.push(e.message));
 await outer.goto(host.url+'/browser/native/supplier');
 const desktop=outer;await desktop.locator('html[data-connected="true"]').waitFor();
 await desktop.locator('canvas').evaluate(c=>new Promise((resolve,reject)=>{const start=Date.now();const check=()=>{const pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let painted=0;for(let i=3;i<pixels.length;i+=400)if(pixels[i])painted++;if(painted>100)return resolve();if(Date.now()-start>15000)return reject(Error('Streamed framebuffer did not paint'));setTimeout(check,50);};check();}));
 const canvas=desktop.locator('canvas'),box=await canvas.boundingBox();
 const point={x:(left+input.x+input.width/2)*box.width/1280,y:(top+input.y+input.height/2)*box.height/900};
 const inputStarted=performance.now();await canvas.click({position:point});await outer.keyboard.press('Shift+N');await outer.keyboard.type('ative input');
 await page.waitForFunction(()=>document.querySelector('#operator').value==='Native input');
 const inputRoundTripMs=performance.now()-inputStarted;await outer.screenshot({path:new URL('01-real-desktop.png',proof).pathname});
 await page.evaluate(()=>{localStorage.setItem('native-proof','retained');document.cookie='native-proof=retained; Max-Age=3600; SameSite=Lax';});
 // Keep the old viewer connected: the server must independently block its input.
 await manager.action(s.id,'resume');assert.equal(s.kernelId,id);
 await canvas.click({position:point});await outer.keyboard.type('BLOCKED');
 await new Promise(r=>setTimeout(r,200));assert.equal(await page.locator('#operator').inputValue(),'Native input');
 await manager.action(s.id,'pause');context=(await adapter.connect(s)).contexts()[0];page=context.pages().at(-1);await canvas.click({position:point});await outer.keyboard.press('End');await outer.keyboard.type(' human');
 await page.waitForFunction(()=>document.querySelector('#operator').value==='Native input human');
 // A second helper cannot write the profile, even through an independent manager.
 const competitor=new NativeBrowser({root:adapter.root});await assert.rejects(competitor.create({profile:s.profile,remoteName:'competitor'},url),/writer/);await competitor.shutdown();
 // Cross-origin or missing capability websocket access is refused.
 const stream=adapter.stream(id);
 for(const [token,origin]of [[stream.token,'https://evil.example'],['wrong',host.url]])await new Promise((resolve,reject)=>{const ws=new WebSocket(host.url.replace('http:','ws:')+`/browser/vnc/supplier?token=${token}`,{origin});ws.on('open',()=>{ws.close();reject(Error('Unauthorised viewer accepted'));});ws.on('error',resolve);});
 await manager.action(s.id,'save-profile');assert.equal(s.status,'closed');assert.ok(s.savedAt);
 await manager.open({id:s.id});assert.notEqual(s.kernelId,id);
 const restored=(await adapter.connect(s)).contexts()[0].pages().at(-1);
 await restored.waitForURL(url);assert.equal(await restored.evaluate(()=>localStorage.getItem('native-proof')),'retained');assert.match(await restored.evaluate(()=>document.cookie),/native-proof=retained/);
 // Native port raw CDP is reusable by the scenario runner without Node automation.
 const targets=await adapter.handles.get(s.kernelId).port.request({op:'cdp',method:'Target.getTargets'});assert.ok(targets.targetInfos.some(t=>t.url===url));
 // Abrupt helper loss keeps the profile for recovery and cannot claim a save.
 const crashed=adapter.handles.get(s.kernelId),ownerPid=crashed.port.child.pid,owned=(await fs.readFile(`/proc/${ownerPid}/task/${ownerPid}/children`,'utf8')).trim().split(/\s+/).map(Number);
 crashed.port.child.kill('SIGKILL');await crashed.port.closed;
 for(let i=0;i<100;i++){const alive=await Promise.all(owned.map(async pid=>{const stat=await fs.readFile(`/proc/${pid}/stat`,'utf8').catch(()=>null);return stat&&!/\) Z /.test(stat);}));if(alive.every(x=>!x))break;if(i===99)assert.fail('Owned native child survived helper death');await new Promise(r=>setTimeout(r,100));}
 await manager.action(s.id,'reconnect');assert.equal(s.status,'closed');
 await manager.open({id:s.id});
 assert.equal(await (await adapter.connect(s)).contexts()[0].pages().at(-1).evaluate(()=>localStorage.getItem('native-proof')),'retained');
 // Refuse to forget arbitrary unmarked directories, even through the raw port.
 const {BrowserPort}=await import('../port.mjs'),guard=new BrowserPort(process.env.BL_BROWSER_PORT);
 const unrelated=path.join(root,'unrelated');await fs.mkdir(unrelated);await fs.writeFile(path.join(unrelated,'keep'),'keep');
 await assert.rejects(guard.request({op:'forget',profile:unrelated}),/managed browser profile/);await guard.close();assert.equal(await fs.readFile(path.join(unrelated,'keep'),'utf8'),'keep');
 // Graceful host shutdown saves; a fresh host restores a profile, not a stale PID.
 const savedProfile=s.profile;await host.stop();const fresh=new Sessions(manager.root,{adapter:new NativeBrowser({root:adapter.root})});await fresh.init();assert.equal(fresh.get(s.id).status,'closed');
 await fresh.open({id:s.id});await fresh.action(s.id,'close');await fresh.action(s.id,'forget');assert.equal(await fs.access(adapter.profilePath(savedProfile)).then(()=>true,()=>false),false);await fresh.shutdown();
 assert.deepEqual(errors,[]);
 const result={ok:true,backend:'native',realHeadedChromium:true,realVncInput:true,startupMs:Math.round(startupMs),inputRoundTripMs:Math.round(inputRoundTripMs),visibleFramebuffer:true,displayBackend,privateDisplay:true,crashChildrenExit:true,localhost:true,profilePersistence:true,existingViewerInputGated:true,exclusiveProfileWriter:true,privateViewer:true,rawCdp:true,gracefulHostRestart:true,crashRecovery:true,guardedDeletion:true,forget:true,onePasswordAccountVerified:false};
 await fs.writeFile(new URL('real.json',proof),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(e){if(proofPage){await proofPage.screenshot({path:'/tmp/omega-native-failure.png'});console.error(await proofPage.locator('#error').textContent());for(const frame of proofPage.frames())console.error(frame.url());}throw e;}finally{await viewer.close();await host.stop();site.closeAllConnections();await new Promise(r=>site.close(r));await fs.rm(root,{recursive:true,force:true});}
