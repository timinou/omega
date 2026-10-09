import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {BrowserPort} from '../port.mjs';
async function helper(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'omega-port-protocol-')),exe=path.join(root,'helper');
 await fs.writeFile(exe,`#!/usr/bin/env node
let buffer=Buffer.alloc(0);process.stdin.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);while(buffer.length>=4&&buffer.length>=4+buffer.readUInt32BE(0)){const n=buffer.readUInt32BE(0),v=JSON.parse(buffer.subarray(4,n+4));buffer=buffer.subarray(n+4);if(v.op==='hang')continue;const b=Buffer.from(JSON.stringify({id:v.id,ok:v.op!=='error',result:v.op,error:'rejected'})),h=Buffer.alloc(4);h.writeUInt32BE(b.length);process.stdout.write(h.subarray(0,2));process.stdout.write(Buffer.concat([h.subarray(2),b]));}});process.stdin.on('end',()=>process.exit(0));`,{mode:0o700});
 const p=new BrowserPort(exe);t.after(async()=>{await p.close();await fs.rm(root,{recursive:true,force:true});});return p;}
test('external process protocol serializes concurrent requests and preserves framing after errors',async t=>{const p=await helper(t);assert.deepEqual(await Promise.all([p.request({op:'one'}),p.request({op:'two'})]),['one','two']);await assert.rejects(p.request({op:'error'}),/rejected/);assert.equal(await p.request({op:'three'}),'three');});
test('a request timeout terminates the helper and refuses later operations',async t=>{const p=await helper(t);await assert.rejects(p.request({op:'hang'},50),/timed out/);await assert.rejects(p.request({op:'one'}),/timed out|exited/);await p.closed;assert.ok(p.child.exitCode!==null||p.child.signalCode);});
