// Package-owned DOM/IO. Source, targets, conversations and edits live in BL.
export function workbenchHost(api) {
  const mounts=new Set();let current=null,controller=null,dead=false,epoch=0;
  let layoutCSS=null;
  const send=(action,extra={})=>api.dispatch({type:'pelagic/work',action,...extra});
  const setText=(el,value)=>{if(el.textContent!==value)el.textContent=value;};
  const setAttr=(el,name,value)=>{value=String(value);if(el.getAttribute(name)!==value)el.setAttribute(name,value);};
  const node=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;};
  const button=(text,label,fn,cls='')=>{const b=node('button',cls,text);b.type='button';if(label)b.setAttribute('aria-label',label);b.addEventListener('click',fn);return b;};
  const selected=(s,r)=>(s.selected||[]).some(x=>x.label===r.label);
  const targetNames=s=>(s.selected||[]).map(x=>x.label).join(' · ')||s.document;
  function referenceButtons(entries,dispatch){const row=node('div','targets');for(const x of entries||[]){row.append(button(x.label,'Reveal '+x.label,()=>dispatch('reveal',{id:x.id})));}return row;}
  function composer(surface,dispatch){
    const form=node('form','request'),top=node('div','request-top'),modes=node('div','modes');modes.setAttribute('aria-label','Request action');
    const ask=button('Ask','Ask about code',()=>setMode('ask')),change=button('Change','Change code',()=>setMode('change'));
    modes.append(ask,change);const scope=node('span','scope');top.append(modes,scope);
    const text=node('textarea');text.rows=3;text.maxLength=2000;text.placeholder=surface==='session'?'Ask about this code…':'What would you like to change?';
    text.setAttribute('aria-label',surface==='session'?'Session request':'Local request');text.spellcheck=false;
    const bottom=node('div','request-bottom'),provider=node('select');provider.setAttribute('aria-label','Request provider');
    for(const [value,label] of [['gen','Gen · live'],['demo','Demo · fixtures']]){const o=node('option','',label);o.value=value;provider.append(o);}
    const submit=node('button','submit','Change ↗');submit.type='submit';const cancel=button('×','Cancel request',()=>dispatch('cancel'));
    bottom.append(provider,cancel,submit);form.append(top,text,bottom);
    let mode=surface==='session'?'ask':'change',pending=false,draftTimer=null,clock=null,busy=false,busyAt=0,phase='',serial=null;
    const paintSubmit=()=>{setText(submit,busy?`${phase==='checking'?'Checking':'Generating'} · ${Math.floor((performance.now()-busyAt)/1000)}s`:mode==='ask'?'Ask ↗':'Change ↗');
      submit.disabled=busy||!text.value.trim();};
    function flush(){clearTimeout(draftTimer);draftTimer=null;if(!pending)return;pending=false;dispatch('draft',{surface,prompt:text.value,mode,provider:provider.value});}
    function draft(){pending=true;flush();}
    function setMode(value){mode=value;draft();}
    // Native text entry must not run a complete editor transaction per key.
    // Synchronize the draft after a pause and before focus/navigation/submission.
    text.addEventListener('input',()=>{pending=true;clearTimeout(draftTimer);paintSubmit();draftTimer=setTimeout(flush,250);});
    text.addEventListener('blur',flush);provider.addEventListener('change',draft);
    text.addEventListener('keydown',e=>{if(e.isComposing)return;if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();form.requestSubmit();}else if(e.key==='Escape'){e.preventDefault();flush();dispatch('dismiss');api.focusEditor?.();}});
    form.addEventListener('submit',e=>{e.preventDefault();if(!submit.disabled){flush();dispatch('submit',{surface,mode,prompt:text.value});}});
    return {element:form,text,dispose(){clearTimeout(draftTimer);clearInterval(clock);},update(s){mode=s[surface==='session'?'sidebar-mode':'mode']||mode;
      setAttr(ask,'aria-pressed',mode==='ask');setAttr(change,'aria-pressed',mode==='change');
      const draft=s[surface==='session'?'sidebar-draft':'draft']||'';if(!pending&&text.value!==draft)text.value=draft;
      const pv=s.provider||'gen';if(provider.value!==pv)provider.value=pv;
      const nextBusy=['generating','checking'].includes(s.phase);
      if(nextBusy&&(!busy||serial!==s.serial)){busyAt=performance.now();serial=s.serial;}
      busy=nextBusy;phase=s.phase;cancel.hidden=!busy;
      if(busy&&!clock)clock=setInterval(paintSubmit,1000);else if(!busy&&clock){clearInterval(clock);clock=null;}
      paintSubmit();
      const old=(s.entries||[]).find(x=>x.id===s.entry);const xs=surface==='session'&&old?(s['reply-targets']||old['after-targets']||old.targets):s.selected;
      setText(scope,(xs||[]).map(x=>x.label).join(' · ')||(surface==='session'&&old?old.document:s.document));if(scope.title!==scope.textContent)scope.title=scope.textContent;
    }};
  }
  function component(root,dispatch){
    const card=node('article','component'),header=node('header'),select=button('','',()=>{}),label=node('span','component-name'),kind=node('span','kind');
    select.className='select-object';select.replaceChildren(label,kind);const peek=button('〈 〉','Peek source',()=>dispatch('peek',{id:model.target.id}),'peek');
    header.append(select,peek);const grid=node('div','notes'),params=node('div','parameters'),code=node('textarea','source-peek');code.spellcheck=false;code.setAttribute('aria-label','Component source');
    const ruler=node('div','ruler');for(let i=0;i<8;i++)ruler.append(node('span','',String(i+1)));
    card.append(header,grid,ruler,params,code);root.append(card);let model=null,key='';
    select.addEventListener('click',e=>dispatch('select',{id:model.target.id,add:e.shiftKey}));
    card.addEventListener('click',e=>{if(e.target===card||e.target===grid)dispatch('select',{id:model.target.id,add:e.shiftKey});});
    code.addEventListener('focus',()=>dispatch('edit-start',{id:model.target.id}));
    code.addEventListener('input',()=>dispatch('edit',{id:model.target.id,code:code.value}));
    code.addEventListener('blur',()=>dispatch('edit-end'));
    code.addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.isComposing){e.preventDefault();code.blur();api.focusEditor?.();}});
    let parameterKey='';
    return {update(s,target,split){model={s,target};setText(label,target.label.replace('-pattern',''));setText(kind,target.profile==='phrase'?'8 BEATS':'INSTRUMENT');
      setAttr(select,'aria-label','Select '+target.label);setAttr(peek,'aria-label','Peek '+target.label+' source');
      card.classList.toggle('selected',selected(s,target));card.classList.toggle('changed',(s.changed||[]).includes(target.label));
      card.classList.toggle('working',['generating','checking'].includes(s.phase)&&selected(s,target));
      const notes=target.notes||[],signature=JSON.stringify(notes);if(signature!==key){key=signature;grid.replaceChildren();
        for(let i=0;i<8;i++){const line=node('i','beat');line.style.left=(i/8*100)+'%';grid.append(line);}
        const pitches=notes.map(x=>x[1]),drum=target.label==='kick-pattern',lo=Math.min(...pitches,48),hi=Math.max(...pitches,78);
        notes.forEach(([beat,pitch,dur],index)=>{const n=button('','Event '+(index+1)+' of '+target.label,e=>dispatch('note',{id:target.id,index,add:e.shiftKey}),'note');
          n.style.left=(beat/8*100)+'%';n.style.bottom=(drum?18:8+(pitch-lo)/Math.max(1,hi-lo)*50)+'%';n.style.width=Math.max(2.8,Math.min(24,dur*122/60/8*100))+'%';
          n.title=drum?`Beat ${beat} · amplitude ${pitch}`:`Beat ${beat} · MIDI ${pitch}`;n.setAttribute('aria-label',n.title+' · '+target.label);grid.append(n);});}
      grid.querySelectorAll('.note').forEach((note,index)=>note.classList.toggle('selected',(s.selected||[]).some(x=>x.label===target.label&&x.path?.[1]===3&&x.path?.[2]===index)));
      const phrase=target.profile==='phrase';grid.hidden=!phrase;ruler.hidden=!phrase;params.hidden=phrase;
      const parameters=Array.isArray(target.parameters)?target.parameters:[];
      const pk=JSON.stringify(parameters.map(x=>x.name));if(pk!==parameterKey){parameterKey=pk;params.replaceChildren();
        parameters.forEach((p,index)=>{const label=node('label','parameter',p.name),input=node('input');input.type='number';input.step='any';input.setAttribute('aria-label',target.label+' '+p.name);
          input.addEventListener('change',()=>{if(input.value!==''&&Number.isFinite(input.valueAsNumber))dispatch('parameter',{id:model.target.id,index,value:input.valueAsNumber});});label.append(input);params.append(label);});}
      [...params.querySelectorAll('input')].forEach((input,index)=>{if(input!==root.getRootNode().activeElement)input.value=parameters[index].value;});
      const open=typeof s.peeks?.has==='function'?s.peeks.has(target.id):(s.peeks||[]).includes(target.id);setAttr(peek,'aria-expanded',open);code.hidden=!(split&&open);
      if(code.value!==target.code)code.value=target.code;
      card.classList.toggle('instrument',!phrase);card.classList.toggle('source-open',split&&open);
    }};
  }
  function mount(root,dispatchEvent){
    root.dataset.pelagicWorkbench='';
    if(!layoutCSS){layoutCSS=node('link');layoutCSS.rel='stylesheet';layoutCSS.href=new URL('layout.css',import.meta.url);document.head.append(layoutCSS);}
    const shadow=root.shadowRoot||root.attachShadow({mode:'open'});shadow.replaceChildren();
    const css=node('link');css.rel='stylesheet';css.href=new URL('workbench.css',import.meta.url);shadow.append(css);
    const body=node('section','workbench');shadow.append(body);let kind=null,parts=null,last=null;
    const dispatch=(action,args={})=>dispatchEvent({type:'pelagic/work',action,...args});
    const mounted={root,shadow,get kind(){return kind;},focus(){parts?.composer?.text.focus({preventScroll:true});}};mounts.add(mounted);
    // Components participate in normal editor commands when no text input owns focus.
    shadow.addEventListener('keydown',e=>{if(e.defaultPrevented||e.isComposing||/^(TEXTAREA|INPUT|SELECT)$/.test(e.target.tagName))return;
      if(e.ctrlKey||e.metaKey||e.altKey)return;if(e.key.length===1||e.key==='Escape'){e.preventDefault();dispatchEvent({type:'key',key:e.key});}});
    function initialize(model){kind=model.kind;body.classList.add('view-'+kind);
      if(kind==='toolbar'){
        const title=node('div','identity');title.append(node('span','eyebrow','PELAGIC / LIVE CODE'),node('strong','','Phrase studies'));
        const play=button('▶','Play the current document',()=>api.start()),stop=button('■','Stop performance',()=>dispatchEvent({type:'command',command:'pelagic/stop'}));
        const actions=node('nav','toolbar-actions');actions.append(play,stop,
          button('Ask ↗','Ask or change selection',()=>dispatch('open')),
          button('⇄','Toggle inline and split',()=>dispatch('layout')),button('Session','Toggle Session',()=>dispatch('sidebar')));
        body.append(title,actions);parts={play,stop};
      }else if(kind==='component'){parts={card:component(body,dispatch)};
      }else if(kind==='components'){
        const header=node('header','panel-heading');header.append(node('span','eyebrow','THE INSTRUMENT'),node('h2','','Voices & phrases'));
        const transport=node('nav','panel-transport'),play=button('▶ Play','Play the current document',()=>api.start());
        transport.append(play,button('■','Stop performance',()=>dispatchEvent({type:'command',command:'pelagic/stop'})));header.append(transport);
        const hint=node('p','hint','Shift-click to select together');const cards=node('div','component-list');body.append(header,hint,cards);parts={cards,views:new Map()};
        parts.play=play;
      }else if(kind==='prompt'){
        const heading=node('div','prompt-heading');heading.append(node('span','eyebrow','WITH THE SELECTION'),button('×','Close local prompt',()=>dispatch('dismiss')));
        const comp=composer('local',dispatch),answer=node('div','answer'),error=node('div','error');answer.dataset.packageScroll='';
        body.append(heading,comp.element,answer,error);parts={composer:comp,answer,error};
      }else if(kind==='session'){
        const header=node('header','panel-heading');header.append(node('span','eyebrow','THIS SESSION'),node('h2','','Conversations'));
        const actions=node('div','session-actions');actions.append(button('＋ New','New conversation',()=>dispatch('new')),button('×','Close Session',()=>dispatch('sidebar')));
        const list=node('div','history'),exchange=node('div','exchange'),comp=composer('session',dispatch),error=node('div','error');
        list.dataset.packageScroll='';exchange.dataset.packageScroll='';body.append(header,actions,list,exchange,error,comp.element);
        parts={list,exchange,composer:comp,error,listKey:'',exchangeKey:''};
      }
    }
    function update(model){if(dead)return;last=model;const s=model.workbench;if(!s)return;current=s;if(!kind)initialize(model);
      if(kind==='toolbar'){const here=s.layout==='inline'||matchMedia('(max-width:760px)').matches;parts.play.hidden=!here;parts.stop.hidden=!here;setText(parts.play,api.playing()?'↵':'▶');return;}
      if(kind==='component'){const target=(s.roots||[]).find(x=>x.id===model.target);if(target)parts.card.update(s,target,false);return;}
      if(kind==='components'){
        const live=api.playing();setText(parts.play,live?'↵ Evaluate':'▶ Play');parts.play.classList.toggle('playing',live);
        const ids=new Set();for(const target of s.roots||[]){ids.add(target.id);let view=parts.views.get(target.id);if(!view){const el=node('div');parts.cards.append(el);view={el,card:component(el,dispatch)};parts.views.set(target.id,view);}view.card.update(s,target,true);}
        for(const [id,view]of parts.views)if(!ids.has(id)){view.el.remove();parts.views.delete(id);}return;
      }
      if(kind==='prompt'){parts.composer.update(s);setText(parts.answer,s['local-answer']||'');parts.answer.hidden=!s['local-answer'];setText(parts.error,s.error||'');parts.error.hidden=!s.error;return;}
      if(kind==='session'){
        parts.composer.update(s);setText(parts.error,s.error||'');parts.error.hidden=!s.error;
        const entries=s.entries||[],listKey=JSON.stringify(entries.map(x=>[x.id,x.prompt,x.status,x.id===s.entry]));
        if(listKey!==parts.listKey){parts.listKey=listKey;parts.list.replaceChildren();
          if(!entries.length)parts.list.append(node('p','empty','Your questions and changes stay here.'));
          for(const e of [...entries].reverse()){
            const b=button('','Open exchange '+e.id,()=>dispatch('entry',{id:e.id}),'history-item');b.classList.toggle('selected',e.id===s.entry);
            const meta=node('span','history-meta',`${e.mode==='ask'?'? ASK':'↗ CHANGE'} · ${(e.targets||[]).map(x=>x.label.replace('-pattern','')).join(' + ')||'buffer'}`);
            b.append(meta,node('span','history-prompt',e.prompt),node('span','history-status',e.status));parts.list.append(b);}}
        const active=entries.find(x=>x.id===s.entry),turns=active?entries.filter(x=>x.conversation===active.conversation):[];
        const exKey=JSON.stringify(turns);if(exKey!==parts.exchangeKey){parts.exchangeKey=exKey;parts.exchange.replaceChildren();
          for(const e of turns){const turn=node('article','turn');turn.append(node('p','question',e.prompt));
            if(e.answer)turn.append(node('div','answer',e.answer));if(e.summary)turn.append(node('p','change-summary',e.summary));
            if(e.provider)turn.append(node('small','provider',e.provider));turn.append(referenceButtons(e.targets,dispatch));
            if(e.edits){const details=node('details'),summary=node('summary','','Source changes');details.append(summary);
              for(const edit of e.edits){const target=e.targets.find(x=>x.id===edit.id);details.append(node('pre','before',target?.code||''),node('pre','after',edit.replacement));}turn.append(details);}
            else if(e.targets?.length||e.snapshot){const details=node('details'),summary=node('summary','','Captured code · '+e.document);details.append(summary);
              for(const target of e.targets||[])details.append(node('pre','snapshot',target.code));if(e.snapshot)details.append(node('pre','snapshot',e.snapshot));turn.append(details);}
            parts.exchange.append(turn);}
          if(active)parts.exchange.append(button('Use current selection','Use current selection for reply',()=>dispatch('retarget'),'retarget'));
        }
      }
    }
    root.pelagicWorkspace={stats:api.stats,evaluate:api.evaluate,request:api.request,compilerReady:api.compilerReady,model:()=>current};
    return {update,dispose(){parts?.composer?.dispose();mounts.delete(mounted);delete root.dataset.pelagicWorkbench;delete root.pelagicWorkspace;shadow.replaceChildren();}};
  }
  async function effect(e){
    await Promise.resolve();if(dead)return;const args=e.args||{};
    if(e.op==='work-focus'){for(const m of mounts)if(m.kind==='prompt')m.focus();return;}
    if(e.op==='work-cancel'){++epoch;controller?.abort();return;}
    const reply=(action,fields={})=>api.dispatch({type:'pelagic/work',action,id:args.id,pane:e.pane,...fields});
    if(!['work-check','work-request'].includes(e.op))return;
    const checking=e.op==='work-check',limit=checking?(api.timeouts?.checkMs??30000):(api.timeouts?.requestMs??60000);
    controller?.abort();controller=new AbortController();const own=controller,turn=++epoch,timer=setTimeout(()=>own.abort(),limit);
    let onAbort;
    const abort=new Promise((_,reject)=>{onAbort=()=>reject(new DOMException('Aborted','AbortError'));own.signal.addEventListener('abort',onAbort,{once:true});});
    try{
      const task=checking?api.evaluate(args.source,{validateOnly:true}):(async()=>{
        const response=await fetch('/api/intent',{method:'POST',headers:{'content-type':'application/json'},
          body:JSON.stringify({intent:args.mode==='ask'?'pelagic/ask':'pelagic/change',args}),signal:own.signal});
        const result=await response.json();if(!response.ok||result.ok===false)throw new Error(result.message||'Request failed');return result;
      })();
      const result=await Promise.race([task,abort]);if(dead||turn!==epoch)return;
      if(checking)reply(result.ok?'checked':'failed',result.ok?{}:{message:result.error});
      else reply(args.mode==='ask'?'answered':'generated',result);
    }catch(error){if(!dead&&turn===epoch)reply('failed',{message:error.name==='AbortError'?`${checking?'Code check':'Generation'} timed out after ${limit/1000}s. You can retry.`:error.message});}
    finally{clearTimeout(timer);own.signal.removeEventListener('abort',onAbort);if(controller===own)controller=null;}
  }
  return {mount,effect,dispose(){dead=true;++epoch;controller?.abort();layoutCSS?.remove();for(const m of mounts)m.root.pelagicWorkspace=null;mounts.clear();}};
}
