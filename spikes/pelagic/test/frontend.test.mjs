import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
const script=new URL('../local/frontend.mjs',import.meta.url);
test('server staging installs the same graph, preserves other packages, and retains server transport',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'pelagic-frontend-'));
 const put=async(file,value)=>{const p=path.join(root,file);await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,value);};
 try{
  await put('spikes/pelagic/local/frontend.mjs',await fs.readFile(script));
  for(const [name,value] of Object.entries({'.pelagic-local':'owned','index.html':'local boot','sw.mjs':'offline only','local/boot.mjs':'local only','out/rt.mjs':'one runtime','pkg/pelagic/values.mjs':'native BL','pkg/pelagic.mjs':'real package'}))await put('spikes/pelagic/dist/local/'+name,value);
  await put('vendor/bl-ed/web/index.html','server boot');await put('vendor/bl-ed/web/pkg/other.mjs','keep');
  const result=spawnSync(process.execPath,[path.join(root,'spikes/pelagic/local/frontend.mjs'),'--install'],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  const read=name=>fs.readFile(path.join(root,name),'utf8');
  assert.equal(await read('spikes/pelagic/dist/server/index.html'),'server boot');
  assert.equal(await read('vendor/bl-ed/web/out/rt.mjs'),'one runtime');assert.equal(await read('vendor/bl-ed/web/pkg/pelagic/values.mjs'),'native BL');
  assert.equal(await read('vendor/bl-ed/web/pkg/other.mjs'),'keep');assert.equal(await read('vendor/bl-ed/web/index.html'),'server boot');
  await assert.rejects(fs.access(path.join(root,'spikes/pelagic/dist/server/sw.mjs')));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
