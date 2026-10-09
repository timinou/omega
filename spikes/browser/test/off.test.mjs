import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {NativeBrowser} from '../native.mjs';
import {BrowserPort} from '../port.mjs';

test('disabled native backend refuses launch without creating a profile or spawning',async()=>{
 const root=path.join(os.tmpdir(),'omega-browser-off-'+crypto.randomUUID());
 const a=new NativeBrowser({root,env:{BL_BROWSER_ENABLED:'0',BL_BROWSER_PORT:'/not-an-executable'}});
 await assert.rejects(a.create({id:'disabled',profile:'disabled'}),/disabled/);
 assert.equal(await fs.access(root).then(()=>true,()=>false),false);assert.equal(a.handles.size,0);
});
test('off host loads no native automation or cloud SDK',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'omega-host-off-'));
 const loader=path.join(root,'deny-loader.mjs');
 await fs.writeFile(loader,`export async function resolve(specifier,context,next){if(/playwright|onkernel|native\\.mjs|kernel\\.mjs/.test(specifier))throw Error('Heavy provider imported: '+specifier);return next(specifier,context);}`);
 const code=`import {startBrowserHost} from ${JSON.stringify(new URL('../serve.mjs',import.meta.url).href)};
 const h=await startBrowserHost({root:${JSON.stringify(root+'/docs')},backend:'off',port:0});
 try{await h.manager.open({id:'disabled'});throw Error('Unexpected launch');}catch(e){if(!/disabled/.test(e.message))throw e;}finally{await h.stop();}`;
 try{await new Promise((resolve,reject)=>{const c=spawn(process.execPath,['--no-warnings','--loader',loader,'--input-type=module','-e',code],{stdio:['ignore','ignore','pipe']});let err='';c.stderr.on('data',b=>err+=b);c.on('error',reject);c.on('exit',code=>code===0?resolve():reject(Error(err)));});}finally{await fs.rm(root,{recursive:true,force:true});}
});
test('native helper off switch refuses before touching profile paths',{skip:!process.env.BL_BROWSER_PORT},async()=>{
 const before=process.env.BL_BROWSER_ENABLED;process.env.BL_BROWSER_ENABLED='0';
 const root=path.join(os.tmpdir(),'omega-port-off-'+crypto.randomUUID());let p;
 try{p=new BrowserPort(process.env.BL_BROWSER_PORT);await assert.rejects(p.request({op:'launch',profile:root+'/profile',runtime:root+'/runtime'}),/disabled/);assert.equal(await fs.access(root).then(()=>true,()=>false),false);}finally{await p?.close();if(before===undefined)delete process.env.BL_BROWSER_ENABLED;else process.env.BL_BROWSER_ENABLED=before;}
});
test('Wayland-only build refuses X11 before creating profiles',{skip:!process.env.BL_BROWSER_PORT},async t=>{
 const p=new BrowserPort(process.env.BL_BROWSER_PORT),root=path.join(os.tmpdir(),'omega-x11-disabled-'+crypto.randomUUID());
 try{const info=await p.request({op:'ping'});if(info.displayBackends.includes('x11')){t.skip('Compatibility feature explicitly enabled');return;}
 await assert.rejects(p.request({op:'launch',displayBackend:'x11',profile:root+'/profile',runtime:root+'/runtime'}),/X11 support was not built/);assert.equal(await fs.access(root).then(()=>true,()=>false),false);}finally{await p.close();}
});
