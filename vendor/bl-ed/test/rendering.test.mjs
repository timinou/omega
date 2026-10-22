import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const out=path.resolve(process.env.BLED_OUT||'out/bl-ed');
const [M,R,C]=await Promise.all(['ed.main','rt','ed.core'].map(n=>import(pathToFileURL(path.join(out,n+'.mjs')).href)));
const K=R.kw,get=(x,k)=>x.get(K(k),null);
const event=fields=>R.hashMap(...Object.entries(fields).flatMap(([k,v])=>[K(k),v]));
const source='#+begin_src beam-lisp\n(def first 12)\n(def second [3 4])\n#+end_src\n';
const boot=text=>M.d_boot(text,'render.bl.org');
const render=(ed,rows=[1,2])=>M.d_render_rows(ed,R.vecFromArray(rows));
const line=(view,row)=>get(view,'lines').toArray().find(x=>get(x,'row')===row);
const tokens=(view,row)=>get(line(view,row),'segments').toArray().map(x=>[get(x,'text'),get(x,'kind').fq]);

test('cursor updates keep source colors stable while updating current row and position',()=>{
  const initial=boot(source),before=render(initial);
  const moved=M.d_handle(initial,event({type:K('click'),pos:R.vec(1,0)})),after=render(moved);
  assert.deepEqual(tokens(after,1),tokens(before,1));
  assert.equal(get(line(after,1),'current?'),true);
  assert.deepEqual(get(after,'cursor').toArray(),[1,0]);
  assert.strictEqual(get(line(before,1),'segments'),get(line(after,1),'segments'));
});

test('syntax edits and undo invalidate both token spans and structural diagnostics',()=>{
  let ed=M.d_handle(boot(source),event({type:K('click'),pos:R.vec(1,0)}));
  const before=render(ed);
  ed=C.d_replace_text(ed,source.replace('(def first 12)','(def first [12)'));
  const changed=render(ed);
  assert.notDeepEqual(tokens(changed,1),tokens(before,1));
  assert.ok(get(get(changed,'status'),'problems')>0);
  ed=M.d_handle(ed,event({type:K('key'),key:'u'}));
  const undone=render(ed);
  assert.deepEqual(tokens(undone,1),tokens(before,1));
  assert.equal(get(get(undone,'status'),'problems'),0);
});

test('visible row sets and alternating buffers do not reuse another projection’s tokens',()=>{
  const a=boot(source),b=boot('#+begin_src beam-lisp\n(def other :different)\n#+end_src\n');
  const a1=render(a,[1]),a2=render(a,[2]),b1=render(b,[1]);
  assert.equal(get(line(a2,2),'row'),2);
  assert.ok(tokens(a1,1).some(([text,kind])=>text==='12'&&kind==='number'));
  assert.ok(tokens(b1,1).some(([text,kind])=>text===':different'&&kind==='keyword'));
  assert.deepEqual(tokens(render(a,[1]),1),tokens(a1,1));
  assert.deepEqual(tokens(render(a,[2]),2),tokens(a2,2));
});

test('a placement update refreshes cached line metadata without changing the source',()=>{
  const ed=boot(source);
  const block=get(get(ed,'struct'),'blocks').toArray().find(b=>get(b,'kind')===K('cell'));
  const id=get(block,'id');
  const local=ed.assoc(K('placements'),R.hashMap(id,R.hashMap(K('place'),K('local'))));
  const beam=ed.assoc(K('placements'),R.hashMap(id,R.hashMap(K('place'),K('beam'),K('why'),'host only')));
  assert.equal(get(line(render(local,[0]),0),'place'),'local');
  assert.equal(get(line(render(beam,[0]),0),'place'),'beam');
  assert.equal(get(line(render(beam,[0]),0),'place-why'),'host only');
  assert.equal(get(line(render(local,[0]),0),'place'),'local');
});
