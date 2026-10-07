import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../../../vendor/bl-ed/web/out/rt.mjs';
import * as M from '../../../vendor/bl-ed/web/out/ed.main.mjs';
import * as T from '../../../vendor/bl-ed/web/out/ed.text.mjs';
import * as P from '../../../vendor/bl-ed/web/out/ed.pkg.mjs';
import * as I from '../../../vendor/bl-ed/web/out/img.main.mjs';
const K = R.kw, get = (x,k) => x.get(K(k));
const ev = (type,...kv) => R.hashMap(K('type'),K(type),...kv);
const key = (ed,k) => M.d_handle(ed,ev('key',K('key'),k));
const text = ed => T.d_to_string(get(ed,'text'));
const url = '/api/assets/' + 'a'.repeat(64) + '.png';
const paste = ed => M.d_handle(ed,ev('paste-image',K('url'),url,K('data'),'bytes'));

test('paste, write below, undo/redo, reopen; unload restores source rendering', () => {
  const original = M.d_boot('before\n','images.bl.org');
  let ed = P.d_use(original,I.d_bl_package);
  ed = key(ed,'j');
  ed = paste(ed);
  const pasted = text(ed);
  assert.equal(pasted, 'before\n[[image:' + url + ']]\n');
  assert.deepEqual(get(get(ed,'sels').nth(0),'head').toArray(), [2,0]);
  assert.equal(get(ed,'mode').name,'insert');
  assert.ok(get(ed,'effects').toArray().some(e => get(e,'kind').name === 'asset-store'));
  assert.ok(get(M.d_render(ed),'lines').toArray().some(l => get(l,'role') === K('image')));
  ed = M.d_handle(ed,ev('text',K('text'),'A caption.'));
  ed = key(ed,'Escape');
  ed = key(ed,'u'); assert.equal(text(ed),pasted);
  ed = key(ed,'u'); assert.equal(text(ed),'before\n');
  ed = key(ed,'U'); assert.equal(text(ed),pasted);
  ed = key(ed,'U'); assert.equal(text(ed),pasted+'A caption.');
  const reopened = P.d_use(M.d_boot(text(ed),'images.bl.org'),I.d_bl_package);
  assert.ok(get(M.d_render(reopened),'lines').toArray().some(l => get(l,'role') === K('image')));
  const unloaded = P.d_unuse(reopened,'images');
  const plain = M.d_boot(text(ed),'images.bl.org');
  assert.deepEqual(get(M.d_render(unloaded),'lines'),get(M.d_render(plain),'lines'));
});

test('source toggle and read-only buffers', () => {
  let ed = P.d_use(M.d_boot('[[image:'+url+']]\n','images.bl.org'),I.d_bl_package);
  ed = key(key(ed,'g'),'i');
  assert.ok(get(M.d_render(ed),'lines').toArray().every(l => get(l,'role') !== K('image')));
  ed = ed.assoc(K('read-only?'),true);
  assert.equal(text(paste(ed)),text(ed));
  const fresh = M.d_boot('hello','test.bl.org');
  assert.deepEqual(get(M.d_render(P.d_unuse(P.d_use(fresh,I.d_bl_package),'images')),'lines'),get(M.d_render(fresh),'lines'));
});

test('images follow nested heading folds, including source view and prose after the reference', () => {
  const sample='* Parent\nintro\n** Child\ntext before\n[[image:'+url+']]\ncaption\n* Sibling\n[[image:'+url+']]\n';
  let ed=P.d_use(M.d_boot(sample,'images.bl.org'),I.d_bl_package);
  const images=()=>get(M.d_render(ed),'lines').toArray().filter(l=>get(l,'role')===K('image')).map(l=>get(l,'src'));
  assert.deepEqual(images(),[4,7]);
  ed=key(key(key(ed,'j'),'j'),'Tab');
  assert.deepEqual(images(),[7],'folding child hides its image, leaves sibling visible');
  ed=key(key(ed,'g'),'i');
  assert.ok(get(M.d_render(ed),'lines').toArray().every(l=>get(l,'row')!==4),'source mode also respects fold');
  ed=key(key(ed,'g'),'i');
  ed=key(ed,'Tab');assert.deepEqual(images(),[4,7]);
  ed=key(key(key(ed,'g'),'g'),'Tab');assert.deepEqual(images(),[7],'parent hides all descendants');
  ed=key(ed,'Tab');assert.deepEqual(images(),[4,7]);
  assert.equal(text(ed),sample,'folding does not change text');
});

test('heading folds hide prose images, while image-looking source code stays source code', () => {
  const sample='* Parent\nprose\n[[image:'+url+']]\ncaption\n* Next\n#+begin_src beam-lisp\n[[image:'+url+']]\n#+end_src\n';
  let ed=P.d_use(M.d_boot(sample,'images.bl.org'),I.d_bl_package);
  const images=()=>get(M.d_render(ed),'lines').toArray().filter(l=>get(l,'role')===K('image'));
  assert.equal(images().length,1,'only the prose reference is an image');
  ed=key(ed,'Tab');assert.equal(images().length,0);
  ed=key(ed,'Tab');assert.equal(images().length,1);
});
