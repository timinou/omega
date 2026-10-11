// Exercise current host source against the actual compiled BL runtime. Keep its
// package-relative imports intact without a second conversion implementation.
import {mkdtempSync,cpSync,mkdirSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {resolve,join} from 'node:path';import {pathToFileURL} from 'node:url';
const stage=mkdtempSync(join(tmpdir(),'pelagic-host-test-'));
const out=resolve(process.env.PELAGIC_OUT||new URL('../dist/local/out',import.meta.url).pathname);
mkdirSync(join(stage,'pkg'),{recursive:true});cpSync(new URL('../host',import.meta.url),join(stage,'pkg/pelagic'),{recursive:true});
symlinkSync(out,join(stage,'out'),'dir');process.on('exit',()=>rmSync(stage,{recursive:true,force:true}));
export const hostImport=name=>import(pathToFileURL(join(stage,'pkg/pelagic',name)));
