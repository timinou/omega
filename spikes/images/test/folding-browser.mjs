// Regression: run against the offline world; preserve the user's image buffer.
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const base=process.env.IMAGE_ORIGIN || 'http://127.0.0.1:8792';
const session='omega-image-folds';
const proof=new URL('../proof/',import.meta.url).pathname;
const browser=(...args)=>execFileSync('npx',['agent-browser','--session',session,...args],{encoding:'utf8',timeout:45000,stdio:['ignore','pipe','pipe']}).trim();
const evaluate=js=>JSON.parse(browser('eval',js));
const doc=await (await fetch(base+'/api/doc?path=images.bl.org')).json();
const asset=doc.text.match(/\[\[image:(\/api\/assets\/[^\]]+)\]\]/)?.[1];
assert.ok(asset,'Run the image paste browser test first to create an offline asset');
const sample='* Parent\nIntroduction\n** Child\nBefore the picture\n[[image:'+asset+']]\nChild caption\n* Sibling\n[[image:'+asset+']]\nSibling caption\n';
const response=await fetch(base+'/api/save',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path:'image-folds.bl.org',text:sample})});
assert.equal(response.status,200);
const state=()=>evaluate(`(()=>{const b=window.blEd,k=b.K,e=b.state();return {images:[...document.querySelectorAll('.k-image img')].map(i=>({loaded:i.complete&&i.naturalWidth>0,row:Number(i.closest('.line').dataset.src)})),shown:document.querySelector('.lines').innerText,text:e.get(k('text')).get(k('lines')).toArray().join('\\n')};})()`);
async function ready(){for(let n=0;n<20;n++){const s=state();if(s.images.length===2&&s.images.every(i=>i.loaded))return;await new Promise(r=>setTimeout(r,100));}throw Error('Images did not load');}
browser('close');
try{
 browser('open',base+'/?file=image-folds.bl.org&use=images');
 browser('set','viewport','1280','1100');await ready();
 browser('press','j');browser('press','j');browser('press','Tab');
 assert.deepEqual(state().images.map(i=>i.row),[7]);assert.ok(!state().shown.includes('Child caption'));
 browser('press','g');browser('press','i');assert.equal(state().images.length,0);
 assert.ok(!state().shown.includes('Child caption'),'fold applies in source mode too');
 browser('press','g');browser('press','i');browser('press','Tab');
 assert.deepEqual(state().images.map(i=>i.row),[4,7]);
 browser('press','g');browser('press','g');browser('press','Tab');
 assert.deepEqual(state().images.map(i=>i.row),[7]);assert.ok(!state().shown.includes('Child'));
 browser('screenshot',proof+'03-folded.png');
 browser('press','Tab');await ready();assert.equal(state().text,sample);
 browser('screenshot',proof+'04-unfolded.png');
 browser('press',':');browser('type','#input-sink','(ed/unuse "images")');browser('press','Enter');
 assert.equal(state().images.length,0);assert.equal(state().text,sample);
 browser('screenshot',proof+'05-fold-test-unused.png');assert.equal(browser('errors'),'');
 console.log('PASS: nested heading folds hide image and caption, source toggle respects folds, unfold restores images, unuse preserves text');
}finally{browser('close');}
