import {test} from 'node:test';
import assert from 'node:assert/strict';
import {frameGeometry} from '../web/frame-geometry.mjs';
import {frameObservers} from '../web/frame-observers.mjs';
test('docked views span columns without occupying an editor column',()=>{
 const g=frameGeometry([{id:'toolbar',dock:'top',height:52},{id:'list',width:'32ch'},{id:'main',width:'minmax(0, 1fr)'},{id:'status',dock:'bottom',height:44}]);
 assert.equal(g.columns,'32ch minmax(0, 1fr)');assert.equal(g.rows,'52px minmax(0, 1fr) 44px');
 assert.deepEqual(g.placements.get('main'),{row:'2',column:'2'});assert.deepEqual(g.placements.get('status'),{row:'3',column:'1 / -1'});
 assert.equal(frameGeometry([{id:'main',width:'minmax(0, 1fr)'}]).rows,'minmax(0, 1fr)');
});
test('observation coalesces after painting; unsubscribe and listener failure are isolated',async()=>{
 const errors=[],seen=[],o=frameObservers(e=>errors.push(e.message));
 const stop=o.subscribe(x=>seen.push(x));o.subscribe(()=>{throw Error('listener failed')});
 o.notify(1);o.notify(2);assert.deepEqual(seen,[]);await Promise.resolve();assert.deepEqual(seen,[2]);
 stop();o.notify(3);await Promise.resolve();assert.deepEqual(seen,[2]);assert.equal(errors.length,2);
});
