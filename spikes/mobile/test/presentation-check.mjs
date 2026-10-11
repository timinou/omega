// Run the unchanged checker on the published graph. Its historical core.pr_str
// name is a logging API; the current runtime exports that printer as printStr.
import {mkdtempSync,readdirSync,symlinkSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
const out=path.resolve(process.env.PP_OUT||process.env.BLED_OUT||'vendor/bl-ed/web/out');
const overlay=mkdtempSync(path.join(tmpdir(),'omega-presentation-check-'));
try{
 for(const name of readdirSync(out))if(name!=='core.mjs')symlinkSync(path.join(out,name),path.join(overlay,name));
 writeFileSync(path.join(overlay,'core.mjs'),`export * from ${JSON.stringify(pathToFileURL(path.join(out,'core.mjs')).href)};\nexport {printStr as pr_str} from ${JSON.stringify(pathToFileURL(path.join(out,'rt.mjs')).href)};\n`);
 const result=spawnSync(process.execPath,[new URL('../../present/test/check.mjs',import.meta.url).pathname,...process.argv.slice(2)],{stdio:'inherit',env:{...process.env,PP_OUT:overlay}});
 if(result.error)throw result.error;
 process.exitCode=result.status??1;
}finally{rmSync(overlay,{recursive:true,force:true});}
