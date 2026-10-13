// Paint the BL workbench model and bind retained editors through their public API.
// No backend transport, task registry or periodic observation loop lives here.
import {context,editorEvent,toolContext} from './editor-bridge.mjs';
import {shareTheme} from './theme.mjs';
import {updateContent} from './content.mjs';
export function createHost(api){
 const priorTitle=document.title,hadClass=document.body.classList.contains('omega-workbench-window');
 document.body.classList.add('omega-workbench-window');document.title='Omega';
 const stylesheet=document.createElement('link');stylesheet.rel='stylesheet';stylesheet.href=new URL('style.css',import.meta.url);document.head.append(stylesheet);
 const bindings=new Map(),waiting=new Map();const theme=shareTheme(document);let model=null,pending=null,timer=null,disposed=false,lastContext='',lastActivity=null,returnFocus=null,wasModal=false;
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
   editorEvent(w,{type:'mobile/modal',value:job.args.name==='actions'?'actions':'commands'});
   if(job.args.name==='lisp')requestAnimationFrame(()=>w.document.querySelector('#eval-code')?.focus());
  }
  else {const keys=job.args.name==='lisp'?[':']:['space','space'];for(const key of keys)editorEvent(w,{type:'key',key},null);w.blEd.focusInput();}
 }
 function queue(op,args){pending={op,args,deadline:performance.now()+30000};deliver();}
 function attach(frame){
  if(disposed||!['work','music','machine'].includes(frame.closest('[data-pane]')?.dataset.pane))return;
  const w=frame.contentWindow;if(!w)return;
  if(!w.blEd){
   if(waiting.get(frame)?.document!==w.document){
    waiting.get(frame)?.dispose();
    const ready=()=>attach(frame);w.addEventListener('bl-ed-ready',ready,{once:true});
    waiting.set(frame,{document:w.document,dispose:()=>w.removeEventListener('bl-ed-ready',ready)});
   }return;
  }
  waiting.get(frame)?.dispose();waiting.delete(frame);
  if(bindings.get(frame)?.document===w.document)return;
  const old=bindings.get(frame);old?.dispose();
  const style=w.document.createElement('link');style.rel='stylesheet';style.href=new URL('content.css',import.meta.url);w.document.head.append(style);
  const was=w.document.documentElement.classList.contains('omega-workbench-content');w.document.documentElement.classList.add('omega-workbench-content');
  const releaseTheme=theme.add(w.document);
  const binding={w,style,document:w.document};bindings.set(frame,binding);
  const clicked=e=>{const b=e.target.closest('[data-parent-buffer],[data-parent-task]');if(!b)return;e.preventDefault();e.stopPropagation();if(b.dataset.parentBuffer)dispatch({type:'home/tool',id:b.dataset.parentBuffer});else dispatch({type:'home/navigate',screen:'task',path:'task:'+b.dataset.parentTask});};
  w.document.addEventListener('click',clicked,true);
  const refresh=()=>{if(disposed)return;const next=context(w),sig=JSON.stringify(next);if(next&&sig!==lastContext){lastContext=sig;dispatch({type:'home/context',context:next});}updateContent(binding,model,dispatch);};
  const owner=frame.closest('[data-pane]').dataset.pane;let toolSignature='',previousMessage=owner==='work'?null:toolContext(w).message;
  const toolRefresh=()=>{const next=toolContext(w),sig=JSON.stringify(next);if(sig===toolSignature)return;toolSignature=sig;dispatch({type:'home/overlay',owner,open:next.open});if(next.message!==previousMessage){previousMessage=next.message;dispatch({type:'home/feedback',owner,message:next.message});}};
  const unsubscribe=w.blEd.observe(owner==='work'?refresh:toolRefresh);binding.dispose=()=>{unsubscribe();releaseTheme();w.document.removeEventListener('click',clicked,true);binding.sidebar?.remove();binding.tools?.remove();style.remove();if(!was)w.document.documentElement.classList.remove('omega-workbench-content');};
  if(owner==='work'){editorEvent(w,{type:'mobile/field',field:'workbench',value:true});refresh();}else toolRefresh();deliver();
 }
 const loaded=e=>{if(e.target.tagName==='IFRAME')attach(e.target);};document.addEventListener('load',loaded,true);
 const shortcut=e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();queue('action',{name:'commands'});}};document.addEventListener('keydown',shortcut);
 return {effect(effect){queue(effect.op,effect.args);},mount(root,send){
  const old=root.getAttribute('style');root.style.cssText='position:absolute;inset:0;overflow:hidden';
  const surface=document.createElement('section');surface.className='omega-workbench';root.append(surface);let role=null;
  surface.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;e.stopPropagation();if(b.dataset.screen)send({type:'home/navigate',screen:b.dataset.screen,path:b.dataset.screen==='places'?'places:':b.dataset.screen==='work'?'workspace:all':null});if(b.hasAttribute('data-clear-feedback'))send({type:'home/clear-feedback'});if(b.dataset.action){returnFocus=b;send({type:'home/action',name:b.dataset.action});}});
  return {update(next){model=next;
   if(role!==next.role){role=next.role;surface.innerHTML=role==='chrome'?'<header class="workbench-header"><button class="workbench-mark" data-screen="work" aria-label="Work">ω</button><button class="workbench-context" data-action="context"><strong></strong><small></small></button><div class="workbench-actions"><button data-action="actions" aria-label="Actions">⋯</button><button data-action="commands" aria-label="Commands">⌘</button><button data-action="lisp" aria-label="Evaluate Lisp">:</button></div></header><p class="workbench-error" role="status"></p><output class="workbench-feedback" role="status" hidden><span></span><button data-clear-feedback aria-label="Dismiss result">×</button></output>':'<footer class="workbench-status"><nav aria-label="Main navigation"></nav><span class="workbench-location"></span></footer>';}
   if(role==='chrome'){surface.querySelector('strong').textContent=next.context.title;surface.querySelector('small').textContent=next.context.place;surface.querySelector('.workbench-error').textContent=next.error||'';const feedback=surface.querySelector('.workbench-feedback');feedback.hidden=!next.feedback;feedback.querySelector('span').textContent=next.feedback||'';}
   else {const nav=surface.querySelector('nav');for(const stale of nav.children)if(!next.navigation.some(x=>x.id===stale.dataset.screen))stale.remove();for(const item of next.navigation){let b=nav.querySelector(`[data-screen=${item.id}]`);if(!b){b=document.createElement('button');b.dataset.screen=item.id;nav.append(b);}b.textContent=item.title;b.setAttribute('aria-current',next.destination===item.id?'page':'false');}surface.querySelector('.workbench-location').textContent=[next.context.mode,next.context.path,next.context.dirty?'modified':null].filter(Boolean).join(' · ');}
   surface.inert=!!next.modal;
   if(wasModal&&!next.modal&&returnFocus?.isConnected){returnFocus.focus({preventScroll:true});returnFocus=null;}wasModal=!!next.modal;
   for(const f of document.querySelectorAll('[data-pane=work] iframe,[data-pane=music] iframe,[data-pane=machine] iframe'))attach(f);
   for(const b of bindings.values())updateContent(b,model,dispatch);
   if(lastActivity!==next.activity){lastActivity=next.activity;requestAnimationFrame(()=>{if(!disposed)current()?.focus();});}
  },dispose(){surface.remove();if(old==null)root.removeAttribute('style');else root.setAttribute('style',old);}};
 },dispose(){disposed=true;clearTimeout(timer);document.removeEventListener('load',loaded,true);document.removeEventListener('keydown',shortcut);for(const b of bindings.values())b.dispose();bindings.clear();for(const pending of waiting.values())pending.dispose();waiting.clear();theme.dispose();stylesheet.remove();if(!hadClass)document.body.classList.remove('omega-workbench-window');document.title=priorTitle;}};
}
