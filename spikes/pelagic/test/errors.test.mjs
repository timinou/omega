import {test} from 'node:test';
import assert from 'node:assert/strict';
import {imp} from './paths.mjs';
const R=await imp('rt');
import {errorText} from '../host/errors.mjs';
test('structured reader diagnostics retain their useful message and location',()=>{
 const diagnostic=R.hashMap(R.kw('msg'),'collection never closed',R.kw('line'),3,R.kw('kind'),R.kw('unterminated-collection'));
 assert.equal(errorText(diagnostic),'collection never closed (source line 3)');
 assert.equal(errorText(new Error('Invalid shader')),'Invalid shader');
 assert.equal(errorText('Snapshot limit reached'),'Snapshot limit reached');
});
