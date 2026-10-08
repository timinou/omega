import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {syncRuns,resume} from './lifecycle.mjs';
import {Workflow} from './workflow.mjs';
import {workflowView,compactCard,attention,shortlist,changedFields} from './views.mjs';
export const stages=['discovered','notice-checked','dossier-reviewed','qualification-checked'];
export const canPursue=o=>o.stage==='qualification-checked'&&!(o.unknowns||[]).length&&(o.requirements||[]).length>0&&o.requirements.every(r=>r.verdict==='met');
export const decisions=['needs-information','pursue','reject'];
const valid=x=>typeof x==='string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(x);
const wrap=s=>String(s||'').replace(/\n/g,' ').match(/.{1,72}(?:\s|$)|\S+/g)?.map(s=>s.trim()).join('\n')||'';
export class Procurement {
 constructor(root,upstream){this.root=root;this.upstream=upstream;this.locks=new Map();this.runs=new Map();this.workflow=new Workflow(this);this.sessions=async()=>[];}
 dir(id){if(!valid(id))throw Error('Use a lowercase desk ID with letters, numbers and hyphens');return path.join(this.root,'desks',id);}
 async read(id){return JSON.parse(await fs.readFile(path.join(this.dir(id),'state.json'),'utf8'));}
 async atomic(file,data){await fs.mkdir(path.dirname(file),{recursive:true});const tmp=file+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(tmp,data);await fs.rename(tmp,file);}
 async lock(id,fn){const prev=this.locks.get(id)||Promise.resolve();const next=prev.catch(()=>{}).then(fn);this.locks.set(id,next);try{return await next;}finally{if(this.locks.get(id)===next)this.locks.delete(id);}}
 async create({id,title,website,from}){return this.lock(id,async()=>{
 const dir=this.dir(id);if(await fs.access(path.join(dir,'state.json')).then(()=>true,()=>false))throw Error('Desk already exists');
 if(website && !/^https:\/\//.test(website))throw Error('Company website must use HTTPS');
 const state={id,title:title||id,website:website||'https://ora-ventures.com/en/',revision:0,opportunities:[],history:[],runs:[],created:new Date().toISOString()};
 await fs.mkdir(dir,{recursive:true});
 for(const [from,to] of [['pages.mjs','pages.mjs'],['arguments.mjs','arguments.mjs'],['browser-tool.mjs','browser-tool.mjs'],['desk-tool.mjs','desk-tool.mjs'],['procurement-instructions.bl.org','procurement-instructions.bl.org'],['procurement-instructions.bl.org','instructions.bl.org']])await fs.copyFile(path.join(this.root,from),path.join(dir,to)).catch(()=>{});
 if(from){const source=await this.read(from);state.website=source.website;for(const name of ['profile.bl.org','search.bl','search.bl.org','settings.json']){const source=await fs.readFile(path.join(this.dir(from),name),'utf8').catch(()=>null);if(source!==null)await fs.writeFile(path.join(dir,name),name.endsWith('.org')?source.replace(/^#\+PROCUREMENT_DESK:.*$/mg,`#+PROCUREMENT_DESK: ${id}`):source);}state.history.push({at:new Date().toISOString(),type:'desk/reused',from});}
 else await fs.writeFile(path.join(dir,'profile.bl.org'),`#+USE: present,browser,procurement\n#+PROCUREMENT_DESK: ${id}\n#+TITLE: ${state.title} — qualification profile\n\n* Company evidence\nWebsite: ${state.website}\nCompany capability brief is not verified yet. Omega must read the site.\n\n* Qualification facts\nDomicile, legal entity, references, certifications, turnover, insurance,\nQlik delivery and public-sector qualifications: UNKNOWN.\nEdit this file with sourced facts; unknown facts are not disqualifiers.\n`);
 const code=await fs.readFile(path.join(dir,'search.bl'),'utf8').catch(()=>';; Omega will generate and execute curated search functions for this desk.\n');
 for(const [name,text] of [['search.bl',code],['search.bl.org',`#+USE: present,browser,procurement\n#+PROCUREMENT_DESK: ${id}\n#+TITLE: ${state.title} — reusable search\n\nStart Discover to generate this desk\'s curated functions through Omega.\n\n#+begin_src beam-lisp\n${code}\n#+end_src\n`]])await fs.writeFile(path.join(dir,name),text,{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});
 await fs.writeFile(path.join(dir,'settings.json'),JSON.stringify({discoveryPages:8,qualificationPages:4,maxInput:400000,maxOutput:12000},null,2)+'\n',{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});
 await this.save(state);return {ok:true,path:`desks/${id}/desk.bl.org`,desk:id};});}
 async save(s){s.revision++;await this.atomic(path.join(this.dir(s.id),'state.json'),JSON.stringify(s,null,2)+'\n');await this.materialize(s);}
 async materialize(s){const head=`#+USE: present,browser,procurement\n#+PROCUREMENT_DESK: ${s.id}\n`;
 let text=head+`#+TITLE: ${s.title} — decision desk

${attention(s)}
Sorted by ${s.sort||'deadline'} · open a row to decide or inspect evidence.

* Attention shortlist
`;

 for(const o of shortlist(s.opportunities,s.sort)){text+=`
#+begin_decision :id ${o.id} :stage ${o.stage} :decision ${o.decision} :compact true :pursuable ${canPursue(o)}
${compactCard(o,new Date())}
#+end_decision
`;const d=head+`#+TITLE: ${o.title}\n\n#+begin_decision :id ${o.id} :stage ${o.stage} :decision ${o.decision} :pursuable ${canPursue(o)}\n${o.title}\n${o.country} · ${o.buyer}\nDeadline: ${o.deadline||'unknown'} · timezone: ${o.timezone||'unspecified'}\nAvailability: ${o.availability||'unverified'}\nFit: ${o.fit||'unassessed'}\n${wrap(o.nextAction)}\n#+end_decision\n\n* Assessment\n${wrap(o.summary)}\n\n* Original notice\n${o.url}\n\n#+begin_browser :id ${s.id}-${o.id} :mode headless :url ${o.url}\n#+end_browser\n\n* Unknowns\n${(o.unknowns||[]).map(x=>'- '+wrap(x)).join('\n')}\n\n* Evidence\n${(o.evidence||[]).map(x=>`[[${x}][${path.basename(x)}]]`).join('\n')}\n\n* Qualification report\n[[desks/${s.id}/qualification-${o.id}.bl.org][Dossier and qualification analysis]]\n\n* Decision rationale\n${wrap(o.rationale||'No decision recorded.')}\n`;
 const facts=`desks/${s.id}/qualification-facts-${o.id}.bl.org`;
 let linked=d.replace('* Qualification report\n',`* Qualification report\n[[${facts}][Current requirements and qualification facts]]\n`);
 if(!await fs.access(path.join(this.dir(s.id),`qualification-${o.id}.bl.org`)).then(()=>true,()=>false))linked=linked.replace(`[[desks/${s.id}/qualification-${o.id}.bl.org][Dossier and qualification analysis]]`,'No narrative dossier analysis yet. Use Qualify dossier to start one.');
 await this.atomic(path.join(this.dir(s.id),`opportunity-${o.id}.bl.org`),linked);
 await this.atomic(path.join(this.root,facts),head+`#+TITLE: ${o.title} — current qualification facts\n\n* Decision\n${o.stage} / ${o.decision}\nUpdated: ${o.updated||'unknown'}\n${wrap(o.rationale)}\n\n* Next action\n${wrap(o.nextAction)}\n\n* Requirements\n${(o.requirements||[]).map((r,i)=>`\n** ${i+1}. ${r.verdict.toUpperCase()}\n${wrap(r.requirement)}\n\nDocument: ${r.document}\nPage/section: ${r.page}\n[[${r.document}][Open retained document text]]\n\nProfile fact: ${wrap(r.fact)}\n`).join('\n')||'No dossier qualification has been recorded.'}\n\n* Unresolved\n${(o.unknowns||[]).map(x=>'- '+wrap(x)).join('\n')}\n\n* Provenance\nThis view is generated from the current structured facts, not an additional\nmodel judgment. Historical narrative reports can contain superseded wording.\nOriginal notice: ${o.url}\n`);}
 if(!s.opportunities.length)text+='\nNo opportunities yet. Start a bounded discovery run, or import a saved notice.\n';
 await this.atomic(path.join(this.dir(s.id),'desk.bl.org'),text);}
 async update(a){return this.lock(a.desk,async()=>{const s=await this.read(a.desk);const o=a.opportunity;
 if(!o || !valid(o.id) || !stages.includes(o.stage)||!decisions.includes(o.decision))throw Error('Invalid opportunity ID, stage or decision');
 const u=new URL(o.url);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw Error('Public original URL required');
 if(stages.indexOf(o.stage)>0 && (!Array.isArray(o.evidence)||!o.evidence.length))throw Error('Evidence required before advancing beyond discovered');
 for(const f of o.evidence||[]){const resolved=path.resolve(this.root,f);if(!resolved.startsWith(this.dir(a.desk)+path.sep))throw Error('Evidence must belong to this desk');await fs.access(resolved);}
 if(stages.indexOf(o.stage)>=2){
  if(!Array.isArray(o.requirements)||!o.requirements.length)throw Error('Dossier review requires document/page references and requirement verdicts');
  for(const r of o.requirements)if(!r.requirement||!r.page||!(o.evidence||[]).includes(r.document)||!['met','unknown','not-met'].includes(r.verdict)||!r.fact)throw Error('Each requirement needs an evidence document, page/section, profile fact and verdict');
 }
 if(o.decision==='pursue' && !canPursue(o))throw Error('Check qualifications and resolve unknown requirements before recommending pursue');
 const active=s.runs.filter(r=>!r.archived).at(-1);if(active&&active.phase!=='complete')active.phase='publish';
 const i=s.opportunities.findIndex(x=>x.id===o.id),before=i<0?null:s.opportunities[i];
 const next={...before,...o,updated:new Date().toISOString()};if(i<0)s.opportunities.push(next);else s.opportunities[i]=next;
 s.history.push({at:next.updated,type:before?'opportunity/updated':'opportunity/discovered',id:o.id,before,after:next});await this.save(s);return {ok:true,path:`desks/${s.id}/opportunity-${o.id}.bl.org`};});}
 async decide({desk,id,decision,rationale}){const s=await this.read(desk),o=s.opportunities.find(o=>o.id===id);if(!o)throw Error('Select an opportunity');return this.update({desk,opportunity:{...o,decision,rationale}});}
 async taskProof(id){return (await fetch(this.upstream+'/api/intent',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({intent:'browser/run-proof',args:{id}})})).json();}
 async run({desk,operation='discover',id,resumeOf,limits:remaining}){return this.lock(desk,async()=>{const s=await this.read(desk);
 for(const [from,to] of [['pages.mjs','pages.mjs'],['arguments.mjs','arguments.mjs'],['browser-tool.mjs','browser-tool.mjs'],['desk-tool.mjs','desk-tool.mjs'],['procurement-instructions.bl.org','procurement-instructions.bl.org'],['procurement-instructions.bl.org','instructions.bl.org']])await fs.copyFile(path.join(this.root,from),path.join(this.dir(desk),to));
 if(!['discover','refresh','qualify'].includes(operation))throw Error('Unknown research operation');
 for(const r of s.runs){if(r.archived)continue;const proof=await this.taskProof(r.task);if(proof.task?.status==='running')throw Error('This desk already has a running task; open its activity view');}
 const o=s.opportunities.find(o=>o.id===id);if(operation==='qualify'&&!o)throw Error('Choose an opportunity');
 const settings=JSON.parse(await fs.readFile(path.join(this.dir(desk),'settings.json'),'utf8').catch(()=> '{}'));
 const limits={maxPages:operation==='qualify'?(settings.qualificationPages||4):(settings.discoveryPages||8),maxInput:Math.min(settings.maxInput||80000,80000),maxOutput:Math.min(settings.maxOutput||6000,6000)};
 if(remaining)Object.assign(limits,remaining);
 if(!Number.isInteger(limits.maxPages)||limits.maxPages<1||limits.maxPages>20||!Number.isInteger(limits.maxInput)||limits.maxInput<10000||limits.maxInput>400000||!Number.isInteger(limits.maxOutput)||limits.maxOutput<1000||limits.maxOutput>32000)throw Error('Invalid desk research limits');
 const run={id:crypto.randomUUID(),operation,opportunity:id,phase:'prepare',started:new Date().toISOString(),pages:0,maxSteps:8,...limits,resumeOf,resumes:resumeOf?1:0};
 if(resumeOf){const previous=s.runs.find(r=>r.id===resumeOf);if(!previous||previous.resumes)throw Error('Resume allowance exhausted');previous.resumes=1;}
 const existingDocuments=(await fs.readdir(path.join(this.dir(desk),'dce')).catch(()=>[])).filter(f=>f.endsWith('.txt')).map(f=>'dce/'+f);
 const prior=resumeOf?s.runs.find(r=>r.id===resumeOf):null;
 let goal;
 goal=`Bounded procurement run ${run.id}. Current working directory is desks/${desk}. ${resumeOf?'RESUME: reuse saved evidence and checkpoint state; do not repeat acquisition.':''}
${prior?`Previous checkpoint: ${JSON.stringify(prior.checkpoint)}. Previous failure: ${prior.failure||'none'}. Saved source snapshots: ${JSON.stringify(prior.sources||[])}. Read these files first; do not repeat their acquisition.`:''}
Read procurement-instructions.bl.org and profile.bl.org. Saved search.bl is preloaded; repair/extend and synchronize search.bl.org if needed. Use shell helpers via (sh ...) and write JSON using a Node script or literal JSON, never js/JSON in Beam Lisp.
Maximum ${run.maxSteps} eval steps, ${run.maxPages} explicit opens, ${run.maxInput} inclusive input, ${run.maxOutput} output tokens. Reserve final two steps for publication and completion. Discover at most ONE new still-open external official-source notice for ${s.title} in the configured countries (Morocco or Europe by default); do not merely recheck inherited notices. Refresh only checks existing notices. Qualify only reviews the selected opportunity and retained dossier.
Configured discovery scope: ${JSON.stringify({countries:settings.countries||['Morocco','Europe'],sources:settings.sources||[]})}. Start with a configured source when supplied; otherwise choose an official source.
Your operation: ${operation}. Selected opportunity: ${o?JSON.stringify(o):'none'}. Existing extracted documents: ${existingDocuments.join(', ')||'none'}.
Persist checkpoints with node desk-tool.mjs checkpoint --arg-file FILE containing {desk:"${desk}",run:"${run.id}",phase:"search"|"publish"|"complete"|"partial",note:"...",evidence:["desks/${desk}/FILE"]}. Complete requires actual retained evidence. Publish notice via desk-tool update schema in instructions. Stop after one portal failure and one alternative; save an honest partial/no-results report. If stuck, checkpoint partial and done; do not silently loop. Save run-${run.id}.bl.org; checkpoint complete only after validating saved files and publishing findings (or a sourced no-results report), then done.
No bids, buyer messages, payments or invented qualifications.`;
 await this.atomic(path.join(this.dir(desk),'.research-context.json'),JSON.stringify({desk,run:run.id,operation,limits}));
 const r=await (await fetch(this.upstream+'/api/intent',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({intent:'procurement/model-open',args:{goal,desk,maxSteps:run.maxSteps,maxInput:run.maxInput,maxOutput:run.maxOutput}})})).json();if(!r.ok)throw Error(r.message);
 run.task=r.id;s.runs.push(run);this.runs.set(r.id,{desk,run});await this.save(s);return {ok:true,id:r.id,path:`task:${r.id}`};});}
 async budget(task,action,url){let found=this.runs.get(task);if(!found){for(const id of await fs.readdir(path.join(this.root,'desks')).catch(()=>[])){const s=await this.read(id);const run=s.runs.find(r=>r.task===task&&!r.archived);if(run){found={desk:id,run};this.runs.set(task,found);break;}}}if(!found)return;
 const functions=await fs.readFile(path.join(this.dir(found.desk),'search.bl'),'utf8').catch(()=> '');
 const docs=await fs.readFile(path.join(this.dir(found.desk),'search.bl.org'),'utf8').catch(()=> '');
 if(!functions.includes('(defn ')||!docs.includes('#+begin_src'))throw Error('Save named curated search functions and documented source blocks before browsing.');
 const {run}=found,current=await this.read(found.desk);const stateRun=current.runs.find(r=>r.id===run.id);
 if((stateRun?.browserErrors||0)>=2){
  const origin=action==='open'?new URL(url).origin:null;
  if(!origin||origin===stateRun.currentOrigin||stateRun.alternativeUsed)throw Error('Browser retry allowance exhausted for this source; save partial evidence or open one alternative origin.');
  await this.lock(found.desk,async()=>{const s=await this.read(found.desk),r=s.runs.find(r=>r.id===run.id);r.alternativeUsed=true;r.browserErrors=0;r.phase='search';await this.save(s);});
 }

 const p=await this.taskProof(task),cost=p.task?.cost||{};
 if((cost.input||0)+(cost['cache-read']||0)>run.maxInput||(cost.output||0)>run.maxOutput)throw Error('Research token budget reached. Save partial outputs from existing evidence and call done.');
 if(action==='open'){if(run.pages>=run.maxPages)throw Error('Research page budget reached. Save partial outputs and call done.');run.pages++;await this.lock(found.desk,async()=>{const s=await this.read(found.desk);const target=s.runs.find(r=>r.task===task&&!r.archived);target.pages=run.pages;if(target.phase==='prepare')target.phase='search';await this.save(s);});}}
 async retainSource(task,session,url,snapshot){const entry=this.runs.get(task);if(!entry)return null;return this.lock(entry.desk,async()=>{const s=await this.read(entry.desk),run=s.runs.find(r=>r.id===entry.run.id);run.sources||=[];const file=`desks/${entry.desk}/research-${entry.run.id}-${run.sources.length+1}.txt`;await this.atomic(path.join(this.root,file),`URL: ${url}\nCaptured: ${new Date().toISOString()}\n\n${snapshot}`);run.currentOrigin=new URL(url).origin;run.sources.push({url,file,session});run.checkpoint={at:new Date().toISOString(),note:`Viewed ${url}`,evidence:run.sources.map(s=>s.file)};await this.save(s);return file;});}
 async browserEvent(task,session,error){const entry=this.runs.get(task);if(!entry)return;await this.lock(entry.desk,async()=>{const s=await this.read(entry.desk),run=s.runs.find(r=>r.id===entry.run.id);if(session){run.sessions||=[];if(!run.sessions.includes(session))run.sessions.push(session);}if(error){run.failure=String(error).slice(0,300);run.browserErrors=(run.browserErrors||0)+1;if(run.browserErrors>=2){run.phase='partial';run.failure=run.alternativeUsed?'Alternative source also failed: save partial results.':'Source failed twice; one alternative origin remains available.';}}await this.save(s);});}
 async doc(address){const [id,view='queue',...parts]=address.slice(12).split('/');if(['activity','runs'].includes(view))await syncRuns(this,id);const s=await this.read(id),lines=[`#+TITLE: ${s.title} · ${view}`,''],objects=[];
 const workflow=await workflowView(this,s,view,parts);if(workflow)return {ok:true,path:address,title:`${s.title} · ${view}`,readOnly:true,rev:crypto.createHash('sha256').update(JSON.stringify(workflow)).digest('hex').slice(0,16),...workflow};
 if(view==='queue'){lines.push('DECISION DESK',`${s.opportunities.length} opportunities`,'');for(const o of shortlist(s.opportunities,s.sort)){objects.push({row:lines.length,type:'procurement/opportunity',key:o.id,path:`desks/${id}/opportunity-${o.id}.bl.org`,desk:id});lines.push(o.title,`  ${o.decision} · ${(o.unknowns||[]).length} blockers`,'');}}
 else if(view==='changes'){for(const h of s.history.slice().reverse()){
  lines.push(`* ${h.type} · ${h.at}`,h.id||h.from||'');
  if(h.after){lines.push(...changedFields(h.before,h.after));lines.push(`[[desks/${id}/opportunity-${h.id}.bl.org][Open opportunity]]`);}
  else if(h.type==='requirement/reviewed')lines.push(`Requirement ${h.index+1}: ${h.beforeRequirement.verdict} → ${h.afterRequirement.verdict}`,h.afterRequirement.fact);
  else if(h.item)lines.push(h.item.title,`Owner: ${h.item.owner} · ${h.item.status}`);
  else if(h.from)lines.push(`Independent desk reused inputs from ${h.from}; no decisions copied.`);
  lines.push('');}}
 else {lines.push('ATTENTION',attention(s),'');const latest=s.runs.at(-1);if(latest){const proof=latest.archived?{task:{status:latest.status}}:await this.taskProof(latest.task);lines.push(`Latest: ${latest.operation}`,`State: ${latest.phase||proof.task?.status||'unavailable'}`,latest.checkpoint?.note||'Open research runs for details.',latest.failure?`Needs attention: ${latest.failure}`:'','');}lines.push(`[[procurement:${id}/work][Missing information]]`,`[[procurement:${id}/runs][Research checkpoints]]`,`[[procurement:${id}/sessions][Browsers and saved profiles]]`,`[[desks/${id}/profile.bl.org][Company evidence]]`,`[[desks/${id}/search.bl.org][Search functions]]`,`[[procurement:${id}/changes][Decision history]]`);}

 return {ok:true,path:address,title:lines[0].slice(9),text:lines.join('\n'),readOnly:true,objects,rev:String(s.revision)+'-'+crypto.createHash('sha256').update(JSON.stringify(lines)).digest('hex').slice(0,12),data:{desk:id}};}
 async artifact(id,name){const dir=await fs.realpath(this.dir(id));const file=await fs.realpath(path.resolve(dir,name));if(!file.startsWith(dir+path.sep)||!['.pdf','.zip','.txt','.docx'].includes(path.extname(file).toLowerCase()))throw Error('Unknown public dossier artifact');return {data:await fs.readFile(file),name:path.basename(file),type:({'.pdf':'application/pdf','.zip':'application/zip','.txt':'text/plain; charset=utf-8','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'})[path.extname(file).toLowerCase()]};}
 async intent(verb,args){if(verb==='resume')return resume(this,args);if(['work-add','work-attach','work-resolve','review','checkpoint'].includes(verb))return this.workflow.act(verb,args);if(verb==='sort')return this.lock(args.desk,async()=>{if(!['deadline','blockers','verified'].includes(args.sort))throw Error('Unknown sort');const s=await this.read(args.desk);s.sort=args.sort;await this.save(s);return {ok:true,path:`desks/${s.id}/desk.bl.org`};});if(verb==='new')return this.create(args);if(verb==='update')return this.update(args);if(verb==='decide')return this.decide(args);if(verb==='run')return this.run(args);if(verb==='state')return {ok:true,state:await this.read(args.desk)};throw Error('Unknown procurement intent');}
}
