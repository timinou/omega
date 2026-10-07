// Real system clipboard and native Ctrl+V, driven entirely by npx agent-browser.
// Start bin/bl-ed FROM the offline root (the launcher currently prepends --root $PWD).
// AGENT_BROWSER_EXECUTABLE_PATH may point to an installed Chromium.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const session = 'omega-images-proof';
const root = process.env.IMAGE_ROOT || '/tmp/omega-image-slice';
const url = process.env.IMAGE_URL || 'http://127.0.0.1:8792/?file=images.bl.org&use=images';
const proof = new URL('../proof/', import.meta.url).pathname;
fs.mkdirSync(proof,{recursive:true});
fs.writeFileSync(root+'/images.bl.org','#+TITLE: Images belong in the buffer\n\n* A thought, with a picture\nPaste a screenshot here.\n\n');
function browser(...args) {
  return execFileSync('npx',['agent-browser','--session',session,...args],{encoding:'utf8',timeout:45000,stdio:['ignore','pipe','pipe']}).trim();
}
const evaluate = js => JSON.parse(browser('eval',js));
const state = () => evaluate(`(() => {const b=window.blEd,k=b.K,e=b.state();return {text:e.get(k('text')).get(k('lines')).toArray().join('\\n'),mode:e.get(k('mode')).name,head:e.get(k('sels')).nth(0).get(k('head')).toArray(),images:[...document.querySelectorAll('.k-image img')].map(i=>({loaded:i.complete&&i.naturalWidth>0,src:i.src})),message:e.get(k('message'))};})()`);
const pause = ms => new Promise(r=>setTimeout(r,ms));
async function until(check) { for(let n=0;n<40;n++){const s=state();if(check(s))return s;await pause(100);}throw new Error('Timed out: '+JSON.stringify(state())); }
browser('close'); // Reset any daemon left by an earlier run before choosing Chromium.
try {
 browser('open',url);
 await until(s=>s.message==='using images');
 browser('press','G');
 const before=state().text;
 const bytes=evaluate(`(async()=>{const c=document.createElement('canvas');c.width=640;c.height=320;const x=c.getContext('2d');x.fillStyle='#102b37';x.fillRect(0,0,640,320);x.fillStyle='#8de1be';x.font='bold 36px sans-serif';x.fillText('A picture in a thought',36,65);x.strokeStyle='#8de1be';x.lineWidth=5;x.beginPath();x.moveTo(40,240);x.bezierCurveTo(170,240,180,110,320,160);x.bezierCurveTo(420,220,480,80,600,95);x.stroke();const b=await new Promise(r=>c.toBlob(r,'image/png'));await navigator.clipboard.write([new ClipboardItem({'image/png':b})]);return b.size;})()`);
 assert.ok(bytes>1000);
 browser('press','Control+v');
 const pasted=await until(s=>s.images.length===1&&s.images[0].loaded);
 assert.equal(pasted.mode,'insert');assert.equal(pasted.head[1],0);
 assert.ok(pasted.text.includes('[[image:/api/assets/'));
 browser('type','#input-sink','This is the thought beneath the picture.');
 browser('press','Escape');
 const caption=state();assert.ok(caption.text.endsWith('This is the thought beneath the picture.'));
 browser('press','u');assert.equal(state().text,pasted.text);
 browser('press','u');assert.equal(state().text,before);assert.equal(state().images.length,0);
 browser('press','U');assert.equal(state().text,pasted.text);
 browser('press','U');assert.equal(state().text,caption.text);
 browser('press','Control+s');
 await until(s=>s.message==='saved' || fs.readFileSync(root+'/images.bl.org','utf8')===caption.text);
 assert.equal(fs.readFileSync(root+'/images.bl.org','utf8'),caption.text);
 browser('reload');
 const reopened=await until(s=>s.images.length===1&&s.images[0].loaded);
 assert.equal(reopened.text,caption.text);
 assert.ok(reopened.images[0].src.startsWith('http://127.0.0.1:8792/api/assets/'),'fresh page resolves bytes from disk');
 browser('screenshot',proof+'01-used.png');
 browser('press','g');browser('press','i');assert.equal(state().images.length,0);
 browser('press','g');browser('press','i');assert.equal(state().images.length,1);
 browser('press',':');browser('type','#input-sink','(ed/unuse "images")');browser('press','Enter');
 await until(s=>s.images.length===0);
 assert.equal(state().text,caption.text);
 browser('screenshot',proof+'02-unused.png');
 assert.equal(browser('errors'),'');
 console.log('PASS: native clipboard paste, caption, undo/redo, disk save, reload, source toggle, unuse; no browser errors');
} finally { browser('close'); }
