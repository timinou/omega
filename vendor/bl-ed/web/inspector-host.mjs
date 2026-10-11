// DOM/browser leaf for ed.inspector. Sections and domain decisions are BL values.
import {patchHTML} from './dom-patch.mjs';
import {d_subscribe as subscribe} from './out/js.observation.mjs';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createInspectorHost(options={}){
 return {effect:options.effect,mount(root,dispatch){
  const shadow=root.attachShadow({mode:'open'}),shell=document.createElement('main');let dead=false,paused=false,signature,events=new Map();
  const css=document.createElement('link');css.rel='stylesheet';css.href=new URL('./inspector.css',import.meta.url).href;shadow.append(css,shell);
  const layoutCSS=options.layoutCSS?document.createElement('link'):null;
  if(layoutCSS){layoutCSS.rel='stylesheet';layoutCSS.href=options.layoutCSS;document.head.append(layoutCSS);}
  const prefix=options.prefix||'inspector',send=event=>{if(!dead)dispatch(event);};
  const dispose=subscribe((data,delivery)=>{
   send({type:prefix+'/browser',data});
   if(delivery)send({type:prefix+'/delivery',data:delivery});
   if(options.refresh)send({type:options.refresh});
  },{interval:1000,active:()=>!dead&&!paused&&!document.hidden,onError:error=>send({type:prefix+'/observation-error',message:error.message})});
  function action(a){const id=String(events.size);events.set(id,a);return '<button data-key="'+esc(JSON.stringify(a.event)||a.label)+'" data-event="'+id+'"'+(a.disabled?' disabled':'')+' class="'+esc(a.variant||'')+'">'+esc(a.label)+'</button>';}
  function block(b,m){
   const key=b.id?' data-key="'+esc(b.id)+'"':'';
   if(b.type==='text')return '<p'+key+' class="'+(b.muted?'muted':'')+'">'+esc(b.text)+'</p>';
   if(b.type==='heading')return '<h3'+key+'>'+esc(b.text)+'</h3>';
   if(b.type==='actions')return '<div'+key+' class="actions">'+(b.items||[]).map(action).join('')+'</div>';
   if(b.type==='json')return '<pre'+key+'>'+esc(JSON.stringify(b.value??null,null,2))+'</pre>';
   if(b.type==='details')return '<details'+key+'><summary>'+esc(b.label)+'</summary>'+(b.blocks||[]).map(x=>block(x,m)).join('')+'</details>';
   if(b.type==='metrics')return '<dl'+key+'>'+(b.rows||[]).map(([label,value])=>'<dt>'+esc(label)+'</dt><dd>'+esc(value??'Unavailable')+'</dd>').join('')+'</dl>';
   if(b.type==='progress')return '<progress'+key+' max="'+Number(b.max||1)+'" value="'+Number(b.value||0)+'"></progress><small>'+esc(b.label)+'</small>';
   if(b.type==='card')return '<article'+key+'>'+(b.blocks||[]).map(x=>block(x,m)).join('')+'</article>';
   if(b.type==='tree')return '<div role="tree">'+(m.tree||[]).map(row=>'<button data-key="'+esc(row.id)+'" role="treeitem" aria-level="'+(row.depth+1)+'"'+(row.branch?' aria-expanded="'+!row.collapsed+'"':'')+' aria-selected="'+(m.selected?.id===row.id)+'" class="row" style="padding-left:'+((row.depth||0)*16+9)+'px" data-select="'+esc(row.id)+'">'+(row.branch?'<span data-toggle="'+esc(row.id)+'" aria-hidden="true" class="branch">'+(row.collapsed?'▸':'▾')+'</span>':'')+'<span>'+esc(row.kind)+'</span><b>'+esc(row.title)+'</b>'+(row.cycle?'<small>Ownership cycle</small>':'')+'</button>').join('')+'</div>';
   return '';
  }
  function render(m){events=new Map();patchHTML(shell,'<header data-key="header"><div><small>'+esc(m.eyebrow||'RUNTIME')+'</small><h1>'+esc(m.title||'Owned work, in view')+'</h1><p role="status">'+esc(m.scope||'')+'</p></div><nav>'+action({label:paused?'Resume':'Pause',event:{type:prefix+'/pause'}})+(m.actions||[]).map(action).join('')+'</nav></header>'+(m.notice?'<p class="notice">'+esc(m.notice)+'</p>':'')+(m.error?'<p class="warning">'+esc(m.error)+'</p>':'')+'<div data-key="grid" class="grid">'+(m.sections||[]).slice(0,16).map(s=>'<section data-key="'+esc(s.id)+'" class="'+esc(s.class||'')+'"><h2>'+esc(s.title)+'</h2>'+(s.blocks||[]).map(b=>block(b,m)).join('')+'</section>').join('')+'</div>'+(m.rowsTruncated||m['rows-truncated']?'<p class="muted">Showing the first 512 resources.</p>':'')+'<footer>'+esc(m.footer||'Read-only observations. Actions require current owner authority.')+'</footer>');}
  shell.addEventListener('click',event=>{
   const toggle=event.target.closest('[data-toggle]');if(toggle){send({type:prefix+'/toggle',item:toggle.dataset.toggle});return;}
   const button=event.target.closest('button');if(!button)return;
   if(button.dataset.select){send({type:prefix+'/select',item:button.dataset.select});return;}
   const a=events.get(button.dataset.event);if(a&&!a.disabled&&(!a.confirm||confirm(a.confirm)))send(a.event);
  });
  shell.addEventListener('keydown',event=>{const row=event.target.closest('[role="treeitem"][aria-expanded]');if(row&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();event.stopPropagation();if((event.key==='ArrowRight')!==(row.getAttribute('aria-expanded')==='true'))send({type:prefix+'/toggle',item:row.dataset.select});}});
  return {update(m){paused=!!m.state?.paused;const next=JSON.stringify(m);if(signature!==next){signature=next;render(m);}},dispose(){dead=true;dispose();layoutCSS?.remove();shadow.replaceChildren();}};
 }};
}
export const createHost=()=>createInspectorHost();
