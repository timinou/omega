export function performanceControls(shadow,api){
 const container=document.createElement('section');container.className='performance-controls';
 container.innerHTML=`<div class="performance-row"><button data-perform>▶ PERFORM</button><button data-action="pause">PAUSE</button><button data-action="resume">RESUME</button><button data-action="undo">UNDO</button><button data-action="redo">REDO</button><button data-action="cancel">CANCEL</button><button data-action="panic">PANIC</button><span class="revision" aria-live="polite">ACTIVE · REV 0</span></div>
 <div class="performance-row"><span>SCENES</span>${['bathymetry','current','cathedral','afterglow'].map(name=>`<button data-launch="${name}">${name.toUpperCase()}</button>`).join('')}<label>AT<select data-quantize><option value="bar">BAR</option><option value="beat">BEAT</option><option value="phrase">PHRASE</option></select></label><label>VIA<select data-transition><option>crossfade</option><option>dissolve</option><option>iris</option></select></label><label>BEATS<select data-transition-beats><option>4</option><option>8</option><option>16</option></select></label></div>
 <div class="performance-row">${['build','break','drop','release'].map(name=>`<button data-gesture="${name}">${name.toUpperCase()}</button>`).join('')}<label>LAYER<select data-layer><option value="">OFF</option><option value="bathymetry">CONTOURS</option><option value="cathedral">MANDALA</option><option value="afterglow">RIBBONS</option></select></label><label>INTENSITY<input aria-label="Visual intensity" data-visual="intensity" type="range" min=".1" max="2" step=".05" value="1"></label></div>
 <details><summary>SESSION / MAPPINGS / DIAGNOSTICS</summary><div class="performance-row"><input data-snapshot-name value="home" aria-label="Snapshot name"><button data-save-snapshot>SAVE SNAPSHOT</button><select data-snapshots aria-label="Saved snapshots"><option value="">RECALL…</option></select><button data-save-session>SAVE SESSION</button><label class="file-label">OPEN SESSION<input data-open-session type="file" accept=".json"></label><button data-command="pelagic/preview">PREVIEW CODE</button><button data-midi>MIDI LEARN</button><select data-midi-target aria-label="MIDI target"><option value="crossfade">CROSSFADE</option><option value="filter">FILTER</option><option value="space">SPACE</option><option value="echo">ECHO</option><option value="master">MASTER</option><option value="intensity">VISUAL INTENSITY</option><option value="feedback">FEEDBACK</option><option value="palette">PALETTE</option></select></div>
 <div class="performance-row"><label>DENSITY<input aria-label="Pattern density" data-variation="density" type="range" min="0" max="1" step=".05" value="1"></label><label>TRANSPOSE<input aria-label="Pattern transposition" data-variation="transpose" type="number" min="-24" max="24" value="0"></label><label>FEEDBACK<input aria-label="Visual feedback" data-visual="feedback" type="range" min="0" max=".7" step=".02" value=".08"></label><button data-save-take>RECOVER LAST TAKE</button></div><pre class="diagnostics"></pre></details>`;
 shadow.querySelector('.transport').after(container);
 const $=selector=>container.querySelector(selector),guard=fn=>Promise.resolve().then(fn).catch(e=>api.notice('Edit rejected · '+(e.message||e)));
 const send=edit=>api.request({kind:'commit',quantize:$('[data-quantize]').value,edits:[edit]});
 let midi=null,learning=false;const bindings=new Map(),listeners=new Map();
 const receive=e=>{
  const [status,control,value]=e.data,key=(status&15)+':'+control;
  if((status&240)===176){if(learning){bindings.set(key,$('[data-midi-target]').value);learning=false;api.notice('MIDI mapped: '+bindings.get(key));}
    const target=bindings.get(key);if(target)guard(()=>{
      const n=value/127;if(['intensity','feedback','palette'].includes(target))send({kind:'visual',values:{[target]:target==='intensity'?.1+n*1.9:target==='feedback'?n*.7:n}});
      else api.mix(target,target==='filter'?.15+n*1.85:target==='space'?n*.9:target==='echo'?n*.7:n);
    });
  }else if((status&240)===144&&value>0){const names=['bathymetry','current','cathedral','afterglow'];guard(()=>send({kind:'launch',name:names[control%4],options:{transition:$('[data-transition]').value,beats:+$('[data-transition-beats]').value}}));}
 };
 container.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.command)return; // Existing real-editor command dispatcher handles preview.
  guard(async()=>{
   if(b.hasAttribute('data-perform'))api.perform();
   else if(b.dataset.action)await api.request({kind:b.dataset.action});
   else if(b.dataset.launch)send({kind:'launch',name:b.dataset.launch,options:{transition:$('[data-transition]').value,beats:+$('[data-transition-beats]').value}});
   else if(b.dataset.gesture)send({kind:'gesture',name:b.dataset.gesture});
   else if(b.hasAttribute('data-save-snapshot'))api.request({kind:'snapshot',name:$('[data-snapshot-name]').value});
   else if(b.hasAttribute('data-save-session'))api.save();
   else if(b.hasAttribute('data-save-take'))await api.take();
   else if(b.hasAttribute('data-midi')){
    if(!navigator.requestMIDIAccess)throw new Error('Web MIDI unavailable; keyboard and code controls remain available');
    midi||=await navigator.requestMIDIAccess();const connect=()=>{for(const input of midi.inputs.values())if(!listeners.has(input)){input.addEventListener('midimessage',receive);listeners.set(input,receive);}};
    connect();midi.onstatechange=connect;learning=true;api.notice('Move one MIDI CC to map '+$('[data-midi-target]').value);
   }
  });
 });
 container.addEventListener('change',e=>guard(async()=>{const x=e.target;
  if(x.dataset.visual)send({kind:'visual',values:{[x.dataset.visual]:+x.value}});
  else if(x.dataset.variation)send({kind:'variation',values:{[x.dataset.variation]:+x.value}});
  else if(x.hasAttribute('data-layer'))send({kind:'layer',name:x.value||null,mix:.3});
  else if(x.hasAttribute('data-snapshots')&&x.value)await api.request({kind:'recall',name:x.value});
  else if(x.hasAttribute('data-open-session')&&x.files[0])await api.load(JSON.parse(await x.files[0].text()));
 }));
 return {update(model,stats){
  $('.revision').textContent=stats.phase+' · REV '+model.revision+(stats.targetBeat!==undefined?' → BEAT '+stats.targetBeat:'');
  $('[data-action="undo"]').disabled=!model.past.length;$('[data-action="redo"]').disabled=!model.future.length;
  const snapshots=Object.keys(model.snapshots);if($('[data-snapshots]').dataset.names!==snapshots.join(',')){
   $('[data-snapshots]').replaceChildren(new Option('RECALL…',''),...snapshots.map(n=>new Option(n,n)));$('[data-snapshots]').dataset.names=snapshots.join(',');
  }
  $('.diagnostics').textContent=JSON.stringify(stats,null,2);
 },dispose(){for(const [input,fn] of listeners)input.removeEventListener('midimessage',fn);if(midi)midi.onstatechange=null;listeners.clear();container.remove();},receive,bindings};
}
