import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {literalArguments,normalizeTarget} from '../procurement/arguments.mjs';
test('bare accessibility references normalize without rewriting CSS selectors or literal URLs',()=>{
 assert.deepEqual(normalizeTarget('download',['e130','desks/ora/dossier.zip']),['@e130','desks/ora/dossier.zip']);
 assert.deepEqual(normalizeTarget('click',['#download']),['#download']);assert.deepEqual(normalizeTarget('open',['e130']),['e130']);
});
test('argument files preserve quotes, dollar signs and selectors without shell expansion',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'browser-args-'));try{const file=path.join(dir,'args');await fs.writeFile(file,'#button\ndesks/ora/$literal file.zip\n');assert.deepEqual(await literalArguments(['--args-lines',file]),['#button','desks/ora/$literal file.zip']);await fs.writeFile(file,'["#button","file.zip"]');assert.deepEqual(await literalArguments(['--args-file',file]),['#button','file.zip']);await fs.writeFile(file,'[1]');await assert.rejects(literalArguments(['--args-file',file]),/strings/);}finally{await fs.rm(dir,{recursive:true,force:true});}
});
