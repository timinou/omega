// Pocket's screens are BL hiccup (mob.view). This boundary converts host data in and
// serializes the tree natively: the BL runtime is slow at string building, not at structure.
import * as R from '../../out/rt.mjs';
import * as A from '../../out/abi.mjs';
import {jsToBL,blToJS} from '../../out/interop.mjs';
import * as V from '../../out/mob.view.mjs';
import * as S from '../../out/mob.session.mjs';

const VOID=new Set(['input','img','br','hr','meta','link']);
export const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const isMap=x=>x&&typeof x==='object'&&typeof x.entries==='function'&&typeof x.get==='function'&&!(x instanceof R.Vec);
const items=x=>x instanceof R.Vec?x.toArray():A.toArray(x);
const attrValue=v=>v instanceof R.Kw?v.name:(v&&typeof v==='object'&&!isMap(v))?items(v).filter(x=>x!=null&&x!==false).map(attrValue).join(' '):String(v);
function raw(m){for(const [k,v] of m.entries())if(k instanceof R.Kw&&k.name==='raw-html')return v;return null;}

// Same contract as mob.html/html, which remains the reference on the BEAM.
export function html(n){
 if(n==null||n===false)return '';
 if(typeof n==='string')return esc(n);
 if(typeof n==='number'||typeof n==='bigint')return String(n);
 if(n instanceof R.Vec){
  const a=n.toArray();
  if(!(a[0] instanceof R.Kw))return a.map(html).join('');
  const [t,...cls]=a[0].name.split('.');let i=1,attrs='';
  if(isMap(a[1])&&raw(a[1])==null){
   for(const [k,v] of a[1].entries()){
    const name=k.name;
    if(name==='class'){if(v!=null&&v!==false){const s=attrValue(v);if(s)cls.push(s);}continue;}
    if(v==null||v===false)continue;
    attrs+=v===true?' '+name:` ${name}="${esc(attrValue(v))}"`;
   }
   i=2;
  }
  if(cls.length)attrs=` class="${esc(cls.join(' '))}"`+attrs;
  let body='';for(;i<a.length;i++)body+=html(a[i]);
  return `<${t}${attrs}>${VOID.has(t)?'':body+`</${t}>`}`;
 }
 if(isMap(n)){const r=raw(n);return r==null?'':String(r);}
 if(n instanceof R.Kw)return esc(n.name);
 if(typeof n==='object')return items(n).map(html).join('');
 return esc(n);
}
const bl=x=>jsToBL(x,R.kw('keywordize-keys'),true);
export const render=vm=>html(V.d_tree(bl(vm)));

// The conversation is most of a long session's screen. Regroup only when the turns
// change, and serialize each group once per (group, running?): new output or an
// unrelated update rebuilds only what changed, never every past message.
const RAW=R.kw('raw-html');
export function createConversationRenderer(){
 let turnsKey=null,groups=null,groupHtml=new Map();
 return function conversation(session){
  const turns=session.turns||[],key=JSON.stringify(turns);
  if(key!==turnsKey){turnsKey=key;groups=S.d_group_turns(bl(turns));}
  const d=bl({...session,turns:[]}),running=S.d_running$Q(d)===true,next=new Map();
  const views=items(groups).map(g=>{
   // Full data, not a potentially abbreviated printed representation, owns
   // equality. Only this mounted host and its current conversation retain it.
   const k=(running?'1':'0')+JSON.stringify(blToJS(g));
   let h=groupHtml.get(k);if(h==null)h=html(S.d_group_view(g,running));next.set(k,h);
   return R.hashMap(RAW,h);
  });
  groupHtml=next;
  return html(S.d_conversation_of(R.EMPTY_MAP,d,groups,R.vecFromArray(views)));
 };
}
export const launchArgs=vm=>blToJS(V.d_launch_args(bl(vm)));
export const paletteCount=vm=>V.d_palette_count(bl(vm));
