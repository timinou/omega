// Package-owned DOM/connection boundary. Models and commands come from mob.main;
// editor documents, revisions, polling, intents and buffers use the real host.
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
 const models=new Map(),mounts=new Map(),messageOrder=new Map();let messageSequence=0; let disposed=false,probeTimer,probeAbort,probing=false,composing=false;
 const css=document.createElement('link');css.rel='stylesheet';css.href=new URL('style.css',import.meta.url);css.dataset.mobileResource='';document.head.append(css);
 const priorTitle=document.title;document.title='Omega · Work, wherever';
 document.documentElement.classList.add('omega-mobile');
 const send=(pane,event)=>api.dispatch({...event,pane});
 const rail=()=>models.get('rail')||{},task=()=>models.get('task')||{},file=()=>models.get('file')||{};
 const shell=()=>rail().state||{};
 const nav=(screen,path)=>{for(const pane of ['rail','task','file'])send(pane,{type:'mobile/clear'});send('rail',{type:'mobile/nav',screen,path});};
 const tab=(name,path,block)=>send('rail',{type:'mobile/tab',tab:name,path,block,dirty:file().dirty,'current-file':file().path});
 const modal=value=>send('rail',{type:'mobile/modal',value});
 const command=(pane,name,row)=>send(pane,row==null?{type:'command',command:name}:{type:'mobile/row-command',name,row});
 const online=()=>shell().connection?.online===true;
 const connection=()=>`<button class="connection ${online()?'':'offline'}" data-act="host"><i></i>${online()?'Host connected':'Reconnecting'}</button>`;
 const placeChoices=()=>{
  const rows=rail().objects||[];
  const current=rows.filter(o=>o.type==='desk/scope'&&o.place);return current.length?current:(shell().places||[]);
 };
 function work(){
  const r=rail(),os=r.objects||[],tasks=os.filter(o=>o.type==='omega/task'),needs=tasks.filter(o=>o.ask),active=tasks.filter(o=>!o.ask&&!['done','failed','cancelled'].includes(o.status)),done=tasks.filter(o=>['done','failed','cancelled'].includes(o.status));
  const scope=os.find(o=>o.type==='desk/scope'&&o.active)?.title||'All places';
  const card=o=>`<button class="task-card ${o.ask?'attention':''}" data-act="open-task" data-path="task:${esc(o.key)}"><div class="card-meta"><span class="tag ${o.ask?'peach':['done'].includes(o.status)?'sage':'lilac'}">${o.ask?'●':'◌'} ${esc(status(o))}</span><span class="place-label">${esc(o.place||'Unplaced')}</span></div><h2>${esc(o.title||o.goal)}</h2><p>${esc(o.summary||o.goal)}</p><div class="card-foot"><span>${o.ask?'Answer to keep this moving':'Open conversation'}</span>${icon('arrow')}</div></button>`;
  const group=(label,items,cls='')=>items.length?`<section class="task-group"><div class="section-label ${cls}">${label}<span>${items.length}</span></div>${items.map(card).join('')}</section>`:'';
  return `<div class="eyebrow">YOUR WORK, WITH YOU</div><div class="heading-row"><h1>Good to go<span class="accent">.</span></h1>${btn(icon('plus'),'new','round primary','aria-label="New task"')}</div><p class="lede">A little attention. Then back to your day.</p><div class="scope-row">${btn(icon('places')+esc(scope)+'<span class="chevron">⌄</span>','scope','scope')}${btn(icon('filter'),'scope','icon-button','aria-label="Filter by place"')}</div>${group('Needs your attention',needs,'attention-label')}${group('Moving along',active)}${group('Recently finished',done)}${tasks.length?'':empty('Room for something new','Choose a place and give your agent a goal.')}`;
 }
 function taskScreen(){
  const t=task(),d=t.data||{},s=shell(),which=s.tab||'conversation';
  if((s['task-path']&&t.path!==s['task-path']&&which==='conversation')||(d.desk!=='task'&&which==='conversation'))return empty('Opening your task…','The conversation will appear here.');
  const home=d.home,artifact=(d.artifacts||[]).find(a=>a.kind!=='home')||home||(file().path?.startsWith('work:')?{path:file().path}:null);
  const tabs=[['conversation','Conversation'],['plan','Plan'],['changes','Changes']].map(([id,label])=>btn(label,'tab-'+id,`tab ${which===id?'selected':''}`,`aria-selected="${which===id}" role="tab"`)).join('');
  let body='';
  if(which==='conversation'){
   body='';
   const question=(t.objects||[]).find(o=>o.type==='omega/msg');
   if(question)body+=`<section class="question-card"><div class="eyebrow">A MOMENT OF YOUR ATTENTION</div><h3>${esc(question.message||d.ask||'Your agent has a question.')}</h3><div class="answer-row">${btn(icon('check')+'Yes','yes','primary',(!online()||t.state?.pending)?'disabled':'')}${btn('No','no','secondary',(!online()||t.state?.pending)?'disabled':'')}${btn('Write an answer','answer','text-button')}</div></section>`;
   body+=conversation(t);
   if(d['task-result'])body+=`<section class="result-card"><div class="eyebrow">${esc(d['task-status'])}</div><p>${esc(d['task-result'])}</p></section>`;
  }else if(s['file-path']&&file().path!==s['file-path'])body=empty('Opening working text…','Your document stays safe while this view opens.');
  else if(which==='plan')body=artifactView(file(),home,artifact);
  else body=changesView(file(),artifact);
  return `<div class="task-context"><span>${icon('places')}${esc(d.place)}</span><span class="tag ${d.ask?'peach':finished(d)?'sage':'lilac'}">${esc(d.ask?'Needs you':d['task-status'])}</span></div><h1 class="task-title">${esc(d['task-title']||(which!=='conversation'?title(file()):title(t)))}</h1><div class="tabs" role="tablist" aria-label="Task views">${tabs}</div><div class="task-body">${body}</div>${which==='conversation'?composer(t):''}`;
 }
 function conversation(t){
  // Provider source stays inspectable. Source syntax is only styled here;
  // task identity, questions, results and available controls are typed data.
  const lines=t.text.split('\n'),out=[];let chunk=[],who='';
  const flush=()=>{if(chunk.some(x=>x.trim())&&chunk.some(x=>/^#\+begin_src/i.test(x))){out.push(`<details class="execution"><summary>Agent step · execution details</summary><pre>${esc(chunk.join('\n'))}</pre></details>`);chunk=[];return;}if(chunk.some(x=>x.trim()))out.push(`<article class="message ${who==='you'?'human':'agent'}"><div class="message-who"><span class="avatar">${who==='you'?'Y':'ω'}</span>${esc(who==='you'?'You':'Agent')}<span class="message-rule"></span></div>${prose(chunk)}</article>`);chunk=[];};
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
  return `<form class="composer" data-form="reply"><label class="sr-only" for="mobile-reply">${finished(d)?'Follow-up goal':'Instruction to agent'}</label><textarea id="mobile-reply" data-field="reply" rows="2" placeholder="${finished(d)?'What’s next in this place?':'A thought, an answer, a new direction…'}">${esc(t.draft)}</textarea><div class="composer-foot"><span>${pending?'Sending to host…':!online()?'Offline · your draft stays here':finished(d)?'Follow-up in '+esc(d.place):'Send to this task'}</span>${btn(icon('send'),'send','send-button',`aria-label="${finished(d)?'Start follow-up':'Send instruction'}" ${!online()||pending?'disabled':''}`)}</div></form>`;
 }
 function artifactView(f,home,artifact){
  if(!home&&!artifact)return empty('No plan linked yet','Use References in Actions to inspect this task’s context.');
  if(f['read-only']&&f.path!=='desk:welcome')return browseDocument(f);
  if(!f.path?.startsWith('work:'))return empty('Opening working text…','Your actual document, at the task’s home.');
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
  return `<div class="eyebrow">CONTEXT THAT TRAVELS</div><h1>${detail?esc(title(r)):'Your places<span class="accent">.</span>'}</h1><p class="lede">${detail?'Tasks, text and conventions belong here.':'A home for every thread of work.'}</p>${detail?btn('‹ All places','places','text-button'):''}<div class="place-list">${os.map(o=>`<button class="place-card" data-act="${o.type==='workspace/file'?'open-file':'open-place'}" data-path="${esc(o.key)}"><span class="place-icon">${icon(o.type==='workspace/file'?'file':'places')}</span><span><strong>${esc(o.title||o.name||(r.text.split('\n')[o.row]||o.key).replace(/^[*▸\s]+/,''))}</strong><small>${esc(o.type==='workspace/place'?'Working place':o.type==='workspace/folder'?'Folder':'Working text')}</small></span>${icon('arrow')}</button>`).join('')}</div>${detail?`<div class="place-actions">${btn('View tasks here','place-tasks','primary')}${btn(icon('plus')+'New task here','new','secondary')}</div><details class="source-details"><summary>Folders & inherited settings</summary><pre>${esc(r.text)}</pre></details>`:''}`;
 }
 function host(){return `<div class="eyebrow">YOUR MACHINE, YOUR WORK</div><h1>Close at hand<span class="accent">.</span></h1><p class="lede">Your agents work on the host. You can step away.</p><section class="host-card"><span class="host-illustration">${icon('host')}</span><h2>${esc(location.hostname)}</h2><span class="tag ${online()?'sage':'peach'}">${online()?'● Connected':'○ Reconnecting'}</span><p>${location.protocol==='https:'?'HTTPS connection':'Local development connection'}</p>${btn('Check connection','reconnect','secondary')}</section><section class="note-card"><h3>Take it with you</h3><p>Connect this phone to your Tailscale network, then open the host’s private HTTPS address.</p><p>Keep the host awake while work is running.</p></section><div class="section-label">ABOUT THIS SPIKE</div><p class="fine-print">Real places, tasks and shared text. The isolated demo uses a scripted agent for its two board tasks. Replies stay with their task while you navigate; browser reloads clear unsent drafts.</p>${btn('Return to bl·ed','unload','text-button')}`;}
 function sheet(){
  const s=shell(),value=s.modal,t=task(),d=t.data||{},r=rail();
  if(!value)return '';
  let content='';
  if(value==='scope')content=`<h2>Where are we working?</h2><p>Include tasks from a place and its subplaces.</p>${btn('All places','scope-choice','sheet-option','data-path="workspace:all"')}${placeChoices().map(o=>btn(icon('places')+esc(o.title),'scope-choice','sheet-option',`data-path="${esc(o.key)}"`)).join('')}`;
  if(value==='new'){
   const field=s.new||{},selected=field.place||r.data?.place||placeChoices()[0]?.place;
   content=`<div class="eyebrow">SOMETHING TO MOVE FORWARD</div><h2>Start a little work.</h2><form data-form="new"><label for="new-place">Working place</label><select id="new-place" data-field="new-place">${placeChoices().map(o=>`<option value="${esc(o.place)}" ${o.place===selected?'selected':''}>${esc(o.title)}</option>`).join('')}</select><label for="new-goal">What would you like done?</label><textarea id="new-goal" data-field="new-goal" rows="4" placeholder="Describe the outcome you have in mind…">${esc(field.goal)}</textarea><p class="fine-print">The task uses this place’s working directory and settings.</p><button class="primary full" type="submit" ${!online()||s.creating?'disabled':''}>${s.creating?'Starting…':'Start task '+icon('arrow')}</button></form>`;
  }
  if(value==='actions')content=`<h2>A little more control.</h2>${btn(icon('places')+'Working folder','folder','sheet-option')}${btn(icon('file')+'Working file','working-file','sheet-option')}${btn('References','references','sheet-option')}${btn('Inspect task source','source','sheet-option')}${!finished(d)?btn('Cancel task','cancel-task','sheet-option danger'):''}`;
  if(value==='cancel')content=`<h2>Cancel this task?</h2><p>The task will stop. Its conversation and accepted edits remain.</p>${btn('Keep working','dismiss','secondary')}${btn('Cancel task','confirm-cancel','primary',online()?'':'disabled')}`;
  if(value==='source')content=`<h2>Task source</h2><pre class="inspect-source">${esc(t.text)}</pre>`;
  return `<div class="scrim" data-act="dismiss"><section class="sheet" role="dialog" aria-modal="true" aria-label="${esc(value)}"><div class="sheet-handle"></div>${btn(icon('close'),'dismiss','sheet-close','aria-label="Close dialog"')}${content}</section></div>`;
 }
 function render(){
  if(composing)return;
  const root=mounts.get('rail')?.root;if(!root)return;
  const s=shell(),screen=s.screen||'work',which=s.tab||'conversation',t=task();
  const fingerprint=JSON.stringify([...models.values()]);if(root._fingerprint===fingerprint)return;root._fingerprint=fingerprint;
  const active=document.activeElement,field=active?.dataset.field,start=active?.selectionStart,end=active?.selectionEnd;
  const oldScroll=root.querySelector('.mobile-scroll')?.scrollTop||0;
  const viewKey=screen+':'+(screen==='task'?which+':'+(which==='conversation'?t.path:file().path):rail().path);
  const noticeOrder=[...models.entries()].sort(([a],[b])=>(messageOrder.get(b)||0)-(messageOrder.get(a)||0)).map(([,m])=>m.message);
  const message=noticeOrder.filter(Boolean).find(x=>/unsaved|discard|overlap|not sent|could not|not published|retained|reverted|received by host|Published shared|Publish the file|Choose a place|Write an instruction/i.test(x));
  root.innerHTML=`<div class="mobile-app"><header class="mobile-header">${screen==='task'?btn(icon('back')+'Work','work','back-button'):'<a class="wordmark" href="#" data-act="work"><span class="omega-mark">ω</span> omega<span class="wordmark-note"> / pocket</span></a>'}${screen==='task'?btn(icon('dots'),'actions','icon-button','aria-label="Task actions"'):connection()}</header><main class="mobile-scroll"><div class="mobile-content">${screen==='task'?taskScreen():screen==='places'?places():screen==='host'?host():work()}</div></main>${message?`<div class="mobile-notice" role="status">${esc(message)}</div>`:''}<nav class="bottom-nav" aria-label="Main navigation">${[['work','Work'],['places','Places'],['host','Host']].map(([id,label])=>btn(icon(id)+`<span>${label}</span>`+(id==='work'?(rail().objects||[]).some(o=>o.ask)?'<b class="nav-dot"></b>':'':''),id,`nav-item ${screen===id||id==='work'&&screen==='task'?'active':''}`,screen===id?'aria-current="page"':'')).join('')}</nav>${sheet()}</div>`;
  root.querySelector('.mobile-scroll').scrollTop=root._viewKey===viewKey?oldScroll:0;root._viewKey=viewKey;
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
   case 'new':modal('new');break;
   case 'actions':modal('actions');break;
   case 'dismiss':modal(null);break;
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
   case 'publish':command('file','mobile/publish');break;
   case 'start-block':command('file','eval-cell',Number(el.dataset.row));break;
   case 'browse':if(el.dataset.path.startsWith('task:'))nav('task',el.dataset.path);else tab('plan',el.dataset.path);break;
   case 'toggle':command('file','desk/toggle',Number(el.dataset.row));break;
   case 'undo':command('file','buffers/undo',Number(el.dataset.row));break;
   case 'edit-mode':send('file',{type:'mobile/edit-mode'});break;
   case 'folder':modal(null);tab('plan',d.folder);break;
   case 'working-file':modal(null);tab('plan',artifact?.path);break;
   case 'references':modal(null);tab('plan','links:task/'+d['task-id']);break;
   case 'open-file':nav('task');tab('plan',el.dataset.path);break;
   case 'source':modal('source');break;
   case 'cancel-task':modal('cancel');break;
   case 'confirm-cancel':send('task',{type:'mobile/cancel'});modal(null);break;
   case 'reconnect':probe();break;
   case 'unload':command('rail','mobile/unload');break;
  }
 }
 function input(event){const e=event.target,f=e.dataset.field;if(f==='reply')send('task',{type:'mobile/draft',text:e.value});if(f==='file')send('file',{type:'mobile/edit',text:e.value});if(f?.startsWith('new-'))send('rail',{type:'mobile/new-field',field:f.slice(4),value:e.value});}
 function submit(event){const form=event.target.closest('form');if(!form)return;event.preventDefault();if(!online())return;if(form.dataset.form==='reply')send('task',{type:'mobile/send'});if(form.dataset.form==='new')send('rail',{type:'mobile/create',place:form.querySelector('select').value,goal:form.querySelector('textarea').value});}
 async function probe(){
  if(disposed||probing)return;probing=true;probeAbort=new AbortController();const timeout=setTimeout(()=>probeAbort.abort(),5000);
  try{const r=await fetch('/api/doc?path=desk:welcome',{signal:probeAbort.signal,cache:'no-store'}),j=await r.json();if(!disposed)send('rail',{type:'mobile/connection',online:r.ok&&j.ok===true,checked:Date.now()});}
  catch{if(!disposed)send('rail',{type:'mobile/connection',online:false,checked:Date.now()});}
  finally{clearTimeout(timeout);probing=false;}
 }
 const network=()=>probe();window.addEventListener('online',network);window.addEventListener('offline',network);
 probeTimer=setInterval(probe,8000);queueMicrotask(probe);
 return {mount(root){let role;const click=e=>{e.stopPropagation();handle(e);},onInput=e=>input(e),onSubmit=e=>submit(e);root.addEventListener('click',click);root.addEventListener('input',onInput);root.addEventListener('change',onInput);root.addEventListener('submit',onSubmit);
  // The editor's global keyboard sink must not swallow native mobile fields.
  const compositionStart=()=>{composing=true;},compositionEnd=e=>{composing=false;input(e);render();};root.addEventListener('compositionstart',compositionStart);root.addEventListener('compositionend',compositionEnd);
  const stop=e=>e.stopPropagation();root.addEventListener('keydown',stop);root.addEventListener('beforeinput',stop);
  return {update(model){role=model.role;if(models.get(role)?.message!==model.message)messageOrder.set(role,++messageSequence);models.set(role,model);mounts.set(role,{root});render();},dispose(){if(mounts.get(role)?.root===root)mounts.delete(role);root.removeEventListener('click',click);root.removeEventListener('input',onInput);root.removeEventListener('change',onInput);root.removeEventListener('submit',onSubmit);root.removeEventListener('compositionstart',compositionStart);root.removeEventListener('compositionend',compositionEnd);root.removeEventListener('keydown',stop);root.removeEventListener('beforeinput',stop);root.replaceChildren();}};},
 dispose(){disposed=true;clearInterval(probeTimer);probeAbort?.abort();window.removeEventListener('online',network);window.removeEventListener('offline',network);css.remove();document.documentElement.classList.remove('omega-mobile');document.title=priorTitle;models.clear();mounts.clear();}};
}
