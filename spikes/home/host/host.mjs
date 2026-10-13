// Paint the BL workbench model and bind retained editors through their public API.
// No backend transport, task registry or periodic observation loop lives here.
import {context,editorEvent,toolContext} from './editor-bridge.mjs';
import {shareTheme} from './theme.mjs';
export function createHost(api){
 const priorTitle=document.title,hadClass=document.body.classList.contains('omega-workbench-window');
 document.body.classList.add('omega-workbench-window');document.title='Omega';
 const stylesheet=document.createElement('link');stylesheet.rel='stylesheet';stylesheet.href=new URL('style.css',import.meta.url);document.head.append(stylesheet);
 const bindings=new Map();const theme=shareTheme(document);let model=null,pending=null,timer=null,disposed=false,lastContext='',lastActivity=null,returnFocus=null,wasModal=false;
 const dispatch=e=>{if(!disposed)api.dispatch(e);};
 const work=()=>document.querySelector('[data-pane=work] iframe')?.contentWindow;
 const current=()=>document.querySelector(`[data-pane=${model?.activity||'work'}] iframe`)?.contentWindow;
 function deliver(){
  clearTimeout(timer);if(!pending||disposed)return;
  const job=pending,w=job.op==='navigate'?work():current();
  if(!w?.blEd){if(performance.now()>job.deadline){pending=null;dispatch({type:'home/error',message:'Buffer is still loading. Try the action again.'});return;}timer=setTimeout(deliver,50);return;}
  pending=null;
  if(job.op==='navigate')editorEvent(w,{type:'mobile/nav',...job.args});
  else if(job.args.name==='context'&&w===work())w.document.querySelector(`[data-act=${model.screen==='task'?'context':'scope'}]`)?.click();
  else if(w===work()&&['commands','lisp','actions'].includes(job.args.name)){
   editorEvent(w,{type:'mobile/modal',value:job.args.name==='actions'&&model.screen==='task'?'actions':'commands'});
   if(job.args.name==='lisp')requestAnimationFrame(()=>w.document.querySelector('#eval-code')?.focus());
  }
  else {const keys=job.args.name==='lisp'?[':']:['space','space'];for(const key of keys)editorEvent(w,{type:'key',key},null);w.blEd.focusInput();}
 }
 function queue(op,args){pending={op,args,deadline:performance.now()+30000};deliver();}
 function tools(binding){
  const w=binding.w,root=w.document.querySelector('.mobile-app'),content=root?.querySelector('.mobile-content');if(!content||!model)return;
  const c=context(w);if(!c)return;
  if(c.screen==='buffers'){
   if(!binding.tools){const box=w.document.createElement('section');box.className='workbench-tools';box.setAttribute('aria-label','Tools');binding.tools=box;}
   for(const item of model.buffers){let row=binding.tools.querySelector(`[data-parent-buffer=${item.id}]`);
    if(!row){row=w.document.createElement('button');row.dataset.parentBuffer=item.id;row.innerHTML='<span></span><small></small>';binding.tools.append(row);}
    row.querySelector('span').textContent=item.title;row.querySelector('small').textContent=model.opened.includes(item.id)?'Open · '+item.kind:item.kind;
   }content.append(binding.tools);
  }else binding.tools?.remove();
  if(c.screen==='task'){
   if(!binding.sidebar){const side=w.document.createElement('aside');side.className='workbench-preview-list';side.setAttribute('aria-label','Work');side.innerHTML='<input data-workbench-filter aria-label="Filter work" placeholder="Filter work…"><div></div>';side.addEventListener('input',e=>{if(e.target.matches('[data-workbench-filter]'))dispatch({type:'home/filter',text:e.target.value});});binding.sidebar=side;}
   const input=binding.sidebar.querySelector('input');if(w.document.activeElement!==input)input.value=model.query;
   const box=binding.sidebar.querySelector('div'),signature=JSON.stringify([model.groups,c.path]);
   if(binding.rowsSignature!==signature){binding.rowsSignature=signature;const fragment=w.document.createDocumentFragment();
    for(const group of model.groups){const heading=w.document.createElement('h2');heading.textContent=group.title+' · '+group.count;fragment.append(heading);
     for(const task of group.rows){const b=w.document.createElement('button');b.dataset.parentTask=task.key;b.dataset.state=group.id;b.setAttribute('aria-current',String(c.path==='task:'+task.key));b.innerHTML='<strong></strong><small></small>';b.querySelector('strong').textContent=task.title||task.key;b.querySelector('small').textContent=[task['state-label'],task['place-name']].filter(Boolean).join(' · ');fragment.append(b);}}
    box.replaceChildren(fragment);
   }root.querySelector('.mobile-scroll').prepend(binding.sidebar);
  }else binding.sidebar?.remove();
 }
 function attach(frame){
  if(disposed||!['work','music','machine'].includes(frame.closest('[data-pane]')?.dataset.pane))return;
  const w=frame.contentWindow;if(!w?.blEd||bindings.get(frame)?.document===w.document)return;
  const old=bindings.get(frame);old?.dispose();
  const style=w.document.createElement('link');style.rel='stylesheet';style.href=new URL('content.css',import.meta.url);w.document.head.append(style);
  const was=w.document.documentElement.classList.contains('omega-workbench-content');w.document.documentElement.classList.add('omega-workbench-content');
  const releaseTheme=theme.add(w.document);
  const binding={w,style,document:w.document};bindings.set(frame,binding);
  const clicked=e=>{const b=e.target.closest('[data-parent-buffer],[data-parent-task]');if(!b)return;e.preventDefault();e.stopPropagation();if(b.dataset.parentBuffer)dispatch({type:'home/tool',id:b.dataset.parentBuffer});else dispatch({type:'home/navigate',screen:'task',path:'task:'+b.dataset.parentTask});};
  w.document.addEventListener('click',clicked,true);
  const refresh=()=>{if(disposed)return;const next=context(w),sig=JSON.stringify(next);if(next&&sig!==lastContext){lastContext=sig;dispatch({type:'home/context',context:next});}tools(binding);};
  const owner=frame.closest('[data-pane]').dataset.pane;let toolSignature='';
  const toolRefresh=()=>{const next=toolContext(w),sig=JSON.stringify(next);if(sig===toolSignature)return;toolSignature=sig;dispatch({type:'home/overlay',owner,open:next.open});dispatch({type:'home/feedback',owner,message:next.message});};
  const unsubscribe=w.blEd.observe(owner==='work'?refresh:toolRefresh);binding.dispose=()=>{unsubscribe();releaseTheme();w.document.removeEventListener('click',clicked,true);binding.sidebar?.remove();binding.tools?.remove();style.remove();if(!was)w.document.documentElement.classList.remove('omega-workbench-content');};
  if(owner==='work')refresh();else toolRefresh();deliver();
 }
 const loaded=e=>{if(e.target.tagName==='IFRAME')attach(e.target);};document.addEventListener('load',loaded,true);
 const shortcut=e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();queue('action',{name:'commands'});}};document.addEventListener('keydown',shortcut);
 return {effect(effect){queue(effect.op,effect.args);},mount(root,send){
  const old=root.getAttribute('style');root.style.cssText='position:absolute;inset:0;overflow:hidden';
  const surface=document.createElement('section');surface.className='omega-workbench';root.append(surface);let role=null;
  surface.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;e.stopPropagation();if(b.dataset.screen)send({type:'home/navigate',screen:b.dataset.screen,path:b.dataset.screen==='places'?'places:':b.dataset.screen==='work'?'workspace:all':null});if(b.dataset.action){returnFocus=b;send({type:'home/action',name:b.dataset.action});}});
  return {update(next){model=next;
   if(role!==next.role){role=next.role;surface.innerHTML=role==='chrome'?'<header class="workbench-header"><button class="workbench-mark" data-screen="work" aria-label="Work">ω</button><button class="workbench-context" data-action="context"><strong></strong><small></small></button><div class="workbench-actions"><button data-action="actions" aria-label="Actions">⋯</button><button data-action="commands" aria-label="Commands">⌘</button><button data-action="lisp" aria-label="Evaluate Lisp">:</button></div></header><p class="workbench-error" role="status"></p><output class="workbench-feedback" role="status"></output>':'<footer class="workbench-status"><nav aria-label="Main navigation"></nav><span class="workbench-location"></span></footer>';}
   if(role==='chrome'){surface.querySelector('strong').textContent=next.context.title;surface.querySelector('small').textContent=next.context.place;surface.querySelector('.workbench-error').textContent=next.error||'';surface.querySelector('.workbench-feedback').textContent=next.feedback||'';}
   else {const nav=surface.querySelector('nav');for(const stale of nav.children)if(!next.navigation.some(x=>x.id===stale.dataset.screen))stale.remove();for(const item of next.navigation){let b=nav.querySelector(`[data-screen=${item.id}]`);if(!b){b=document.createElement('button');b.dataset.screen=item.id;nav.append(b);}b.textContent=item.title;b.setAttribute('aria-current',next.destination===item.id?'page':'false');}surface.querySelector('.workbench-location').textContent=[next.context.mode,next.context.path,next.context.dirty?'modified':null].filter(Boolean).join(' · ');}
   surface.inert=!!next.modal;
   if(wasModal&&!next.modal&&returnFocus?.isConnected){returnFocus.focus({preventScroll:true});returnFocus=null;}wasModal=!!next.modal;
   for(const f of document.querySelectorAll('[data-pane=work] iframe'))attach(f);
   for(const b of bindings.values())tools(b);
   if(lastActivity!==next.activity){lastActivity=next.activity;requestAnimationFrame(()=>{if(!disposed)current()?.focus();});}
  },dispose(){surface.remove();if(old==null)root.removeAttribute('style');else root.setAttribute('style',old);}};
 },dispose(){disposed=true;clearTimeout(timer);document.removeEventListener('load',loaded,true);document.removeEventListener('keydown',shortcut);for(const b of bindings.values())b.dispose();bindings.clear();theme.dispose();stylesheet.remove();if(!hadClass)document.body.classList.remove('omega-workbench-window');document.title=priorTitle;}};
}
