import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {phases} from './desk-model.mjs';
export class Workflow {
 constructor(service){this.p=service;}
 async evidence(desk,file){const dir=await fs.realpath(this.p.dir(desk));const resolved=await fs.realpath(path.resolve(this.p.root,file));if(!resolved.startsWith(dir+path.sep))throw Error('Evidence must be an existing file in this desk');if(!(await fs.stat(resolved)).isFile())throw Error('Evidence must be a file');return file;}
 async act(verb,a){const p=this.p;return p.lock(a.desk,async()=>{
 const s=await p.read(a.desk),o=s.opportunities.find(o=>o.id===a.id);const at=new Date().toISOString();
 if(verb==='checkpoint'){
  const run=s.runs.find(r=>r.id===a.run&&!r.archived);if(!run)throw Error('Unknown active run');
  if(!phases.includes(a.phase))throw Error('Invalid research phase');
  if(run.phase==='complete')throw Error('Completed checkpoint cannot be changed');
  for(const f of a.evidence||[])await this.evidence(a.desk,f);
  if(a.phase==='complete'){
   if(!(a.evidence||[]).length)throw Error('Completion needs retained evidence or a no-results report');
   const code=await fs.readFile(path.join(p.dir(a.desk),'search.bl'),'utf8'),org=await fs.readFile(path.join(p.dir(a.desk),'search.bl.org'),'utf8');
   const blocks=Array.from(org.matchAll(/#\+begin_src beam-lisp[^\n]*\n([\s\S]*?)#\+end_src/g),m=>m[1]);
   if(code.trim()!==blocks.join('\n').trim())throw Error('Saved functions and Org source differ');
   if(run.operation==='discover'&&!s.opportunities.some(o=>Date.parse(o.updated)>=Date.parse(run.started))){
    if(!String(a.note||'').toLowerCase().includes('no-results')||!run.pages)throw Error('Discovery completion requires published findings or a sourced no-results outcome');
   }
  }
  if(['prepare','search','publish'].includes(a.phase)&&phases.indexOf(a.phase)<phases.indexOf(run.phase||'prepare')&&!['partial','failed'].includes(run.phase))throw Error('Checkpoint cannot move backwards');
  run.phase=a.phase;run.checkpoint={at,note:String(a.note||'').slice(0,500),evidence:a.evidence||[]};run.checkpoints||=[];run.checkpoints.push({...run.checkpoint,phase:a.phase});
 } else if(verb==='work-add'){
  if(!o||!String(a.title||'').trim())throw Error('Choose an opportunity and describe the missing information');
  if(a.due&&!/^\d{4}-\d{2}-\d{2}$/.test(a.due))throw Error('Due date must be YYYY-MM-DD');
  s.work||=[];const item={key:crypto.randomUUID(),opportunity:o.id,title:a.title,owner:a.owner||'Unassigned',due:a.due||null,status:'open',evidence:[],created:at};s.work.push(item);s.history.push({type:'work/created',at,id:o.id,item});
 } else if(verb==='work-attach'){
  const item=(s.work||[]).find(w=>w.key===a.work);if(!item)throw Error('Choose a work item');await this.evidence(a.desk,a.file);
  item.evidence.push({file:a.file,note:a.note||'',at});item.status='ready-for-review';s.history.push({type:'work/evidence-attached',at,id:item.opportunity,item:structuredClone(item)});
 } else if(verb==='work-resolve'){
  const item=(s.work||[]).find(w=>w.key===a.work);if(!item||!item.evidence.length||!String(a.note||'').trim())throw Error('Resolve requires an attached file and review rationale');
  item.status='done';item.resolvedAt=at;item.reviewNote=a.note;s.history.push({type:'work/resolved',at,id:item.opportunity,item:structuredClone(item)});
 } else if(verb==='review'){
  const r=o?.requirements?.[a.index];if(!r)throw Error('Choose a requirement');
  if(!['met','unknown','not-met'].includes(a.verdict)||!String(a.fact||'').trim())throw Error('A review needs a verdict and reason');
  if(a.verdict==='met'&&!a.file)throw Error('A met verdict needs retained company evidence');
  if(a.file)await this.evidence(a.desk,a.file);
  const before=structuredClone(r);Object.assign(r,{verdict:a.verdict,fact:a.fact,profileEvidence:a.file||r.profileEvidence||null,reviewedAt:at,reviewer:'local-operator'});
  s.history.push({type:'requirement/reviewed',at,id:o.id,index:a.index,beforeRequirement:before,afterRequirement:structuredClone(r)});
  o.updated=at;
 } else throw Error('Unknown workflow action');
 await p.save(s);return {ok:true,path:verb==='checkpoint'?`procurement:${s.id}/runs`:verb==='review'?`procurement:${s.id}/review/${o.id}/${a.index}`:`procurement:${s.id}/work`};
 });}
 async reviewDoc(s,id,index){const o=s.opportunities.find(o=>o.id===id),r=o?.requirements?.[index];if(!r)throw Error('Requirement not found');
 const text=await fs.readFile(path.resolve(this.p.root,await this.evidence(s.id,r.document)),'utf8');const n=Number(String(r.page).match(/(?:page[s]?|p\.)\s*(\d+)/i)?.[1]||0);const pages=text.split('\f');const excerpt=n>0&&n<=pages.length?pages[n-1]:null;
 // PDF lookup is limited to this desk and matches the extracted document basename.
 const base=path.basename(r.document,'.txt').toLowerCase();let pdf=null;
 const walk=async(dir)=>{for(const f of await fs.readdir(dir,{withFileTypes:true}).catch(()=>[])){const file=path.join(dir,f.name);if(f.isDirectory())await walk(file);else if(f.isFile()&&path.extname(file).toLowerCase()==='.pdf'&&path.basename(file,'.pdf').toLowerCase()===base)pdf=file;}};await walk(path.join(this.p.dir(s.id),'dce'));
 const src=pdf&&n?`/procurement/artifact/${s.id}/${path.relative(this.p.dir(s.id),pdf).split(path.sep).map(encodeURIComponent).join('/')}#page=${n}`:null;
 const offset=excerpt&&/qlik/i.test(r.requirement)?Math.max(0,excerpt.toLowerCase().indexOf('qlik')-400):0;const preview=excerpt?excerpt.slice(offset,offset+1600):null;
 return {text:[`#+TITLE: Requirement ${Number(index)+1} · ${o.title}`,'',`VERDICT: ${r.verdict.toUpperCase()}`,`Reviewed: ${r.reviewedAt||'Not confirmed by a person'}`,'','* Requirement',r.requirement,'','* Company evidence',r.fact,r.profileEvidence||'No retained company evidence attached.','','* Citation',`${r.document} · ${r.page}`,'','* Retained page excerpt',preview||'Exact PDF page could not be resolved. Open the full source; no excerpt was guessed.'].join('\n'),data:{desk:s.id,opportunity:id,requirement:Number(index),source:src,sourceLabel:`${path.basename(r.document)} · ${r.page}`,excerpt:excerpt||'No exact page excerpt available.'}};
 }
}
