// Package-owned DOM/connection boundary. Models and commands come from mob.main;
// editor documents, revisions, polling, intents and buffers use the real host.
import {reconcile} from './dom.mjs';
import {rich,inline as formatInline,unified} from './text.mjs';
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
const compact=x=>{const t=String(x||'').split('\n')[0];return t.length>72?t.slice(0,69)+'…':t;};
const status=o=>o.ask?'Needs you':({done:'Done',failed:'Failed',cancelled:'Cancelled',running:'Running',idle:'Answered',open:'Starting'}[o.status]||o.status||'In progress');
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
 function saveSession(){if(!sessionKey)return;try{sessionStorage.setItem(sessionKey,JSON.stringify({...session,route:currentRoute(),fields,new:shell().new,selection:shell().selection,queries:[...queries],positions:[...positions]}));}catch{}}
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
   try{session=JSON.parse(sessionStorage.getItem(sessionKey)||'{}');Object.assign(fields,session.fields||{});for(const [k,v] of session.positions||[])positions.set(k,v);for(const [k,v] of session.queries||[])queries.set(k,v);if(session.selection)send('rail',{type:'mobile/selection',selection:session.selection});for(const [field,value] of Object.entries(session.new||{}))send('rail',{type:'mobile/new-field',field,value});}catch{}
   try{const cached=JSON.parse(sessionStorage.getItem(draftKey)||'{}');if(cached&&typeof cached==='object'&&!Array.isArray(cached))draftCache=cached;}catch{}
   const u=new URL(location.href);const restoredRoute=u.searchParams.has('pocket')?{screen:u.searchParams.get('pocket'),path:u.searchParams.get('at'),tab:u.searchParams.get('view')||'conversation',file:u.searchParams.get('doc')}:session.route;
   routeReady=true;if(restoredRoute)applyRoute(restoredRoute);syncDraft();render();
  }catch{}finally{clearTimeout(timeout);}
 }
 let placeDraft={},directoryData={},directoryAbort;
 const forceRender=()=>{const root=mounts.get('rail')?.root;if(root)root._fingerprint=null;render();};
 async function copy(text){try{await navigator.clipboard.writeText(text);fields.copied=true;}catch{fields.copied=false;}forceRender();}
 async function directory(path){modal('directory');directoryAbort?.abort();directoryAbort=new AbortController();directoryData={loading:true};forceRender();try{const r=await fetch('/api/doc?path='+encodeURIComponent('directory:'+path),{signal:directoryAbort.signal,cache:'no-store'}),j=await r.json();directoryData=j.ok?j.data:{error:j.message||'Directory unavailable'};}catch(e){if(e.name!=='AbortError')directoryData={error:String(e.message)};}forceRender();}
 const connection=()=>`<button class="connection ${online()?'':'offline'}" data-act="host"><i></i><span class="sr-only">${online()?'Host connected':'Reconnecting'}</span></button>`;
 const placeChoices=()=>{
  const rows=rail().objects||[];
  const current=rows.filter(o=>o.type==='desk/scope'&&o.place);const choices=current.length?current:(shell().places||[]);const d=rail().data;if(d?.place&&!choices.some(o=>o.place===d.place))return [...choices,{place:d.place,title:d.name||d.place,root:d.root,settings:d.settings}];return choices;
 };
 const commandPane=()=>shell().screen==='task'?'task':['places','work'].includes(shell().screen||'work')?'rail':'file';
 const commandLabel=c=>({'mobile/publish':'Publish','buffers/resolve':'Resolve overlap','buffers/undo':'Undo edit','desk/link':'Link reference','places/attach':'Add place','mobile/unload':'Return to editor','eval-cell':'Run cell'}[c.name]||c.name.split('/').pop().replaceAll('-',' ').replace(/^./,x=>x.toUpperCase()));
 function work(){
  const r=rail(),os=r.objects||[],tasks=os.filter(o=>o.type==='omega/task'),needs=tasks.filter(o=>o.ask&&(session.snoozed?.[o.key]||0)<Date.now()),answered=tasks.filter(o=>!o.ask&&o.status==='idle'),active=tasks.filter(o=>!o.ask&&!['done','failed','cancelled','idle'].includes(o.status)),done=tasks.filter(o=>['done','failed','cancelled'].includes(o.status));
  const scope=os.find(o=>o.type==='desk/scope'&&o.active)?.title||'All places';
  const card=o=>`<button class="task-card ${o.ask?'attention':''} ${session.read?.[o.key]===o.ask?'read':''} ${esc(o.status)}" data-key="task:${esc(o.key)}" data-act="open-task" data-path="task:${esc(o.key)}" aria-label="${esc(o.title||o.goal)} · ${esc(status(o))}"><div class="card-meta"><span class="state-dot ${o.ask?'peach':o.status==='done'?'sage':'lilac'}" aria-hidden="true"></span><span class="task-state">${esc(status(o))}</span><span class="place-label">${esc(o['place-name']||o.place||'')}</span></div><h2>${esc(compact(o.title||o.goal))}</h2><p>${esc(o.summary||o.goal)}</p></button>`;
  const group=(label,items,cls='')=>items.length?`<section class="task-group"><div class="section-label ${cls}">${label}<span>${items.length}</span></div>${items.map(card).join('')}</section>`:'';
  return `<div class="heading-row"><h1>Work</h1>${btn(icon('plus'),'new','round primary','aria-label="New task"')}</div><div class="scope-row">${btn(icon('places')+esc(scope)+'<span class="chevron">⌄</span>','scope','scope')}${btn(icon('filter'),'scope','icon-button','aria-label="Filter by place"')}</div>${group('Attention',needs,'attention-label')}${group('Working',active)}${group('Answered',answered)}${group('Recent',done)}${Object.values(session.snoozed||{}).some(t=>t>Date.now())?btn('Snoozed','unsnooze','text-button'):''}${tasks.length?'':empty('No tasks','Choose a place to start.')}`;
 }
 function taskScreen(){
  const t=task(),d=t.data||{},s=shell(),which=s.tab||'conversation';
  if(which==='conversation'&&t.path&&!t.path.startsWith('task:')&&t.path!=='desk:welcome')return reader(t,'task');
  if((s['task-path']&&t.path!==s['task-path']&&which==='conversation')||(d.desk!=='task'&&which==='conversation'))return empty('Opening your task…','The conversation will appear here.');
  const home=d.home,artifact=(d.artifacts||[]).find(a=>a.kind!=='home')||home||(file().path?.startsWith('work:')?{path:file().path}:null);
  const tabs=[['conversation','Conversation'],['plan','Files'],['changes','Changes']].map(([id,label])=>btn(label,'tab-'+id,`tab ${which===id?'selected':''}`,`aria-selected="${which===id}" role="tab"`)).join('');
  let body='';
  if(which==='conversation'){
   body='';
   const question=(t.objects||[]).find(o=>o.type==='omega/msg');
   let questionMarkup='';if(question)questionMarkup=`<section class="question-card"><h3>${esc(question.message||d.ask||'Question')}</h3><div class="answer-row">${(d.questions?.[0]?.choices||[]).map(choice=>btn(esc(typeof choice==='string'?choice:choice.label),'choice','secondary',`data-answer="${esc(typeof choice==='string'?choice:choice.value)}" ${!online()||t.state?.pending?'disabled':''}`)).join('')}${btn('Answer','answer','primary')}${btn('Later','snooze','text-button')}</div></section>`;
   if(question)body+=btn('Question ↓','question-anchor','attention-anchor');
   body+=conversation(t)+questionMarkup;
   const result=d['task-result'];if(result&&!d.turns?.some(turn=>(turn.content||[]).some(block=>block.type==='text'&&block.text?.includes(result))))body+=`<article class="message outcome"><div class="message-who">Outcome</div>${rich(result)}</article>`;
   if(d['task-status']==='running')body+='<div class="turn-status" role="status">Working<span aria-hidden="true"> ···</span></div>';
   else if(d['task-status']==='idle')body+='<div class="turn-status">Answered</div>';
   else if(finished(d))body+=`<div class="turn-status">${esc(d['task-status'])}</div>`;
  }else if(s['file-path']&&file().path!==s['file-path'])body=empty('Opening working text…','Your document stays safe while this view opens.');
  else if(which==='plan')body=artifactList(d)+((s['file-path']&&file().path===s['file-path'])?artifactView(file(),home,artifact):'');
  else body=changesView(file(),artifact);
  return `<div class="task-context"><span>${btn(icon('places')+esc(d['place-name']||d.place),'context','text-button')}</span><span class="tag ${d.ask?'peach':d['task-status']==='failed'?'error':finished(d)?'sage':'lilac'}"><span class="sr-only">${esc(d.ask?'Needs you':d['task-status'])}</span></span></div><h1 class="task-title">${esc(compact(d['task-title']||(which!=='conversation'?title(file()):title(t))))}</h1><div class="tabs" role="tablist" aria-label="Task views">${tabs}</div><div class="task-body">${body}</div>`;
 }
 function artifactList(d){return `<div class="artifact-list">${(d.artifacts||[]).map(a=>btn(`<span class="artifact-kind">${esc(a.kind==='home'?'Home':a.kind)}</span>${icon('file')}<span>${esc(a.label||a.path)}<small>${esc(a.path)}</small></span>`,'artifact','file-row',`data-path="${esc(a.path)}" ${a.block?`data-block="${esc(a.block)}"`:''}`)).join('')||empty('No files','')}${btn(icon('places')+'Folder','folder','sheet-option')}</div>`;}
 function conversation(t){
  if(Array.isArray(t.data?.turns)&&t.data.turns.length){
   const turns=t.data.turns,results=new Map(turns.flatMap(turn=>(turn.content||[]).filter(b=>b.type==='tool-result').map(b=>[b.id,b])));
   return turns.map(turn=>`<div data-key="turn:${esc(t.path)}:${turn.n}">${(turn.content||[]).map((block,index)=>{
    if(block.type==='text'&&block.text?.trim())return `<article class="message ${turn.role==='user'?'human':'agent'}" data-key="text:${index}"><div class="message-who">${turn.role==='user'?'You':'ω'}${btn('Copy','copy','text-button',`data-text="${esc(encodeURIComponent(block.text))}" aria-label="Copy message"`)}</div>${rich(block.text)}</article>`;
    if(block.type==='tool-use'){const result=results.get(block.id),input=block.input?.code||block.input?.command||(typeof block.input==='string'?block.input:JSON.stringify(block.input,null,2));const hint=(input||'').match(/(?:read|write|shell|exec)\s*[ (]+["']?([^"'\n)]+)/)?.[0]||Object.values(block.input||{}).find(v=>typeof v==='string')||'';
     return `<details class="execution ${result?.['error?']?'failed':''}" data-key="step:${esc(block.id)}"><summary><code>${esc(block.name)}</code><span>${esc(compact(hint))}</span><small>${result?(result['error?']?'Failed':'✓'):'…'}</small></summary><div class="execution-body"><pre>${esc(input)}</pre>${result?`<pre class="tool-result">${esc(result.content)}</pre>${btn('Copy output','copy','text-button',`data-text="${esc(encodeURIComponent(result.content))}"`)}`:''}</div></details>`;
    }return '';
   }).join('')}</div>`).join('');
  }
  // Provider source stays inspectable. Source syntax is only styled here;
  // task identity, questions, results and available controls are typed data.
  const lines=t.text.split('\n'),out=[];let chunk=[],who='';
  const flush=()=>{if(chunk.some(x=>x.trim())&&chunk.some(x=>/^#\+begin_src/i.test(x))){out.push(`<details class="execution" data-key="${esc(t.path+':'+(chunk.join('\n').match(/:id\s+([^\s]+)/)?.[1]||chunk[0]))}"><summary>Agent step · execution details</summary><pre>${esc(chunk.join('\n'))}</pre></details>`);chunk=[];return;}if(chunk.some(x=>x.trim()))out.push(`<article class="message ${who==='you'?'human':'agent'}"><div class="message-who"><span class="avatar">${who==='you'?'Y':'ω'}</span>${esc(who==='you'?'You':'Agent')}<span class="message-rule"></span></div>${rich(chunk.join('\n'))}</article>`);chunk=[];};
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
  return `<form class="composer" data-form="reply"><label class="sr-only" for="mobile-reply">${finished(d)?'Follow-up goal':'Instruction to agent'}</label><textarea id="mobile-reply" data-field="reply" rows="1" placeholder="${finished(d)?'New follow-up…':d['task-status']==='running'?'Steer…':d.ask?'Answer…':'Reply…'}">${esc(t.draft)}</textarea><div class="composer-foot"><span>${pending?'Sending to host…':!online()?'Offline · draft retained':finished(d)?'New task':d['task-status']==='running'?'Current turn':''}</span>${btn(icon('send'),'send','send-button',`aria-label="${finished(d)?'Start follow-up':'Send instruction'}" ${!online()||pending?'disabled':''}`)}</div></form>`;
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
  const d=task().data||{},files=(d.artifacts||[]).filter(a=>a.path?.startsWith('work:'));
  const choices=`<div class="review-files">${files.map(a=>btn(icon('file')+esc(a.label||a.path),'review-file',`file-row ${f.path==='changes:'+a.path?'selected':''}`,`data-path="${esc(a.path)}"`)).join('')}</div>`;
  if(!f.path?.startsWith('changes:'))return choices+empty('Choose a file','');
  const ops=(f.objects||[]).filter(o=>o.type==='buffer/op'),lines=f.text.split('\n');
  return choices+`<div class="section-label">${esc(f.data?.['buffer-path']||artifact?.label||'Changes')}<span>${ops.length}</span></div>${ops.map(o=>`<article class="change-card" data-key="change:${esc(o.key)}"><div class="change-heading"><strong>${esc(o.actor||lines[o.row]?.replace(/^\* /,''))}</strong><small>${esc(o.kind||'')} · ${esc(o.rev||'')}</small></div>${o.old!=null?unified(o.old,o.new):`<pre>${esc(lines.slice(o.row+2,o.row+4).join('\n'))}</pre>`}${btn('Undo','undo','secondary',`data-row="${o.row}" data-id="${esc(o.key)}" ${online()?'':'disabled'}`)}</article>`).join('')||empty('No edits','')}`;
 }
 function places(){
  const r=rail(),os=(r.objects||[]).filter(o=>['workspace/place','workspace/folder','workspace/file'].includes(o.type)),detail=r.path?.startsWith('place:')||r.path?.startsWith('folder:');
  return `<div class="heading-row"><h1>${detail?esc(title(r)):'Places'}</h1>${btn(icon('plus'),'add-place','round primary','aria-label="Add place"')}</div>${detail?btn('‹ Places','places','text-button'):''}${r.data?.root?`<code class="place-root">${esc(r.data.root)}</code>`:''}<div class="place-list">${os.map(o=>`<div class="place-entry" data-key="place:${esc(o.key)}">${btn(icon(o.type==='workspace/file'?'file':'places')+`<span><strong>${esc(o.name||o.title||(r.text.split('\n')[o.row]||o.key).replace(/^[*▸\s]+/,''))}</strong><small>${esc(o.root||o.key)}</small></span>`+(session.pins?.includes(o.key)?'★':icon('arrow')),o.type==='workspace/file'?'open-file':'open-place','place-card',`data-path="${esc(o.key)}"`)}${btn(session.pins?.includes(o.key)?'★':'☆','pin','icon-button',`data-path="${esc(o.key)}" aria-label="Pin ${esc(o.name||o.key)}"`)}</div>`).join('')}</div>${detail?`<div class="place-actions">${btn('Work','place-tasks','secondary')}${btn('New task','new','primary')}${r.data?.place?btn('Settings','edit-place','secondary'):''}</div><dl class="settings">${Object.entries(r.data?.settings||{}).map(([key,v])=>`<dt>${esc(key)}</dt><dd>${esc(typeof v.value==='string'?v.value:JSON.stringify(v.value))}<small>← ${esc(v.from)}</small></dd>`).join('')}</dl>`:''}`;
 }
 function buffers(){const recent=session.recent||[],paths=[...new Set([...(session.pins||[]).filter(p=>p!=='machine:'),...recent.map(x=>x.path)])];return `<div class="heading-row"><h1>Buffers</h1>${btn(icon('plus'),'commands','icon-button','aria-label="Open buffer"')}</div><div class="place-entry">${btn(icon('host')+'Machine','machine','sheet-option')}${btn(session.pins?.includes('machine:')?'★':'☆','pin','icon-button','data-path="machine:" aria-label="Pin Machine"')}</div>${paths.map(path=>`<div class="place-entry">${btn(icon(path.startsWith('place:')?'places':'file')+`<span>${esc(recent.find(x=>x.path===path)?.title||path.split('/').pop())}<small>${esc(path)}</small></span>`,'buffer','place-card',`data-path="${esc(path)}"`)}${btn(session.pins?.includes(path)?'★':'☆','pin','icon-button',`data-path="${esc(path)}" aria-label="Pin buffer"`)}</div>`).join('')||empty('No buffers','')}`;}
 function machine(){return `<div class="heading-row"><h1>Machine</h1>${connection()}</div><code>${esc(shell()['eval-namespace']||location.hostname)}</code><div class="repl-history">${(session.repl||[]).map((x,i)=>`<article data-key="repl:${i}"><pre class="repl-input">${esc(x.code)}</pre><pre class="repl-result">${esc(x.result)}</pre></article>`).join('')}</div><form data-form="machine" class="repl-form"><label class="sr-only" for="machine-code">Lisp expression</label><textarea id="machine-code" data-field="machine-code" spellcheck="false" placeholder="(+ 1 2)">${esc(fields['machine-code']||'')}</textarea>${btn(shell().evaluating?'Evaluating…':'Evaluate','machine-run','primary',online()&&!shell().evaluating?'':'disabled')}${btn('Namespaces','namespaces','secondary')}</form>${btn('Connection','host','sheet-option')}`;}
 function host(){return `<h1>Machine</h1><section class="host-card"><span class="host-illustration">${icon('host')}</span><h2>${esc(location.hostname)}</h2><span role="status">${online()?'Connected':'Reconnecting'}</span>${btn('Reconnect','reconnect','secondary')}</section>${btn('Live image','machine','sheet-option')}${btn('Commands','commands','sheet-option')}${btn('Return to bl·ed','unload','sheet-option')}`;}
 const inline=formatInline;
 function reader(f=file(),pane='file'){
  const lines=(f.text||'').split('\n'),query=queries.get(f.path)||'',selected=shell().selection;
  const headings=lines.flatMap((l,row)=>/^(\*+|#{1,6}) /.test(l)?[{row,label:l.replace(/^(\*+|#{1,6}) /,'')}]:[]);
  const objects=(f.objects||[]).filter(o=>o.type==='bl/ns'||o.type==='bl/var'||o.type.startsWith('workspace/')||o.type==='omega/task');
  const rows=rich(f.text,{pane,structure:f.structure,query,selection:selected,path:f.path});
  return `<div class="reader-tools">${btn(icon('back'),'document-back','icon-button',`aria-label="Back" data-pane="${pane}"`)}${btn('Outline','outline','text-button')}${btn('Find','find','text-button')}${btn('Copy','copy-passage','text-button',selected?.path===f.path?'':'disabled')}${btn('Ask','ask-passage','text-button',selected?.path===f.path?'':'disabled')}${!f['read-only']?btn(f.state?.editing?'Read':'Edit','edit-mode','text-button',`data-pane="${pane}"`):''}</div>${fields.find===f.path?`<form data-form="search" class="reader-search"><input type="search" data-field="search" data-path="${esc(f.path)}" aria-label="Find in document" placeholder="Find…" value="${esc(query)}"/><span class="find-count">${query?lines.filter(l=>l.toLowerCase().includes(query.toLowerCase())).length:0}</span>${btn('↑','find-prev','icon-button','aria-label="Previous match"')}${btn('↓','find-next','icon-button','aria-label="Next match"')}</form>`:''}${objects.length?`<div class="place-list">${objects.map(o=>btn(esc(o.label||o.key),'document-object','sheet-option',`data-pane="${pane}" data-path="${esc(o.type==='omega/task'?'task:'+o.key:o.key)}" ${o.type.startsWith('bl/')?`data-command="bl/open" data-row="${o.row}"`:''}`)).join('')}</div>`:''}<article class="document reader" data-pane="${pane}" aria-label="Document">${f.state?.editing&&!f['read-only']?`<textarea aria-label="Document source" class="source-editor" data-field="file" data-pane="${pane}">${esc(f.text)}</textarea>`:rows}</article>${f.dirty?`<div class="publish-bar">${(/overlap|Not published|resolve/i.test(f.message||''))?btn('Resolve','resolve','secondary'):''}${btn('Publish','publish','primary',`data-pane="${pane}" ${online()?'':'disabled'}`)}</div>`:''}<details class="source-details"><summary>${esc(f.path)}</summary><pre>${esc(f.revision)}</pre></details>`;
 }

 function sheet(){
  const s=shell(),value=s.modal,t=task(),d=t.data||{},r=rail();
  const pending=prompt();
  if(pending){const [pane,m]=pending,mb=m.minibuf;return `<div class="scrim" data-act="dismiss"><section class="sheet" role="dialog" aria-modal="true" aria-label="Editor prompt">${btn(icon('close'),'dismiss','sheet-close','aria-label="Cancel prompt"')}<form data-form="prompt" data-pane="${esc(pane)}"><label for="editor-prompt">${esc(mb.prompt)}</label><input id="editor-prompt" data-field="prompt" data-pane="${esc(pane)}" value="${esc(mb.text)}" autocomplete="off"/><button class="primary full" type="submit">Enter</button></form></section></div>`;}
  if(!value)return '';
  let content='';
  if(value==='scope')content=`<h2>Places</h2>${btn('All places','scope-choice','sheet-option','data-path="workspace:all"')}${placeChoices().map(o=>btn(icon('places')+esc(o.title),'scope-choice','sheet-option',`data-path="${esc(o.key)}"`)).join('')}`;
  if(value==='new'){
   const field=s.new||{},selected=field.place||r.data?.place||session.lastPlace||placeChoices().find(p=>p.place==='project')?.place||placeChoices()[0]?.place;
   content=`<h2>New task</h2>${s.selection?`<blockquote>${esc(s.selection.text)}</blockquote>`:''}<form data-form="new"><label for="new-place">Place</label><select id="new-place" data-field="new-place">${placeChoices().map(o=>`<option value="${esc(o.place)}" ${o.place===selected?'selected':''}>${esc(o.title)}</option>`).join('')}</select>${btn('+ Place','add-place','text-button')}${btn('Context','context','text-button')}<label for="new-title">Title <small>optional</small></label><input id="new-title" data-field="new-title" value="${esc(field.title||'')}" maxlength="120"/><label for="new-goal">Goal</label><textarea id="new-goal" autofocus data-field="new-goal" rows="4" placeholder="Goal…">${esc(field.goal)}</textarea><button class="primary full" type="submit" ${!online()||s.creating?'disabled':''}>${s.creating?'Starting…':'Start task '+icon('arrow')}</button></form>`;
  }
  if(value==='context'){const selected=placeChoices().find(p=>p.place===(s.new?.place||r.data?.place||session.lastPlace||'project'));content=`<h2>Context</h2><dl class="settings"><dt>Place</dt><dd>${esc(d['place-name']||selected?.title||'')}</dd><dt>Directory</dt><dd><code>${esc(s.screen==='task'?d.cwd:selected?.root||'')}</code></dd></dl>${s.selection?`<blockquote>${esc(s.selection.text)}</blockquote><code>${esc(s.selection.path)} · ${esc(s.selection.rev)}</code>`:''}${Object.entries(selected?.settings||{}).map(([key,v])=>`<div class="context-setting"><code>${esc(key)}</code> ${esc(typeof v.value==='string'?v.value:JSON.stringify(v.value))}<small>← ${esc(v.from)}</small></div>`).join('')}${s.screen==='task'?artifactList(d):''}`;}
  if(value==='place'){content=`<h2>${placeDraft.id?'Place settings':'Add place'}</h2><form data-form="place">${[['name','Name'],['id','Address'],['root','Directory']].map(([key,label])=>`<label for="place-${key}">${label}</label><input id="place-${key}" ${key==='name'?'autofocus':''} data-field="place-${key}" value="${esc(placeDraft[key]||'')}" ${key==='id'&&r.data?.place===placeDraft.id?'readonly':''} required/>`).join('')}${btn('Browse','choose-directory','secondary')}<label for="place-parent">Parent</label><select id="place-parent" data-field="place-parent"><option value="">None</option>${placeChoices().filter(o=>o.place!==placeDraft.id).map(o=>`<option value="${esc(o.place)}" ${o.place===placeDraft.parent?'selected':''}>${esc(o.title)}</option>`).join('')}</select><label for="place-cwd">Working directory</label><input id="place-cwd" data-field="place-cwd" value="${esc(placeDraft.cwd||'')}" placeholder="Inherit"/><label for="place-home">Home</label><input id="place-home" data-field="place-home" value="${esc(placeDraft.home||'')}" placeholder="Document address"/><button type="submit" class="primary full" ${s['saving-place']||!online()?'disabled':''}>Save</button></form>`;}
  if(value==='directory')content=`<h2>Directory</h2><code>${esc(directoryData.directory||'')}</code>${directoryData.loading?'<p role="status">Loading…</p>':directoryData.error?`<p role="alert">${esc(directoryData.error)}</p>`:`${btn('Use directory','use-directory','primary full')}${btn('↑ Parent','directory','sheet-option',`data-path="${esc(directoryData.parent)}"`)}${(directoryData.entries||[]).map(e=>btn(icon('places')+esc(e.name),'directory','sheet-option',`data-path="${esc(e.path)}"`)).join('')}`}`;
  if(value==='undo'){const op=file().objects?.find(o=>o.key===fields['undo-id']);content=`<h2>Undo edit?</h2><code>${esc(op?.path||file().data?.['buffer-path'])}</code><p>${esc(op?.actor)} · ${esc(op?.kind)}</p>${unified(op?.old,op?.new)}${btn('Cancel','dismiss','secondary')}${btn('Undo','confirm-undo','primary')}`;}
  if(value==='actions')content=`<h2>Task</h2><p><code>${esc(d.cwd)}</code></p>${btn(icon('places')+'Working folder','folder','sheet-option')}${btn(icon('file')+'Working file','working-file','sheet-option')}${d.home?btn(esc(d.home.path),'origin','sheet-option'):''}${btn('References','references','sheet-option')}${btn('Commands','commands','sheet-option')}${btn('Inspect task source','source','sheet-option')}${!finished(d)?btn('Cancel task','cancel-task','sheet-option danger'):''}`;
  if(value==='cancel')content=`<h2>Cancel this task?</h2>${btn('Keep working','dismiss','secondary')}${btn('Cancel task','confirm-cancel','primary',online()?'':'disabled')}`;
  if(value==='source')content=`<h2>Task source</h2><pre class="inspect-source">${esc(t.text)}</pre>`;
  if(value==='outline')content=`<h2>Outline</h2>${(readerModel().text||'').split('\n').flatMap((l,row)=>/^(\*+|#{1,6}) /.test(l)?[btn(esc(l.replace(/^(\*+|#{1,6}) /,'')),'heading','sheet-option',`data-row="${row}"`)]:[]).join('')}`;
  if(value==='commands')content=`<h2>Commands</h2><label class="sr-only" for="command-query">Find command</label><input autofocus id="command-query" data-field="command-query" placeholder="Find command…" value="${esc(s['command-query']||'')}"/><div class="command-results">${(models.get(s['command-pane']||commandPane())?.commands||[]).filter(c=>(c.name+' '+c.doc).toLowerCase().includes((s['command-query']||'').toLowerCase())).slice(0,s['command-query']?100:8).map(c=>btn(`<span>${esc(commandLabel(c))}<small>${esc(c.name)}</small></span>`,'run-command','sheet-option',`data-name="${esc(c.name)}"`)).join('')}</div><label for="command-pane">Target</label><select id="command-pane" data-field="command-pane">${['rail','task','file'].map(p=>`<option value="${p}" ${p===(s['command-pane']||commandPane())?'selected':''}>${{rail:'Work',task:'Conversation',file:'Document'}[p]}</option>`).join('')}</select><form data-form="open"><label for="open-address">Open</label><input id="open-address" data-field="address" value="${esc(fields.address||'')}" placeholder="bl: or a document address"/><button class="secondary" type="submit">Open</button></form><form data-form="eval"><label for="eval-code">Lisp</label><textarea id="eval-code" data-field="eval-code" placeholder="(+ 1 2)">${esc(s['eval-code']||'')}</textarea><button class="secondary" name="target" value="editor" type="submit">Editor</button><button class="secondary" name="target" value="machine" type="submit">Machine</button></form>${(s['eval-result']||models.get(s['command-pane']||commandPane())?.message)?`<pre role="status">${esc(s['eval-result']||models.get(s['command-pane']||commandPane())?.message)}</pre>`:''}`;
  return `<div class="scrim" data-act="dismiss"><section class="sheet" data-key="sheet:${esc(value)}" role="dialog" aria-modal="true" aria-label="${esc(value)}">${btn(icon('close'),'dismiss','sheet-close','aria-label="Close dialog"')}${content}</section></div>`;
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
  const priorScroll=root.querySelector('.mobile-scroll'),follow=priorScroll&&priorScroll.scrollHeight-priorScroll.clientHeight-priorScroll.scrollTop<80;const changedTask=root._taskText!=null&&root._taskText!==t.text;const oldScroll=priorScroll?.scrollTop||0;if(root._viewKey)positions.set(root._viewKey,oldScroll);
  const viewKey=screen+':'+(screen==='document'?file().path:screen==='task'?which+':'+(which==='conversation'?t.path:file().path):rail().path);
  if(changedTask&&screen==='task'&&which==='conversation'&&!follow)fields.unseen=t.path;root._taskText=t.text;
  const noticeOrder=[...models.entries()].sort(([a],[b])=>(messageOrder.get(b)||0)-(messageOrder.get(a)||0)).map(([,m])=>m.message);
  const message=noticeOrder.filter(Boolean).find(x=>/unsaved|discard|overlap|not sent|could not|not published|retained|reverted|Publish the file|Choose a place|Write an instruction/i.test(x));
  reconcile(root,`<div class="mobile-app"><header class="mobile-header">${screen==='task'?btn(icon('back')+'Work','work','back-button'):'<a class="wordmark" href="#" data-act="work"><span class="omega-mark">ω</span> omega<span class="wordmark-note"> / pocket</span></a>'}<div>${btn('⌘','commands','icon-button','aria-label="Commands"')}${connection()}${screen==='task'?btn(icon('dots'),'actions','icon-button','aria-label="Task actions"'):''}</div></header><main class="mobile-scroll"><div class="mobile-content">${screen==='document'?reader():screen==='task'?taskScreen():screen==='places'?places():screen==='host'?host():screen==='buffers'?buffers():screen==='machine'?machine():work()}</div></main>${screen==='task'&&which==='conversation'&&t.data?.desk==='task'?`${fields.unseen===t.path?btn('New output ↓','latest','latest'):''}${composer(t)}`:''}${message?`<div class="mobile-notice" role="status">${esc(message)}</div>`:''}<nav class="bottom-nav" aria-label="Main navigation">${[['work','Work'],['places','Places'],['buffers','Buffers']].map(([id,label])=>btn(icon(id)+`<span>${label}</span>`+(id==='work'?(rail().objects||[]).some(o=>o.ask)?'<b class="nav-dot"></b>':'':''),id,`nav-item ${screen===id||id==='work'&&screen==='task'?'active':''}`,screen===id?'aria-current="page"':'')).join('')}</nav>${sheet()}</div>`);
  root.querySelector('.mobile-scroll').scrollTop=positions.get(viewKey)||0;if(changedTask&&follow&&root._viewKey===viewKey&&screen==='task'&&which==='conversation')root.querySelector('.mobile-scroll').scrollTop=1e9;if(root._viewKey!==viewKey&&screen==='task'&&which==='plan'&&file().cursor>0&&!positions.has(viewKey)){const row=file().cursor;(root.querySelector(`[data-row="${row}"]`)||root.querySelector(`[data-row="${row+1}"]`))?.scrollIntoView({block:'start'});}root._viewKey=viewKey;
  root._readerKey=readerKey;
  const dialog=root.querySelector('[role="dialog"]');
  if(dialog&&(!priorDialog||dialog!==priorDialog)){if(!priorDialog)root._returnFocus=active;queueMicrotask(()=>(dialog.querySelector('[autofocus]')||dialog.querySelector('input,textarea,select')||dialog.querySelector('button'))?.focus({preventScroll:true}));}
  for(const sibling of root.querySelector('.mobile-app').children)if(!sibling.classList.contains('scrim'))sibling.inert=!!dialog;
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
   case 'buffers':nav('buffers');break;
   case 'machine':nav('machine');break;
   case 'namespaces':openDocument('bl:');break;
   case 'machine-run':if(shell().evaluating)break;send('rail',{type:'mobile/machine-eval',text:fields['machine-code']||''});session.pendingCode=fields['machine-code'];break;
   case 'buffer':if(el.dataset.path==='machine:')nav('machine');else if(el.dataset.path.startsWith('task:'))nav('task',el.dataset.path);else if(el.dataset.path.startsWith('place:'))nav('places',el.dataset.path);else openDocument(el.dataset.path);break;
   case 'pin':session.pins=(session.pins||[]).includes(el.dataset.path)?session.pins.filter(x=>x!==el.dataset.path):[...(session.pins||[]),el.dataset.path];saveSession();forceRender();break;
   case 'artifact':tab('plan',el.dataset.path,el.dataset.block);break;
   case 'review-file':tab('changes','changes:'+el.dataset.path);break;
   case 'copy':copy(decodeURIComponent(el.dataset.text));break;
   case 'copy-passage':copy(window.getSelection()?.toString()||shell().selection?.text||'');break;
   case 'choice':send('task',{type:'mobile/send',answer:el.dataset.answer});break;
   case 'add-place':placeDraft=session.placeDraft||{};modal('place');break;
   case 'edit-place':placeDraft={id:rail().data?.place,name:rail().data?.name,root:rail().data?.['own-root']||'',parent:rail().data?.parent||'',home:rail().data?.home?.path||'',cwd:rail().data?.config?.cwd||'',config:rail().data?.config||{}};modal('place');break;
   case 'choose-directory':directory(placeDraft.root||rail().data?.root||'/');break;
   case 'directory':directory(el.dataset.path);break;
   case 'use-directory':placeDraft.root=directoryData.directory;modal('place');break;
   case 'scope':modal('scope');break;
   case 'context':modal('context');break;
   case 'snooze':session.snoozed={...(session.snoozed||{}),[d['task-id']]:Date.now()+3600000};saveSession();nav('work','workspace:all');break;
   case 'unsnooze':session.snoozed={};saveSession();forceRender();break;
   case 'question-anchor':mounts.get('rail').root.querySelector('.question-card')?.scrollIntoView({block:'center'});break;
   case 'latest':fields.unseen=null;mounts.get('rail').root.querySelector('.mobile-scroll')?.scrollTo({top:1e9});forceRender();break;
   case 'find':fields.find=fields.find!==readerModel().path?readerModel().path:null;forceRender();if(fields.find)mounts.get('rail').root.querySelector('[data-field="search"]')?.focus();break;
   case 'resolve':command('file','buffers/resolve');break;
   case 'new':send('rail',{type:'mobile/selection',selection:null});modal('new');break;
   case 'actions':modal('actions');break;
   case 'dismiss':{const p=prompt();if(p)send(p[0],{type:'key',key:'Escape'});else modal(null);break;}
   case 'scope-choice':modal(null);nav('work',el.dataset.path);break;
   case 'open-task':session.read={...(session.read||{}),[el.dataset.path.slice(5)]:(rail().objects||[]).find(o=>'task:'+o.key===el.dataset.path)?.ask};saveSession();nav('task',el.dataset.path);break;
   case 'open-place':nav('places',el.dataset.path);break;
   case 'place-tasks':nav('work','workspace:'+(rail().data?.place||rail().path.split(':')[1]));break;
   case 'tab-conversation':tab('conversation');break;
   case 'tab-plan':tab('plan');break;
   case 'tab-changes':tab('changes',artifact?'changes:'+artifact.path:undefined);break;
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
   case 'ask-passage':modal('new');break;
   case 'read-result':openDocument(task().path);break;
   case 'origin':modal(null);openDocument(d.home?.path);break;
   case 'commands':modal('commands');break;
   case 'run-command':modal(null);command(shell()['command-pane']||commandPane(),el.dataset.name);break;
   case 'source':modal('source');break;
   case 'cancel-task':modal('cancel');break;
   case 'confirm-cancel':send('task',{type:'mobile/cancel'});modal(null);break;
   case 'reconnect':probe();break;
   case 'unload':command('rail','mobile/unload');break;
  }
 }
 function input(event){const e=event.target,f=e.dataset.field;if(f?.startsWith('place-')){placeDraft[f.slice(6)]=e.value;session.placeDraft=placeDraft;if(f==='place-id')placeDraft.manualId=true;if(f==='place-name'&&!placeDraft.manualId){placeDraft.id=e.value.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');forceRender();}}if(f)fields[f]=e.value;if(f==='prompt')send(e.dataset.pane,{type:'mobile/prompt',text:e.value});if(f==='search'){queries.set(e.dataset.path||file().path,e.value);const root=mounts.get('rail')?.root;if(root)root._fingerprint=null;render();}if(['command-pane','command-query','eval-code'].includes(f))send('rail',{type:'mobile/field',field:f,value:e.value});if(f==='reply'){send('task',{type:'mobile/draft',text:e.value});saveDraft(task(),e.value);}if(f==='file')send(e.dataset.pane||'file',{type:'mobile/edit',text:e.value});if(f?.startsWith('new-'))send('rail',{type:'mobile/new-field',field:f.slice(4),value:e.value});saveSession();}
 function submit(event){const form=event.target.closest('form');if(!form)return;event.preventDefault();
  if(form.dataset.form==='place'){session.placeDraft=placeDraft;send('rail',{type:'mobile/place-save',...placeDraft});return;}
  if(form.dataset.form==='machine'){if(shell().evaluating)return;session.pendingCode=fields['machine-code'];send('rail',{type:'mobile/machine-eval',text:fields['machine-code']||''});return;}
  if(form.dataset.form==='search'){handle({target:form.querySelector('[data-act="find-next"]'),preventDefault(){}});return;}
  if(form.dataset.form==='prompt'){send(form.dataset.pane,{type:'key',key:'Enter'});return;}
  if(form.dataset.form==='open'){modal(null);openDocument(form.querySelector('input').value.trim());return;}
  if(form.dataset.form==='eval'){const text=form.querySelector('textarea').value;if(event.submitter?.value==='machine')send('rail',{type:'mobile/machine-eval',text});else send(shell()['command-pane']||commandPane(),{type:'mobile/eval',text});return;}
  if(!online())return;if(form.dataset.form==='reply')send('task',{type:'mobile/send'});if(form.dataset.form==='new'){session.lastPlace=form.querySelector('select').value;saveSession();}if(form.dataset.form==='new')send('rail',{type:'mobile/create',place:form.querySelector('select').value,goal:form.querySelector('textarea').value,title:form.querySelector('[data-field="new-title"]').value});}
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
  return {update(model){role=model.role;if(models.get(role)?.message!==model.message)messageOrder.set(role,++messageSequence);if(role==='rail'&&models.get(role)?.state?.['saving-place']&&model.state?.['saving-place']===false&&!model.state?.modal){session.placeDraft=null;placeDraft={};}models.set(role,model);if(session.pendingCode&&role==='rail'&&model.state?.['eval-result']!=null){session.repl=[...(session.repl||[]),{code:session.pendingCode,result:model.state['eval-result']}].slice(-100);session.lastEval=model.state['eval-result'];session.pendingCode=null;saveSession();}if(model.path&&model.path!=='desk:welcome'&&(role==='file'||role==='task'&&model.path.startsWith('task:'))){session.recent=[{path:model.path,title:model.data?.['task-title']||title(model)},...(session.recent||[]).filter(x=>x.path!==model.path)].slice(0,40);}mounts.set(role,{root});if(role==='task')syncDraft();render();},dispose(){if(mounts.get(role)?.root===root)mounts.delete(role);root.removeEventListener('scroll',onScroll,true);root.removeEventListener('pointerup',passage);root.removeEventListener('click',click);root.removeEventListener('input',onInput);root.removeEventListener('change',onInput);root.removeEventListener('submit',onSubmit);root.removeEventListener('compositionstart',compositionStart);root.removeEventListener('compositionend',compositionEnd);root.removeEventListener('keydown',stop);root.removeEventListener('beforeinput',stop);root.replaceChildren();}};},
 dispose(){disposed=true;clearInterval(probeTimer);probeAbort?.abort();draftAbort?.abort();directoryAbort?.abort();window.removeEventListener('popstate',pop);window.removeEventListener('online',network);window.removeEventListener('offline',network);css.remove();document.documentElement.classList.remove('omega-mobile');document.title=priorTitle;models.clear();mounts.clear();positions.clear();history.length=0;queries.clear();restored.clear();restoring.clear();}};
}
