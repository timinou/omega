// Package-owned DOM/connection boundary. Models and commands come from mob.main;
// editor documents, revisions, polling, intents and buffers use the real host.
import {reconcile} from './dom.mjs';
const icons = {
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
const status=o=>o.ask?'Needs you':({done:'Done',failed:'Failed',cancelled:'Cancelled',running:'Running',idle:'In progress',open:'Starting'}[o.status]||o.status||'In progress');
const title=m=>(m?.text.split('\n')[0]||'').replace(/^#\+TITLE:\s*/i,'');
const empty=(heading,copy)=>`<div class="empty"><span class="empty-icon">${icon('work')}</span><h2>${esc(heading)}</h2><p>${esc(copy)}</p></div>`;

export function createHost(api){
 const models=new Map(),mounts=new Map(),messageOrder=new Map(),positions=new Map(),history=[],queries=new Map();let messageSequence=0; let disposed=false,probeTimer,probeAbort,probing=false,composing=false;
 const css=document.createElement('link');css.rel='stylesheet';css.href=new URL('style.css',import.meta.url);css.dataset.mobileResource='';document.head.append(css);
 const priorTitle=document.title;document.title='Omega · Pocket';
 document.documentElement.classList.add('omega-mobile');
 const send=(pane,event)=>api.dispatch({...event,pane});
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
 let draftKey=null,draftCache={},draftAbort,sessionKey=null;const fields={};let session={};
 function saveSession(){if(!sessionKey)return;try{sessionStorage.setItem(sessionKey,JSON.stringify({...session,route:currentRoute(),fields,new:shell().new,positions:[...positions]}));}catch{}}
 let routeReady=false,lastRoute='',restoringRoute=false;
 function currentRoute(){const s=shell(),screen=s.screen||'work';return {screen,path:screen==='task'?(s['task-path']||task().path):screen==='document'?(s['file-path']||file().path):['work','places'].includes(screen)?rail().path:null,tab:s.tab||'conversation',file:s['file-path']};}
 function applyRoute(r){if(!r||!['work','places','task','document','host','buffers','machine'].includes(r.screen))return;restoringRoute=true;lastRoute=JSON.stringify(r);if(r.screen==='document')openDocument(r.path);else{nav(r.screen,r.path);if(r.screen==='task'&&r.tab!=='conversation')tab(r.tab,r.file);}restoringRoute=false;}
 function syncRoute(){if(!routeReady||restoringRoute)return;const r=currentRoute(),encoded=JSON.stringify(r);if(encoded===lastRoute)return;const u=new URL(location.href);u.searchParams.set('pocket',r.screen);if(r.path)u.searchParams.set('at',r.path);else u.searchParams.delete('at');u.searchParams.set('view',r.tab);if(r.file)u.searchParams.set('doc',r.file);else u.searchParams.delete('doc');window.history[lastRoute?'pushState':'replaceState']({pocket:r},'',u);lastRoute=encoded;}
 const pop=()=>{const u=new URL(location.href);applyRoute(window.history.state?.pocket||{screen:u.searchParams.get('pocket')||'work',path:u.searchParams.get('at')||'workspace:all',tab:u.searchParams.get('view')||'conversation',file:u.searchParams.get('doc')});};
 window.addEventListener('popstate',pop);

const restored=new Set(),restoring=new Set();
 function saveDraft(t,text){
  if(!draftKey||t.path!=='task:'+t.data?.['task-id']||t.data?.['task-at']==null)return;
  if(text)draftCache[t.path]={at:t.data['task-at'],text};else delete draftCache[t.path];
  try{sessionStorage.setItem(draftKey,JSON.stringify(draftCache));}catch{}
 }
 function syncDraft(){
  const t=task(),at=t.data?.['task-at'];if(!draftKey||at==null||t.path!=='task:'+t.data?.['task-id'])return;
  const id=t.path+':'+at;
  if(!restored.has(id)){
   restored.add(id);const cached=draftCache[t.path];
   if(cached?.at===at&&typeof cached.text==='string'&&cached.text&&!t.draft){restoring.add(id);send('task',{type:'mobile/draft',text:cached.text});return;}
  }
  if(restoring.has(id)&&!t.draft)return;
  restoring.delete(id);saveDraft(t,t.draft||'');
 }
 async function restoreDrafts(){
  if(disposed)return;
  draftAbort=new AbortController();const timeout=setTimeout(()=>draftAbort.abort(),5000);
  try{
   const r=await fetch('/api/doc?path=launch:identity',{signal:draftAbort.signal,cache:'no-store'}),j=await r.json(),identity=JSON.parse(j.text);
   if(disposed||!r.ok||!j.ok||!identity.db)return;
   draftKey='omega.pocket.drafts:'+JSON.stringify([identity.root,identity.db,identity.live]);
   sessionKey=draftKey+':view';
   try{session=JSON.parse(sessionStorage.getItem(sessionKey)||'{}');Object.assign(fields,session.fields||{});for(const [k,v] of session.positions||[])positions.set(k,v);for(const [field,value] of Object.entries(session.new||{}))send('rail',{type:'mobile/new-field',field,value});}catch{}
   try{const cached=JSON.parse(sessionStorage.getItem(draftKey)||'{}');if(cached&&typeof cached==='object'&&!Array.isArray(cached))draftCache=cached;}catch{}
   const u=new URL(location.href);const restoredRoute=u.searchParams.has('pocket')?{screen:u.searchParams.get('pocket'),path:u.searchParams.get('at'),tab:u.searchParams.get('view')||'conversation',file:u.searchParams.get('doc')}:session.route;
   routeReady=true;if(restoredRoute)applyRoute(restoredRoute);syncDraft();render();
  }catch{}finally{clearTimeout(timeout);}
 }
 const connection=()=>`<button class="connection ${online()?'':'offline'}" data-act="host"><i></i><span class="sr-only">${online()?'Host connected':'Reconnecting'}</span></button>`;
 const placeChoices=()=>{
  const rows=rail().objects||[];
  const current=rows.filter(o=>o.type==='desk/scope'&&o.place);return current.length?current:(shell().places||[]);
 };
 function work(){
  const r=rail(),os=r.objects||[],tasks=os.filter(o=>o.type==='omega/task'),needs=tasks.filter(o=>o.ask),active=tasks.filter(o=>!o.ask&&!['done','failed','cancelled'].includes(o.status)),done=tasks.filter(o=>['done','failed','cancelled'].includes(o.status));
  const scope=os.find(o=>o.type==='desk/scope'&&o.active)?.title||'All places';
  const card=o=>`<button class="task-card ${o.ask?'attention':''} ${esc(o.status)}" data-act="open-task" data-path="task:${esc(o.key)}" aria-label="${esc(o.title||o.goal)} · ${esc(status(o))}"><div class="card-meta"><span class="state-dot ${o.ask?'peach':o.status==='done'?'sage':'lilac'}" aria-hidden="true"></span><span class="place-label">${esc(o.place||'')}</span></div><h2>${esc(o.title||o.goal)}</h2><p>${esc(o.summary||o.goal)}</p></button>`;
  const group=(label,items,cls='')=>items.length?`<section class="task-group"><div class="section-label ${cls}">${label}<span>${items.length}</span></div>${items.map(card).join('')}</section>`:'';
  return `<div class="heading-row"><h1>Work</h1>${btn(icon('plus'),'new','round primary','aria-label="New task"')}</div><div class="scope-row">${btn(icon('places')+esc(scope)+'<span class="chevron">⌄</span>','scope','scope')}${btn(icon('filter'),'scope','icon-button','aria-label="Filter by place"')}</div>${group('Attention',needs,'attention-label')}${group('Active',active)}${group('Recent',done)}${tasks.length?'':empty('No tasks','Choose a place to start.')}`;
 }
 function taskScreen(){
  const t=task(),d=t.data||{},s=shell(),which=s.tab||'conversation';
  if(which==='conversation'&&t.path&&!t.path.startsWith('task:')&&t.path!=='desk:welcome')return reader(t,'task');
  if((s['task-path']&&t.path!==s['task-path']&&which==='conversation')||(d.desk!=='task'&&which==='conversation'))return empty('Opening your task…','The conversation will appear here.');
  const home=d.home,artifact=(d.artifacts||[]).find(a=>a.kind!=='home')||home||(file().path?.startsWith('work:')?{path:file().path}:null);
  const tabs=[['conversation','Conversation'],['plan','Plan'],['changes','Changes']].map(([id,label])=>btn(label,'tab-'+id,`tab ${which===id?'selected':''}`,`aria-selected="${which===id}" role="tab"`)).join('');
  let body='';
  if(which==='conversation'){
   body='';
   const question=(t.objects||[]).find(o=>o.type==='omega/msg');
   if(question)body+=`<section class="question-card"><h3>${esc(question.message||d.ask||'Question')}</h3><div class="answer-row">${btn(icon('check')+'Yes','yes','primary',(!online()||t.state?.pending)?'disabled':'')}${btn('No','no','secondary',(!online()||t.state?.pending)?'disabled':'')}${btn('Answer','answer','text-button')}</div></section>`;
   body+=conversation(t);
   if(d['task-result'])body+=`<section class="result-card ${d['task-status']==='failed'?'failed':''}"><p>${esc(d['task-result'])}</p>${btn('Read','read-result','text-button')}</section>`;
  }else if(s['file-path']&&file().path!==s['file-path'])body=empty('Opening working text…','Your document stays safe while this view opens.');
  else if(which==='plan')body=artifactView(file(),home,artifact);
  else body=changesView(file(),artifact);
  return `<div class="task-context"><span>${icon('places')}${esc(d.place)}</span><span class="tag ${d.ask?'peach':d['task-status']==='failed'?'error':finished(d)?'sage':'lilac'}"><span class="sr-only">${esc(d.ask?'Needs you':d['task-status'])}</span></span></div><h1 class="task-title">${esc(d['task-title']||(which!=='conversation'?title(file()):title(t)))}</h1><div class="tabs" role="tablist" aria-label="Task views">${tabs}</div><div class="task-body">${body}</div>${which==='conversation'?composer(t):''}`;
 }
 function conversation(t){
  // Provider source stays inspectable. Source syntax is only styled here;
  // task identity, questions, results and available controls are typed data.
  const lines=t.text.split('\n'),out=[];let chunk=[],who='';
  const flush=()=>{if(chunk.some(x=>x.trim())&&chunk.some(x=>/^#\+begin_src/i.test(x))){out.push(`<details class="execution" data-key="${esc(t.path+':'+(chunk.join('\n').match(/:id\s+([^\s]+)/)?.[1]||chunk[0]))}"><summary>Agent step · execution details</summary><pre>${esc(chunk.join('\n'))}</pre></details>`);chunk=[];return;}if(chunk.some(x=>x.trim()))out.push(`<article class="message ${who==='you'?'human':'agent'}"><div class="message-who"><span class="avatar">${who==='you'?'Y':'ω'}</span>${esc(who==='you'?'You':'Agent')}<span class="message-rule"></span></div>${prose(chunk)}</article>`);chunk=[];};
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
  return `<form class="composer" data-form="reply"><label class="sr-only" for="mobile-reply">${finished(d)?'Follow-up goal':'Instruction to agent'}</label><textarea id="mobile-reply" data-field="reply" rows="2" placeholder="${finished(d)?'Follow-up…':'Reply…'}">${esc(t.draft)}</textarea><div class="composer-foot"><span>${pending?'Sending to host…':!online()?'Offline · draft retained':finished(d)?esc(d.place):''}</span>${btn(icon('send'),'send','send-button',`aria-label="${finished(d)?'Start follow-up':'Send instruction'}" ${!online()||pending?'disabled':''}`)}</div></form>`;
 }
 function artifactView(f,home,artifact){
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
  if(!artifact)return empty('No working file yet','Changes appear when this task has a linked or changed file.');
  if(!f.path?.startsWith('changes:'))return empty('Opening changes…','Attributed edits to the working file.');
  const ops=(f.objects||[]).filter(o=>o.type==='buffer/op'),lines=f.text.split('\n');
  return `<div class="section-label">${esc(artifact.label||'Working file')}<span>${ops.length} edits</span></div>${ops.length?ops.map(o=>`<article class="change-card"><div class="change-heading">${icon('file')}<strong>${esc(lines[o.row]?.replace(/^\* /,''))}</strong></div><pre class="removed">${esc(lines[o.row+2])}</pre><pre class="added">${esc(lines[o.row+3])}</pre>${btn('Undo this edit','undo','secondary',`data-row="${o.row}" ${online()?'':'disabled'}`)}</article>`).join(''):empty('No accepted edits yet','Agent and human edits will appear here with their attribution.')}`;
 }
 function places(){
  const r=rail(),os=(r.objects||[]).filter(o=>['workspace/place','workspace/folder','workspace/file'].includes(o.type));
  const detail=r.path?.startsWith('place:')||r.path?.startsWith('folder:');
  return `<h1>${detail?esc(title(r)):'Places'}</h1>${detail?btn('‹ All places','places','text-button'):''}<div class="place-list">${os.map(o=>`<button class="place-card" data-act="${o.type==='workspace/file'?'open-file':'open-place'}" data-path="${esc(o.key)}"><span class="place-icon">${icon(o.type==='workspace/file'?'file':'places')}</span><span><strong>${esc(o.title||o.name||(r.text.split('\n')[o.row]||o.key).replace(/^[*▸\s]+/,''))}</strong><small>${esc(o.type==='workspace/place'?'':o.type==='workspace/folder'?'':'')}</small></span>${icon('arrow')}</button>`).join('')}</div>${detail?`<div class="place-actions">${btn('Tasks','place-tasks','primary')}${btn(icon('plus')+'New task','new','secondary')}</div><details class="source-details"><summary>Folders & inherited settings</summary><pre>${esc(r.text)}</pre></details>`:''}`;
 }
 function host(){return `<h1>Machine</h1><section class="host-card"><span class="host-illustration">${icon('host')}</span><h2>${esc(location.hostname)}</h2><span role="status">${online()?'Connected':'Reconnecting'}</span>${btn('Reconnect','reconnect','secondary')}</section>${btn('Live image','machine','sheet-option')}${btn('Commands','commands','sheet-option')}${btn('Return to bl·ed','unload','sheet-option')}`;}
 function inline(text){
  const pattern=/\[\[([^\]]+)\](?:\[([^\]]+)\])?\]|\[([^\]]+)\]\(([^)]+)\)/g;let out='',at=0;
  for(const m of text.matchAll(pattern)){out+=esc(text.slice(at,m.index));const path=m[1]||m[4],label=m[2]||m[3]||path;out+=btn(esc(label),'document-link','text-button',`data-path="${esc(path)}"`);at=m.index+m[0].length;}
  return out+esc(text.slice(at));
 }
 function reader(f=file(),pane='file'){
  const lines=(f.text||'').split('\n'),query=queries.get(f.path)||'',selected=shell().selection;
  const headings=lines.flatMap((l,row)=>/^(\*+|#{1,6}) /.test(l)?[{row,label:l.replace(/^(\*+|#{1,6}) /,'')}]:[]);
  const objects=(f.objects||[]).filter(o=>o.type==='bl/ns'||o.type==='bl/var'||o.type.startsWith('workspace/')||o.type==='omega/task');
  const rows=lines.map((l,row)=>{
   const attrs=`data-row="${row}" data-pane="${pane}" class="reader-line ${query&&l.toLowerCase().includes(query.toLowerCase())?'match':''} ${selected?.path===f.path&&row>=selected.start&&row<selected.end?'passage':''}"`;
   if(/^#\+TITLE:/i.test(l))return `<h1 ${attrs}>${esc(l.replace(/^#\+TITLE:\s*/i,''))}</h1>`;
   if(/^(\*+|#{1,6}) /.test(l))return `<h2 ${attrs}>${inline(l.replace(/^(\*+|#{1,6}) /,''))}</h2>`;
   return `<p ${attrs}>${inline(l)||'&nbsp;'}</p>`;
  }).join('');
  return `<div class="reader-tools">${btn(icon('back'),'document-back','icon-button',`aria-label="Back" data-pane="${pane}"`)}${btn('Outline','outline','text-button')}${btn('Ask','ask-passage','text-button',selected?.path===f.path?'':'disabled')}${!f['read-only']?btn(f.state?.editing?'Read':'Edit','edit-mode','text-button',`data-pane="${pane}"`):''}</div><form data-form="search" class="reader-search"><input type="search" data-field="search" data-path="${esc(f.path)}" aria-label="Find in document" placeholder="Find…" value="${esc(query)}"/>${btn('Next','find-next','text-button')}</form>${objects.length?`<div class="place-list">${objects.map(o=>btn(esc(o.label||o.key),'document-object','sheet-option',`data-pane="${pane}" data-path="${esc(o.type==='omega/task'?'task:'+o.key:o.key)}" ${o.type.startsWith('bl/')?`data-command="bl/open" data-row="${o.row}"`:''}`)).join('')}</div>`:''}<article class="document reader" data-pane="${pane}" aria-label="Document">${f.state?.editing&&!f['read-only']?`<textarea aria-label="Document source" class="source-editor" data-field="file" data-pane="${pane}">${esc(f.text)}</textarea>`:rows}</article>${f.dirty?`<div class="publish-bar">${btn('Publish','publish','primary',`data-pane="${pane}" ${online()?'':'disabled'}`)}</div>`:''}<details class="source-details"><summary>${esc(f.path)}</summary><pre>${esc(f.revision)}</pre></details>`;
 }

 function sheet(){
  const s=shell(),value=s.modal,t=task(),d=t.data||{},r=rail();
  const pending=prompt();
  if(pending){const [pane,m]=pending,mb=m.minibuf;return `<div class="scrim" data-act="dismiss"><section class="sheet" role="dialog" aria-modal="true" aria-label="Editor prompt">${btn(icon('close'),'dismiss','sheet-close','aria-label="Cancel prompt"')}<form data-form="prompt" data-pane="${esc(pane)}"><label for="editor-prompt">${esc(mb.prompt)}</label><input id="editor-prompt" data-field="prompt" data-pane="${esc(pane)}" value="${esc(mb.text)}" autocomplete="off"/><button class="primary full" type="submit">Enter</button></form></section></div>`;}
  if(!value)return '';
  let content='';
  if(value==='scope')content=`<h2>Places</h2>${btn('All places','scope-choice','sheet-option','data-path="workspace:all"')}${placeChoices().map(o=>btn(icon('places')+esc(o.title),'scope-choice','sheet-option',`data-path="${esc(o.key)}"`)).join('')}`;
  if(value==='new'){
   const field=s.new||{},selected=field.place||r.data?.place||placeChoices()[0]?.place;
   content=`<h2>New task</h2>${s.selection?`<blockquote>${esc(s.selection.text)}</blockquote>`:''}<form data-form="new"><label for="new-place">Place</label><select id="new-place" data-field="new-place">${placeChoices().map(o=>`<option value="${esc(o.place)}" ${o.place===selected?'selected':''}>${esc(o.title)}</option>`).join('')}</select><label for="new-goal">Goal</label><textarea id="new-goal" data-field="new-goal" rows="4" placeholder="Goal…">${esc(field.goal)}</textarea><button class="primary full" type="submit" ${!online()||s.creating?'disabled':''}>${s.creating?'Starting…':'Start task '+icon('arrow')}</button></form>`;
  }
  if(value==='actions')content=`<h2>Task</h2><p><code>${esc(d.cwd)}</code></p>${btn(icon('places')+'Working folder','folder','sheet-option')}${btn(icon('file')+'Working file','working-file','sheet-option')}${d.home?btn(esc(d.home.path),'origin','sheet-option'):''}${btn('References','references','sheet-option')}${btn('Commands','commands','sheet-option')}${btn('Inspect task source','source','sheet-option')}${!finished(d)?btn('Cancel task','cancel-task','sheet-option danger'):''}`;
  if(value==='cancel')content=`<h2>Cancel this task?</h2>${btn('Keep working','dismiss','secondary')}${btn('Cancel task','confirm-cancel','primary',online()?'':'disabled')}`;
  if(value==='source')content=`<h2>Task source</h2><pre class="inspect-source">${esc(t.text)}</pre>`;
  if(value==='outline')content=`<h2>Outline</h2>${(readerModel().text||'').split('\n').flatMap((l,row)=>/^(\*+|#{1,6}) /.test(l)?[btn(esc(l.replace(/^(\*+|#{1,6}) /,'')),'heading','sheet-option',`data-row="${row}"`)]:[]).join('')}`;
  if(value==='commands')content=`<h2>Commands</h2><label for="command-pane">Pane</label><select id="command-pane" data-field="command-pane">${['rail','task','file'].map(p=>`<option ${p===(s['command-pane']||'file')?'selected':''}>${p}</option>`).join('')}</select><form data-form="open"><label for="open-address">Open</label><input id="open-address" data-field="address" value="${esc(fields.address||'')}" placeholder="bl: or a document address"/><button class="secondary" type="submit">Open</button></form><form data-form="eval"><label for="eval-code">Lisp</label><textarea id="eval-code" data-field="eval-code" placeholder="(+ 1 2)">${esc(s['eval-code']||'')}</textarea><button class="secondary" name="target" value="editor" type="submit">Editor</button><button class="secondary" name="target" value="machine" type="submit">Machine</button></form>${(s['eval-result']||models.get(s['command-pane']||'file')?.message)?`<pre role="status">${esc(s['eval-result']||models.get(s['command-pane']||'file')?.message)}</pre>`:''}<label for="command-query">Find</label><input id="command-query" data-field="command-query" value="${esc(s['command-query']||'')}"/>${(models.get(s['command-pane']||'file')?.commands||[]).filter(c=>(c.name+' '+c.doc).toLowerCase().includes((s['command-query']||'').toLowerCase())).map(c=>btn(esc(c.name),'run-command','sheet-option',`data-name="${esc(c.name)}" title="${esc(c.doc)}"`)).join('')}`;
  return `<div class="scrim" data-act="dismiss"><section class="sheet" data-key="sheet:${esc(value)}" role="dialog" aria-modal="true" aria-label="${esc(value)}"><div class="sheet-handle"></div>${btn(icon('close'),'dismiss','sheet-close','aria-label="Close dialog"')}${content}</section></div>`;
 }
 let rendering=false,renderQueued=false;
 function render(){
  if(disposed||composing)return;
  if(rendering){renderQueued=true;return;}
  rendering=true;
  try{renderNow();}
  finally{rendering=false;if(renderQueued){renderQueued=false;queueMicrotask(render);}}
 }
 function renderNow(){
  const root=mounts.get('rail')?.root;if(!root)return;
  const s=shell(),screen=s.screen||'work',which=s.tab||'conversation',t=task();
  const fingerprint=JSON.stringify([...models.values()]);if(root._fingerprint===fingerprint)return;root._fingerprint=fingerprint;
  const reading=readerModel();
  const readerKey=JSON.stringify([screen,reading.path,reading.text,reading.state?.editing,s.modal]);
  const selection=window.getSelection(),anchor=selection?.anchorNode;
  // Preserve the browser's range and selection handles while the package
  // records the passage. Replacing this DOM would also break native Copy.
  if(!selection?.isCollapsed&&root._readerKey===readerKey&&root.contains(anchor)&&
     (anchor?.nodeType===1?anchor:anchor?.parentElement)?.closest('.reader-line')){
   const selected=s.selection;
   for(const line of root.querySelectorAll('.reader-line'))line.classList.toggle('passage',selected?.path===reading.path&&+line.dataset.row>=selected.start&&+line.dataset.row<selected.end);
   const ask=root.querySelector('[data-act="ask-passage"]');if(ask)ask.disabled=selected?.path!==reading.path;
   const connection=root.querySelector('.connection');connection?.classList.toggle('offline',!online());
   if(connection)connection.querySelector('.sr-only').textContent=online()?'Host connected':'Reconnecting';
   const work=root.querySelector('.bottom-nav [data-act="work"]'),needs=(rail().objects||[]).some(o=>o.ask),dot=work?.querySelector('.nav-dot');
   if(needs&&work&&!dot)work.insertAdjacentHTML('beforeend','<b class="nav-dot"></b>');else if(!needs)dot?.remove();return;
  }
  const priorDialog=root.querySelector('[role="dialog"]');
  const active=document.activeElement,field=active?.dataset.field,start=active?.selectionStart,end=active?.selectionEnd;
  const oldScroll=root.querySelector('.mobile-scroll')?.scrollTop||0;if(root._viewKey)positions.set(root._viewKey,oldScroll);
  const viewKey=screen+':'+(screen==='document'?file().path:screen==='task'?which+':'+(which==='conversation'?t.path:file().path):rail().path);
  const noticeOrder=[...models.entries()].sort(([a],[b])=>(messageOrder.get(b)||0)-(messageOrder.get(a)||0)).map(([,m])=>m.message);
  const message=noticeOrder.filter(Boolean).find(x=>/unsaved|discard|overlap|not sent|could not|not published|retained|reverted|received by host|Published shared|Publish the file|Choose a place|Write an instruction/i.test(x));
  reconcile(root,`<div class="mobile-app"><header class="mobile-header">${screen==='task'?btn(icon('back')+'Work','work','back-button'):'<a class="wordmark" href="#" data-act="work"><span class="omega-mark">ω</span> omega<span class="wordmark-note"> / pocket</span></a>'}<div>${btn('⌘','commands','icon-button','aria-label="Commands"')}${screen==='task'?btn(icon('dots'),'actions','icon-button','aria-label="Task actions"'):connection()}</div></header><main class="mobile-scroll"><div class="mobile-content">${screen==='document'?reader():screen==='task'?taskScreen():screen==='places'?places():screen==='host'?host():work()}</div></main>${message?`<div class="mobile-notice" role="status">${esc(message)}</div>`:''}<nav class="bottom-nav" aria-label="Main navigation">${[['work','Work'],['places','Places'],['host','Host']].map(([id,label])=>btn(icon(id)+`<span>${label}</span>`+(id==='work'?(rail().objects||[]).some(o=>o.ask)?'<b class="nav-dot"></b>':'':''),id,`nav-item ${screen===id||id==='work'&&screen==='task'?'active':''}`,screen===id?'aria-current="page"':'')).join('')}</nav>${sheet()}</div>`);
  root.querySelector('.mobile-scroll').scrollTop=positions.get(viewKey)||0;root._viewKey=viewKey;
  root._readerKey=readerKey;
  const dialog=root.querySelector('[role="dialog"]');
  if(dialog&&!priorDialog){root._returnFocus=active;queueMicrotask(()=>dialog.querySelector('[autofocus],input,textarea,button')?.focus({preventScroll:true}));}
  if(!dialog&&priorDialog&&root._returnFocus?.isConnected)root._returnFocus.focus({preventScroll:true});
  syncRoute();saveSession();
  if(field){const el=root.querySelector(`[data-field="${field}"]`);if(el){el.focus({preventScroll:true});if(typeof start==='number'&&el.setSelectionRange)el.setSelectionRange(start,end);}}
 }
 function handle(event){
  const el=event.target.closest('[data-act]');if(!el)return;
  if(el.classList.contains('scrim')&&event.target!==el)return;
  const action=el.dataset.act,d=task().data||{},artifact=(d.artifacts||[]).find(a=>a.kind!=='home')||d.home;
  if(el.disabled||(!online()&&['yes','no','send','publish','undo','confirm-cancel','start-block'].includes(action)))return;event.preventDefault();
  switch(action){
   case 'work':nav('work','workspace:'+(rail().data?.scope||'all'));break;
   case 'places':nav('places','places:');break;
   case 'host':nav('host');break;
   case 'scope':modal('scope');break;
   case 'new':send('rail',{type:'mobile/selection',selection:null});modal('new');break;
   case 'actions':modal('actions');break;
   case 'dismiss':{const p=prompt();if(p)send(p[0],{type:'key',key:'Escape'});else modal(null);break;}
   case 'scope-choice':modal(null);nav('work',el.dataset.path);break;
   case 'open-task':nav('task',el.dataset.path);break;
   case 'open-place':nav('places',el.dataset.path);break;
   case 'place-tasks':nav('work','workspace:'+(rail().data?.place||rail().path.split(':')[1]));break;
   case 'tab-conversation':tab('conversation');break;
   case 'tab-plan':{const a=file().dirty?{path:file().path}:d.home||artifact;tab('plan',a?.path,a?.block);break;}
   case 'tab-changes':tab('changes',artifact?'changes:'+artifact.path:undefined);break;
   case 'yes':send('task',{type:'mobile/send',answer:'yes'});break;
   case 'no':send('task',{type:'mobile/send',answer:'no'});break;
   case 'answer':mounts.get('rail').root.querySelector('[data-field="reply"]')?.focus();break;
   case 'send':send('task',{type:'mobile/send'});break;
   case 'publish':command(el.dataset.pane||'file','mobile/publish');break;
   case 'start-block':command('file','eval-cell',Number(el.dataset.row));break;
   case 'browse':if(el.dataset.path.startsWith('task:'))nav('task',el.dataset.path);else tab('plan',el.dataset.path);break;
   case 'toggle':command('file','desk/toggle',Number(el.dataset.row));break;
   case 'undo':command('file','buffers/undo',Number(el.dataset.row));break;
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
   case 'find-next':{const root=mounts.get('rail').root,matches=[...root.querySelectorAll('.reader-line.match')],scroll=root.querySelector('.mobile-scroll');(matches.find(x=>x.offsetTop>scroll.scrollTop+40)||matches[0])?.scrollIntoView({block:'start'});break;}
   case 'ask-passage':modal('new');break;
   case 'read-result':openDocument(task().path);break;
   case 'origin':modal(null);openDocument(d.home?.path);break;
   case 'machine':openDocument('bl:');break;
   case 'commands':modal('commands');break;
   case 'run-command':modal(null);command(shell()['command-pane']||'file',el.dataset.name);break;
   case 'source':modal('source');break;
   case 'cancel-task':modal('cancel');break;
   case 'confirm-cancel':send('task',{type:'mobile/cancel'});modal(null);break;
   case 'reconnect':probe();break;
   case 'unload':command('rail','mobile/unload');break;
  }
 }
 function input(event){const e=event.target,f=e.dataset.field;if(f)fields[f]=e.value;if(f==='prompt')send(e.dataset.pane,{type:'mobile/prompt',text:e.value});if(f==='search'){queries.set(e.dataset.path||file().path,e.value);const root=mounts.get('rail')?.root;if(root)root._fingerprint=null;render();}if(['command-pane','command-query','eval-code'].includes(f))send('rail',{type:'mobile/field',field:f,value:e.value});if(f==='reply'){send('task',{type:'mobile/draft',text:e.value});saveDraft(task(),e.value);}if(f==='file')send(e.dataset.pane||'file',{type:'mobile/edit',text:e.value});if(f?.startsWith('new-'))send('rail',{type:'mobile/new-field',field:f.slice(4),value:e.value});saveSession();}
 function submit(event){const form=event.target.closest('form');if(!form)return;event.preventDefault();
  if(form.dataset.form==='search'){handle({target:form.querySelector('[data-act="find-next"]'),preventDefault(){}});return;}
  if(form.dataset.form==='prompt'){send(form.dataset.pane,{type:'key',key:'Enter'});return;}
  if(form.dataset.form==='open'){modal(null);openDocument(form.querySelector('input').value.trim());return;}
  if(form.dataset.form==='eval'){const text=form.querySelector('textarea').value;if(event.submitter?.value==='machine')send('rail',{type:'mobile/machine-eval',text});else send(shell()['command-pane']||'file',{type:'mobile/eval',text});return;}
  if(!online())return;if(form.dataset.form==='reply')send('task',{type:'mobile/send'});if(form.dataset.form==='new')send('rail',{type:'mobile/create',place:form.querySelector('select').value,goal:form.querySelector('textarea').value});}
 function passage(){const selected=window.getSelection();if(!selected||selected.isCollapsed)return;const node=n=>(n?.nodeType===1?n:n?.parentElement)?.closest('.reader-line');const a=node(selected.anchorNode),b=node(selected.focusNode);if(!a||!b||a.dataset.pane!==b.dataset.pane)return;const source=models.get(a.dataset.pane)||file();const start=Math.min(+a.dataset.row,+b.dataset.row),end=Math.max(+a.dataset.row,+b.dataset.row)+1;send('rail',{type:'mobile/selection',selection:{path:source.path,rev:source.revision,start,end,text:source.text.split('\n').slice(start,end).join('\n')}});}

 async function probe(){
  if(disposed||probing)return;probing=true;probeAbort=new AbortController();const timeout=setTimeout(()=>probeAbort.abort(),5000);
  try{const r=await fetch('/api/doc?path=desk:welcome',{signal:probeAbort.signal,cache:'no-store'}),j=await r.json();if(!disposed)send('rail',{type:'mobile/connection',online:r.ok&&j.ok===true,checked:Date.now()});}
  catch{if(!disposed)send('rail',{type:'mobile/connection',online:false,checked:Date.now()});}
  finally{clearTimeout(timeout);probing=false;}
 }
 const network=()=>probe();window.addEventListener('online',network);window.addEventListener('offline',network);
 probeTimer=setInterval(probe,8000);queueMicrotask(probe);queueMicrotask(restoreDrafts);
 return {mount(root){let role;const click=e=>{e.stopPropagation();handle(e);},onInput=e=>input(e),onSubmit=e=>submit(e),onScroll=e=>{if(e.target.matches?.('.mobile-scroll')&&root._viewKey){positions.set(root._viewKey,e.target.scrollTop);saveSession();}};root.addEventListener('scroll',onScroll,true);root.addEventListener('pointerup',passage);root.addEventListener('click',click);root.addEventListener('input',onInput);root.addEventListener('change',onInput);root.addEventListener('submit',onSubmit);
  // The editor's global keyboard sink must not swallow native mobile fields.
  const compositionStart=()=>{composing=true;},compositionEnd=e=>{composing=false;input(e);render();};root.addEventListener('compositionstart',compositionStart);root.addEventListener('compositionend',compositionEnd);
  const stop=e=>{e.stopPropagation();const dialog=root.querySelector('[role="dialog"]');if(e.key==='Escape'&&dialog){e.preventDefault();const p=prompt();if(p)send(p[0],{type:'key',key:'Escape'});else modal(null);}if(e.key==='Tab'&&dialog){const items=[...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href]')];const first=items[0],last=items.at(-1);if(e.shiftKey&&(document.activeElement===first||!dialog.contains(document.activeElement))){e.preventDefault();last?.focus();}else if(!e.shiftKey&&(document.activeElement===last||!dialog.contains(document.activeElement))){e.preventDefault();first?.focus();}}};root.addEventListener('keydown',stop);root.addEventListener('beforeinput',stop);
  return {update(model){role=model.role;if(models.get(role)?.message!==model.message)messageOrder.set(role,++messageSequence);models.set(role,model);mounts.set(role,{root});if(role==='task')syncDraft();render();},dispose(){if(mounts.get(role)?.root===root)mounts.delete(role);root.removeEventListener('scroll',onScroll,true);root.removeEventListener('pointerup',passage);root.removeEventListener('click',click);root.removeEventListener('input',onInput);root.removeEventListener('change',onInput);root.removeEventListener('submit',onSubmit);root.removeEventListener('compositionstart',compositionStart);root.removeEventListener('compositionend',compositionEnd);root.removeEventListener('keydown',stop);root.removeEventListener('beforeinput',stop);root.replaceChildren();}};},
 dispose(){disposed=true;clearInterval(probeTimer);probeAbort?.abort();draftAbort?.abort();window.removeEventListener('popstate',pop);window.removeEventListener('online',network);window.removeEventListener('offline',network);css.remove();document.documentElement.classList.remove('omega-mobile');document.title=priorTitle;models.clear();mounts.clear();positions.clear();history.length=0;queries.clear();restored.clear();restoring.clear();}};
}
