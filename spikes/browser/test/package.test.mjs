import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const out=path.join(root,'vendor/bl-ed/web/out');
const imp=n=>import(pathToFileURL(path.join(out,n+'.mjs')));
const {start}=await imp('repl');
const repl=await start(f=>fs.readFileSync(path.join(out,'src',f),'utf8'));
Object.assign(globalThis.BL_HOST || (globalThis.BL_HOST={}),{'eval-ed':(src,api)=>repl.evalWith(src,'ed',api),'eval-cells':cells=>repl.evalCells(cells)});
const [M,R,P,F,G]=await Promise.all(['ed.main','rt','br.main','ed.frame','ed.pkg'].map(imp));
const K=R.kw,ev=(...a)=>R.hashMap(...a),get=(m,k)=>m?.get(K(k),null);
const key=k=>ev(K('type'),K('key'),K('key'),k);
const use=ed=>M.d_handle(ed,ev(K('type'),K('use'),K('package'),P.d_bl_package));
function awaitText(ed){return get(get(ed,'text'),'lines').toArray().join('\n');}
const text=fs.readFileSync(new URL('../demo.bl.org',import.meta.url),'utf8');
function at(ed,row){return ed.assoc(K('sels'),R.vec(R.hashMap(K('anchor'),R.vec(row,0),K('head'),R.vec(row,0))));}
test('browser task C-Enter emits a host intent, ordinary tasks pass through',()=>{
 let ed=use(at(M.d_boot(text,'demo.bl.org'),4));
 ed=M.d_handle(ed,key('C-Enter'));
 const [,fx]=M.d_take_effects(ed).toArray();
 const intent=fx.toArray().find(x=>get(x,'intent')==='browser/task-open');
 assert.ok(intent);assert.equal(get(get(intent,'args'),'id'),'ora');
 assert.equal(get(get(intent,'args'),'mode'),'headless');
 assert.equal(get(intent,'then'),K('task-opened'));
 const answered=M.d_handle(ed,ev(K('type'),K('intent-result'),K('ok?'),true,K('then'),K('task-opened'),K('block'),'ora-tenders',K('data'),ev(K('id'),'t-demo')));
 const T=awaitText(answered); assert.match(T,/#omega\/task.*t-demo/);
 const ordinary=use(at(M.d_boot('#+begin_task :id normal\nDo work\n#+end_task','a.bl.org'),1));
 const taken=P.d_open_block(ordinary);assert.equal(taken,null);
});
test('browser render and keys vanish on unuse; user tables stay identical',()=>{
 const base=M.d_boot(text,'demo.bl.org'),ed=use(base);
 assert.equal(get(ed,'user-commands'),get(base,'user-commands'));
 assert.equal(get(ed,'user-keys'),get(base,'user-keys'));
 assert.ok(P.d_render(ed), 'browser syntax selects the package renderer');
 assert.ok(get(M.d_render(ed),'lines').toArray().some(l=>get(l,'ornament?') || get(l,'segs')?.toArray().some(s=>String(get(s,'text')).includes('◉ browser'))));
 const removed=G.d_unuse(ed,'browser');
 assert.equal(get(removed,'presentation'),get(base,'presentation'));
 assert.equal(R.printStr(M.d_render(removed).dissoc(K('message'))),R.printStr(M.d_render(base).dissoc(K('message'))));
});
test('package provided layout is removed frame-wide',()=>{
 let fr=F.d_single(use(M.d_boot(text,'demo.bl.org')));
 fr=F.d_arrange(fr,P.d_browser_inbox);
 assert.equal(get(get(fr,'layout'),'name'),'browser-inbox');
 fr=F.d_handle(fr,key(':'));
 for(const ch of '(ed/unuse "browser")')fr=F.d_handle(fr,ev(K('type'),K('text'),K('text'),ch));
 fr=F.d_handle(fr,key('Enter'));
 assert.equal(get(F.d_render(fr),'layout'),'single',R.printStr(get(F.d_focused(fr),'minibuf'))+' '+R.printStr(get(F.d_focused(fr),'message')));
 assert.ok(F.d_editor_ids(fr).cnt===1);
 assert.equal(get(P.d_bl_package,'provides').get(K('layouts')).get('browser-observe').get(K('panes')).cnt,2);
});

test('resource references watch the existing session; historical images keep their artifact identity',()=>{
 const ed=use(at(M.d_boot('#+begin_browser :id ora :mode headless\nexisting session\n#+end_browser','browser:ora'),1));
 const [,fx]=M.d_take_effects(M.d_handle(ed,key('C-Enter'))).toArray();
 assert.ok(fx.toArray().some(e=>get(e,'intent')==='browser/watch'));
 const artifact=M.d_boot('Screenshot','browser:ora/001-viewport.png');
 const model=P.d_image_model(artifact);
 assert.equal(get(model,'src'),'/browser/artifact/ora/001-viewport.png');
 assert.equal(get(model,'refresh-ms'),0);
});

test('report directive requests a package layout without changing ordinary documents',()=>{
 const plain=M.d_boot('Ordinary document','plain.bl.org');
 assert.equal(P.d_adopt_report(plain),plain);
 const report=use(M.d_boot('#+TITLE: Findings\n#+BROWSER_LAYOUT: procurement-review\n\n* Opportunities','opportunities.bl.org'));
 assert.equal(get(report,'frame/layout'),'procurement-review');
 const removed=G.d_unuse(report,'browser');
 assert.equal(get(removed,'frame/layout'),null);
});
