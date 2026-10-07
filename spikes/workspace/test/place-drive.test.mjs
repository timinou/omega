import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
globalThis.BL_HOST = globalThis.BL_HOST || {};
const out=path.resolve(process.env.BLED_OUT||'vendor/bl-ed/web/out');
const load=n=>import(pathToFileURL(path.join(out,n+'.mjs')));
const R=await load('rt'),M=await load('ed.main'),P=await load('ed.pkg'),Q=await load('place.main');
const K=R.kw,g=(m,k)=>m?.get(K(k),null),ev=(...a)=>R.hashMap(...a);
const key=k=>ev(K('type'),K('key'),K('key'),k);
const boot=()=>M.d_handle(M.d_boot('places'),ev(K('type'),K('use'),K('package'),Q.d_bl_package));
test('parent uses provider context and requests a normal editor visit',()=>{
 let ed=boot().assoc(K('doc'),ev(K('data'),ev(K('parent'),'omega')));
 ed=M.d_handle(M.d_handle(ed,key('g')),key('p'));
 const effects=M.d_take_effects(ed).toArray()[1].toArray();
 assert.equal(g(effects.at(-1),'path'),'place:omega');
});
test('place attachment submits a plain map as a host intent',()=>{
 let ed=Q.d_attach(boot());
 ed=M.d_handle(ed,ev(K('type'),K('text'),K('text'),'{:id "child" :parent "omega"}'));
 ed=M.d_handle(ed,key('Enter'));
 const fx=M.d_take_effects(ed).toArray()[1].toArray().find(e=>g(e,'intent')==='place/put');
 assert.ok(fx);assert.equal(g(g(fx,'args'),'text'),'{:id "child" :parent "omega"}');
});
test('place home forwards an anchor and unloading is exact',()=>{
 let ed=boot().assoc(K('obj-index'),R.hashMap(0,ev(K('type'),'workspace/file',K('key'),'work:omega/plan.bl.org',K('goto'),ev(K('block'),'x'))));
 ed=M.d_handle(ed,key('Enter'));
 const fx=M.d_take_effects(ed).toArray()[1].toArray().find(e=>g(e,'kind')===K('visit'));
 assert.equal(g(g(fx,'goto'),'block'),'x');
 const raw=M.d_boot('hello').assoc(K('packages'),R.vec());assert.equal(R.printStr(P.d_unuse(P.d_use(raw,Q.d_bl_package),'places')),R.printStr(raw));
});
test('new work names its selected place so inherited cwd defaults can resolve',()=>{
 let ed=boot().assoc(K('doc'),ev(K('data'),ev(K('place'),'boards')));
 ed=Q.d_new_task(ed);ed=M.d_handle(ed,ev(K('type'),K('text'),K('text'),'work'));
 ed=M.d_handle(ed,key('Enter'));
 const fx=M.d_take_effects(ed).toArray()[1].toArray().find(e=>g(e,'intent')==='task/open');
 assert.equal(g(g(fx,'args'),'path'),'place:boards');
});
test('unuse cancels the package-owned prompt and preserves a foreign draft',()=>{
 const owned=Q.d_attach(boot());assert.equal(g(g(owned,'minibuf'),'package'),'places');
 assert.equal(g(P.d_unuse(owned,'places'),'minibuf'),null);
 const foreign=owned.assoc(K('minibuf'),ev(K('package'),'other',K('text'),'keep me'));
 assert.equal(g(g(P.d_unuse(foreign,'places'),'minibuf'),'text'),'keep me');
});
