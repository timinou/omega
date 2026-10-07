import {test} from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import {pathToFileURL} from 'node:url';
globalThis.BL_HOST = globalThis.BL_HOST || {};
const load=n=>import(pathToFileURL(path.resolve(process.env.BLED_OUT||'vendor/bl-ed/web/out',n+'.mjs')));
const R=await load('rt'),M=await load('ed.main'),P=await load('ed.pkg'),L=await load('links.main');
const K=R.kw,g=(m,k)=>m?.get(K(k),null),ev=(...a)=>R.hashMap(...a);
const effects=ed=>M.d_take_effects(ed).toArray()[1].toArray();
test('references use place metadata or selected task identity',()=>{
 let ed=M.d_boot('place').assoc(K('doc'),ev(K('data'),ev(K('place'),'boards')));
 assert.equal(g(effects(L.d_inspect(ed)).at(-1),'path'),'links:place/boards');
 ed=ed.assoc(K('obj-index'),R.hashMap(0,ev(K('type'),'omega/task',K('key'),'t-1')));
 assert.equal(g(effects(L.d_inspect(ed)).at(-1),'path'),'links:task/t-1');
});
test('add submits a data map through the existing minibuffer and unloading is exact',()=>{
 let ed=P.d_use(M.d_boot('references'),L.d_bl_package);ed=L.d_add(ed);
 ed=M.d_handle(ed,ev(K('type'),K('text'),K('text'),'{:id "ref"}'));ed=M.d_handle(ed,ev(K('type'),K('key'),K('key'),'Enter'));
 const fx=effects(ed).find(e=>g(e,'intent')==='links/put');assert.equal(g(g(fx,'args'),'text'),'{:id "ref"}');
 const raw=M.d_boot('hello').assoc(K('packages'),R.vec());assert.equal(R.printStr(P.d_unuse(P.d_use(raw,L.d_bl_package),'references')),R.printStr(raw));
});
