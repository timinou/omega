import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {imp} from './paths.mjs';
test('prepared instrument plans preserve parameter semantics and immutable defaults',{skip:!process.env.PELAGIC_OUT},async()=>{
 const [R,O,B]=await Promise.all(['rt','pelagic.overtone','pelagic.browser'].map(imp));
 const defaults=R.vec(R.vec(R.kw('freq'),440),R.vec(R.kw('amp'),R.flt(.5)));
 const plan=O.d_parameter_plan(defaults),names=plan.nth(0),initial=plan.nth(1);
 for(const args of [R.vec(),R.vec(220),R.vec(220,R.kw('amp'),R.flt(.2)),R.vec(R.kw('amp'),R.flt(.2),R.kw('amp'),R.flt(.3))]){
  assert.deepEqual(B.d_to_js(O.d_parameter_map(defaults,args)),B.d_to_js(O.d_parameter_map(names,initial,args)));
 }
 assert.deepEqual(B.d_to_js(initial),{freq:440,amp:.5});
 for(const args of [R.vec(1,2,3),R.vec(R.kw('nope'),1),R.vec(R.kw('amp'))])assert.throws(()=>O.d_parameter_map(names,initial,args));
});
test('bounded score slices reproduce the complete score byte for byte',{skip:!process.env.PELAGIC_OUT},async()=>{
 const B=await imp('pelagic.browser');
 for(const budget of [0,.000001,4]){
  const rows=[];while(rows.length<1024){const chunk=B.d_score_slice(rows.length,Math.min(16,1024-rows.length),budget);assert.ok(chunk.length>=1&&chunk.length<=16);rows.push(...chunk);}
  assert.equal(createHash('sha256').update(JSON.stringify(rows)).digest('hex'),'11d812d7eff77acc25e66e80215b366f4dc2bf5daf7b80b8e5524e94b0080b9a');
 }
});
