// Package-owned DOM and transport only. Selection/proposals live in BL state;
// sound, compilation and revision history use the existing instrument host.
export function phraseComposer(shadow,api){
 const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('composer.css',import.meta.url);shadow.append(link);
 const panel=document.createElement('section');panel.className='phrase-composer';panel.setAttribute('aria-label','Phrase workspace');
 panel.innerHTML=`<header class="phrase-heading"><div><span class="eyebrow">PELAGIC / GEN · 01</span><h2>Phrase studies</h2></div><button class="phrase-start" data-start aria-label="Start the example">▶ <span>Play</span></button></header>
 <div class="phrase-context"><button class="object-chip" data-select aria-label="Select melody function"><span class="object-dot"></span>melody <span class="object-type">ƒ</span></button><span class="phrase-meter">8 beats <span>·</span> D minor</span><span class="phase-badge" role="status"></span></div>
 <section class="phrase-lane" aria-label="Source melody"><div class="lane-caption"><span>SOURCE</span><span data-active-revision>r0</span></div><div class="note-grid" data-current-notes></div><div class="beat-ruler" aria-hidden="true">${Array.from({length:8},(_,i)=>`<span>${i+1}</span>`).join('')}</div></section>
 <nav class="form-path" aria-label="Selected syntax"></nav>
 <div class="form-tools"><span data-selection-kind></span><div>${[['prev','←','Previous form'],['up','↑','Parent form'],['down','↓','First child'],['next','→','Next form']].map(([d,g,l])=>`<button data-move="${d}" aria-label="${l}" title="${l}">${g}</button>`).join('')}</div></div>
 <form class="phrase-request"><label class="sr-only" for="phrase-intent">Change the selected form</label><textarea id="phrase-intent" rows="3" maxlength="2000" placeholder="Make this more syncopated…" spellcheck="false"></textarea><div class="request-bottom"><select aria-label="Generation provider" data-provider><option value="gen">Gen · live model</option><option value="demo">Demo · fixtures</option></select><button class="request-button" type="submit" aria-label="Generate variation">Generate <span>↗</span></button><button data-cancel type="button" aria-label="Cancel generation">×</button></div></form>
 <section class="candidate-card" hidden aria-label="Generated candidate"><div class="candidate-heading"><span class="eyebrow">NEXT</span><div class="candidate-versions" aria-label="Candidate history"></div><span class="candidate-provider"></span><button data-discard aria-label="Discard candidate">×</button></div><div class="note-grid candidate-grid" data-candidate-notes></div><details class="source-diff"><summary>Source <span>− / +</span></summary><pre class="diff-before"></pre><pre class="diff-after"></pre></details><div class="candidate-checks" aria-label="Validation checks"></div><div class="candidate-actions"><button data-audition>◉ <span>Audition</span></button><button data-commit>Commit <span>→ bar</span></button></div></section>
 <div class="phrase-error" role="alert" hidden></div><footer class="phrase-footer"><span class="phrase-progress" aria-label="Generation progress">${['select','generate','check','audition','live'].map((x,i)=>`<i data-step="${i}" title="${x}"></i>`).join('')}</span><button data-source-state data-save aria-label="Save source"></button><button data-undo aria-label="Undo last phrase commit">↶ Undo</button><button data-stop aria-label="Stop performance">■</button></footer>`;
 shadow.querySelector('.header').after(panel);
 const $=s=>panel.querySelector(s),send=(action,extra={})=>api.dispatch({type:'pelagic/compose',action,...extra});
 let model=null,dead=false,abort=null,epoch=0,notesKey='',candidateKey='',versionsKey='',selectionKey='',invalidationKey='';
 const active=()=>!dead&&model?.enabled;
 const guard=(id,phase)=>active()&&id===model.serial&&(!phase||model.phase===phase);
 const fail=(id,error)=>send('failed',{id,message:error.message||String(error)});
 const sourceState=()=>{const p=api.performance();return {revision:p.revision,phase:p.phase,beat:p.beat,playing:p.playing};};
 function drawNotes(element,notes,candidate=false){
  const fragment=document.createDocumentFragment();
  for(let i=0;i<8;i++){const line=document.createElement('i');line.className='beat-line';line.style.left=(i/8*100)+'%';fragment.append(line);}
  const pitches=notes.map(n=>n[1]),lo=Math.min(58,...pitches),hi=Math.max(78,...pitches);
  notes.forEach(([beat,pitch,duration],index)=>{const note=document.createElement(candidate?'span':'button');note.className='phrase-note';note.style.left=(beat/8*100)+'%';note.style.bottom=(12+(pitch-lo)/(hi-lo)*58)+'%';note.style.width=Math.max(2.8,Math.min(25,duration*(api.performance().bpm||122)/60/8*100))+'%';note.textContent=String(pitch);if(!candidate){note.dataset.note=index;note.setAttribute('aria-label',`Note ${index+1}, MIDI ${pitch}, beat ${beat+1}`);}fragment.append(note);});
  const playhead=document.createElement('i');playhead.className='phrase-playhead';fragment.append(playhead);element.replaceChildren(fragment);
 }
 function focus(){if(!active())return;$('textarea').focus();}
 async function generate(args){
  abort?.abort();abort=new AbortController();const turn=++epoch,controller=abort;
  const timeout=setTimeout(()=>controller.abort(),130000);
  try{
   const response=await fetch(new URL('/api/intent',location.href),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({intent:'pelagic/generate',args}),signal:controller.signal});
   const result=await response.json();if(turn!==epoch||!guard(args.id,'generating'))return;
   if(!response.ok||result.ok===false)throw new Error(result.message||'Generation failed');
   send('generated',{id:args.id,...result});
  }catch(error){if(turn===epoch&&guard(args.id,'generating'))fail(args.id,error.name==='AbortError'?new Error('Generation timed out'):error);}
  finally{clearTimeout(timeout);if(abort===controller)abort=null;}
 }
 async function effect(e){
  // bl-ed performs effects before painting the corresponding view model.
  // Read request guards after that dispatch has finished its synchronous draw.
  await Promise.resolve();if(dead)return;
  const args=e.args||{},id=args.id;
  if(e.op==='compose-focus'){focus();return;}
  if(e.op==='compose-cancel'){++epoch;abort?.abort();api.cancelEvaluation();api.request({kind:'audition-cancel'});return;}
  if(e.op==='compose-generate'){api.request({kind:'audition-cancel'});return generate(args);}
  try{
   if(e.op==='compose-check'){
    if(!guard(id,'checking'))return;
    const result=await api.evaluate(args.source,{validateOnly:true});
    if(!guard(id,'checking'))return;if(!result.ok)throw new Error(result.error);
    send('checked',{id,checks:['Reader','Scope','Finite phrase','Browser compile','Audio graph']});
   }else if(e.op==='compose-audition'){
    if(!guard(id,'preparing'))return;
    const result=await api.evaluate(args.source,{preview:true,previewBeats:8});
    if(!guard(id,'preparing')){api.request({kind:'audition-cancel'});return;}
    if(!result.ok)throw new Error(result.error);send('auditioned',{id});
   }else if(e.op==='compose-commit'){
    if(!guard(id,'committing'))return;
    const result=api.request({kind:'audition-commit',quantize:'bar'});send('committed',{id,revision:result.revision});
   }else if(e.op==='compose-undo'){
    if(!guard(id)||sourceState().revision!==args.revision||sourceState().phase!=='ACTIVE')throw new Error('Performance changed; select its current source before undoing');
    api.request({kind:'undo'});send('undone',{id,source:args.source});
   }
  }catch(error){if(guard(id))fail(id,error);}
 }
 panel.addEventListener('click',event=>{
  const b=event.target.closest('button');if(!b)return;
  if(b.dataset.note!==undefined)send('note',{index:+b.dataset.note});
  else if(b.hasAttribute('data-select'))send('select');
  else if(b.dataset.move)send('move',{direction:b.dataset.move});
  else if(b.dataset.path)send('path',{path:JSON.parse(b.dataset.path)});
  else if(b.dataset.version!==undefined)send('version',{index:+b.dataset.version});
  else if(b.hasAttribute('data-audition'))send('audition');
  else if(b.hasAttribute('data-commit'))send('commit');
  else if(b.hasAttribute('data-cancel')||b.hasAttribute('data-discard'))send('cancel');
  else if(b.hasAttribute('data-undo'))send('undo');
  else if(b.hasAttribute('data-stop'))api.request({kind:'stop'});
  else if(b.hasAttribute('data-save'))api.dispatch({type:'command',command:'save'});
  else if(b.hasAttribute('data-start'))api.start().catch(error=>fail(model.serial,error));
 });
 const draft=()=>send('draft',{prompt:$('textarea').value,provider:$('[data-provider]').value});
 $('textarea').addEventListener('input',draft);$('[data-provider]').addEventListener('change',draft);
 $('.phrase-request').addEventListener('submit',event=>{event.preventDefault();send('generate',{prompt:$('textarea').value,provider:$('[data-provider]').value});});
 $('textarea').addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();$('.phrase-request').requestSubmit();}});
 function update(next){
  const was=active();model=next;const enabled=active();panel.hidden=!enabled;shadow.querySelector('.app').classList.toggle('composing',!!enabled);api.composing(!!enabled);
  if(!enabled){if(was){++epoch;abort?.abort();}return;}
  const invalidation=model.serial+':'+model.phase;
  if(was&&['stale','reverted'].includes(model.phase)&&invalidation!==invalidationKey){
   invalidationKey=invalidation;++epoch;abort?.abort();api.cancelEvaluation();
   queueMicrotask(()=>{if(active()&&model.serial+':'+model.phase===invalidation)api.request({kind:'audition-cancel'});});
  }
  const phase=model.phase||'idle',busy=['generating','checking','preparing','committing'].includes(phase),candidate=model.candidate;
  panel.dataset.phase=phase;const names={idle:'Select',generating:'Generating',checking:'Checking',ready:'Ready',preparing:'Preparing',audition:'Audition',committing:'Commit',queued:'Next bar',active:'Live',failed:'Check',stale:'Changed',reverted:'Restored'};
  $('.phase-badge').textContent=names[phase]||phase;
  if(shadow.activeElement!==$('textarea')&&model.draft!==undefined)$('textarea').value=model.draft;
  if(model.provider&&shadow.activeElement!==$('[data-provider]'))$('[data-provider]').value=model.provider;
  $('.request-button').disabled=busy||!model.selection?.supported||!$('textarea').value.trim();$('[data-cancel]').hidden=!busy;
  const key=JSON.stringify(model.notes||[]);if(key!==notesKey){notesKey=key;drawNotes($('[data-current-notes]'),model.notes||[]);}
  const sk=JSON.stringify(model.selection);if(sk!==selectionKey){selectionKey=sk;$('.form-path').replaceChildren(...(model.selection?.trail||[]).map((entry,i,all)=>{const b=document.createElement('button');b.textContent=entry.label;b.dataset.path=JSON.stringify(entry.path);b.setAttribute('aria-current',i===all.length-1?'location':'false');return b;}));$('[data-selection-kind]').textContent=model.selection?.kind||'Select code';}
  panel.querySelectorAll('[data-note]').forEach(b=>{const path=model.selection?.path||[];b.classList.toggle('selected',path.length>=3&&path[1]===3&&path[2]===+b.dataset.note);});
  $('.object-chip').classList.toggle('selected',!!model.selection?.supported);$('.candidate-card').hidden=!candidate;
  if(candidate){const ck=JSON.stringify([candidate.id,candidate.source]);if(ck!==candidateKey){candidateKey=ck;drawNotes($('[data-candidate-notes]'),candidate.notes||[],true);$('.diff-before').textContent='− '+candidate.before;$('.diff-after').textContent='+ '+candidate.replacement;$('.candidate-provider').textContent=candidate.provider||'';}
   $('.candidate-checks').replaceChildren(...(candidate.checks||[]).map(name=>{const item=document.createElement('span');item.textContent='✓ '+name;return item;}));
  }
  const vk=JSON.stringify((model.versions||[]).map(x=>[x.id,x.source===candidate?.source]));if(vk!==versionsKey){versionsKey=vk;$('.candidate-versions').replaceChildren(...(model.versions||[]).map((version,index)=>{const b=document.createElement('button');b.textContent=String(index+1).padStart(2,'0');b.dataset.version=index;b.classList.toggle('selected',version.source===candidate?.source);b.disabled=version.basis!==candidate?.basis||busy;return b;}));}
  $('[data-audition]').disabled=!['ready','audition'].includes(phase);$('[data-commit]').disabled=phase!=='audition';
  $('[data-commit]').classList.toggle('armed',phase==='audition');$('[data-audition]').classList.toggle('selected',phase==='audition');
  $('[data-undo]').disabled=phase!=='active';$('[data-source-state]').textContent=model.dirty?'● Save source':'Saved source';$('[data-source-state]').disabled=!model.dirty;
  $('.phrase-error').hidden=!model.error;$('.phrase-error').textContent=model.error||'';
  const step={idle:0,generating:1,checking:2,ready:2,preparing:3,audition:3,committing:4,queued:4,active:4}[phase]??0;
  panel.querySelectorAll('[data-step]').forEach((el,i)=>{el.classList.toggle('done',i<step);el.classList.toggle('current',i===step);});
 }
 function tick(stats){if(!active())return;$('[data-active-revision]').textContent=model.phase==='queued'?'→ bar':model.phase==='stale'?'draft':'r'+stats.revision;$('[data-start]').classList.toggle('playing',stats.playing);$('[data-start] span').textContent=stats.playing?'Playing':'Play';
  panel.querySelectorAll('.phrase-playhead').forEach(el=>{el.style.left=((stats.beat%8)/8*100)+'%';el.hidden=!stats.playing;});
  if(model.phase==='audition'){
   const current=api.performance().auditionCurrent;$('[data-commit]').disabled=!current;
   $('.phase-badge').textContent=current?'Audition':'Changed';panel.dataset.phase=current?'audition':'stale';
  }
  if(model.phase==='reverted'){
   $('.phase-badge').textContent=stats.phase==='ACTIVE'?'Restored':'Undo → bar';panel.dataset.phase=stats.phase==='ACTIVE'?'reverted':'queued';
  }
  if(model.phase==='queued'&&stats.phase==='ACTIVE'&&stats.revision===model['performance-revision'])send('active');
 }
 return {update,tick,effect,focus,enabled:active,dispose(){dead=true;++epoch;abort?.abort();panel.remove();link.remove();api.composing(false);}};
}
