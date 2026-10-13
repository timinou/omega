// Fill explicit content slots in the retained Pocket renderer. No model authority
// or private editor/render loop lives here; the sibling patcher is shared.
import {context} from './editor-bridge.mjs';
import {patchHTML} from '../../dom-patch.mjs';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function updateContent(binding,model,dispatch){
 const w=binding.w,root=w.document.querySelector('.mobile-app');
 if(!root||!model)return;
 const c=context(w);if(!c)return;
 const tools=root.querySelector('[data-host-slot=workbench-tools]');
 if(tools){
  patchHTML(tools,`<section class="workbench-tools" aria-label="Tools">${model.buffers.map(item=>
   `<button data-key="${esc(item.id)}" data-parent-buffer="${esc(item.id)}"><span>${esc(item.title)}</span><small>${model.opened.includes(item.id)?'Open · ':''}${esc(item.kind)}</small></button>`).join('')}</section>`);
 }
 const sidebar=root.querySelector('[data-host-slot=workbench-preview]');
 if(!sidebar)return;
 if(binding.sidebar!==sidebar){
  binding.sidebar=sidebar;binding.rowsSignature=null;sidebar.setAttribute('aria-label','Work');
  sidebar.innerHTML='<input data-workbench-filter aria-label="Filter work" placeholder="Filter work…"><div></div>';
  sidebar.addEventListener('input',e=>{
   if(e.target.matches('[data-workbench-filter]'))dispatch({type:'home/filter',text:e.target.value});
  });
 }
 const input=sidebar.querySelector('input');if(w.document.activeElement!==input)input.value=model.query;
 const signature=JSON.stringify([model.groups,c.path]);
 if(binding.rowsSignature===signature)return;
 binding.rowsSignature=signature;
 patchHTML(sidebar.querySelector('div'),model.groups.map(group=>
  `<section data-key="${esc(group.id)}"><h2>${esc(group.title)} · ${group.count}</h2>${group.rows.map(task=>
   `<button data-key="${esc(task.key)}" data-parent-task="${esc(task.key)}" data-state="${esc(group.id)}" aria-current="${c.path==='task:'+task.key}"><strong>${esc(task.title||task.key)}</strong><small>${esc([task['state-label'],task['place-name']].filter(Boolean).join(' · '))}</small></button>`).join('')}</section>`).join(''));
}
