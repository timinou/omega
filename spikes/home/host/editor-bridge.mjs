// The host boundary: translate values and read only chrome metadata.
const get=(m,k,w)=>m?.get(w.blEd.K(k),null);
function plain(value){
 if(value?.entries&&value?.get){const out={};for(const [k,v]of value.entries())out[k.fq??String(k)]=plain(v);return out;}
 if(value?.toArray)return value.toArray().map(plain);
 if(value&&typeof value==='object'&&typeof value.fq==='string')return value.fq;
 return value;
}
export function editorEvent(w,event,pane='rail'){
 const b=w.blEd;if(!b)return;
 const cv=x=>Array.isArray(x)?b.R.vecFromArray(x.map(cv)):x&&typeof x==='object'?Object.entries(x).reduce((m,[k,v])=>m.assoc(b.K(k),cv(v)),b.R.EMPTY_MAP):x;
 let e=cv(event).assoc(b.K('type'),b.K(event.type));if(event.command)e=e.assoc(b.K('command'),b.K(event.command));if(pane)e=e.assoc(b.K('pane'),b.K(pane));b.dispatch(e);
}
export function context(w){
 const read=(m,k)=>get(m,k,w),panes=read(w.blEd.snapshot(),'panes').toArray();
 const models={};for(const p of panes){const v=read(p,'view');if(read(v,'package')==='mobile')models[read(v,'role')]=v;}
 const rail=models.rail;if(!rail)return null;
 const state=read(rail,'state'),screen=read(state,'screen')||'work';
 const m=models[screen==='task'?'task':screen==='document'?'file':'rail']||rail,d=read(m,'data');
 const objects=(read(rail,'objects')?.toArray()||[]),scope=objects.find(o=>read(o,'type')==='desk/scope'&&read(o,'active'));
 const route=read(state,'task-path'),known=objects.find(o=>'task:'+read(o,'key')===route);
 const connection=read(state,'connection');
 return {screen,target:read(m,'role'),actions:plain(read(m,'actions')),modal:!!read(state,'modal')||Object.values(models).some(v=>!!read(v,'minibuf')),path:read(m,'path'),title:screen==='task'?read(d,'task-title')||read(known,'title')||'Session':screen==='document'?read(d,'title')||read(m,'path'):({work:'Work',places:'Places',buffers:'Buffers',machine:'Lisp',host:'Connection'}[screen]||screen),
  place:read(d,'place-name')||read(known,'place-name')||read(scope,'title')||'All places',dirty:read(m,'dirty'),online:read(connection,'online'),
  objects:objects.filter(o=>read(o,'type')==='omega/task').map(o=>Object.fromEntries(['type','key','title','summary','ask','status','place-name'].map(k=>[k,read(o,k)])))};
}

// Tool buffers use the generic editor prompt and message, without reading their
// document or traversing a potentially large presentation tree.
export function toolContext(w){
 const state=w.blEd.state();
 return {open:!!get(state,'minibuf',w),message:get(state,'message',w)};
}
