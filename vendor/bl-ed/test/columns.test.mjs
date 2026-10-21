// Drive the same pure Beam Lisp column policy the browser uses.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const out=path.resolve(process.env.BLED_OUT || 'vendor/bl-ed/web/out');
const load=name=>import(pathToFileURL(path.join(out,name+'.mjs')));
const [C,F,M,R]=await Promise.all(['ed.columns','ed.frame','ed.main','rt'].map(load));
const K=R.kw, get=(m,k)=>m?.get(K(k),null);
const bl=x=>Array.isArray(x)?R.vecFromArray(x.map(bl)) : x && Object.getPrototypeOf(x)===Object.prototype
  ? Object.entries(x).reduce((m,[k,v])=>m.assoc(K(k),bl(v)),R.EMPTY_MAP) : x;
const pane=(id,width,dock)=>bl({id:K(id),width:width===undefined?K('fill'):R.vec(K(width[0]),width[1]),...(dock?{dock:K(dock)}:{})});
const panes=R.vec(pane('bar',undefined,'top'),pane('left',['ch',30]),pane('hidden',['ch',0]),pane('right',['fr',2]),pane('last',['fr',1]));
const sizes=bl({left:300,right:600,last:300});
const resize=(delta,ps=panes,sz=sizes,l='left',r='right')=>C.d_resize(ps,sz,K(l),K(r),delta);
const weight=(ws,id)=>{const n=get(ws,id).toArray()[1];return n instanceof R.Flt?n.v:n;};
test('adjacent resizing conserves widths, skips hidden/docked panes and preserves a third column',()=>{
 const ws=resize(100);
 assert.equal(weight(ws,'left'),400);assert.equal(weight(ws,'right'),500);assert.equal(weight(ws,'last'),300);
 assert.equal(R.printStr(get(ws,'hidden')),'[:ch 0]');assert.equal(get(ws,'bar'),null);
 assert.equal(C.d_boundaries(panes).toArray().length,2);
 for(const delta of [-2000,-100,0,400,2000]){
  const w=resize(delta);assert.equal(weight(w,'left')+weight(w,'right'),900);
  assert.ok(weight(w,'left')>=120 && weight(w,'right')>=120);
 }
 const small=resize(1000,panes,bl({left:70,right:80,last:200}));
 assert.equal(weight(small,'left'),75);assert.equal(weight(small,'right'),75);
 const fractional=resize(R.flt(10.25),panes,bl({left:R.flt(300.5),right:R.flt(600.25),last:300}));
 assert.equal(weight(fractional,'left'),310.75);assert.equal(weight(fractional,'right'),590);
});
test('incomplete/invalid measurements and nonadjacent boundaries cannot corrupt widths',()=>{
 for(const delta of [NaN,Infinity,-Infinity,'10'])assert.equal(resize(delta),null);
 for(const n of [0,-1,NaN,Infinity])assert.equal(resize(10,panes,bl({left:n,right:600,last:300})),null);
 assert.equal(resize(10,panes,sizes,'left','last'),null);
 assert.equal(resize(10,panes,sizes,'hidden','right'),null);
});
test('frame widths survive drawing and keys without changing editors or package layout; cancel/reset is exact',()=>{
 const layout=bl({name:'columns',panes,focus:K('left')});
 let fr=F.d_arrange(F.d_single(M.d_boot('draft\n','notes.bl.org')),layout);
 const original=fr, editors=get(fr,'editors');
 const event=ws=>bl({type:K('frame-columns'),layout:'columns',panes:R.vec(K('left'),K('hidden'),K('right'),K('last')),widths:ws});
 fr=F.d_handle(fr,event(resize(100)));
 assert.equal(get(fr,'editors'),editors);assert.equal(get(fr,'layout'),layout);
 const drawn=get(F.d_render(fr),'panes').toArray();assert.equal(weight(C.d_widths(R.vecFromArray(drawn)),'left'),400);
 fr=F.d_handle(fr,bl({type:K('key'),key:'j'}));
 assert.equal(weight(get(fr,'column-widths'),'left'),400);
 assert.equal(R.printStr(F.d_handle(F.d_handle(original,event(resize(100))),event(C.d_widths(panes)))),R.printStr(original));
 assert.equal(get(F.d_handle(fr,event(null)),'column-widths'),null);
 assert.equal(get(F.d_unarrange(fr),'column-widths'),null);
 assert.equal(get(F.d_arrange(fr,layout),'column-widths'),null);
});
test('late layout events and malformed width declarations are ignored',()=>{
 const fr=F.d_arrange(F.d_single(M.d_boot('','x')),bl({name:'columns',panes,focus:K('left')}));
 const good=bl({type:K('frame-columns'),layout:'columns',panes:R.vec(K('left'),K('hidden'),K('right'),K('last')),widths:resize(10)});
 for(const bad of [good.assoc(K('layout'),'old'),good.assoc(K('panes'),R.vec(K('left'))),good.assoc(K('widths'),bl({left:K('fill')})),good.assoc(K('widths'),resize(10).assoc(K('left'),R.vec(K('fr'),-1)))])
  assert.equal(F.d_handle(fr,bad),fr);
 assert.equal(C.d_key_delta('ArrowRight',false),16);assert.equal(C.d_key_delta('ArrowLeft',true),-64);
});
