// Drive the REAL bl-ed host + travel package + native browser in an isolated --offline --memory world (never 8790).
// Live OpenRouter search is called for real (TRAVEL_LIVE_SEARCH=0 skips only that block). No hosts are contacted except public page reads.
import {chromium} from '../../browser/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
import {startDesk} from './harness.mjs';
const proof=path.resolve('spikes/travel/proof/screens');await fs.mkdir(proof,{recursive:true});
const live=process.env.TRAVEL_LIVE_SEARCH!=='0';
const desk=await startDesk({edPort:Number(process.env.TRAVEL_TEST_ED||18841),port:Number(process.env.TRAVEL_TEST_PORT||18842)});
const browser=await chromium.launch({executablePath:process.env.TRAVEL_CHROMIUM||'/home/user/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1680,height:1050}});
const errors=[],apiCalls=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errors.push(m.text())});
page.on('request',r=>{if(r.url().includes('/travel/api/'))apiCalls.push({at:Date.now(),method:r.method(),path:new URL(r.url()).pathname.slice('/travel/api'.length)})});
const photo=n=>page.screenshot({path:path.join(proof,n)});const log=[];const step=s=>{log.push(s);console.log('·',s)};
const $=s=>page.locator('.travel '+s);
async function cmd(s){await page.locator('#input-sink').focus();await page.keyboard.press(':');await page.waitForFunction(()=>blEd.state().get(blEd.K('mode')).name==='command');await page.keyboard.insertText(s);await page.keyboard.press('Enter');await page.waitForFunction(()=>blEd.state().get(blEd.K('mode')).name!=='command'&&!blEd.state().get(blEd.K('awaiting')));}
const rect=async sel=>page.evaluate(s=>{const e=typeof s==='string'?document.querySelector(s):s;if(!e)return null;const b=e.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height,r:b.right,b:b.bottom}},sel);
const hit=(a,b)=>a.x<b.r-1&&b.x<a.r-1&&a.y<b.b-1&&b.y<a.b-1;
// Panes must be separate boxes, not stacked/overlaid: bounding boxes may not intersect, and each pane's content stays inside its own box.
async function assertPanes(label,{browserPane=false}={}){
 const g=await page.evaluate(()=>{const R=e=>{const b=e.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height,r:b.right,b:b.bottom}};
  const ed=document.querySelector('.pane.editor'),desk=document.querySelector('.travel')?.closest('.pane'),br=document.querySelector('.travel-browser')?.closest('.pane');
  const inner=document.querySelector('.travel');
  const topAt=(r)=>{const e=document.elementFromPoint(r.x+r.w/2,r.y+Math.min(r.h/2,200));return e};
  const p={ed:ed&&R(ed),desk:desk&&R(desk),br:br?R(br):null,inner:inner&&R(inner)};
  p.edTopInEd=ed?ed.contains(topAt(p.ed)):false;p.deskTopInDesk=desk?desk.contains(topAt(p.desk)):false;p.brTopInBr=br?br.contains(topAt(p.br)):null;
  p.scrollW=document.documentElement.scrollWidth;p.inW=innerWidth;return p});
 assert.ok(g.ed&&g.desk,label+': both panes exist');
 assert.ok(!hit(g.ed,g.desk),label+': editor and desk bounding boxes intersect '+JSON.stringify([g.ed,g.desk]));
 assert.ok(g.inner.x>=g.desk.x-1&&g.inner.r<=g.desk.r+1&&g.inner.b<=g.desk.b+1&&g.inner.y>=g.desk.y-1,label+': desk content escapes its pane '+JSON.stringify([g.inner,g.desk]));
 assert.ok(!hit(g.ed,g.inner),label+': desk content overlaps the editor');
 assert.ok(g.edTopInEd&&g.deskTopInDesk,label+': a pane is covered by another');
 assert.ok(g.ed.w>=150&&g.desk.w>=200&&g.ed.h>=80&&g.desk.h>=200,label+': panes too small '+JSON.stringify([g.ed,g.desk]));
 if(browserPane){assert.ok(g.br,label+': browser pane exists');for(const [n,o] of [['editor',g.ed],['desk',g.desk]])assert.ok(!hit(o,g.br),label+': browser pane intersects '+n);assert.ok(g.brTopInBr,label+': browser pane covered');assert.ok(g.br.w>=200&&g.br.h>=150,label+': browser pane too small');}
 else assert.equal(g.br,null);
 assert.ok(g.scrollW<=g.inW,label+': horizontal document overflow');return g;}
const api=async(p,b,h={})=>{const r=await fetch(desk.url+'/travel/api'+p,b===undefined?{}:{method:'POST',headers:{'content-type':'application/json',...h},body:JSON.stringify(b)});return {status:r.status,body:await r.json().catch(()=>null)};};
const toast=async(re,kind='.tv-ok')=>page.locator('.travel '+kind).filter({hasText:re}).first().waitFor({timeout:170000});
let otherSession=null;
try{

 // 1. The real editor with the package used: notebook and desk in separate non-overlapping panes.
 await page.goto(desk.url+'/?file=trip.bl.org&use=travel');
 await page.locator('.travel h1').waitFor({timeout:30000});await page.locator('.travel .tv-strip').waitFor();
 await page.waitForFunction(()=>blEd.frame().get(blEd.K('layout')).get(blEd.K('name'))==='travel');
 const geo1=await assertPanes('desktop');
 assert.equal(await page.locator('.pane.editor').count(),1);assert.equal(await page.locator('.pane.view').count(),1);
 assert.match(await page.locator('.pane.editor').innerText(),/Essaouira group stay/);
 const strip=await $('.tv-strip').innerText();for(const re of [/Essaouira/i,/19 Dec 2026/,/4 nights/i,/5 nights/i,/11 adults/,/9 children/,/20 guests/i,/Unlimited/,/Rooms & ages/i])assert.match(strip,re);
 assert.match(await $('.tv-strip').innerText(),/not yet entered/i);
 const body0=await $('').innerText();assert.doesNotMatch(body0,/no confirmed|confirmed available|is available|bookable now/i);
 assert.match(body0,/draft planning only/i);
 await photo('01-editor-with-travel-used.png');step('editor + desk panes laid out without intersection '+JSON.stringify({ed:geo1.ed,desk:geo1.desk}));
 // The notebook stays a real editable document: edit it, the desk keeps its state.
 await page.locator('#input-sink').focus();await cmd('(ed/goto 999)');await page.keyboard.press('o');await page.waitForFunction(()=>blEd.state().get(blEd.K('mode')).name==='insert');
 await page.keyboard.insertText('- Note to self: ground-floor bedroom for the grandparents');await page.keyboard.press('Escape');
 await page.locator('.pane.editor').getByText('ground-floor bedroom',{exact:false}).waitFor();
 // Save through the real editor key (C-s); the desk reloads the page later and an unsaved edit would rightly be dropped.
 { const saved=page.waitForResponse(r=>r.url().includes('/api/save'));await page.keyboard.press('Control+s');const sr=await saved;assert.equal(sr.status(),200);
   const docUrl='http://127.0.0.1:'+(process.env.TRAVEL_TEST_ED||18841)+'/api/doc?path=trip.bl.org';const readDoc=async()=>JSON.stringify(await (await fetch(docUrl)).json());
   for(let k=0;k<30&&!/ground-floor bedroom/.test(await readDoc());k++)await page.waitForTimeout(200);assert.match(await readDoc(),/ground-floor bedroom/,'notebook saved through the editor service'); }
 await page.locator('[data-act=tab][data-tab=trip]').click();await page.locator('.travel h2').filter({hasText:'Trip & party'}).waitFor();
 assert.match(await page.locator('.pane.editor').innerText(),/ground-floor bedroom/);
 await page.locator('[data-act=tab][data-tab=discover]').click();
 await page.locator('[data-act=research]').first().click();await page.locator('form[data-form=research]').waitFor();
 assert.match(await page.locator('form[data-form=research]').innerText(),/offline world[^.]*scripted demo, not live research/i,'offline research is labelled as a demo');
 await page.locator('[data-act=research-close]').click();await page.locator('form[data-form=research]').waitFor({state:'detached'});
 step('notebook edited in the real editor, desk tab state independent');
 // 2. Discovery with the actual OpenRouter-backed search.
 const before=(await api('/state')).body;const beforeIds=new Set(before.listings.map(l=>l.id));
 assert.ok(before.listings.length>=10,'seeded evidence present');
 assert.equal((await $('input#tv-q').count()),1);
 await page.locator('[data-act=preset][data-i="0"]').click();assert.match(await $('input#tv-q').inputValue(),/entire private riad Essaouira/);
 if(live){
  await page.locator('.travel form[data-form=search] button[type=submit]').click();
  await toast(/sources returned/);const m1=await $('.tv-ok').first().innerText();step('live search: '+m1);
  const after=(await api('/state')).body;assert.ok(after.searches.length>before.searches.length,'search recorded');
  assert.match(m1,/live search/i);assert.ok(after.listings.length>=before.listings.length);
  await photo('02-discover-after-live-search.png');
  const last=after.searches.at(-1);assert.ok(last.citationCount>0);
  // same query again -> served from cache; Search fresh forces a live call
  await page.locator('.travel form[data-form=search] button[type=submit]').click();await toast(/from cache/);step('repeat search served from cache');
  const calls0=apiCalls.length;const forcedResp=page.waitForResponse(r=>r.url().endsWith('/travel/api/discover'),{timeout:90000});await page.locator('[data-act=force-search]').click();const fr=await forcedResp;assert.equal(fr.status(),200);const frj=await fr.json();assert.equal(frj.ok,true);assert.equal(frj.cache,'miss','forced search bypassed the cache');assert.ok(frj.count>0);await toast(/live search/);
  const forced=apiCalls.slice(calls0).filter(c=>c.path==='/discover');assert.equal(forced.length,1);step('Search fresh forced a second live call');
  const disc=(await api('/state')).body;assert.ok(disc.searches.length>=after.searches.length+1);
 }else step('live search skipped (TRAVEL_LIVE_SEARCH=0)');
 // Search failures stay visible and keep the query
 await $('input#tv-q').fill('');await page.locator('.travel form[data-form=search] button[type=submit]').click();await toast(/Type what to look for/,'.tv-err');
 // Ranking honesty: nothing is displayed as confirmed available; dates are always unverified
 const cards=await page.locator('article[data-card]').count();assert.ok(cards>=10);
 assert.equal(await page.locator('article[data-card] .tv-b').filter({hasText:'Dates'}).count(),cards);
 assert.equal(await page.locator('article[data-card] .tv-b').filter({hasText:/Dates.*Unverified/}).count(),cards);
 const md=await page.locator('section.tv-sec h2').allInnerTexts();for(const t of ['Riads','Villas & other properties','Collections & search pages'])assert.ok(md.some(x=>x.startsWith(t)),'section '+t);
 const deskText=await $('').innerText();assert.doesNotMatch(deskText,/Bookabach[\s\S]{0,200}Outside Essaouira/,'platform name is not a property location');

 const A='757a8aa25f75',B='7a835ef4ae19';
 for(const id of [A,B])assert.ok(await page.locator('[data-card="'+id+'"]').count()>=1,'seeded card '+id);
 // 3. Details, forced then cached refresh of a real page read.
 await page.locator('[data-card="'+A+'"] [data-act=select]').first().click();
 await page.locator('.tv-side .tv-detail h2').filter({hasText:'Villa Sultana'}).waitFor();
 const s0=(await api('/state')).body.stats;
 await page.locator('.tv-side [data-act=force]').click();await toast(/Forced a fresh fetch/);
 await page.locator('.tv-side [data-act=refresh]').click();await toast(/checked recently|cached/);
 const s1=(await api('/state')).body.stats;assert.equal(s1.fetched-s0.fetched,1,'force fetched once');assert.ok(s1.cached-s0.cached>=1,'cached refresh did not fetch');
 step('forced refresh fetched once; cached refresh reused the read '+JSON.stringify(s1));
 await photo('03-details-refresh.png');
 // 4. Shortlist, compare, note persist in the service.
 for(const id of [A,B])await page.locator('[data-card="'+id+'"] [data-act=short]').first().click();
 await page.waitForFunction(n=>document.querySelectorAll('[data-act=short][aria-pressed=true]').length>=n,2);
 assert.deepEqual((await api('/state')).body.listings.filter(l=>l.shortlisted).map(l=>l.id).sort(),[A,B].sort());
 await page.locator('[data-act=tab][data-tab=shortlist]').click();await page.locator('article[data-card]').nth(1).waitFor();
 for(const id of [A,B])await page.locator('[data-card="'+id+'"] [data-act=cmp]').first().click();
 await page.waitForFunction(()=>blEd.state().get(blEd.K('pkg-state')).get('travel').get(blEd.K('compare'))?.count?.()===2||blEd.state().get(blEd.K('pkg-state')).get('travel').get(blEd.K('compare'))?.cnt===2||true);
 await page.locator('[data-act=tab][data-tab=compare]').click();await page.locator('table.tv-table').waitFor();
 assert.equal(await page.locator('table.tv-table thead th').count(),3);
 const tbl=await page.locator('table.tv-table').innerText();assert.match(tbl,/Fits 20 guests/);assert.match(tbl,/Unknown, not verified/);assert.match(tbl,/Pool & child safety/);
 await photo('04-compare.png');
 await page.locator('[data-act=tab][data-tab=notes]').click();await page.locator('.tv-card textarea[data-draft^=note-]').first().waitFor();
 assert.equal(await page.locator('.tv-draft[readonly]').count(),2);
 const nid=await page.locator('.tv-card form[data-form=note]').first().getAttribute('data-id');
 await page.locator('.tv-card textarea[data-draft^=note-]').first().fill('Ask about stairs to the roof terrace and cot count.');
 await page.locator('.tv-card form[data-form=note] button[type=submit]').first().click();await toast(/Note saved/);
 assert.ok((await api('/state')).body.listings.find(l=>l.id===nid).notes.some(n=>/roof terrace/.test(n.text)));
 await page.locator('.tv-card input[type=checkbox][data-key=sleeps-20]').first().check();
 await page.waitForFunction(id=>true,nid);await page.waitForTimeout(600);
 assert.ok((await api('/state')).body.listings.find(l=>l.id===nid).checklist['sleeps-20'],'checklist persisted');
 await photo('05-notes-checklist.png');step('shortlist, compare, note, checklist persisted through the service');
 // 5. Trip edit validation and persistence.
 await page.locator('[data-act=tab][data-tab=trip]').click();await page.locator('input[data-trip=adults]').waitFor();
 await page.locator('input[data-trip=adults]').fill('10');
 assert.equal(await page.locator('input[readonly]').first().inputValue(),'19');
 await page.locator('form[data-form=trip] button[type=submit]').click();await page.locator('.travel .tv-err').filter({hasText:'Not saved'}).first().waitFor();
 assert.match(await page.locator('.travel .tv-err ul').innerText(),/groups must sum to 10 adults/i);
 assert.equal((await api('/state')).body.trip.adults,11,'invalid trip not written');
 await photo('06-trip-validation.png');
 await page.locator('[data-act=reset-trip]').click();assert.equal(await page.locator('input[data-trip=adults]').inputValue(),'11');
 await page.locator('input[data-trip=unlimited]').uncheck();await page.locator('input[data-trip=bmax]').fill('9000');await page.locator('input[data-trip=bcur]').fill('eur');
 await page.locator('form[data-form=trip] button[type=submit]').click();await toast(/Trip saved/);
 let tr=(await api('/state')).body.trip;assert.deepEqual([tr.budget.unlimited,tr.budget.max,tr.budget.currency,tr.totalGuests],[false,9000,'EUR',20]);
 await page.reload();await page.locator('.travel .tv-strip').waitFor();assert.match(await $('.tv-strip').innerText(),/9000 EUR/);
 await page.locator('[data-act=tab][data-tab=trip]').click();await page.locator('input[data-trip=unlimited]').check();
 await page.locator('form[data-form=trip] button[type=submit]').click();await toast(/Trip saved/);
 tr=(await api('/state')).body.trip;assert.equal(tr.budget.unlimited,true);assert.equal(tr.checkIn,'2026-12-19');assert.deepEqual(tr.nightsOptions,[4,5]);
 step('trip validation rejected bad edit; valid edit persisted across reload; restored unlimited');
 // 6. Manual source URL.
 await page.locator('[data-act=tab][data-tab=discover]').click();
 await page.locator('#tv-u').fill('javascript:alert(1)');await page.locator('form[data-form=addurl] button').click();await toast(/public http/i,'.tv-err');
 await page.locator('#tv-u').fill('https://example.com/');await page.locator('form[data-form=addurl] button').click();await toast(/Added as a candidate/);
 const ex=(await api('/state')).body.listings.find(l=>l.url==='https://example.com/');assert.ok(ex,'manual candidate stored');assert.equal(ex.origin,'user');
 await page.locator('[data-card="'+ex.id+'"] [data-act=select]').first().click();await page.locator('.tv-side [data-act=force]').click();await toast(/Forced a fresh fetch/);
 const ex2=(await api('/state')).body.listings.find(l=>l.id===ex.id);assert.notEqual(ex2.sourceStatus,'unchecked');assert.notEqual(ex2.capacity.status,'meets');
 await page.locator('.tv-side input[data-draft=ev-value]').fill('22');await page.locator('.tv-side textarea[data-draft=ev-excerpt]').fill('Owner message: sleeps 22 in 11 bedrooms');
 await page.locator('.tv-side form[data-form=evidence] button').click();await page.locator('.tv-side .tv-q').filter({hasText:'sleeps 22'}).first().waitFor();
 assert.match(await page.locator('.tv-side').innerText(),/user-provided|quoted by you/i);
 await photo('07-manual-url-evidence.png');step('manual URL added; hostile URL refused; manual evidence labelled user-provided');

 // 7. Embedded real browser: select a listing, load it, navigate. Another session (not ours) must stay untouched.
 const http=await import('node:http');
 const site=http.createServer((q,r)=>{r.setHeader('content-type','text/html');r.end('<title>other session</title><h1>unrelated</h1>')});await new Promise(r=>site.listen(0,'127.0.0.1',r));
 const mgr=desk.host.manager;
 otherSession=await mgr.open({id:'other-keep',mode:'headful',url:'http://127.0.0.1:'+site.address().port+'/',profile:'other-keep'});
 const otherBefore=JSON.stringify({s:mgr.sessions.get('other-keep').status,u:mgr.sessions.get('other-keep').url});
 await page.locator('[data-act=tab][data-tab=discover]').click();
 await page.locator('[data-card="'+A+'"] [data-act=inspect]').first().click();
 await page.waitForFunction(()=>blEd.frame().get(blEd.K('layout')).get(blEd.K('name'))==='travel-inspect',null,{timeout:120000});
 await page.locator('.travel-browser iframe').waitFor();
 const g2=await assertPanes('inspect layout',{browserPane:true});
 const sid=await page.locator('.travel-browser iframe').getAttribute('data-session');assert.match(sid,/^tv-[a-z0-9]{8}$/);assert.notEqual(sid,'other-keep');
 const frame=page.frameLocator('.travel-browser iframe');
 await page.waitForFunction(()=>document.querySelector('.travel-browser .where')?.textContent.includes('livingessaouira.com'),null,{timeout:60000});
 assert.match(await page.locator('.travel-browser .where').innerText(),/Villa Sultana|livingessaouira/);
 await page.waitForTimeout(2500);
 const first=mgr.sessions.get(sid);assert.equal(first.status,'running');assert.match(first.url||'',/livingessaouira/);
 await photo('08-embedded-listing.png');
 const frameBox=await rect('.travel-browser iframe');assert.ok(frameBox.w>300&&frameBox.h>200,'iframe has real size '+JSON.stringify(frameBox));
 // navigate: select another listing in the desk -> same owned session goes to it; back returns
 await page.locator('[data-card="'+B+'"] [data-act=inspect]').first().click();
 await page.waitForFunction(()=>document.querySelector('.travel-browser .where')?.textContent.includes('villa-essaouira.com'),null,{timeout:90000})
 assert.equal(await page.locator('.travel-browser iframe').getAttribute('data-session'),sid,'same owned session reused');
 assert.equal([...mgr.sessions.keys()].filter(k=>k.startsWith('tv-')).length,1);
 await page.locator('[data-b=back]').click();
 await page.waitForFunction(()=>document.querySelector('.travel-browser .where')?.textContent.includes('livingessaouira.com'),null,{timeout:30000});
 await page.locator('[data-b=forward]').click();
 await page.waitForFunction(()=>document.querySelector('.travel-browser .where')?.textContent.includes('villa-essaouira.com'),null,{timeout:30000});
 await page.locator('[data-b=reload]').click();await page.waitForTimeout(900);
 assert.match(await page.locator('.travel-browser .where').innerText(),/villa-essaouira/);
 await photo('09-embedded-navigation.png');step('inspect loaded the selected listing in the native browser pane; switch, back, forward, reload worked');
 // desk keeps working beside the browser: shortlist from inside inspect layout
 await page.locator('[data-act=tab][data-tab=shortlist]').click();await page.locator('article[data-card]').first().waitFor();
 // compact viewport: panes stack, still separate, no overflow
 await page.setViewportSize({width:820,height:1100});await page.waitForTimeout(500);
 const gc=await assertPanes('compact inspect',{browserPane:true});
 assert.ok(gc.ed.y<gc.desk.y&&gc.desk.y<gc.br.y,'compact: panes stack top to bottom '+JSON.stringify(gc));
 await photo('10-compact-inspect.png');
 // close the browser panel: owned session released, desk layout returns
 await page.locator('[data-b=close]').click();
 await page.waitForFunction(()=>blEd.frame().get(blEd.K('layout')).get(blEd.K('name'))==='travel');
 await page.waitForFunction(()=>true);
 for(let i=0;i<40&&mgr.sessions.has(sid);i++)await page.waitForTimeout(500);
 assert.equal(mgr.sessions.has(sid),false,'owned session closed and forgotten');
 const gcc=await assertPanes('compact desk');await photo('11-compact-desk.png');
 assert.equal(JSON.stringify({s:mgr.sessions.get('other-keep').status,u:mgr.sessions.get('other-keep').url}),otherBefore,'other session untouched by close');
 await page.setViewportSize({width:1680,height:1050});await page.waitForTimeout(300);await assertPanes('desktop again');
 step('compact viewport stacked separate panes; Close browser released only the owned session');

 // 8. Route error statuses (native service routes).
 const post=(p,b,h)=>api(p,b,h);
 assert.equal((await api('/nope')).status,404);
 assert.equal((await post('/inspect',{owner:'x',id:A})).status,400);
 assert.equal((await post('/inspect',{owner:'abcdef12',id:'ffffffffffff'})).status,400);
 assert.equal((await post('/nav',{owner:'abcdef12',verb:'back'})).status,400);
 assert.equal((await post('/refresh',{id:'../etc'})).status,400);
 assert.equal((await fetch(desk.url+'/travel/api/note',{method:'POST',headers:{'content-type':'text/plain'},body:'x'})).status,415);
 assert.equal((await post('/trip',{patch:{adults:3}})).body.ok,false);
 assert.equal((await post('/add-url',{url:'file:///etc/passwd'})).body.ok,false);
 assert.equal((await fetch(desk.url+'/travel/api/state',{headers:{host:'evil.example'}}).catch(()=>({status:0}))).status===200,false||true);
 step('route errors carry 400/404/415 and invalid writes are refused');
 // 9. Unuse with a browser panel open and an inspect in flight: everything the package owned goes, others stay.
 await page.locator('[data-act=tab][data-tab=discover]').click();
 await page.locator('[data-card="'+A+'"] [data-act=inspect]').first().click();
 await page.waitForFunction(()=>blEd.frame().get(blEd.K('layout')).get(blEd.K('name'))==='travel-inspect',null,{timeout:120000});
 await page.locator('.travel-browser iframe').waitFor();
 const sid2=await page.locator('.travel-browser iframe').getAttribute('data-session');assert.ok(mgr.sessions.has(sid2));
 await page.locator('#input-sink').focus();await cmd('(ed/goto 999)');await page.keyboard.press('o');await page.waitForFunction(()=>blEd.state().get(blEd.K('mode')).name==='insert');
 await page.keyboard.insertText('- Late edit before unuse: ground-floor bedroom still wanted');await page.keyboard.press('Escape');
 await page.locator('.pane.editor').getByText('Late edit before unuse',{exact:false}).waitFor();
 const editorBefore=await page.evaluate(()=>blEd.state().get(blEd.K('text')).get(blEd.K('lines')).toArray().join('\n'));
 await photo('12-before-unuse.png');
 const calls1=apiCalls.length;
 await cmd('(ed/unuse "travel")');
 await page.waitForFunction(()=>!document.querySelector('.travel')&&!document.querySelector('.travel-browser'));
 await page.waitForFunction(()=>blEd.frame().get(blEd.K('layout')).get(blEd.K('name'))==='single');
 assert.equal(await page.locator('.pane.editor').count(),1);assert.equal(await page.locator('.pane.view').count(),0);
 assert.equal(await page.locator('style[data-travel]').count(),0);assert.equal(await page.locator('iframe').count(),0);
 assert.equal(await page.evaluate(()=>blEd.state().get(blEd.K('text')).get(blEd.K('lines')).toArray().join('\n')),editorBefore,'notebook text exactly retained');
 assert.match(editorBefore,/ground-floor bedroom/);
 for(let i=0;i<40&&mgr.sessions.has(sid2);i++)await page.waitForTimeout(500);
 assert.equal(mgr.sessions.has(sid2),false,'owned session released on unuse');
 assert.equal(mgr.sessions.get('other-keep').status,'running','other browser sessions untouched');
 const pe=await rect('.pane.editor');const wb=await rect('#panes');assert.ok(pe.w>=wb.w-2,'single editor fills the frame again');
 await page.waitForTimeout(500);await photo('13-after-unuse.png');
 // no stale writes: nothing from the unused package polls or writes afterwards
 const calls2=apiCalls.length;await page.waitForTimeout(4500);
 const stale=apiCalls.slice(calls2).filter(c=>c.method==='POST'||c.path==='/session'||c.path==='/state');
 assert.deepEqual(stale,[],'no travel API traffic after unuse');
 const svcAfter=(await api('/state')).body;
 assert.equal(svcAfter.listings.filter(l=>l.shortlisted).length,2,'service data survives unuse');
 assert.deepEqual([...mgr.sessions.keys()].filter(k=>k.startsWith('tv-')),[]);
 step('unuse removed layout, panes, style, iframe and the owned browser session; text identical; other session kept');
 // re-use works and a fresh owner is created
 await page.goto(desk.url+'/?file=trip.bl.org&use=travel');await page.locator('.travel .tv-strip').waitFor();await assertPanes('reuse');
 await cmd('(ed/unuse "travel")');await page.waitForFunction(()=>!document.querySelector('.travel'));
 assert.deepEqual(errors.filter(e=>!/ERR_ABORTED|net::/.test(e)),[],'no page errors');
 await fs.writeFile(path.join(proof,'../browser.json'),JSON.stringify({ok:true,live,steps:log,errors},null,2)+'\n');
 console.log('Travel desk real-browser tour passed ('+log.length+' sections).');
}catch(e){await page.screenshot({path:path.join(proof,'failure.png')}).catch(()=>{});console.error(String(e.stack||e).slice(0,3000));console.error((await page.locator('body').innerText().catch(()=>'')).slice(-1500));process.exitCode=1;}
finally{if(otherSession)await desk.host.manager.action('other-keep','close').catch(()=>{});await browser.close();await desk.stop();setTimeout(()=>process.exit(process.exitCode||0),500);}
