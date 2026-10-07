// Run against the offline world only: IMAGE_URL=http://127.0.0.1:8792.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const base=process.env.IMAGE_URL || 'http://127.0.0.1:8792';
const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=','base64');
const name=createHash('sha256').update(bytes).digest('hex')+'.png';
const post=body=>fetch(base+'/api/assets',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
test('content-addressed images survive repeated uploads and read back byte-for-byte',async()=>{
 for(let i=0;i<2;i++)assert.equal((await post({name,data:bytes.toString('base64')})).status,200);
 const r=await fetch(base+'/api/assets/'+name);
 assert.equal(r.status,200);assert.equal(r.headers.get('content-type').split(';')[0],'image/png');
 assert.deepEqual(Buffer.from(await r.arrayBuffer()),bytes);
});
test('reject invalid paths, unsupported suffixes, malformed base64, and digest mismatch',async()=>{
 for(const body of [{name:'../escape.png',data:'abc'},{name:name.replace('.png','.svg'),data:bytes.toString('base64')},{name,data:'???'},{name:'0'.repeat(64)+'.png',data:bytes.toString('base64')}])
  assert.equal((await post(body)).status,400);
 assert.equal((await fetch(base+'/api/assets/'+'f'.repeat(64)+'.png')).status,404);
});
