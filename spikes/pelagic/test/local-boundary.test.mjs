import {test} from 'node:test';
import assert from 'node:assert/strict';
import {imp} from './paths.mjs';
test('local compiled BL boundary converts data and preserves numeric results', {skip:!process.env.PELAGIC_OUT}, async()=>{
 const [R,B,Bridge,J,Hash]=await Promise.all(['rt','pelagic.browser','pelagic.bridge','interop','ed.hash'].map(imp));
 for(const text of ['', 'hello', 'é', '💧', 'A💧é'])assert.equal(Hash.d_string_hash(text),R.strHash(text));
 const browser=J.requireNamespace('pelagic.browser');
 assert.equal(browser['to-js'](R.flt(.125)),.125);
 assert.deepEqual(browser['to-js'](R.hashMap(R.kw('notes'),R.vec(60,64))),{notes:[60,64]});
 assert.equal(B.d_to_bl({space:.45}).get(R.kw('space')).v,.45);
 assert.equal(typeof Bridge.d_live_bindings.get('av').get('pattern-stop'),'function');
 assert.throws(()=>browser['to-js'](R.dec(15,1)),/decimal/);
 assert.equal(await browser['read-text']('data:text/plain,local'),'local');
 const fetch=globalThis.fetch;
 try { globalThis.fetch=async()=>new Response('missing',{status:404});
   await assert.rejects(browser['read-text']('missing.glsl'),/Cannot load/);
 } finally {globalThis.fetch=fetch;}
 const prior=globalThis.AudioContext;
 try {globalThis.AudioContext=class {constructor(options){this.options=options;}};
   assert.deepEqual(browser['audio-context']().options,{latencyHint:'interactive'});
 } finally {if(prior)globalThis.AudioContext=prior;else delete globalThis.AudioContext;}
 const node={textContent:'old'};B.d_set_text(node,'new');assert.equal(node.textContent,'new');
});
