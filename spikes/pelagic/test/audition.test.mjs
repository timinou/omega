import {test} from 'node:test';import assert from 'node:assert/strict';import {imp} from './paths.mjs';
const [R,P,A]=await Promise.all(['rt','pelagic.performance','pelagic.audition'].map(imp));
const edit=space=>R.hashMap(R.kw('kind'),'configure',R.kw('values'),R.hashMap(R.kw('space'),R.flt(space)));
test('audition stages outside history and commits only against its exact unchanged base',()=>{
 const model=P.d_initial(),candidate=P.d_stage(model,R.vec(edit(.6))),staged=A.d_stage(model,candidate,'(av/configure {:space 0.6})');
 assert.equal(model.get(R.kw('revision')),0);assert.equal(model.get(R.kw('past')).cnt,0);assert.equal(model.get(R.kw('pending')),null);
 assert.equal(A.d_commit(staged,model),candidate);
 const newer=P.d_stage(model,R.vec(edit(.2)));
 assert.equal(A.d_current$Q(staged,newer),false);assert.throws(()=>A.d_commit(staged,newer));
 const changed=model.assoc(R.kw('current'),candidate.get(R.kw('pending')).get(R.kw('state')));
 assert.throws(()=>A.d_commit(staged,changed));
 const active=P.d_activate(candidate,candidate.get(R.kw('serial')));assert.throws(()=>A.d_commit(staged,active));
});
test('audition duration is bounded at both slow and fast tempos',()=>{
 assert.equal(Number(A.d_duration(30).v??A.d_duration(30)),8);
 assert.equal(Number(A.d_duration(1000).v??A.d_duration(1000)),.5);
});
