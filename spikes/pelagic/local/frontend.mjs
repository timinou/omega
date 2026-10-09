// The server frontend uses exactly the local compilation, with the real server
// document/intent transport. No second compiler pin, runtime, or BL namespace ABI.
import fs from 'node:fs/promises';
import path from 'node:path';
const here=path.resolve(import.meta.dirname,'..');
const local=path.join(here,'dist/local'),server=path.join(here,'dist/server');
await fs.access(path.join(local,'.pelagic-local'));
try{await fs.access(server);await fs.access(path.join(server,'.pelagic-server'));}catch(error){if(error.code!=='ENOENT')throw error;try{await fs.access(server);throw new Error('Refusing unmarked server output');}catch(e){if(e.code!=='ENOENT')throw e;}}
const stage=server+'.stage-'+process.pid;
try{
 await fs.cp(local,stage,{recursive:true,filter:source=>source===local||!['sw.mjs','.pelagic-local','local'].includes(path.basename(source))});
 await fs.copyFile(path.join(here,'../../vendor/bl-ed/web/index.html'),path.join(stage,'index.html'));
 await fs.writeFile(path.join(stage,'.pelagic-server'),'PELAGIC shared native-JS server frontend\n');
 await fs.rm(server,{recursive:true,force:true});await fs.rename(stage,server);
}finally{await fs.rm(stage,{recursive:true,force:true});}
if(process.argv.includes('--install')){
 const web=path.join(here,'../../vendor/bl-ed/web');
 // Preserve unrelated package files. Editor/runtime modules come from one graph.
 await fs.cp(path.join(server,'out'),path.join(web,'out'),{recursive:true});
 await fs.cp(path.join(server,'pkg/pelagic'),path.join(web,'pkg/pelagic'),{recursive:true});
 await fs.copyFile(path.join(server,'pkg/pelagic.mjs'),path.join(web,'pkg/pelagic.mjs'));
 console.log('Installed shared PELAGIC frontend; run bin/bl-ed normally.');
}
console.log(server);
