import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RfbInput} from '../rfb.mjs';
function start(canInput){const p=new RfbInput(canInput);assert.equal(Buffer.concat(p.push(Buffer.concat([Buffer.from('RFB 003.008\n'),Buffer.from([1,1])]))).length,14);return p;}
test('RFB filters input on an existing connection when control changes',()=>{
 let human=true;const p=start(()=>human),key=Buffer.from([4,1,0,0,0,0,0,65]),pointer=Buffer.from([5,1,0,1,0,2]),request=Buffer.from([3,1,0,0,0,0,0,10,0,10]);
 assert.equal(p.push(key).length,1);human=false;assert.deepEqual(p.push(Buffer.concat([key,pointer,request])),[request]);human=true;assert.equal(p.push(pointer).length,1);
});
test('RFB handles fragmented messages and blocks clipboard writes in agent mode',()=>{
 const p=start(()=>false),clipboard=Buffer.from([6,0,0,0,0,0,0,3,65,66,67]);assert.deepEqual(p.push(clipboard.subarray(0,5)),[]);assert.deepEqual(p.push(clipboard.subarray(5)),[]);
 const encoding=Buffer.from([2,0,0,1,0,0,0,5]);assert.deepEqual(p.push(encoding.subarray(0,3)),[]);assert.deepEqual(p.push(encoding.subarray(3)),[encoding]);
});
test('RFB fails closed on oversized or unknown messages',()=>{
 assert.throws(()=>start(()=>true).push(Buffer.from([127])),/Unsupported/);
 assert.throws(()=>start(()=>true).push(Buffer.from([6,0,0,0,127,255,255,255])),/too large/);
});
