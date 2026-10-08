import {shortlist,urgency,clip,changedFields} from './desk-model.mjs';
export async function workflowView(p,s,view,parts){
 const lines=[],objects=[],data={desk:s.id};
 if(view==='requirements'){
  const o=s.opportunities.find(o=>o.id===parts[0]);if(!o)throw Error('Opportunity not found');data.opportunity=o.id;
  lines.push('REQUIREMENTS',o.title,'');for(const [index,r] of (o.requirements||[]).entries()){objects.push({row:lines.length,type:'procurement/requirement',key:String(index),path:`procurement:${s.id}/review/${o.id}/${index}`});lines.push(`${index+1}. ${r.verdict.toUpperCase()}`,clip(r.requirement,70),'');}if(!o.requirements?.length)lines.push('No dossier review yet.','Use Qualify dossier first.');
 } else if(view==='review'){
  const doc=await p.workflow.reviewDoc(s,parts[0],Number(parts[1]));return {...doc,objects};
 } else if(view==='work'){
  lines.push('MISSING INFORMATION','Attach evidence, then review its requirement.','');
  for(const w of s.work||[]){objects.push({row:lines.length,type:'procurement/work',key:w.key,opportunity:w.opportunity});lines.push(`* ${w.title}`,`${w.status} · owner: ${w.owner}`,`Due: ${w.due||'Not set'}`,`[[desks/${s.id}/opportunity-${w.opportunity}.bl.org][Open opportunity]]`,...w.evidence.map(e=>`[[${e.file}][${e.note||'Attached company evidence'}]]`),'');}if(!s.work?.length)lines.push('No work items. Open an opportunity and choose Add blocker.');
 } else if(view==='sessions'){
  lines.push('BROWSER / SESSION SHELF','C-Enter inspects; browser keys control the selected session.','');
  const runs=new Set(s.runs.filter(r=>!r.archived).map(r=>r.task));const retained=new Set(s.runs.flatMap(r=>r.sessions||[]));for(const b of await p.sessions()){
   if(!(b.id.startsWith(s.id+'-')||runs.has(b.task)||retained.has(b.id)))continue;
   objects.push({row:lines.length,type:'omega/browser',key:b.id});lines.push(`* ${b.id}`,`${b.status} · ${b.mode} · control: ${b.control}`,`Owner: ${b.task||'manual / retained'}`,`Auth: ${b.auth} · profile: ${b.profile}`,`Last capture: ${b.frameAt||'None'}`,`[[browser:${b.id}][Inspect, hand off or manage profile]]`,'');
  }if(!objects.length)lines.push('No sessions for this desk.','Open an original notice to start one.');
 } else if(view==='runs'){
  lines.push('RESEARCH RUNS','A completed task needs a verified publication checkpoint.','');
  for(const r of s.runs.slice().reverse()){const proof=r.archived?{task:{status:r.status}}:await p.taskProof(r.task),status=proof.task?.status||'unavailable';lines.push(`* ${r.operation} · ${r.phase||status}`,`Started: ${r.started}`,`Task: ${status}`,`Checkpoint: ${r.checkpoint?.note||'Legacy run: no structured checkpoint'}`,`Failure: ${r.failure||'None recorded'}`,`Resume: ${['complete'].includes(r.phase)?'Finished; start a new refresh':'Resume from retained files; remaining limits carry forward.'}`,r.archived?`[[${r.report||`desks/${s.id}/run-${r.id}.bl.org`}][Archived report]]`:`[[task:${r.task}][Inspect task]]`,'');}
 } else return null;
 return {text:[`#+TITLE: ${s.title} · ${view}`,'',...lines].join('\n'),objects,data};
}
export function compactCard(o,now){return [o.title,`${o.country} · ${urgency(o,now)} · ${o.deadline||'No deadline'}`,`${o.unknowns?.length||0} blockers · checked ${String(o.verifiedAt||o.updated||'unknown').slice(0,10)}`,`Next: ${clip(o.nextAction,115)}`].join('\n');}
export function attention(s){return `${s.opportunities.length} opportunities · ${s.opportunities.filter(o=>o.decision==='needs-information').length} need information · ${(s.work||[]).filter(w=>w.status!=='done').length} work items`;}
export {shortlist,changedFields};
