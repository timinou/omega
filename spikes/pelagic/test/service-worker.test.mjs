import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const template=await readFile(new URL('../local/service-worker.mjs.in',import.meta.url),'utf8');
function worker(scope='/set-a/'){
  const listeners=new Map(),deleted=[],installed=[],opened=[],requests=[];
  const prefix='pelagic-local:'+encodeURIComponent(scope)+':';
  const current=prefix+'release-2',other='pelagic-local:'+encodeURIComponent('/set-b/')+':release-1';
  const cache={addAll:async urls=>installed.push(...urls),match:async key=>key==='https://example.test'+scope+'index.html'?'cached editor':undefined};
  vm.runInNewContext(template.replace('__PELAGIC_CACHE__','"release-2"').replace('__PELAGIC_ASSETS__','["./index.html","./assets.json"]'),{
    URL,encodeURIComponent,self:{location:new URL('https://example.test'+scope+'sw.mjs'),addEventListener:(kind,fn)=>listeners.set(kind,fn),
      skipWaiting:()=>assert.fail('must not replace a live graph'),clients:{claim:()=>assert.fail('must not claim an old module realm')}},
    caches:{open:async name=>{opened.push(name);return cache;},keys:async()=>[prefix+'release-1',current,other],delete:async name=>deleted.push(name)},
    fetch:async request=>{requests.push(request);return 'network';}
  });
  return {listeners,deleted,installed,opened,requests,prefix,current,other};
}
async function lifecycle(w,kind){let completion;w.listeners.get(kind)({waitUntil:p=>completion=p});await completion;}
test('cache installation and retirement preserve live realms and other bundle scopes',async()=>{
  const w=worker();await lifecycle(w,'install');await lifecycle(w,'activate');
  assert.deepEqual(w.installed,['./index.html','./assets.json']);
  assert.deepEqual(w.deleted,[w.prefix+'release-1']);assert.deepEqual(w.opened,[w.current]);
});
test('offline navigation uses this bundle index; foreign requests remain untouched',async()=>{
  const w=worker();let response;
  w.listeners.get('fetch')({request:{url:'https://example.test/set-a/?use=pelagic',method:'GET',mode:'navigate'},respondWith:p=>response=p});
  assert.equal(await response,'cached editor');
  for(const url of ['https://elsewhere.test/set-a/index.html','https://example.test/set-b/index.html','https://example.test/set-ab/index.html']){
    w.listeners.get('fetch')({request:{url,method:'GET',mode:'cors'},respondWith:()=>assert.fail('foreign request intercepted')});
  }
  assert.deepEqual(w.requests,[]);
});
