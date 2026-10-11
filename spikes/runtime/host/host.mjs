import {observations} from '../../package-observations.mjs';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const json=x=>JSON.stringify(x??null,null,2);
const short=x=>String(x||'unavailable').slice(0,12);
const button=(label,attrs='')=>'<button '+attrs+'>'+esc(label)+'</button>';
const article=body=>'<article>'+body+'</article>';
const section=(title,body,cls='')=>'<section class="'+cls+'"><h2>'+title+'</h2>'+body+'</section>';
export function createHost(){
 return {effect(e){
  if(e.op==='export'){
   const url=URL.createObjectURL(new Blob([json(e.args)],{type:'application/json'}));
   const a=document.createElement('a');a.href=url;a.download='omega-runtime.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }else if(e.op==='candidate'){
   const url=new URL(e.args.url,location.href);
   if(url.origin!==location.origin||!/^\/generations\/[a-f0-9]{64}\/$/.test(url.pathname))throw new Error('Candidate must be an admitted same-origin generation');
   window.open(url.href,'_blank','noopener');
  }else if(e.op==='audition-cancel'){
   const reader=observations();try{reader.invoke(e.args.id,'audition-cancel');}finally{reader.dispose();}
  }
 },mount(root,dispatch){
  const shadow=root.attachShadow({mode:'open'}),reader=observations();let dead=false,paused=false,signature;
  const css=document.createElement('link');css.rel='stylesheet';css.href=new URL('./style.css',import.meta.url).href;
  const shell=document.createElement('main');shadow.append(css,shell);
  const send=event=>{if(!dead)dispatch(event);};
  const sample=()=>{if(dead||paused||document.hidden)return;send({type:'runtime/browser',data:reader.sample()});send({type:'runtime/refresh'});};
  const timer=setInterval(sample,1000);document.addEventListener('visibilitychange',sample);queueMicrotask(sample);
  function render(m){
   const s=m.state||{},b=s.backend||{},items=m.items||[],selected=m.selected,build=b.build||{};
   const jobs=items.filter(i=>['probe','task'].includes(i.kind)),resources=items.filter(i=>i.kind==='browser-resource');
   const active=jobs.filter(j=>['running','cancelling'].includes(j.status)).length;
   const owners=section('Ownership','<p>BEAM ownership and reported browser tabs are separate trees.</p><div role="tree">'+
    items.filter(i=>!['probe','task'].includes(i.kind)).map(i=>'<button role="treeitem" aria-selected="'+(selected?.id===i.id)+'" class="row '+(i.parent?'child':'')+'" data-select="'+esc(i.id)+'"><span>'+esc(i.kind)+'</span><b>'+esc(i.title)+'</b><small>'+esc(i.parent||'root')+'</small></button>').join('')+
    '</div><p class="muted">Other projects and unreported tabs are outside this view. Member rows are capped at 128.</p>','owners');
   const work=section('Active work','<p>Probe jobs exercise the native actor path; they are not playback work.</p>'+button('Start actor probe','data-action="start"')+
    jobs.map(j=>article('<button class="select" data-select="'+esc(j.id)+'">'+esc(j.title)+' · '+esc(j.status)+'</button>'+
     (j.kind==='probe'?'<progress max="200" value="'+(j.progress||0)+'"></progress><small>'+(j.progress||0)+'/200 turns · '+Math.round(j['elapsed-ms']||0)+' ms'+
      (j['cancel-ms']!=null?' · cancellation '+j['cancel-ms']+' ms':'')+'</small>'+
      (['running','cancelling'].includes(j.status)?button('Cancel','data-cancel="'+esc(j.id)+'"'):''):''))).join('')+
    resources.map(r=>article('<button class="select" data-select="'+esc(r.id)+'">'+esc(r.title)+' · browser work</button><p>Preparation '+
     (r.data?.preparing?.done?'complete':r.data?.preparing?.worker?'running':'idle')+' · '+(r.data?.preparing?.rows??0)+'/1024 rows<br>Evaluator '+
     (r.data?.evaluator?'available':'absent')+' · queued edits '+(r.data?.pending??0)+'</p>')).join(''));
   const health=section('Health & timing','<p>Browser clocks and audio-clock estimates; physical output latency is not measured.</p><p>BEAM memory '+
    (b.vm?Math.round(b.vm.memory/1048576)+' MiB':'unavailable')+' · processes '+(b.vm?.processes??'unavailable')+'</p>'+
    (resources.map(r=>{const d=r.data?.diagnostics||{};return article('<b>'+esc(r.title)+(r.remote?' · reported peer':'')+'</b><dl><dt>Audio</dt><dd>'+esc(r.data?.audioContext)+
      '</dd><dt>Missed events</dt><dd>'+(d.missedEvents??'unavailable')+'</dd><dt>Frame P95 / P99</dt><dd>'+(d.frameP95??'—')+' / '+(d.frameP99??'—')+
      ' ms</dd><dt>Prepare turn P95</dt><dd>'+(d.preparation?.nativeTurnP95Ms??'—')+' ms</dd><dt>A/V submit P95</dt><dd>'+(d.avSubmitP95Ms??'—')+
      ' ms (submission only)</dd><dt>Preparation pool</dt><dd>'+esc(json(r.data?.pool))+'</dd></dl><details><summary>All timing and resource counters</summary><pre>'+esc(json(d))+'</pre></details>');}).join('')||
     '<p>No package timing reports yet. Open PELAGIC in another tab on this origin.</p>'));
   const builds=section('Builds & revisions','<p>Serving <code>'+esc(short(build.current))+'</code> · watcher <b>'+esc(build.watch?.status||'not running')+'</b></p>'+
    (build.watch?.error?'<p class="warning">Held: '+esc(build.watch.error)+'</p>':'')+
    (build.watch?.candidate?'<p>Ready candidate '+esc(short(build.watch.candidate.generation))+'</p>'+button('Open candidate','data-candidate="'+esc(build.watch.candidate.path)+'"'):'')+
    (build.watch&&build.watch.status!=='stopped'?button('Stop watch','data-action="watch-stop"'):'')+
    '<ul>'+(build.generations||[]).map(g=>'<li><code>'+esc(short(g.id))+'</code> · host-pinned '+button('Open','data-candidate="'+esc(g.url)+'"')+'</li>').join('')+
    '</ul><p class="muted">Opening a candidate creates a new frontend session. Existing performances keep their graph. Host/realm restart uses the CLI and affects all its sessions.</p>');
   const detail=section('Selected item',selected?'<h3>'+esc(selected.title)+'</h3><p>'+esc(selected.kind)+' · <code>'+esc(selected.id)+'</code></p>'+
    (selected.source?button('Open source','data-source="'+esc(selected.source)+'"'):'')+
    (selected.kind==='browser-resource'&&!selected.remote&&selected.data?.diagnostics?.audition?button('Cancel local audition','data-audition="'+esc(selected.id)+'"'):'')+
    '<pre>'+esc(json(selected))+'</pre>':'<p>Select an owner or job to inspect it.</p>','detail');
   shell.innerHTML='<header><div><small>OMEGA / RUNTIME · PROTOTYPE</small><h1>Owned work, in view</h1><p role="status">'+active+' active jobs · '+resources.length+' reported package resources · '+
    (s.paused?'sampling paused':'sampling 1 Hz')+'</p></div><nav>'+button(s.paused?'Resume':'Pause','data-action="pause"')+button('Refresh','data-action="refresh"')+
    button('Export snapshot','data-action="export"')+button('Return','data-action="close"')+'</nav></header>'+
    (s.error?'<p class="warning">Backend unavailable: '+esc(s.error)+'. Browser observations remain available.</p>':'')+
    (s.notice?'<p class="notice">'+esc(s.notice)+'</p>':'')+'<div class="grid">'+owners+work+health+builds+detail+'</div>'+
    '<footer>Read-only observations unless you invoke an action. Same-origin peer reports expire after six seconds. No mailbox contents or environment variables are collected.</footer>';
  }
  shell.addEventListener('click',event=>{
   const b=event.target.closest('button');if(!b)return;
   if(b.dataset.select)send({type:'runtime/select',item:b.dataset.select});
   if(b.dataset.cancel)send({type:'runtime/cancel',id:b.dataset.cancel});
   if(b.dataset.source)send({type:'runtime/source',path:b.dataset.source});
   if(b.dataset.candidate)send({type:'runtime/candidate',url:b.dataset.candidate});
   if(b.dataset.audition)send({type:'runtime/audition-cancel',id:b.dataset.audition});
   if(b.dataset.action==='watch-stop'){if(confirm('Stop speculative builds for this world? Existing pages and playback remain.'))send({type:'runtime/watch-stop',confirmed:true});}
   else if(b.dataset.action)send({type:'runtime/'+b.dataset.action});
  });
  return {update(model){paused=!!model.state?.paused;const next=JSON.stringify(model);if(next!==signature){signature=next;render(model);}},dispose(){dead=true;clearInterval(timer);document.removeEventListener('visibilitychange',sample);reader.dispose();shadow.replaceChildren();}};
 }};
}
