import {test} from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import {pathToFileURL} from 'node:url';
const root=path.resolve(process.env.BLED_OUT||'out/bl-ed');const N=await import(pathToFileURL(path.join(root,'ed.num.mjs')));
const numeric=x=>typeof x==='object'&&x!==null?Number(x.v??x):x;
test('portable decimal parsing keeps the numeric predicate callable',()=>{
 for(const [source,value] of [['0.38',.38],['-0.38',-.38],['12.5',12.5],['-12.5',-12.5],['.5',.5],['-.5',-.5],['0.0',0]])assert.equal(numeric(N.d_parse_decimal(source)),value,source);
 for(const source of ['abc','1.','1.-2','1.+2','1.2.3'])assert.equal(N.d_parse_decimal(source),null,source);
});
