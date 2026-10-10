import {localDocuments} from './documents.mjs';
try {
const seeds={};
for(const name of ['live-set.bl.org','demo.bl.org',
  'tutorials/00-start.bl.org','tutorials/01-first-light.bl.org',
  'tutorials/02-pattern-laboratory.bl.org','tutorials/03-safe-worlds.bl.org',
  'tutorials/04-under-the-surface.bl.org']){
  const response=await fetch(new URL('../'+name,import.meta.url));
  if(!response.ok)throw new Error('Cannot load bundled patch: '+name);
  seeds[name]=await response.text();
}
globalThis.BL_DOCUMENTS=await localDocuments(seeds);
await import('../host.mjs');
if('serviceWorker' in navigator){
  navigator.serviceWorker.register(new URL('../sw.mjs',import.meta.url),{scope:new URL('../',import.meta.url).pathname})
    .catch(error=>console.warn('Offline asset cache unavailable:',error));
}

} catch(error) {
  document.querySelector("#echo").textContent="Cannot open local PELAGIC: "+(error.message||String(error));
}
