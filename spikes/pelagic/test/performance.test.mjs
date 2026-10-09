import {hostImport} from './host-runtime.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {imp} from './paths.mjs';
const [R,P]=await Promise.all(['rt','pelagic.performance'].map(imp));
const {plain}=await hostImport('audio.mjs');
const bl=x=>Array.isArray(x)?R.vecFromArray(x.map(bl)):x&&typeof x==='object'?R.hashMap(...Object.entries(x).flatMap(([k,v])=>[R.kw(k),bl(v)])):x;
const stage=(m,...edits)=>P.d_stage(m,bl(edits));
const activate=m=>P.d_activate(m,m.get(R.kw('pending')).get(R.kw('id')));
test('revisions stage without changing active state; stale acknowledgements cannot activate',()=>{
 const m=P.d_initial(),a=stage(m,{kind:'configure',values:{space:.6}});
 assert.equal(plain(a).current.config.space,.38);
 assert.equal(plain(a).pending.state.config.space,.6);
 assert.equal(P.d_activate(a,0),a);
 const b=stage(a,{kind:'launch',name:'cathedral',options:{beats:8}}),c=activate(b);
 assert.equal(plain(c).current.config.space,.6);assert.equal(plain(c).current.visual.scene,'cathedral');
 assert.equal(plain(c).past.length,1);assert.equal(plain(c).revision,2);
});
test('undo redo and snapshot recall restore whole performance states with bounded history',()=>{
 let m=P.d_initial();m=P.d_snapshot(m,'home');
 for(let i=0;i<40;i++)m=activate(stage(m,{kind:'configure',values:{space:i/100}}));
 assert.equal(plain(m).past.length,32);
 m=activate(P.d_history(m,'undo'));assert.equal(plain(m).current.config.space,.38);
 m=activate(P.d_history(m,'redo'));assert.equal(plain(m).current.config.space,.39);
 m=activate(P.d_recall(m,'home'));assert.equal(plain(m).current.config.space,.38);
 assert.throws(()=>P.d_recall(m,'missing'));
});
test('quantized targets lie beyond the scheduling horizon and continuous score never ends',()=>{
 assert.equal(P.d_boundary(7.9,4,.4),12);assert.equal(P.d_boundary(8,4,.4),12);
 assert.equal(P.d_score_index(1024),256);assert.equal(P.d_score_index(1000000),320);
 for(let i=1024;i<20000;i++)assert.ok(P.d_score_index(i)>=256&&P.d_score_index(i)<768);
});
test('macro gestures mute the rhythm and restore a drop as one revision',()=>{
 let m=activate(stage(P.d_initial(),{kind:'gesture',name:'break'}));
 assert.equal(plain(m).current.config.kick,false);
 m=activate(stage(m,{kind:'gesture',name:'drop'}));
 assert.equal(plain(m).current.config.kick,true);assert.equal(plain(m).current.visual.intensity,1.35);
});

test('stopping a lane suppresses its default score and snapshots keep asset references',()=>{
 let m=P.d_initial();
 const state={...plain(m).current,assets:{a:{deck:'a',hash:'a'.repeat(64),bpm:122,cue:0,loopBeats:8}}};
 m=m.assoc(R.kw('current'),bl(state));m=P.d_snapshot(m,'with-audio');
 m=activate(stage(m,{kind:'pattern-stop',stem:'melody'}));
 assert.deepEqual(plain(m).current.patterns.melody.plan.bundles,[]);
 assert.ok(plain(m).current.patterns.melody);
 m=activate(P.d_recall(m,'with-audio'));assert.equal(plain(m).current.assets.a.hash,'a'.repeat(64));
});
