// Actual model acceptance, only against the trial's explicit disposable file.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright-core');
const base=process.env.DOSSIER_URL||'http://127.0.0.1:8792';assert.ok(!base.includes(':8790'));
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:['--no-sandbox']});
const errors=[];
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(e.message));
 const identity=await(await page.request.get(base+'/api/doc?path=launch:identity')).json();assert.equal(JSON.parse(identity.text).root,'/tmp/omega-documents-try');
 const tasks=async()=>{const j=await(await page.request.get(base+'/api/doc?path=workspace:all')).json();return j.objects.filter(o=>o.type==='omega/task');};
 const before=new Set((await tasks()).map(t=>t.key));
 await page.goto(base+'/?use=mobile&layout=mobile&file=workspace:all&pocket=document&at='+encodeURIComponent('project:project/verification.bl.org'));
 await page.frameLocator('.dossier-frame').locator('#doc h1').waitFor();
 await page.locator('[data-act="document-task"]').click();await page.locator('.launch-origin').waitFor();
 await page.locator('[data-act="document-scope"][data-value="document"]').click();
 const goal='Open the source file named in the starting context. Append this exact line once: Verified: a real Omega task edited this temporary file. Do not change any other file. Call (done "Prototype verification passed") when finished.';
 await page.locator('[data-field="new-goal"]').fill(goal);await page.locator('[data-act="launch-start"]').click();await page.locator('[data-screen="task"]').waitFor();
 let created,last;const deadline=Date.now()+180000;
 while(Date.now()<deadline){
  created=(await tasks()).find(t=>!before.has(t.key)&&t.origin?.file?.endsWith('/verification.bl.org'));
  if(created?.status!==last){last=created?.status;console.log('real model task',created?.key,last);}
  if(created&&['done','failed','cancelled'].includes(created.status))break;
  await new Promise(r=>setTimeout(r,1000));
 }
 assert.ok(created);assert.equal(created.status,'done',JSON.stringify(created));
 const doc=await(await page.request.get(base+'/api/doc?path=project:project/verification.bl.org')).json();
 assert.match(doc.text,/Verified: a real Omega task edited this temporary file\./);assert.equal(created.origin.scope,'document');
 await page.screenshot({path:'spikes/workspace/dossier/proof/task-06-real-model.png'});
 assert.deepEqual(errors,[]);const result={base,task:created.key,status:created.status,source:created.origin.path,edited_disposable_file:true,errors,passed:true};
 writeFileSync('spikes/workspace/dossier/proof/document-task-real-model.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}
