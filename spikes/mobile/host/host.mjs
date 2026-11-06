// Package-owned DOM/connection boundary. Models and commands come from mob.main;
// editor documents, revisions, polling, intents and buffers use the real host.
import {reconcile} from './dom.mjs';
import {rich,inline as formatInline,unified} from './text.mjs';
import {render as renderView,launchArgs,createConversationRenderer} from './view.mjs';
const icons = {
 copy:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
 work:'<rect x="4" y="6" width="16" height="15" rx="3"/><path d="M9 6V4h6v2M4 11h16M10 11v3h4v-3"/>',
 places:'<path d="M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
 host:'<rect x="4" y="3" width="16" height="13" rx="2"/><path d="M8 21h8M12 16v5M8 7h8M8 11h4"/>',
 arrow:'<path d="m9 5 7 7-7 7"/>',back:'<path d="m15 5-7 7 7 7"/>',plus:'<path d="M12 5v14M5 12h14"/>',
 send:'<path d="m5 12 7-7 7 7M12 5v15"/>', check:'<path d="m5 12 4 4L19 6"/>',
 dots:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
 file:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8ZM14 2v6h6M8 13h8M8 17h5"/>',
 close:'<path d="m6 6 12 12M18 6 6 18"/>',filter:'<path d="M4 7h16M7 12h10M10 17h4"/>',
};
const icon=name=>`<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]||icons.file}</svg>`;
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const btn=(label,action,cls='quiet',attrs='')=>`<button class="${cls}" data-act="${action}" ${attrs}>${label}</button>`;
const finished=d=>['done','failed','cancelled'].includes(d?.['task-status']);
const compact=x=>{const t=String(x||'').split('\n')[0];return t.length>72?t.slice(0,69)+'…':t;};
const status=o=>o['state-label']||o.status||'In progress';
const title=m=>m?.data?.['document-title']||(String(m?.text||'').split('\n').find(l=>/^#\+TITLE:/i.test(l))||m?.text?.split('\n')[0]||'').replace(/^#\+TITLE:\s*/i,'');
const empty=(heading,copy)=>`<div class="empty"><span class="empty-icon">${icon('work')}</span><h2>${esc(heading)}</h2><p>${esc(copy)}</p></div>`;

export function createHost(api){
 const models=new Map(),mounts=new Map(),messageOrder=new Map(),positions=new Map(),history=[],queries=new Map();let messageSequence=0,sessionContext=null; let disposed=false,probeTimer,probeAbort,probing=false,composing=false;
 const css=document.createElement('link');css.rel='stylesheet';css.href=new URL('style.css',import.meta.url);css.dataset.mobileResource='';document.head.append(css);
 const pocketCss=document.createElement('link');pocketCss.rel='stylesheet';pocketCss.href=new URL('pocket.css',import.meta.url);pocketCss.dataset.mobileResource='';document.head.append(pocketCss);
 const conversationView=createConversationRenderer();
 const priorTitle=document.title;document.title='Omega · Pocket';
 document.documentElement.classList.add('omega-mobile');
 const send=(pane,event)=>api.dispatch({...event,pane});
 // Typing stays local: the reply box owns its text and the package hears it in
 // batches. Any action, blur, hide or teardown flushes first, so Send, a saved
 // draft and a restored tab always carry every character typed.
 let replyTimer=null,replyPending=null,sentDraft=null,renderMissed=false;
 const replyText=t=>(replyPending?.path===t.path?replyPending.text:sentDraft?.path===t.path?sentDraft.text:t.draft)||'';
 function flushReply(){
  clearTimeout(replyTimer);replyTimer=null;const p=replyPending;replyPending=null;
  if(!p||disposed||task().path!==p.path)return;
  sentDraft=p;saveDraft(task(),p.text);send('task',{type:'mobile/draft',text:p.text});
 }
 const flushHidden=()=>{if(document.visibilityState==='hidden')flushReply();};
 document.addEventListener('visibilitychange',flushHidden);window.addEventListener('pagehide',flushReply);
 const rail=()=>models.get('rail')||{},task=()=>models.get('task')||{},file=()=>models.get('file')||{};
 const shell=()=>rail().state||{};
 const readerModel=()=>shell().screen==='task'&&(shell().tab||'conversation')==='conversation'&&task().path&&!task().path.startsWith('task:')&&task().path!=='desk:welcome'?task():file();
 const prompt=()=>[...models.entries()].find(([,m])=>m.minibuf);
 const nav=(screen,path)=>{for(const pane of ['rail','task','file'])send(pane,{type:'mobile/clear'});send('rail',{type:'mobile/nav',screen,path});};
 const tab=(name,path,block)=>send('rail',{type:'mobile/tab',tab:name,path,block,dirty:file().dirty,'current-file':file().path});
 const openDocument=(path,goto)=>{if(!path)return;if(file().dirty&&path!==file().path){send('rail',{type:'mobile/document',path,dirty:true,'current-file':file().path});return;}if(file().path&&file().path!==path&&file().path!=='desk:welcome')history.push(file().path);send('rail',{type:'mobile/document',path,goto});};
 const modal=value=>send('rail',{type:'mobile/modal',value});
 const command=(pane,name,row)=>send(pane,row==null?{type:'command',command:name}:{type:'mobile/row-command',name,row});
 const online=()=>shell().connection?.online===true;
 // Local composition belongs to this browser tab and this durable world.
 // A task's creation fact prevents a reused ID inheriting an older draft.
// Drafts and the route restore asynchronously; never over what the person did since load.
 let touched=new Set(),userActed=false;
 let draftKey=null,draftCache={},draftAbort,sessionKey=null;const fields={};let session={};
 function saveSession(){if(!sessionKey)return;try{sessionStorage.setItem(sessionKey,JSON.stringify({...session,route:currentRoute(),fields,new:shell().new,selection:shell().selection,queries:[...queries],positions:[...positions]}));}catch{}}
 let routeReady=false,lastRoute='',restoringRoute=false;
 function currentRoute(){const s=shell(),screen=s.screen||'work';return {screen,path:screen==='task'?(s['task-path']||task().path):screen==='document'?(s['file-path']||file().path):screen==='place'?'place:'+s['place-id']:screen==='work'?rail().path:null,tab:s.tab||'conversation',file:s['file-path']};}
 function applyRoute(r){if(!r||!['work','places','place','launch','task','document','host','buffers','machine'].includes(r.screen))return;restoringRoute=true;lastRoute=JSON.stringify(r);if(r.screen==='document')openDocument(r.path);else if(r.screen==='place'){nav('place',r.path);loadPlace(String(r.path||'').replace(/^place:/,''));}else{nav(r.screen,r.screen==='places'?null:r.path);if(r.screen==='task'&&r.tab!=='conversation')tab(r.tab,r.file);}restoringRoute=false;}
 function syncRoute(){if(!routeReady||restoringRoute)return;const r=currentRoute(),encoded=JSON.stringify(r);if(encoded===lastRoute)return;const u=new URL(location.href);u.searchParams.set('pocket',r.screen);if(r.path)u.searchParams.set('at',r.path);else u.searchParams.delete('at');u.searchParams.set('view',r.tab);if(r.file)u.searchParams.set('doc',r.file);else u.searchParams.delete('doc');window.history[lastRoute?'pushState':'replaceState']({pocket:r},'',u);lastRoute=encoded;}
 const dossierMessage=e=>{
  if(e.origin!==location.origin)return;
  const frames=[...mounts.values()].flatMap(({root})=>[...root.querySelectorAll('.dossier-frame')]);
  const frame=frames.find(f=>f.contentWindow===e.source);if(!frame)return;
  const model=models.get(frame.closest('[data-pane]')?.dataset.pane)||readerModel();
  if(e.data?.type==='omega-document-revealed'&&fields.pendingOrigin?.token===e.data.token)fields.pendingOrigin=null;
  if(e.data?.type==='omega-document-open')openDocument(e.data.path);
  if(e.data?.type==='omega-document-location')fields.documentLocation={...e.data,path:model.path};
  if(e.data?.type==='omega-document-context')setDocumentContext(e.data.scope,{...e.data,path:model.path});
 };window.addEventListener('message',dossierMessage);
 const pop=()=>{const u=new URL(location.href);applyRoute(window.history.state?.pocket||{screen:u.searchParams.get('pocket')||'work',path:u.searchParams.get('at')||'workspace:all',tab:u.searchParams.get('view')||'conversation',file:u.searchParams.get('doc')});};
 window.addEventListener('popstate',pop);

let draftReady=false;
const restored=new Set(),restoring=new Set();
 function saveDraft(t,text){
  if(!draftKey||t.path!=='task:'+t.data?.['task-id']||t.data?.['task-at']==null)return;
  if(text)draftCache[t.path]={at:t.data['task-at'],text};else delete draftCache[t.path];
  try{sessionStorage.setItem(draftKey,JSON.stringify(draftCache));}catch{}
 }
 function syncDraft(){
  if(!draftReady)return;
  const t=task(),at=t.data?.['task-at'];if(!draftKey||at==null||t.path!=='task:'+t.data?.['task-id'])return;
  const id=t.path+':'+at;
  if(!restored.has(id)){
   restored.add(id);const cached=draftCache[t.path];
   if(cached?.at===at&&typeof cached.text==='string'&&cached.text&&!t.draft){restoring.add(id);sentDraft={path:t.path,text:cached.text};send('task',{type:'mobile/draft',text:cached.text});forceRender();return;}
  }
  if(restoring.has(id)&&!t.draft)return;
  restoring.delete(id);saveDraft(t,replyText(t));
 }
 async function restoreDrafts(){
  if(disposed)return;
  draftAbort=new AbortController();const timeout=setTimeout(()=>draftAbort.abort(),5000);
  try{
   const r=await fetch('/api/doc?path=launch:identity',{signal:draftAbort.signal,cache:'no-store'}),j=await r.json(),identity=JSON.parse(j.text);
   if(disposed||!r.ok||!j.ok)return;if(!identity.db){routeReady=true;const u=new URL(location.href);if(u.searchParams.has('pocket'))pop();render();return;}
   draftKey='omega.pocket.drafts:'+JSON.stringify([identity.root,identity.db,identity.live]);
   sessionKey=draftKey+':view';
   try{session=JSON.parse(sessionStorage.getItem(sessionKey)||'{}');Object.assign(fields,session.fields||{});for(const [k,v] of session.positions||[])positions.set(k,v);for(const [k,v] of session.queries||[])queries.set(k,v);if(session.selection)send('rail',{type:'mobile/selection',selection:session.selection});for(const [field,value] of Object.entries(session.new||{}))if(!touched.has(field))send('rail',{type:'mobile/new-field',field,value});}catch{}
   try{const cached=JSON.parse(sessionStorage.getItem(draftKey)||'{}');if(cached&&typeof cached==='object'&&!Array.isArray(cached))draftCache=cached;}catch{}
   const u=new URL(location.href);const restoredRoute=u.searchParams.has('pocket')?{screen:u.searchParams.get('pocket'),path:u.searchParams.get('at'),tab:u.searchParams.get('view')||'conversation',file:u.searchParams.get('doc')}:session.route;
   draftReady=true;routeReady=true;if(restoredRoute&&!userActed)applyRoute(restoredRoute);syncDraft();render();
  }catch{}finally{clearTimeout(timeout);}
 }
 let placeDraft={},directoryData={},directoryAbort,toastTimer;
 const forceRender=()=>{const root=mounts.get('rail')?.root;if(root)root._fingerprint=null;render();};
 async function copy(text){try{await navigator.clipboard.writeText(text);fields.toast='Copied';}catch{fields.toast='Copy unavailable. Use system selection.';}clearTimeout(toastTimer);toastTimer=setTimeout(()=>{fields.toast=null;forceRender();},2500);forceRender();}
 async function directory(path){modal('directory');directoryAbort?.abort();directoryAbort=new AbortController();directoryData={loading:true};forceRender();try{const r=await fetch('/api/doc?path='+encodeURIComponent('directory:'+path),{signal:directoryAbort.signal,cache:'no-store'}),j=await r.json();directoryData=j.ok?j.data:{error:j.message||'Directory unavailable'};}catch(e){if(e.name!=='AbortError')directoryData={error:String(e.message)};}forceRender();}
 const connection=()=>`<button class="connection ${online()?'':'offline'}" data-act="host"><i></i><span class="sr-only">${online()?'Host connected':'Reconnecting'}</span></button>`;
 const placeChoices=()=>{
  const rows=rail().objects||[];
  const current=rows.filter(o=>o.type==='desk/scope'&&o.place);const choices=current.length?current:(shell().places||[]);const d=rail().data;if(d?.place&&!choices.some(o=>o.place===d.place))return [...choices,{place:d.place,title:d.name||d.place,root:d.root,cwd:d.cwd,settings:d.settings}];return choices;
 };
 const commandPane=()=>shell().screen==='task'?'task':shell().screen==='document'?'file':'rail';
 const commandChoices=()=>{const pane=shell()['command-pane']||commandPane(),query=(shell()['command-query']||'').toLowerCase(),priority=pane==='task'?['mobile/send','desk/link','omega/steer','omega/cancel']:pane==='rail'?['places/attach','desk/new','mobile/places']:['mobile/publish','buffers/resolve','buffers/changes','eval-cell','desk/link'];return (models.get(pane)?.commands||[]).filter(c=>(c.name+' '+c.doc+' '+commandLabel(c)).toLowerCase().includes(query)).sort((a,b)=>{const rank=x=>priority.includes(x.name)?priority.indexOf(x.name):100;return rank(a)-rank(b);}).slice(0,query?100:8);};
 const commandLabel=c=>({'mobile/publish':'Publish','buffers/resolve':'Resolve overlap','buffers/undo':'Undo edit','desk/link':'Link reference','places/attach':'Add place','mobile/unload':'Return to editor','eval-cell':'Run cell'}[c.name]||c.name.split('/').pop().replaceAll('-',' ').replace(/^./,x=>x.toUpperCase()));

 // ── Pocket: one view model for the BL screens (mob.view) ──────────────────
 let homeDir='',repoState={repos:[],picked:new Set(),loading:false},placeData={};
 const intent=async(name,args)=>{const r=await fetch('/api/intent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({intent:name,args}),cache:'no-store'});return r.json();};
 let contextRequest=0;
 async function setDocumentContext(scope,location){
  const m=readerModel(),loc=location||((fields.documentLocation?.path===m.path)?fields.documentLocation:{});
  const path=location?.path||fields.contextDocument?.path||m.path;if(!path)return;
  const request=++contextRequest;fields.contextLoading=true;
  try{
   const j=await intent('document/context',{path,scope,row:loc.row??loc.start??0,start:loc.start,end:loc.end,rev:loc.rev||m.revision});
   if(request!==contextRequest||disposed)return;
   if(!j.ok)throw new Error(j.message||j.error||'Could not read the starting context');
   fields.contextDocument={path:j.selection.path,row:loc.row??loc.start??0,rev:j.selection.rev};
   send('rail',{type:'mobile/selection',selection:j.selection});return j.selection;
  }catch(e){fields.toast=e.message;forceRender();}finally{if(request===contextRequest){fields.contextLoading=false;forceRender();}}
 }
 async function beginDocumentTask(){
  if(readerModel().dirty){fields.toast='Publish your edits before starting from this document.';forceRender();return;}
  const m=readerModel(),sel=shell().selection;
  fields.contextDocument=null;
  const same=!!sel&&(sel.path===m.path||(sel.document&&sel.document===m.data?.dossier?.id)||(sel.file&&sel.file===m.data?.['buffer-path']));
  const context=await setDocumentContext(same?'passage':fields.documentLocation?.path===m.path?(fields.documentLocation.scope||'part'):'document',same?{...sel,row:sel.start}:undefined);
  if(!context)return;
  fields.launchFrom=shell().screen==='task'?'task':'document';fields.launchTask=shell()['task-path'];
  const place=context.project||placeChoices().find(p=>context.file?.startsWith((p.root||p.cwd)+'/'))?.place||session.lastPlace||placeChoices()[0]?.place;
  if(place)draft('place',place);
  modal(null);nav('launch');
 }
 async function revealTaskOrigin(taskId){
  try{
   const j=await intent('document/reveal',{task:taskId});if(!j.ok)throw new Error(j.message||j.error||'Source unavailable');
   if(['missing','ambiguous'].includes(j.state)){fields.originSnapshot=j.origin;fields.originMessage=j.message;modal('origin-snapshot');forceRender();return;}
   if(j.state==='changed')fields.toast='This source has changed since the task started.';
   fields.originSequence=(fields.originSequence||0)+1;fields.pendingOrigin={...j,task:taskId,token:String(fields.originSequence)};openDocument(j.path);deliverOrigin();
  }catch(e){
   try{const r=await fetch('/api/doc?path='+encodeURIComponent('task:'+taskId),{cache:'no-store'}),d=await r.json();
    if(d.data?.origin){fields.originSnapshot=d.data.origin;fields.originMessage=e.message;modal('origin-snapshot');forceRender();return;}
   }catch{}
   fields.toast=e.message;forceRender();
  }
 }
 function deliverOrigin(){
  const pending=fields.pendingOrigin;if(!pending||file().path!==pending.path)return;
  const root=mounts.get('rail')?.root,frame=root?.querySelector('.dossier-frame');
  if(frame){
   if(frame.dataset.revealSent===pending.token)return;frame.dataset.revealSent=pending.token;
   const reveal=()=>frame.contentWindow?.postMessage({type:'omega-document-reveal',row:pending.row,end:pending.end,token:pending.token},location.origin);
   frame.addEventListener('load',reveal,{once:true});reveal();
  }else{
   const line=root?.querySelector(`[data-row="${pending.row}"]`);if(line){line.classList.add('source-origin');line.scrollIntoView({block:'center'});fields.pendingOrigin=null;}
  }
 }
 const config=settings=>Object.fromEntries(Object.entries(settings||{}).map(([k,v])=>[k,v&&typeof v==='object'&&'value' in v?v.value:v]));
 function pocketPlaces(){
  const pins=session.pins||[];
  return (rail().objects||[]).filter(o=>o.type==='desk/scope'&&o.place).map(o=>({id:o.place,name:o.title,root:o.root||o.cwd,cwd:o.cwd,branch:o.branch,home:!!homeDir&&(o.root||o.cwd)===homeDir,config:config(o.settings),pinned:pins.includes('place:'+o.place)}))
   .sort((a,b)=>(b.pinned-a.pinned)||a.name.localeCompare(b.name));
 }
 const stripNext=text=>String(text||'').split('\n').filter(l=>!l.trim().startsWith('#+next:')).join('\n').trim();
 function pocketTasks(all){const now=Date.now(),sn=session.snoozed||{};return (rail().objects||[]).filter(o=>o.type==='omega/task'&&(all||!((sn[o.key]||0)>now&&(o.ask||o.proposals?.length)))).map(o=>({...o,activity:o.activity||null}));}
 const snoozedCount=()=>{const now=Date.now(),sn=session.snoozed||{};return (rail().objects||[]).filter(o=>o.type==='omega/task'&&(sn[o.key]||0)>now&&(o.ask||o.proposals?.length)).length;};
 let formattedPath=null,formattedTurns=new Map();
 function pocketSession(){
  const d=sessionData(),t=task();
  if(formattedPath!==t.path){formattedPath=t.path;formattedTurns.clear();}
  const next=new Map(),turns=(t.path===shell()['task-path']&&Array.isArray(t.data?.turns)?t.data.turns:[]).map(turn=>{
   const key=JSON.stringify(turn);let value=formattedTurns.get(key);
   if(!value)value={...turn,content:(turn.content||[]).map(b=>b.type==='text'?{...b,text:stripNext(b.text),html:rich(stripNext(b.text))}:b.type==='tool-result'?{...b,content:String(b.content??'').slice(0,20000)}:b)};
   next.set(key,value);return value;
  });formattedTurns=next;
  // A typed question's own choices keep their exact values as the next steps.
  const q=(t.objects||[]).find(o=>o.type==='omega/msg'),qd=(d.questions||[]).find(x=>x.id===q?.key)||(d.questions||[])[0],offered=qd?.choices||qd?.data?.choices;
  const choices=Array.isArray(offered)&&offered.length?offered.map(c=>typeof c==='string'?{label:c,text:c}:{label:c.label,text:c.value??c.label}):null;
  // An open question message means it is the person's turn, whatever the last status said.
  return {...d,turns,ask:d.ask||q?.message||null,proposals:d.proposals?.length?d.proposals:choices,'task-status':q&&d['task-status']==='done'?'idle':d['task-status']};
 }
 function viewModel(){
  const s=shell(),screen=s.screen||'work',places=pocketPlaces(),pane=s['command-pane']||commandPane();
  const vm={screen,online:online(),home:homeDir,places,tasks:pocketTasks(),filter:session.filter||null,modal:s.modal||null,
   embedded:!!s.workbench,'in-app':new URL(location.href).searchParams.get('app')==='pocket',pins:session.pins||[],recent:session.recent||[],repos:repoState.repos,picked:[...repoState.picked],
   'repo-query':fields['repo-query']||'','repos-loading':repoState.loading,'saving-places':!!s.adding,
   'palette-query':fields['palette-query']||'','palette-index':fields['palette-index']||0,
   commands:(models.get(pane)?.commands||[]).map(c=>({name:c.name,label:commandLabel(c)})),
   evaluating:!!s.evaluating,'eval-result':s['eval-result']??null,namespace:s['eval-namespace']||session.namespace||null,
   selection:s.selection||null,creating:!!s.creating||!!fields.contextLoading,snoozed:screen==='work'?snoozedCount():0,'command-pane':pane,'eval-target':fields.evalTarget||null,'editor-result':fields.evalTarget==='editor'?(models.get(pane)?.message||''):null,scrolled:screen==='work'&&!!fields.scrolled,notice:null,tab:s.tab||'conversation',unseen:fields.unseen===s['task-path']};
  if(vm.filter)vm.tasks=vm.tasks.filter(t=>t.place===vm.filter);
  if(screen==='place'){const id=s['place-id'],p=places.find(x=>x.id===id)||{id,name:id};Object.assign(vm,{place:p,'place-tab':s['place-tab']||'sessions',info:placeData[id]?.info||{},entries:placeData[id]?.entries??null,subpath:placeData[id]?.subpath||''});vm.tasks=pocketTasks(true);}
  if(['places','buffers'].includes(screen)||vm.modal==='commands')vm.tasks=pocketTasks(true);
  if(screen==='launch')vm.draft={...(s.new||{}),place:(s.new||{}).place||session.lastPlace||places[0]?.id};
  if(screen==='task'||vm.modal==='details'||(vm.modal==='commands'&&s['task-path']&&screen==='task'))vm.session=pocketSession();
  return vm;
 }
 async function loadRepos(){repoState.loading=true;forceRender();try{const j=await intent('pocket/repos',{});if(j.ok){repoState.repos=j.repos||[];homeDir=j.home||homeDir;}}catch{}repoState.loading=false;forceRender();}
 async function loadPlace(id,folder){
  if(!id)return;const p=pocketPlaces().find(x=>x.id===id);const slot=placeData[id]=placeData[id]||{};
  try{const dir=p?.root||p?.cwd;if(dir&&!folder){const j=await intent('pocket/place-info',{dir});if(j.ok)slot.info=j;}}catch{}
  try{const path=folder||'folder:'+id,r=await fetch('/api/doc?path='+encodeURIComponent(path),{cache:'no-store'}),j=await r.json();
   if(j.ok){slot.subpath=path.split('/').slice(1).join('/');const sub=path.split('/').slice(1).join('/'),status=slot.info?.status||{};slot.entries=(j.objects||[]).filter(o=>o.type==='workspace/folder'||o.type==='workspace/file').map(o=>{const name=String(o.label||o.key||'').split('/').filter(Boolean).pop();return {name:o.title||name,filename:name,path:o.key,'dir?':o.type==='workspace/folder','data?':name?.startsWith('!'),git:sub?null:status[name]||null};}).sort((a,b)=>(b['dir?']-a['dir?'])||(a['data?']-b['data?'])||a.name.localeCompare(b.name));}}catch{}
  forceRender();
 }
 const draft=(field,value)=>{touched.add(field);send('rail',{type:'mobile/new-field',field,value});};
 const placeIdFor=path=>{let h=0;for(const c of path)h=(h*31+c.charCodeAt(0))>>>0;return path.split('/').pop().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')+'-'+h.toString(16).padStart(8,'0').slice(0,8);};
 function work(){
  if(!rail().path?.startsWith('workspace:'))return empty('Opening…','');
  const r=rail(),os=r.objects||[],tasks=os.filter(o=>o.type==='omega/task'),groups=(r.groups||[]).map(g=>({...g,rows:g.id==='attention'?g.rows.filter(o=>(session.snoozed?.[o.key]||0)<Date.now()):g.rows})).filter(g=>g.rows.length);
  const scope=os.find(o=>o.type==='desk/scope'&&o.active)?.title||'All places';
  const card=o=>`<button class="task-card ${o.ask?'attention':''} ${session.read?.[o.key]===o.ask?'read':''} ${esc(o.status)}" data-key="task:${esc(o.key)}" data-act="open-task" data-path="task:${esc(o.key)}" aria-label="${esc(o.title||o.goal)} · ${esc(status(o))}"><div class="card-meta"><span class="state-dot ${o.ask?'peach':o.status==='done'?'sage':'lilac'}" aria-hidden="true"></span><span class="task-state">${esc(status(o))}</span><span class="place-label">${esc(o['place-name']||o.place||'')}</span></div><h2>${esc(compact(o.title||o.goal))}</h2>${o.summary===''?'':`<p>${esc(o.summary||o.goal)}</p>`}</button>`;
  const group=(label,items,cls='')=>items.length?`<section class="task-group"><div class="section-label ${cls}">${label}<span>${items.length}</span></div>${items.map(card).join('')}</section>`:'';
  return `<div class="heading-row"><h1>Work</h1>${btn(icon('plus'),'new','round primary','aria-label="New task"')}</div><div class="scope-row">${btn(icon('places')+esc(scope)+'<span class="chevron">⌄</span>','scope','scope')}${btn(icon('filter'),'scope','icon-button','aria-label="Filter by place"')}</div>${groups.map(g=>group(g.title,g.rows,g.id==='attention'?'attention-label':'')).join('')}${Object.values(session.snoozed||{}).some(t=>t>Date.now())?btn('Snoozed','unsnooze','text-button'):''}${tasks.length?'':empty('No tasks','')}`;
 }
 function sessionData(){
  const t=task(),path=shell()['task-path'];
  if(t.data?.desk==='task'&&(!path||t.path===path))return t.data;
  if(sessionContext&&sessionContext.path===path)return sessionContext.data;
  const row=(rail().objects||[]).find(o=>o.type==='omega/task'&&'task:'+o.key===path);
  return row?{...row,'task-title':row.title||row.goal,'task-status':row.status}:{};
 }
 function sessionHeader(){
  const d=sessionData(),label=d['task-title']||'Session',place=d['place-name']||d.place;
  return `${btn(icon('back'),'work','back-button','aria-label="Back to Work"')}<div class="session-heading"><h1 class="task-title" title="${esc(label)}">${esc(label)}</h1><div class="task-context">${place?btn('<span class="session-place-name">'+esc(place)+'</span><span aria-hidden="true">⌄</span>','context','session-place','aria-label="Session place and context"'):''}<span class="tag ${d.ask?'peach':d['task-status']==='failed'?'error':finished(d)?'sage':'lilac'}"><span class="sr-only">${esc(d.ask?'Needs you':d['task-status']||'Opening')}</span></span></div></div>`;
 }
 function sessionTabs(){
  const d=sessionData(),which=shell().tab||'conversation',files=new Set((d.artifacts||[]).map(a=>a.path).filter(Boolean)).size,changes=new Set(d['changed-files']||(d.artifacts||[]).filter(a=>a.kind==='changed').map(a=>a.path)).size;
  const tabs=[['conversation','Conversation',null],['plan','Files',files],['changes','Changes',changes]].map(([id,label,count])=>btn(label+(count==null?(fields.unseen===shell()['task-path']?'<span class="tab-dot" aria-label="Unread output"></span>':''):`<span class="tab-count">${count}</span>`),'tab-'+id,`tab ${which===id?'selected':''}`,`aria-selected="${which===id}" role="tab"`)).join('');
  return `<div class="tabs" role="tablist" aria-label="Session views">${tabs}</div>`;
 }
 function taskScreen(){
  const t=task(),d=t.data||{},s=shell(),which=s.tab||'conversation';
  if(which==='conversation'&&t.path&&!t.path.startsWith('task:')&&t.path!=='desk:welcome')return reader(t,'task');
  if((s['task-path']&&t.path!==s['task-path'])||d.desk!=='task')return empty('Opening…','');
  const home=d.home,artifact=(d.artifacts||[]).find(a=>a.kind!=='home')||home||(file().path?.startsWith('work:')?{path:file().path}:null);
  let body='';
  if(which==='conversation'){
   body='';
   const question=(t.objects||[]).find(o=>o.type==='omega/msg'),questionData=(d.questions||[]).find(q=>q.id===question?.key)||(d.questions||[])[0],offered=questionData?.choices||questionData?.data?.choices;const choices=Array.isArray(offered)?offered:[];
   let questionMarkup='';if(question)questionMarkup=`<section class="question-card"><h3>${esc(question.message||d.ask||'Question')}</h3><div class="answer-row">${choices.map(choice=>btn(esc(typeof choice==='string'?choice:choice.label),'choice','secondary',`data-answer="${esc(typeof choice==='string'?choice:choice.value)}" ${!online()||t.state?.pending?'disabled':''}`)).join('')}${btn('Answer','answer','primary')}${btn('Later','snooze','text-button')}</div></section>`;
   if(question)body+=btn('Question ↓','question-anchor','attention-anchor');
   body+=conversation(t)+questionMarkup;
   const result=d['task-result'];if(result&&!d.turns?.some(turn=>(turn.content||[]).some(block=>block.type==='text'&&block.text?.includes(result))))body+=`<article class="message outcome"><div class="message-who">Outcome</div>${rich(result)}</article>`;
   if(d['task-status']==='running')body+='<div class="turn-status" role="status">Working<span aria-hidden="true"> ···</span></div>';
   else if(d['task-status']==='idle'&&!question)body+='<div class="turn-status">Answered</div>';
   else if(finished(d))body+=`<div class="turn-status">${esc(d['task-status'])}</div>`;
  }else if(s['file-path']&&file().path!==s['file-path'])body=empty('Opening…','');
  else if(which==='plan')body=artifactList(d)+((s['file-path']&&file().path===s['file-path'])?artifactView(file(),home,artifact):'');
  else body=changesView(file(),artifact);
  return `<div class="task-body">${body}</div>`;
 }
 function artifactList(d){return `<div class="artifact-list">${(d.artifacts||[]).map(a=>btn(`<span class="artifact-kind">${esc(a.kind==='home'?'Home':a.kind)}</span>${icon('file')}<span>${esc(a.kind==='home'?'Home':a.label||a.path)}<small>${esc(a.path)}</small></span>`,'artifact','file-row',`data-path="${esc(a.path)}" ${a.block?`data-block="${esc(a.block)}"`:''}`)).join('')||empty('No files','')}${btn(icon('places')+'Folder','folder','sheet-option')}</div>`;}
 // Read DOM geometry after scroll restoration too, so background updates and
 // returning from Files keep the prompt aligned with the visible conversation.
 function syncPrompt(root){
  const strip=root.querySelector('.conversation-prompt'),scroll=root.querySelector('.mobile-scroll');
  if(!strip||!scroll)return;
  const prompts=[...scroll.querySelectorAll('[data-user-prompt]')];
  const top=scroll.getBoundingClientRect().top;
  let current=prompts[0];
  for(const prompt of prompts){if(prompt.getBoundingClientRect().top>top+1)break;current=prompt;}
  const text=current?.dataset.userPrompt||'';
  strip.hidden=!text;
  if(strip.textContent!==text)strip.textContent=text;
  strip.title=text;
 }
 const promptAttr=text=>` data-user-prompt="${esc(String(text).split(/\r?\n/)[0])}"`;
 function conversation(t){
  if(Array.isArray(t.data?.turns)&&t.data.turns.length){
   const turns=t.data.turns,results=new Map(turns.flatMap(turn=>(turn.content||[]).filter(b=>b.type==='tool-result').map(b=>[b.id,b])));
   return turns.map(turn=>`<div data-key="turn:${esc(t.path)}:${turn.n}">${(turn.content||[]).map((block,index)=>{
    if(block.type==='text'&&block.text?.trim())return `<article class="message ${turn.role==='user'?'human':'agent'}" data-key="text:${index}"${turn.role==='user'?promptAttr(block.text):''}><div class="message-who">${turn.role==='user'?'You':'ω'}${btn('Copy','copy','text-button',`data-text="${esc(encodeURIComponent(block.text))}" aria-label="Copy message"`)}</div>${rich(block.text)}</article>`;
    if(block.type==='tool-use'){const result=results.get(block.id),input=block.input?.code||block.input?.command||(typeof block.input==='string'?block.input:JSON.stringify(block.input,null,2));const hint=(input||'').match(/(?:read|write|shell|exec)\s*[ (]+["']?([^"'\n)]+)/)?.[0]||Object.values(block.input||{}).find(v=>typeof v==='string')||'';
     return `<details class="execution ${result?.['error?']?'failed':''}" data-key="step:${esc(block.id)}"><summary><code>${esc(block.name)}</code><span>${esc(compact(hint))}</span><small>${result?(result['error?']?'Failed':'✓'):'…'}</small></summary><div class="execution-body"><pre>${esc(input)}</pre>${result?`<pre class="tool-result">${esc(result.content)}</pre>${btn('Copy output','copy','text-button',`data-text="${esc(encodeURIComponent(result.content))}"`)}`:''}</div></details>`;
    }return '';
   }).join('')}</div>`).join('');
  }
  // Provider source stays inspectable. Source syntax is only styled here;
  // task identity, questions, results and available controls are typed data.
  const lines=t.text.split('\n'),out=[];let chunk=[],who='';
  const flush=()=>{if(chunk.some(x=>x.trim())&&chunk.some(x=>/^#\+begin_src/i.test(x))){out.push(`<details class="execution" data-key="${esc(t.path+':'+(chunk.join('\n').match(/:id\s+([^\s]+)/)?.[1]||chunk[0]))}"><summary>Agent step · execution details</summary><pre>${esc(chunk.join('\n'))}</pre></details>`);chunk=[];return;}if(chunk.some(x=>x.trim()))out.push(`<article class="message ${who==='you'?'human':'agent'}"${who==='you'?promptAttr(chunk.join('\n').trim()):''}><div class="message-who"><span class="avatar">${who==='you'?'Y':'ω'}</span>${esc(who==='you'?'You':'Agent')}<span class="message-rule"></span></div>${rich(chunk.join('\n'))}</article>`);chunk=[];};
  let collecting=false;
  for(const l of lines){
   if(/^\* (you|agent|assistant|model)\s*[·:]/i.test(l)){flush();who=/^\* you/i.test(l)?'you':'agent';collecting=true;continue;}
   if(/^\* /.test(l)){flush();collecting=false;continue;}
   if(collecting&&!/^(⚑|:\s*#omega|\s*[ys]\s*[▸>])/.test(l))chunk.push(l);
  }flush();
  return out.join('')||`<article class="message agent"><div class="message-who"><span class="avatar">ω</span>Agent</div><p>Your task is opening. Its updates will appear here.</p></article>`;
 }
 function prose(lines){
  const out=[];let code=[],inside=false;
  for(const line of lines){
   if(/^#\+begin_src/i.test(line)){inside=true;continue;}
   if(/^#\+end_src/i.test(line)){inside=false;out.push(`<details class="execution"><summary>Execution details</summary><pre>${esc(code.join('\n'))}</pre></details>`);code=[];continue;}
   if(inside){code.push(line);continue;}
   if(/^#\+RESULTS:/i.test(line)||/^:/.test(line))continue;
   if(line.trim())out.push(`<p>${esc(line)}</p>`);
  }if(code.length)out.push(`<pre>${esc(code.join('\n'))}</pre>`);return out.join('');
 }
 function composer(t){
  const d=t.data||{},pending=t.state?.pending;
  return `<form class="composer" data-form="reply"><label class="sr-only" for="mobile-reply">${finished(d)?'Follow-up goal':'Instruction to agent'}</label><textarea id="mobile-reply" data-field="reply" rows="1" placeholder="${finished(d)?'New follow-up…':d['task-status']==='running'?'Steer…':d.ask?'Answer…':'Reply…'}">${esc(replyText(t))}</textarea><div class="composer-foot"><span>${pending?'Sending to host…':!online()?'Offline · draft retained':finished(d)?'New task':d['task-status']==='running'?'Current turn':''}</span>${btn(icon('send'),'send','send-button',`aria-label="${finished(d)?'Start follow-up':'Send instruction'}" ${!online()||pending?'disabled':''}`)}</div></form>`;
 }
 function artifactView(f,home,artifact){
  if(f.data?.dossier&&f.commands?.some(c=>c.name==='dossier/toggle'))return reader(f);
  if(!home&&!artifact)return empty('No plan linked yet','Use References in Actions to inspect this task’s context.');
  if(!f.path||f.path==='desk:welcome')return empty('Opening…','');
  if(f['read-only']||!f.path.startsWith('work:'))return reader();
  const lines=f.text.split('\n');
  const document=lines.map((l,row)=>{
   if(/^#\+TITLE:/i.test(l))return `<h2>${esc(l.replace(/^#\+TITLE:\s*/i,''))}</h2>`;
   const todo=l.match(/^(\*+) (TODO|DONE) (.*)$/);
   if(todo)return `<button class="check-row ${todo[2]==='DONE'?'complete':''}" data-act="toggle" data-row="${row}"><span class="checkbox">${todo[2]==='DONE'?icon('check'):''}</span><span>${esc(todo[3])}</span></button>`;
   if(/^\*+ /.test(l))return `<h3>${esc(l.replace(/^\*+ /,''))}</h3>`;
   if(/^#\+begin_task/.test(l))return `<div class="task-source-label">LINKED TASK ${btn('Start / open','start-block','text-button',`data-row="${row}" ${online()?'':'disabled'}`)}</div>`;
   if(/^#\+end_task/.test(l))return '';
   const ref=l.match(/#omega\/task.*:id "([^"]+)"/);if(ref)return btn('Open linked task '+icon('arrow'),'open-task','file-row',`data-path="task:${esc(ref[1])}"`);
   if(/^#\+/.test(l))return '';
   return l?`<p class="document-line ${row===f.cursor?'anchored':''}">${esc(l)}</p>`:'<div class="document-gap"></div>';
  }).join('');
  return `<div class="file-toolbar"><div>${icon('file')}<span>${esc(f.path.split('/').pop())}<small>${f.dirty?'Unpublished edits':'Saved to host'}</small></span></div>${btn(f.state?.editing?'Done editing':'Edit','edit-mode','secondary')}</div><article class="document">${f.state?.editing?`<label class="sr-only" for="mobile-file">Working document source</label><textarea id="mobile-file" class="source-editor" data-field="file" spellcheck="false">${esc(f.text)}</textarea>`:document}</article>${f.dirty?`<div class="publish-bar"><span>Your edits are unpublished</span>${btn('Publish','publish','primary',online()?'':'disabled')}</div>`:''}<details class="source-details"><summary>Document address</summary><code>${esc(f.path)}</code></details>`;
 }
 function browseDocument(f){return `<h2>${esc(title(f))}</h2><div class="place-list">${(f.objects||[]).filter(o=>o.type.startsWith('workspace/')||o.type==='omega/task').map(o=>btn(icon(o.type==='workspace/file'?'file':'places')+esc(o.label||f.text.split('\n')[o.row]||o.key),'browse','place-card',`data-path="${esc(o.type==='omega/task'?'task:'+o.key:o.key)}"`)).join('')}</div><details class="source-details"><summary>Document & settings</summary><pre>${esc(f.text)}</pre></details>`;}
 function changesView(f,artifact){
  const d=sessionData(),files=[...new Map((d.artifacts||[]).filter(a=>a.path?.startsWith('work:')&&(!Array.isArray(d['changed-files'])||d['changed-files'].includes(a.path))).map(a=>[a.path,a])).values()];
  const choices=`<div class="review-files">${files.map(a=>btn(icon('file')+esc(a.label||a.path),'review-file',`file-row ${f.path==='changes:'+a.path?'selected':''}`,`data-path="${esc(a.path)}"`)).join('')}</div>`;
  if(!files.length)return empty('No changed files','');
  if(!shell()['file-path']||!files.some(a=>'changes:'+a.path===shell()['file-path']))return choices+empty('Choose a file','');
  if(f.path!==shell()['file-path'])return choices+empty('Opening…','');
  const ops=(f.objects||[]).filter(o=>o.type==='buffer/op'),lines=f.text.split('\n');
  return choices+`<div class="section-label">${esc(f.data?.['buffer-path']||artifact?.label||'Changes')}<span>${ops.length}</span></div>${ops.map(o=>`<article class="change-card" data-key="change:${esc(o.key)}"><div class="change-heading"><strong>${esc(o.actor||lines[o.row]?.replace(/^\* /,''))}</strong><small>${esc(o.kind||'')} · ${esc(o.rev||'')}</small></div>${o.old!=null?unified(o.before??o.old,o.after??o.new):`<pre>${esc(lines.slice(o.row+2,o.row+4).join('\n'))}</pre>`}${btn('Undo','undo','secondary',`data-row="${o.row}" data-id="${esc(o.key)}" ${online()?'':'disabled'}`)}</article>`).join('')||empty('No edits','')}`;
 }
 function places(){
  const r=rail(),os=(r.objects||[]).filter(o=>['workspace/place','workspace/folder','workspace/file'].includes(o.type)),detail=r.path?.startsWith('place:')||r.path?.startsWith('folder:');
  return `<div class="heading-row"><h1>${detail?esc(title(r)):'Places'}</h1>${btn(icon('plus'),'add-place','round primary','aria-label="Add place"')}</div>${detail?btn('‹ Places','places','text-button'):''}${r.data?.root?`<code class="place-root">${esc(r.data.root)}</code>`:''}<div class="place-list">${os.map(o=>`<div class="place-entry" data-key="place:${esc(o.key)}">${btn(icon(o.type==='workspace/file'?'file':'places')+`<span><strong>${esc(o.name||o.title||(r.text.split('\n')[o.row]||o.key).replace(/^[*▸\s]+/,''))}</strong><small>${esc(o.root||o.key)}</small></span>`+(session.pins?.includes(o.key)?'★':icon('arrow')),o.type==='workspace/file'?'open-file':'open-place','place-card',`data-path="${esc(o.key)}"`)}${btn(session.pins?.includes(o.key)?'★':'☆','pin','icon-button',`data-path="${esc(o.key)}" aria-label="Pin ${esc(o.name||o.key)}"`)}</div>`).join('')}</div>${detail?`<div class="place-actions">${btn('Work','place-tasks','secondary')}${btn('New task','new','primary')}${r.data?.place?btn('Settings','edit-place','secondary'):''}</div><dl class="settings">${Object.entries(r.data?.settings||{}).map(([key,v])=>`<dt>${esc(key)}</dt><dd>${esc(typeof v.value==='string'?v.value:JSON.stringify(v.value))}<small>← ${esc(v.from)}</small></dd>`).join('')}</dl>`:''}`;
 }
 function buffers(){const recent=session.recent||[],paths=[...new Set([...(session.pins||[]).filter(p=>p!=='machine:'),...recent.map(x=>x.path)])];return `<div class="heading-row"><h1>Buffers</h1>${btn(icon('plus'),'commands','icon-button','aria-label="Open buffer"')}</div><div class="place-entry">${btn(icon('host')+'Machine','machine','sheet-option')}${btn(session.pins?.includes('machine:')?'★':'☆','pin','icon-button','data-path="machine:" aria-label="Pin Machine"')}</div>${paths.map(path=>`<div class="place-entry">${btn(icon(path.startsWith('place:')?'places':'file')+`<span>${esc(recent.find(x=>x.path===path)?.title||path.split('/').pop())}<small>${esc(path)}</small></span>`,'buffer','place-card',`data-path="${esc(path)}"`)}${btn(session.pins?.includes(path)?'★':'☆','pin','icon-button',`data-path="${esc(path)}" aria-label="Pin buffer"`)}</div>`).join('')||empty('No buffers','')}`;}
 function machine(){return `<div class="heading-row"><h1>Machine</h1>${connection()}</div><code>${esc(shell()['eval-namespace']||session.namespace||location.hostname)}</code><div class="repl-history">${(session.repl||[]).map((x,i)=>`<article data-key="repl:${i}"><pre class="repl-input">${esc(x.code)}</pre><pre class="repl-result">${esc(x.result)}</pre></article>`).join('')}</div><form data-form="machine" class="repl-form"><label class="sr-only" for="machine-code">Lisp expression</label><textarea id="machine-code" data-field="machine-code" spellcheck="false" placeholder="(+ 1 2)">${esc(fields['machine-code']||'')}</textarea>${btn(shell().evaluating?'Evaluating…':'Evaluate','machine-run','primary',online()&&!shell().evaluating?'':'disabled')}${btn('Namespaces','namespaces','secondary')}</form>${btn('Connection','host','sheet-option')}`;}
 function host(){return `<h1>Connection</h1><section class="host-card"><span class="host-illustration">${icon('host')}</span><h2>${esc(location.hostname)}</h2><span role="status">${online()?'Connected':'Reconnecting'}</span>${btn('Reconnect','reconnect','secondary')}</section>${btn('Runtime inspector','runtime','sheet-option')}${btn('Machine','machine','sheet-option')}${btn('Namespaces','namespaces','sheet-option')}${btn('Commands','commands','sheet-option')}${btn('Return to bl·ed','unload','sheet-option')}`;}
 const inline=formatInline;
 function reader(f=file(),pane='file'){
  const lines=(f.text||'').split('\n'),query=queries.get(f.path)||'',selected=shell().selection;
  const headings=lines.flatMap((l,row)=>/^(\*+|#{1,6}) /.test(l)?[{row,label:l.replace(/^(\*+|#{1,6}) /,'')}]:[]);
  const objects=(f.objects||[]).filter(o=>o.type==='bl/ns'||o.type==='bl/var'||o.type.startsWith('workspace/')||o.type==='omega/task');
  const dossier=f.commands?.some(c=>c.name==='dossier/toggle')?f.data?.dossier:null;
  const rows=dossier?'':rich(f.text,{pane,structure:f.structure,query,selection:selected,path:f.path});
  return `<div class="reader-tools">${btn(icon('back'),'document-back','icon-button',`aria-label="Back" data-pane="${pane}"`)}${btn('Outline','outline','text-button')}${btn('Find','find','text-button')}${btn(icon('copy'),'copy-passage','icon-button',`aria-label="Copy passage" title="Copy passage" ${selected?.path===f.path?'':'disabled'}`)}${f.commands?.some(c=>c.name==='document-tasks/part')?btn(icon('work'),'document-task','icon-button','aria-label="Start task from document" title="Work on this…"'):''}${!f['read-only']?btn(f.state?.editing?'Read':'Edit','edit-mode','text-button',`data-pane="${pane}"`):''}</div>${fields.find===f.path?`<form data-form="search" class="reader-search"><input type="search" data-field="search" data-path="${esc(f.path)}" aria-label="Find in document" placeholder="Find…" value="${esc(query)}"/><span class="find-count">${query?lines.filter(l=>l.toLowerCase().includes(query.toLowerCase())).length:0}</span>${btn('↑','find-prev','icon-button','aria-label="Previous match"')}${btn('↓','find-next','icon-button','aria-label="Next match"')}</form>`:''}${objects.length?`<div class="place-list">${objects.map(o=>btn(esc(o.label||o.key),'document-object','sheet-option',`data-pane="${pane}" data-path="${esc(o.type==='omega/task'?'task:'+o.key:o.key)}" ${o.type.startsWith('bl/')?`data-command="bl/open" data-row="${o.row}"`:''}`)).join('')}</div>`:''}<article class="document reader" data-pane="${pane}" aria-label="Document">${dossier?`<iframe data-key="dossier:${esc(dossier.id)}" title="Interactive document" class="dossier-frame" src="${esc(dossier.url)}" ${f.state?.editing?'hidden':''}></iframe>`:''}${f.state?.editing&&!f['read-only']?`<textarea aria-label="Document source" class="source-editor" data-field="file" data-pane="${pane}">${esc(f.text)}</textarea>`:dossier?'':rows}</article>${f.dirty?`<div class="publish-bar">${(/overlap|Not published|resolve/i.test(f.message||''))?btn('Resolve','resolve','secondary'):''}${btn('Publish','publish','primary',`data-pane="${pane}" ${online()?'':'disabled'}`)}</div>`:''}<details class="source-details"><summary>${esc(f.path)}</summary><pre>${esc(f.revision)}</pre></details>`;
 }

 function sheet(){
  const s=shell(),value=s.modal,t=task(),d=sessionData(),r=rail();
  const pending=prompt();
  if(pending){const [pane,m]=pending,mb=m.minibuf;return `<div class="scrim" data-act="dismiss"><section class="sheet" role="dialog" aria-modal="true" aria-label="Editor prompt">${btn(icon('close'),'dismiss','sheet-close','aria-label="Cancel prompt"')}<form data-form="prompt" data-pane="${esc(pane)}"><label for="editor-prompt">${esc(mb.prompt)}</label><input id="editor-prompt" data-field="prompt" data-pane="${esc(pane)}" value="${esc(mb.text)}" autocomplete="off"/><button class="primary full" type="submit">Enter</button></form></section></div>`;}
  if(!value)return '';
  let content='';
  if(value==='origin-snapshot')content=`<h2>Original starting context</h2><p>${esc(fields.originMessage)}</p><strong>${esc(fields.originSnapshot?.label)}</strong><pre class="origin-preview">${esc(fields.originSnapshot?.text)}</pre>`;
  if(value==='scope')content=`<h2>Places</h2>${btn('All places','scope-choice','sheet-option','data-path="workspace:all"')}${placeChoices().map(o=>btn(icon('places')+esc(o.title),'scope-choice','sheet-option',`data-path="${esc(o.key)}"`)).join('')}`;
  if(value==='new'){
   const field=s.new||{},selected=field.place||r.data?.place||session.lastPlace||placeChoices().find(p=>p.place==='project')?.place||placeChoices()[0]?.place;
   content=`<h2>New task</h2>${s.selection?`<blockquote>${esc(s.selection.text)}</blockquote>`:''}<form data-form="new"><label for="new-place">Place</label><select id="new-place" data-field="new-place">${placeChoices().map(o=>`<option value="${esc(o.place)}" ${o.place===selected?'selected':''}>${esc(o.title)}</option>`).join('')}</select>${btn('+ Place','add-place','text-button')}${btn('Context','context','text-button')}<label for="new-title">Title <small>optional</small></label><input id="new-title" data-field="new-title" value="${esc(field.title||'')}" maxlength="120"/><label for="new-goal">Goal</label><textarea id="new-goal" autofocus data-field="new-goal" rows="4" placeholder="Goal…">${esc(field.goal)}</textarea><button class="primary full" type="submit" ${!online()||s.creating?'disabled':''}>${s.creating?'Starting…':'Start task '+icon('arrow')}</button></form>`;
  }
  if(value==='context'){const taskContext=s.screen==='task'&&fields.contextSource!=='new';const selected=placeChoices().find(p=>p.place===(taskContext?d.place:(s.new?.place||r.data?.place||session.lastPlace||'project')));content=`<h2>Context</h2><dl class="settings"><dt>Place</dt><dd>${esc(taskContext?d['place-name']||d.place:selected?.title||'')}</dd><dt>Directory</dt><dd><code>${esc(taskContext?d.cwd:selected?.cwd||selected?.root||'')}</code></dd></dl>${s.selection?`<blockquote>${esc(s.selection.text)}</blockquote><code>${esc(s.selection.path)} · ${esc(s.selection.rev)}</code>`:''}${Object.entries(selected?.settings||{}).map(([key,v])=>`<div class="context-setting"><code>${esc(key)}</code> ${esc(typeof v.value==='string'?v.value:JSON.stringify(v.value))}<small>← ${esc(v.from)}</small></div>`).join('')}${taskContext?artifactList(d):''}`;}
  if(value==='place'){content=`<h2>${placeDraft.id?'Place settings':'Add place'}</h2><form data-form="place">${[['name','Name'],['id','Address'],['root','Directory']].map(([key,label])=>`<label for="place-${key}">${label}</label><input id="place-${key}" ${key==='name'?'autofocus':''} data-field="place-${key}" value="${esc(placeDraft[key]||'')}" ${key==='id'&&r.data?.place===placeDraft.id?'readonly':''} required/>`).join('')}${btn('Browse','choose-directory','secondary')}<label for="place-parent">Parent</label><select id="place-parent" data-field="place-parent"><option value="">None</option>${placeChoices().filter(o=>o.place!==placeDraft.id).map(o=>`<option value="${esc(o.place)}" ${o.place===placeDraft.parent?'selected':''}>${esc(o.title)}</option>`).join('')}</select><label for="place-cwd">Working directory</label><input id="place-cwd" data-field="place-cwd" value="${esc(placeDraft.cwd||'')}" placeholder="Inherit"/><label for="place-home">Home</label><input id="place-home" data-field="place-home" value="${esc(placeDraft.home||'')}" placeholder="Document address"/><button type="submit" class="primary full" ${s['saving-place']||!online()?'disabled':''}>Save</button></form>`;}
  if(value==='directory')content=`<h2>Directory</h2><code>${esc(directoryData.directory||'')}</code>${directoryData.loading?'<p role="status">Loading…</p>':directoryData.error?`<p role="alert">${esc(directoryData.error)}</p>`:`${btn('Use directory','use-directory','primary full')}${btn('↑ Parent','directory','sheet-option',`data-path="${esc(directoryData.parent)}"`)}${(directoryData.entries||[]).map(e=>btn(icon('places')+esc(e.name),'directory','sheet-option',`data-path="${esc(e.path)}"`)).join('')}`}`;
  if(value==='undo'){const op=file().objects?.find(o=>o.key===fields['undo-id']);content=`<h2>Undo edit?</h2><code>${esc(op?.path||file().data?.['buffer-path'])}</code><p>${esc(op?.actor)} · ${esc(op?.kind)}</p>${unified(op?.before??op?.old,op?.after??op?.new)}${btn('Cancel','dismiss','secondary')}${btn('Undo','confirm-undo','primary')}`;}
  if(value==='actions'){const pane=commandPane(),m=models.get(pane);content=`<h2>${esc(title(m))}</h2><code>${esc(m?.path)}</code>${(m?.actions||[]).map(a=>btn(`<span>${esc(a.name)}<small>${esc(a.doc)}</small></span>`,'object-action','sheet-option',`data-command="${esc(a.command)}" data-pane="${pane}"`)).join('')}${btn('Commands','commands','sheet-option')}`;}
  if(value==='cancel')content=`<h2>Cancel this task?</h2>${btn('Keep working','dismiss','secondary')}${btn('Cancel task','confirm-cancel','primary',online()?'':'disabled')}`;
  if(value==='source'){const m=models.get(commandPane());content=`<h2>Source</h2><code>${esc(m?.path)}</code><pre class="inspect-source">${esc(m?.text)}</pre>`;}
  if(value==='outline')content=`<h2>Outline</h2>${(readerModel().text||'').split('\n').flatMap((l,row)=>/^(\*+|#{1,6}) /.test(l)?[btn(esc(l.replace(/^(\*+|#{1,6}) /,'')),'heading','sheet-option',`data-row="${row}"`)]:[]).join('')}`;
  if(value==='commands')content=`<h2>Commands</h2><label class="sr-only" for="command-query">Find command</label><input autofocus id="command-query" data-field="command-query" placeholder="Find command…" value="${esc(s['command-query']||'')}"/><div class="command-results">${commandChoices().map(c=>btn(`<span>${esc(commandLabel(c))}<small>${esc(c.name)}</small></span>`,'run-command','sheet-option',`data-name="${esc(c.name)}"`)).join('')}</div><label for="command-pane">Target</label><select id="command-pane" data-field="command-pane">${['rail','task','file'].map(p=>`<option value="${p}" ${p===(s['command-pane']||commandPane())?'selected':''}>${{rail:'Work',task:'Conversation',file:'Document'}[p]}</option>`).join('')}</select><form data-form="open"><label for="open-address">Open</label><input id="open-address" data-field="address" value="${esc(fields.address||'')}" placeholder="bl: or a document address"/><button class="secondary" type="submit">Open</button></form><form data-form="eval"><label for="eval-code">Lisp</label><textarea id="eval-code" data-field="eval-code" placeholder="(+ 1 2)">${esc(s['eval-code']||'')}</textarea><button class="secondary" name="target" value="editor" type="submit">Editor</button><button class="secondary" name="target" value="machine" type="submit">Machine</button></form>${(s['eval-result']||models.get(s['command-pane']||commandPane())?.message)?`<pre role="status">${esc(s['eval-result']||models.get(s['command-pane']||commandPane())?.message)}</pre>`:''}`;
  return `<div class="scrim" data-act="dismiss"><section class="sheet" data-key="sheet:${esc(value)}" role="dialog" aria-modal="true" aria-label="${esc(value)}">${btn(icon('close'),'dismiss','sheet-close','aria-label="Close dialog"')}${['place','new'].includes(value)&&/^Could not|^Choose a place|^Write an instruction|^Not sent/i.test(r.message||'')?`<p class="sheet-error" role="alert">${esc(r.message)}</p>`:''}${content}</section></div>`;
 }
 let rendering=false,renderQueued=false;
 function render(){
  if(disposed)return;if(composing){renderMissed=true;return;}renderMissed=false;
  if(rendering){renderQueued=true;return;}
  rendering=true;
  try{renderNow();}
  finally{rendering=false;if(renderQueued){renderQueued=false;queueMicrotask(render);}}
 }
 function renderNow(){
  const root=mounts.get('rail')?.root;if(!root)return;
  const s=shell(),screen=s.screen||'work',which=s.tab||'conversation',t=task();
  // The task's draft is the reply box's own text: typing never redraws the screen.
  const fingerprint=JSON.stringify([...models.values()].map(m=>m.draft===undefined?m:{...m,draft:null}));if(root._fingerprint===fingerprint)return;root._fingerprint=fingerprint;
  const reading=readerModel();
  const readerKey=JSON.stringify([screen,reading.path,reading.text,reading.state?.editing,s.modal]);
  const selection=window.getSelection(),anchor=selection?.anchorNode;
  // Preserve the browser's range and selection handles while the package
  // records the passage. Replacing this DOM would also break native Copy.
  if(!selection?.isCollapsed&&root._readerKey===readerKey&&root.contains(anchor)&&
     (anchor?.nodeType===1?anchor:anchor?.parentElement)?.closest('.reader-line')){
   const selected=s.selection;
   for(const line of root.querySelectorAll('.reader-line'))line.classList.toggle('passage',selected?.path===reading.path&&+line.dataset.row>=selected.start&&+line.dataset.row<selected.end);
   for(const button of root.querySelectorAll('[data-act="ask-passage"],[data-act="copy-passage"]'))button.disabled=selected?.path!==reading.path;saveSession();
   const connection=root.querySelector('.connection');connection?.classList.toggle('offline',!online());
   if(connection)connection.querySelector('.sr-only').textContent=online()?'Host connected':'Reconnecting';
   const work=root.querySelector('.bottom-nav [data-act="work"]'),needs=(rail().objects||[]).some(o=>o.ask),dot=work?.querySelector('.nav-dot');
   if(needs&&work&&!dot)work.insertAdjacentHTML('beforeend','<b class="nav-dot"></b>');else if(!needs)dot?.remove();return;
  }
  const priorDialog=root.querySelector('[role="dialog"]');
  const active=document.activeElement,field=active?.dataset.field,start=active?.selectionStart,end=active?.selectionEnd;
  const priorScroll=root.querySelector('.mobile-scroll'),follow=priorScroll&&priorScroll.scrollHeight-priorScroll.clientHeight-priorScroll.scrollTop<80;const changedTask=root._taskText!=null&&root._taskText!==t.text;const oldScroll=priorScroll?.scrollTop||0;if(root._viewKey)positions.set(root._viewKey,oldScroll);
  const viewKey=screen+':'+(screen==='document'?file().path:screen==='task'?which+':'+(which==='conversation'?t.path:file().path):rail().path);
  if(changedTask&&screen==='task'&&t.data?.desk==='task'&&(which!=='conversation'||!follow))fields.unseen=t.path;root._taskText=t.text;
  if(screen==='task'&&which==='conversation'&&root._viewKey===viewKey&&follow&&fields.unseen===t.path)fields.unseen=null;
  const noticeOrder=[...models.entries()].sort(([a],[b])=>(messageOrder.get(b)||0)-(messageOrder.get(a)||0)).map(([,m])=>m.message);
  const message=noticeOrder.filter(Boolean).find(x=>/unsaved|discard|overlap|not sent|could not|not published|retained|reverted|Publish the file|Choose a place|Write an instruction|^Sent\.|^Added \d+ place|Copied/i.test(x));
  const vm=viewModel(),pending=prompt(),inConversation=screen==='task'&&which==='conversation';
  const taskReady=t.data?.desk==='task'&&t.path===s['task-path'];
  if(pending)vm.modal='prompt';
  if(vm.modal&&!['details','add-places','commands'].includes(vm.modal))vm['sheet-html']=sheet();
  if(screen==='task'){
   if(inConversation&&!(t.path&&!t.path.startsWith('task:')&&t.path!=='desk:welcome')){if(!taskReady)vm['body-html']=empty('Opening…','');else if(!t.data?.turns?.length&&t.text?.trim())vm['body-html']=`<div class="task-body legacy">${conversation(t)}</div>`;vm['prompt-strip']=taskReady;if(taskReady)vm['conversation-html']=conversationView(vm.session);if(taskReady)vm['composer-html']=(fields.unseen===t.path?btn('New output ↓','latest','latest'):'')+composer(t);}
   else vm['body-html']=taskScreen();
   if(s.workbench)vm['aside-html']='<aside class="workbench-preview-list" aria-label="Work" data-key="workbench-preview" data-host-slot="workbench-preview"></aside>';
  }
  if(screen==='document'){vm['body-html']=reader();vm.title=title(file())||'Document';}
  if(screen==='machine'){vm['body-html']=machine();vm.title='Machine';}
  if(screen==='host'){vm['body-html']=host();vm.title='Connection';}
  vm.notice=fields.toast||message||null;
  if(message&&message!==fields.noticeShown){fields.noticeShown=message;clearTimeout(fields.noticeTimer);fields.noticeTimer=setTimeout(()=>{for(const pane of ['rail','task','file'])send(pane,{type:'mobile/clear'});},3600);}
  reconcile(root,renderView(vm));
  root.querySelector('.mobile-scroll').scrollTop=positions.get(viewKey)||0;if(changedTask&&follow&&root._viewKey===viewKey&&screen==='task'&&which==='conversation')root.querySelector('.mobile-scroll').scrollTop=1e9;if(root._viewKey!==viewKey&&screen==='task'&&which==='plan'&&file().cursor>0&&!positions.has(viewKey)){const row=file().cursor;(root.querySelector(`[data-row="${row}"]`)||root.querySelector(`[data-row="${row+1}"]`))?.scrollIntoView({block:'start'});}root._viewKey=viewKey;
  syncPrompt(root);
  root._readerKey=readerKey;
  const dialog=root.querySelector('[role="dialog"]');
  if(dialog&&(!priorDialog||dialog!==priorDialog)){if(!priorDialog)root._returnFocus=active;queueMicrotask(()=>(dialog.querySelector('[autofocus]')||dialog.querySelector('input,textarea,select')||dialog.querySelector('button'))?.focus({preventScroll:true}));}
  for(const sibling of root.querySelector('.mobile-app').children)if(!sibling.classList.contains('scrim'))sibling.inert=!!dialog;
  if(!dialog&&priorDialog&&root._returnFocus?.isConnected)root._returnFocus.focus({preventScroll:true});
  syncRoute();saveSession();deliverOrigin();
  if(field){const el=root.querySelector(`[data-field="${field}"]`);if(el){el.focus({preventScroll:true});if(typeof start==='number'&&el.setSelectionRange)el.setSelectionRange(start,end);}}
 }
 function handle(event){
  flushReply();
  const el=event.target.closest('[data-act]');if(!el)return;if(event.isTrusted!==false&&!el.dataset.proxy)userActed=true;
  if(el.classList.contains('scrim')&&event.target!==el)return;
  const action=el.dataset.act,d=sessionData(),artifact=(d.artifacts||[]).find(a=>a.kind!=='home')||d.home;
  if(el.disabled||(!online()&&['yes','no','send','publish','undo','confirm-cancel','start-block'].includes(action)))return;event.preventDefault();
  switch(action){
   case 'work':nav('work','workspace:all');break;
   case 'places':nav('places');if(!repoState.repos.length)loadRepos();break;
   // ── Pocket screens ──
   case 'propose':case 'quick':{const key=el.dataset.path.slice(5),o=(rail().objects||[]).find(x=>x.key===key);if(!o)break;send('rail',{type:'mobile/quick',task:key,msg:o['ask-id']||null,status:o.status,place:o.place,cwd:o.cwd,text:el.dataset.text});break;}
   case 'reply':nav('task',el.dataset.path);requestAnimationFrame(()=>setTimeout(()=>mounts.get('rail')?.root.querySelector('[data-field="reply"]')?.focus(),60));break;
   case 'launch-close':if(fields.launchFrom==='document')openDocument(fields.contextDocument?.path||file().path);else nav(fields.launchFrom||'work',fields.launchFrom==='task'?fields.launchTask:'workspace:all');break;
   case 'launch-place':draft('place',el.dataset.path);session.lastPlace=el.dataset.path;saveSession();break;
   case 'launch-set':{const v=el.dataset.value;draft(el.dataset.field,v==='true'?true:v==='false'?false:v);break;}
   case 'launch-unref':{const refs=[...(shell().new?.refs||[])];refs.splice(+el.dataset.value,1);draft('refs',refs);break;}
   case 'launch-ref-selection':{const sel=shell().selection;if(!sel)break;draft('refs',[...(shell().new?.refs||[]),{label:`${sel.path.split('/').pop()} · lines ${sel.start+1}–${sel.end}`,text:`passage ${sel.path} lines ${sel.start+1}–${sel.end}:\n${sel.text}`}]);break;}
   case 'launch-ref-file':fields['palette-query']='@';fields.paletteFor='launch';modal('commands');break;
   case 'launch-ref-session':fields['palette-query']='';fields.paletteFor='launch-session';modal('commands');break;
   case 'launch-start':{if(shell().creating||!online())break;const vm=viewModel(),args=launchArgs(vm);if(!args.goal||!args.place||fields.contextLoading)break;session.lastPlace=args.place;saveSession();send('rail',{type:'mobile/create',place:args.place,goal:args.goal,title:args.title,run:args.run});break;}
   case 'add-places':modal('add-places');repoState.picked=new Set();loadRepos();break;
   case 'repo-toggle':{const p=el.dataset.path;repoState.picked.has(p)?repoState.picked.delete(p):repoState.picked.add(p);forceRender();break;}
   case 'repos-add':{const chosen=repoState.repos.filter(r=>repoState.picked.has(r.path));if(!chosen.length)break;send('rail',{type:'mobile/add-places',places:chosen.map(r=>({id:placeIdFor(r.path),name:r.name,root:r.path}))});repoState.picked=new Set();setTimeout(loadRepos,1500);break;}
   case 'place-tab':send('rail',{type:'mobile/field',field:'place-tab',value:el.dataset.value});if(el.dataset.value==='files'&&!placeData[shell()['place-id']]?.entries)loadPlace(shell()['place-id']);break;
   case 'place-default':{const id=shell()['place-id'];fetch('/api/doc?path='+encodeURIComponent('place:'+id),{cache:'no-store'}).then(r=>r.json()).then(j=>{const d=j.data||{};send('rail',{type:'mobile/place-save',id,name:d.name,root:d['own-root']||'',parent:d.parent||'',home:d.home?.path||'',cwd:d.config?.cwd||'',config:{...(d.config||{}),[el.dataset.field]:el.dataset.value}});});break;}
   case 'details':modal('details');break;
   case 'app-server':location.href='https://pocket.invalid/server';break;
   case 'tool':{const id=el.dataset.value;if(id==='machine')nav('machine');else if(id==='runtime')send('rail',{type:'mobile/runtime'});else if(id==='live')send('rail',{type:'mobile/live'});else if(id==='music')location.href='/?use=pelagic&layout=pelagic&file=spikes/pelagic/live-set.bl.org';break;}
   case 'open-address':modal(null);openDocument(el.dataset.path);break;
   case 'palette-pick':{
    const run=el.dataset.run;
    if(fields.paletteFor==='launch'&&run==='open-file'){fields.paletteFor=null;fields['palette-query']='';modal(null);draft('refs',[...(shell().new?.refs||[]),{label:el.dataset.path.split('/').pop(),text:`file ${el.dataset.path}`}]);break;}
    if(fields.paletteFor==='launch-session'&&run==='open-task'){fields.paletteFor=null;modal(null);const o=(rail().objects||[]).find(x=>'task:'+x.key===el.dataset.path);draft('refs',[...(shell().new?.refs||[]),{label:o?.title||el.dataset.path,text:`session ${el.dataset.path} (${o?.title||''}): continue from its outcome`}]);break;}
    fields.paletteFor=null;fields['palette-query']='';if(!['answer'].includes(run))modal(null);
    const proxy=document.createElement('button');proxy.dataset.act=run==='answer'?'palette-steer':run;for(const [k,v] of Object.entries(el.dataset))if(!['act','run','index'].includes(k))proxy.dataset[k]=v;
    handle({target:proxy,preventDefault(){},stopPropagation(){}});break;
   }
   case 'palette-eval':{const q=(fields['palette-query']||'').replace(/^:/,'').trim();if(!q)break;fields.evalTarget=el.dataset.value;if(el.dataset.value==='editor')send(shell()['command-pane']||commandPane(),{type:'mobile/eval',text:q});else if(!shell().evaluating){session.pendingCode=q;send('rail',{type:'mobile/machine-eval',text:q});}forceRender();break;}
   case 'palette-pane':send('rail',{type:'mobile/field',field:'command-pane',value:el.dataset.value});break;
   case 'palette-steer':modal(null);requestAnimationFrame(()=>mounts.get('rail')?.root.querySelector('[data-field="reply"]')?.focus());break;
   case 'host':nav('host');break;
   case 'buffers':nav('buffers');break;
   case 'machine':nav('machine');break;
   case 'runtime':send('rail',{type:'mobile/runtime'});break;
   case 'namespaces':openDocument('bl:');break;
   case 'machine-run':if(shell().evaluating)break;send('rail',{type:'mobile/machine-eval',text:fields['machine-code']||''});session.pendingCode=fields['machine-code'];break;
   case 'buffer':if(el.dataset.path==='machine:')nav('machine');else if(el.dataset.path.startsWith('task:'))nav('task',el.dataset.path);else if(el.dataset.path.startsWith('place:')){nav('place',el.dataset.path);loadPlace(el.dataset.path.slice(6));}else openDocument(el.dataset.path);break;
   case 'pin':session.pins=(session.pins||[]).includes(el.dataset.path)?session.pins.filter(x=>x!==el.dataset.path):[...(session.pins||[]),el.dataset.path];saveSession();forceRender();break;
   case 'artifact':if(d.origin&&(el.dataset.path===d.origin.path||el.dataset.path===d.home?.path))revealTaskOrigin(d['task-id']);else tab('plan',el.dataset.path,el.dataset.block);break;
   case 'review-file':tab('changes','changes:'+el.dataset.path);break;
   case 'copy':copy(el.dataset.copy??decodeURIComponent(el.dataset.text));break;
   case 'copy-passage':copy(window.getSelection()?.toString()||shell().selection?.text||'');break;
   case 'choice':send('task',{type:'mobile/send',answer:el.dataset.answer});break;
   case 'add-place':placeDraft=session.placeDraft||{};modal('place');break;
   case 'edit-place':{const id=shell()['place-id'];fetch('/api/doc?path='+encodeURIComponent('place:'+id),{cache:'no-store'}).then(r=>r.json()).then(j=>{const d=j.data||{};placeDraft={id:d.place||id,name:d.name,root:d['own-root']||'',parent:d.parent||'',home:d.home?.path||'',cwd:d.config?.cwd||'',config:d.config||{}};modal('place');});break;}
   case 'choose-directory':directory(placeDraft.root||rail().data?.root||'/');break;
   case 'directory':directory(el.dataset.path);break;
   case 'use-directory':placeDraft.root=directoryData.directory;modal('place');break;
   case 'scope':modal('scope');break;
   case 'context':fields.contextSource=shell().modal==='new'?'new':'task';modal('context');break;
   case 'snooze':session.snoozed={...(session.snoozed||{}),[d['task-id']]:Date.now()+3600000};saveSession();nav('work','workspace:all');break;
   case 'unsnooze':session.snoozed={};saveSession();forceRender();break;
   case 'question-anchor':mounts.get('rail').root.querySelector('.question-card')?.scrollIntoView({block:'center'});break;
   case 'latest':fields.unseen=null;mounts.get('rail').root.querySelector('.mobile-scroll')?.scrollTo({top:1e9});forceRender();break;
   case 'find':fields.find=fields.find!==readerModel().path?readerModel().path:null;forceRender();if(fields.find)mounts.get('rail').root.querySelector('[data-field="search"]')?.focus();break;
   case 'resolve':command('file','buffers/resolve');break;
   case 'new':{fields.contextDocument=null;send('rail',{type:'mobile/selection',selection:null});const s0=shell();fields.launchFrom=['work','places','place','buffers'].includes(s0.screen)?s0.screen:'work';if(el.dataset.path)draft('place',el.dataset.path);else if(s0.screen==='place')draft('place',s0['place-id']);modal(null);nav('launch');requestAnimationFrame(()=>setTimeout(()=>mounts.get('rail')?.root.querySelector('[data-field="new-goal"]')?.focus({preventScroll:true}),80));break;}
   case 'object-action':{
    // Presentation-specific navigation stays in the existing touch adapters;
    // ordinary commands (including owned confirmation prompts) stay in bl-ed.
    const pane=el.dataset.pane,name=el.dataset.command;
    if(!(models.get(pane)?.actions||[]).some(a=>a.command===name))break;
    const adapted={'desk/new':'new','desk/source':'source','desk/artifact':'working-file','desk/folder':'folder','desk/home':'origin','desk/place':'inspect-place','desk/references':'inspect-references','desk/conversation':'document-back'}[name];
    if(adapted==='inspect-place'){modal(null);const m=models.get(pane),place=m?.data?.place;if(place)nav('places','place:'+place);}
    else if(adapted==='inspect-references'){modal(null);const data=models.get(pane)?.data||{},id=data['task-id']||data['link-source']?.task,place=data.place||data['link-source']?.place;if(id||place)openDocument('links:'+(id?'task/'+id:'place/'+place));}
    else if(adapted){const proxy=document.createElement('button');proxy.dataset.act=adapted;handle({target:proxy,preventDefault(){},stopPropagation(){}});}
    else {modal(null);command(pane,name);}
    break;
   }
   case 'actions':modal('actions');break;
   case 'dismiss':{const p=prompt();if(p)send(p[0],{type:'key',key:'Escape'});else modal(null);break;}
   case 'scope-choice':{modal(null);const id=el.dataset.path.replace(/^workspace:/,'');session.filter=id==='all'?null:id;saveSession();if(shell().screen!=='work')nav('work','workspace:all');else forceRender();break;}
   case 'open-task':session.read={...(session.read||{}),[el.dataset.path.slice(5)]:(rail().objects||[]).find(o=>'task:'+o.key===el.dataset.path)?.ask};saveSession();nav('task',el.dataset.path);break;
   case 'open-place':{const path=el.dataset.path;if(path.startsWith('folder:')){loadPlace(shell()['place-id'],path);break;}const id=path.replace(/^place:/,'');if(shell().screen!=='place'||shell()['place-id']!==id){nav('place',path);loadPlace(id);}break;}
   case 'place-tasks':nav('work','workspace:'+(rail().data?.place||rail().path.split(':')[1]));break;
   case 'tab-conversation':if(shell()['task-path']&&task().path!==shell()['task-path'])nav('task',shell()['task-path']);else tab('conversation');break;
   case 'tab-plan':if(shell()['task-path']&&task().path!==shell()['task-path'])nav('task',shell()['task-path']);tab('plan');break;
   case 'tab-changes':{if(shell()['task-path']&&task().path!==shell()['task-path'])nav('task',shell()['task-path']);const changed=d['changed-files']?.[0]??(Array.isArray(d['changed-files'])?null:(d.artifacts||[]).find(a=>a.path?.startsWith('work:'))?.path);tab('changes',changed?'changes:'+changed:undefined);break;}
   case 'yes':send('task',{type:'mobile/send',answer:'yes'});break;
   case 'no':send('task',{type:'mobile/send',answer:'no'});break;
   case 'answer':mounts.get('rail').root.querySelector('[data-field="reply"]')?.focus();break;
   case 'send':send('task',{type:'mobile/send'});break;
   case 'publish':command(el.dataset.pane||'file','mobile/publish');break;
   case 'start-block':command('file','eval-cell',Number(el.dataset.row));break;
   case 'browse':if(el.dataset.path.startsWith('task:'))nav('task',el.dataset.path);else tab('plan',el.dataset.path);break;
   case 'toggle':command('file','desk/toggle',Number(el.dataset.row));break;
   case 'undo':fields['undo-row']=el.dataset.row;fields['undo-id']=el.dataset.id;modal('undo');break;
   case 'confirm-undo':{const op=file().objects?.find(o=>o.key===fields['undo-id']);modal(null);if(op)command('file','buffers/undo',op.row);break;}
   case 'edit-mode':send(el.dataset.pane||'file',{type:'mobile/edit-mode'});break;
   case 'folder':modal(null);tab('plan',d.folder);break;
   case 'working-file':modal(null);tab('plan',artifact?.path);break;
   case 'references':modal(null);openDocument('links:task/'+d['task-id']);break;
   case 'open-file':openDocument(el.dataset.path);break;
   case 'document-link':{const source=models.get(el.closest('.reader')?.dataset.pane)||file();let path=el.dataset.path;if(/^https?:/.test(path)){window.open(path,'_blank','noopener');break;}path=path.replace(/^file:/,'');if(!/^[a-z-]+:/i.test(path)&&source.path?.startsWith('work:'))path=source.path.slice(0,source.path.lastIndexOf('/')+1)+path;openDocument(path);break;}
   case 'document-object':if(el.dataset.command)command(el.dataset.pane||'file',el.dataset.command,Number(el.dataset.row));else if(el.dataset.path.startsWith('task:'))nav('task',el.dataset.path);else openDocument(el.dataset.path);break;
   case 'document-back':if(el.dataset.pane==='task'){nav('task',shell()['task-path']);break;}if(history.length){const path=history.pop();send('rail',{type:'mobile/document',path,dirty:file().dirty,'current-file':file().path});}else nav('places','places:');break;
   case 'outline':modal('outline');break;
   case 'heading':{const row=el.dataset.row;modal(null);mounts.get('rail').root.querySelector(`.reader-line[data-row="${row}"]`)?.scrollIntoView({block:'start'});break;}
   case 'find-prev':
   case 'find-next':{const root=mounts.get('rail').root,matches=[...root.querySelectorAll('.reader-line.match')],scroll=root.querySelector('.mobile-scroll');(action==='find-prev'?(matches.filter(x=>x.offsetTop<scroll.scrollTop-20).at(-1)||matches.at(-1)):(matches.find(x=>x.offsetTop>scroll.scrollTop+40)||matches[0]))?.scrollIntoView({block:'start'});break;}
   case 'ask-passage':case 'document-task':beginDocumentTask();break;
   case 'document-scope':setDocumentContext(el.dataset.value,fields.contextDocument);break;
   case 'task-origin':revealTaskOrigin(el.dataset.task||d['task-id']);break;
   case 'read-result':openDocument(task().path);break;
   case 'origin':modal(null);openDocument(d.home?.path);break;
   case 'commands':fields['palette-query']='';fields['palette-index']=0;fields.paletteFor=null;modal('commands');break;
   case 'run-command':modal(null);command(shell()['command-pane']||commandPane(),el.dataset.name);break;
   case 'source':modal('source');break;
   case 'cancel-task':modal('cancel');break;
   case 'confirm-cancel':send('task',{type:'mobile/cancel'});modal(null);break;
   case 'reconnect':probe();break;
   case 'unload':command('rail','mobile/unload');break;
  }
 }
 function input(event){const e=event.target,f=e.dataset.field;if(f?.startsWith('place-')){placeDraft[f.slice(6)]=e.value;session.placeDraft=placeDraft;if(f==='place-id')placeDraft.manualId=true;if(f==='place-name'&&!placeDraft.manualId){placeDraft.id=e.value.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');forceRender();}}if(f)fields[f]=e.value;if(f==='prompt')send(e.dataset.pane,{type:'mobile/prompt',text:e.value});if(f==='search'){queries.set(e.dataset.path||file().path,e.value);const root=mounts.get('rail')?.root;if(root)root._fingerprint=null;render();}if(['command-pane','command-query','eval-code'].includes(f))send('rail',{type:'mobile/field',field:f,value:e.value});if(f==='reply'){replyPending={path:task().path,text:e.value};clearTimeout(replyTimer);replyTimer=setTimeout(flushReply,250);}if(f==='repo-query'||f==='palette-query'){if(f==='palette-query')fields['palette-index']=0;forceRender();}if(f==='file')send(e.dataset.pane||'file',{type:'mobile/edit',text:e.value});if(f?.startsWith('new-')){touched.add(f.slice(4));send('rail',{type:'mobile/new-field',field:f.slice(4),value:e.value});}if(f!=='reply')saveSession();}
 function submit(event){const form=event.target.closest('form');if(!form)return;event.preventDefault();flushReply();
  if(form.dataset.form==='place'){session.placeDraft=placeDraft;send('rail',{type:'mobile/place-save',...placeDraft});return;}
  if(form.dataset.form==='machine'){if(shell().evaluating)return;session.pendingCode=fields['machine-code'];send('rail',{type:'mobile/machine-eval',text:fields['machine-code']||''});return;}
  if(form.dataset.form==='search'){handle({target:form.querySelector('[data-act="find-next"]'),preventDefault(){}});return;}
  if(form.dataset.form==='prompt'){send(form.dataset.pane,{type:'key',key:'Enter'});return;}
  if(form.dataset.form==='open'){modal(null);openDocument(form.querySelector('input').value.trim());return;}
  if(form.dataset.form==='eval'){const text=form.querySelector('textarea').value;if(event.submitter?.value==='machine')send('rail',{type:'mobile/machine-eval',text});else send(shell()['command-pane']||commandPane(),{type:'mobile/eval',text});return;}
  if(!online())return;if(form.dataset.form==='reply')send('task',{type:'mobile/send'});if(form.dataset.form==='new'){session.lastPlace=form.querySelector('select').value;saveSession();}if(form.dataset.form==='new')send('rail',{type:'mobile/create',place:form.querySelector('select').value,goal:form.querySelector('textarea').value,title:form.querySelector('[data-field="new-title"]').value});}
 function passage(event){
  const target=event?.target?.closest?.('[data-row]');
  if(target){const m=models.get(target.dataset.pane)||readerModel();fields.documentLocation={path:m.path,row:+target.dataset.row,start:+target.dataset.row,end:+target.dataset.end,rev:m.revision};}
  const selected=window.getSelection();if(!selected||selected.isCollapsed)return;const node=n=>(n?.nodeType===1?n:n?.parentElement)?.closest('.reader-line');const a=node(selected.anchorNode),b=node(selected.focusNode);if(!a||!b||a.dataset.pane!==b.dataset.pane)return;const source=models.get(a.dataset.pane)||file();const start=Math.min(+a.dataset.row,+b.dataset.row),end=Math.max(+a.dataset.row,+b.dataset.row)+1;send('rail',{type:'mobile/selection',selection:{path:source.path,rev:source.revision,start,end,text:source.text.split('\n').slice(start,end).join('\n')}});}

 async function probe(){
  if(disposed||probing)return;probing=true;probeAbort=new AbortController();const timeout=setTimeout(()=>probeAbort.abort(),5000);
  try{const r=await fetch('/api/doc?path=desk:welcome',{signal:probeAbort.signal,cache:'no-store'}),j=await r.json();if(!disposed)send('rail',{type:'mobile/connection',online:r.ok&&j.ok===true,checked:Date.now()});}
  catch{if(!disposed)send('rail',{type:'mobile/connection',online:false,checked:Date.now()});}
  finally{clearTimeout(timeout);probing=false;}
 }
 const network=()=>probe();window.addEventListener('online',network);window.addEventListener('offline',network);
 const paletteKey=e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'&&!shell().workbench){e.preventDefault();fields['palette-query']='';fields['palette-index']=0;fields.paletteFor=null;modal('commands');}};document.addEventListener('keydown',paletteKey,true);
 probeTimer=setInterval(probe,8000);queueMicrotask(probe);queueMicrotask(()=>intent('pocket/home',{}).then(j=>{if(j.ok&&j.home){homeDir=j.home;forceRender();}}).catch(()=>{}));queueMicrotask(restoreDrafts);
 return {mount(root){let role;const click=e=>{e.stopPropagation();handle(e);},onInput=e=>input(e),onSubmit=e=>submit(e),onScroll=e=>{if(e.target.matches?.('.mobile-scroll')){const app=root.querySelector('.mobile-app'),last=root._lastTop||0,top=e.target.scrollTop;fields.scrolled=top>40&&top>=last;if(app)app.classList.toggle('scrolled',fields.scrolled);root._lastTop=top;}if(e.target.matches?.('.mobile-scroll')&&root._viewKey){positions.set(root._viewKey,e.target.scrollTop);syncPrompt(root);saveSession();if(shell().screen==='task'&&(shell().tab||'conversation')==='conversation'&&fields.unseen===task().path&&e.target.scrollHeight-e.target.clientHeight-e.target.scrollTop<80){fields.unseen=null;forceRender();}}};root.addEventListener('scroll',onScroll,true);root.addEventListener('pointerup',passage);root.addEventListener('click',click);root.addEventListener('input',onInput);root.addEventListener('change',onInput);root.addEventListener('submit',onSubmit);root.addEventListener('focusout',flushReply);
  // The editor's global keyboard sink must not swallow native mobile fields.
  const compositionStart=()=>{composing=true;},compositionEnd=e=>{composing=false;input(e);if(renderMissed||e.target?.dataset?.field!=='reply')render();};root.addEventListener('compositionstart',compositionStart);root.addEventListener('compositionend',compositionEnd);
  const stop=e=>{e.stopPropagation();if(e.type==='keydown'&&e.key==='Enter'&&e.target.matches?.('.card[role=link]')){e.preventDefault();e.target.click();return;}const dialog=root.querySelector('[role="dialog"]');if(e.type==='keydown'&&e.target.dataset?.field==='palette-query'){const q=fields['palette-query']||'';if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const n=root.querySelectorAll('.palette-list .cmd').length;fields['palette-index']=Math.max(0,Math.min(n-1,(fields['palette-index']||0)+(e.key==='ArrowDown'?1:-1)));forceRender();root.querySelector('.palette-list .cmd.sel')?.scrollIntoView({block:'nearest'});return;}if(e.key==='Enter'){e.preventDefault();if(q.startsWith(':')){const code=q.slice(1).trim();fields.evalTarget='machine';if(code&&!shell().evaluating){session.pendingCode=code;send('rail',{type:'mobile/machine-eval',text:code});}}else root.querySelector('.palette-list .cmd.sel')?.click();return;}}if(e.key==='Escape'&&dialog){e.preventDefault();const p=prompt();if(p)send(p[0],{type:'key',key:'Escape'});else modal(null);}if(e.key==='Tab'&&dialog){const items=[...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href]')];const first=items[0],last=items.at(-1);if(e.shiftKey&&(document.activeElement===first||!dialog.contains(document.activeElement))){e.preventDefault();last?.focus();}else if(!e.shiftKey&&(document.activeElement===last||!dialog.contains(document.activeElement))){e.preventDefault();first?.focus();}}};root.addEventListener('keydown',stop);root.addEventListener('beforeinput',stop);
  return {update(model){role=model.role;if(role==='task'&&sentDraft&&(sentDraft.path!==model.path||model.draft===sentDraft.text))sentDraft=null;if(role==='task'&&model.data?.desk==='task'){const {turns,questions,...data}=model.data;sessionContext={path:model.path,data};}if(models.get(role)?.message!==model.message)messageOrder.set(role,++messageSequence);if(role==='rail'&&models.get(role)?.state?.['saving-place']&&model.state?.['saving-place']===false&&!model.state?.modal){session.placeDraft=null;placeDraft={};}models.set(role,model);if(session.pendingCode&&role==='rail'&&model.state?.['eval-result']!=null){session.repl=[...(session.repl||[]),{code:session.pendingCode,result:model.state['eval-result']}].slice(-100);session.lastEval=model.state['eval-result'];session.namespace=model.state['eval-namespace']||session.namespace;session.pendingCode=null;saveSession();}if(model.path&&model.path!=='desk:welcome'&&(role==='file'||role==='task'&&model.path.startsWith('task:')||role==='rail'&&/^(place|folder):/.test(model.path))){session.recent=[{path:model.path,title:model.data?.['task-title']||title(model)},...(session.recent||[]).filter(x=>x.path!==model.path)].slice(0,40);}mounts.set(role,{root});if(role==='task')syncDraft();render();},dispose(){flushReply();if(mounts.get(role)?.root===root)mounts.delete(role);root.removeEventListener('scroll',onScroll,true);root.removeEventListener('pointerup',passage);root.removeEventListener('click',click);root.removeEventListener('input',onInput);root.removeEventListener('change',onInput);root.removeEventListener('submit',onSubmit);root.removeEventListener('focusout',flushReply);root.removeEventListener('compositionstart',compositionStart);root.removeEventListener('compositionend',compositionEnd);root.removeEventListener('keydown',stop);root.removeEventListener('beforeinput',stop);root.replaceChildren();}};},
 dispose(){flushReply();disposed=true;document.removeEventListener('visibilitychange',flushHidden);window.removeEventListener('pagehide',flushReply);clearInterval(probeTimer);clearTimeout(toastTimer);probeAbort?.abort();draftAbort?.abort();directoryAbort?.abort();window.removeEventListener('popstate',pop);window.removeEventListener('message',dossierMessage);document.removeEventListener('keydown',paletteKey,true);window.removeEventListener('online',network);window.removeEventListener('offline',network);css.remove();pocketCss.remove();document.documentElement.classList.remove('omega-mobile');document.title=priorTitle;formattedTurns.clear();models.clear();sessionContext=null;mounts.clear();positions.clear();history.length=0;queries.clear();restored.clear();restoring.clear();}};
}
