// Build-time only: content-address the complete static application.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=path.resolve(process.argv[2]);
async function walk(dir){const files=[];for(const entry of await fs.readdir(dir,{withFileTypes:true})){
 const p=path.join(dir,entry.name);if(entry.isDirectory())files.push(...await walk(p));else files.push(p);
}return files;}
const files=(await walk(root)).sort();const hash=createHash('sha256');
for(const file of files){hash.update(path.relative(root,file));hash.update(await fs.readFile(file));}
const version='pelagic-local-'+hash.digest('hex').slice(0,20);
const urls=files.filter(f=>!f.endsWith('/local/cache-build.mjs')).map(f=>'./'+path.relative(root,f).split(path.sep).join('/'));
await fs.writeFile(path.join(root,'sw.mjs'),`
const CACHE=${JSON.stringify(version)},ASSETS=${JSON.stringify(urls)};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(names=>Promise.all(names.filter(n=>n.startsWith('pelagic-local-')&&n!==CACHE).map(n=>caches.delete(n)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==self.location.origin||!url.pathname.startsWith(new URL('./',self.location).pathname))return;
 event.respondWith(caches.open(CACHE).then(async cache=>{
   const key=event.request.mode==='navigate'?new URL('./index.html',self.location).href:event.request;
   return (await cache.match(key))||fetch(event.request);
 }));
});
`);
console.log(version+': '+urls.length+' local assets');
