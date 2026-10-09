import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {browserOperation} from '../kernel.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {executable} from './executable.mjs';
test('Kernel operation code runs in a real browser: stable refs, literal fill, snapshot and screenshot',async()=>{
 const browser=await chromium.launch({executablePath:await executable(),headless:true});
 try{
  const page=await browser.newPage();await page.setContent('<h1>Contract fixture</h1><label>Name <input name="name"></label><button onclick="document.querySelector(\'h1\').textContent=\'Clicked\'">Apply</button>');
  const run=args=>browserOperation(page,page.context(),args);
  const snapshot=await run(['snapshot']);assert.match(snapshot.snapshot,/\[ref=e1\]/);assert.match(snapshot.snapshot,/\[ref=e2\]/);
  const literal='literal $value `text` "quotes"';await run(['fill','@e1',literal]);assert.equal(await page.locator('input').inputValue(),literal);
  await run(['click','@e2']);assert.equal(await page.locator('h1').innerText(),'Clicked');
  const capture=await run(['capture']);assert.match(capture.snapshot,/Clicked/);assert.ok(Buffer.from(capture.png,'base64').length>100);
  await run(['snapshot']);assert.equal(await page.locator('button').getAttribute('data-omega-ref'),'e2');
 }finally{await browser.close();}
});
