import {test} from 'node:test';
import assert from 'node:assert/strict';
import {documentPackages} from '../web/document-packages.mjs';
test('file-local package declaration accepts installed names, orders dependencies and excludes executable/remote references',()=>{
 assert.deepEqual(documentPackages('#+USE: present,browser,procurement\n#+USE: browser https://bad/pkg.mjs ../escape (eval)'),['present','browser','procurement']);
 assert.deepEqual(documentPackages('\n'.repeat(12)+'#+USE: late'),[]);
});
test('explicit unload is respected across refreshes until explicitly used again',()=>{
 assert.deepEqual(documentPackages('#+USE: present,browser,procurement',{loaded:new Set(['present']),suppressed:new Set(['procurement'])}),['browser']);
});
