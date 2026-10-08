import fs from 'node:fs/promises';
import path from 'node:path';
export const inclusive=c=>(c?.input||0)+(c?.['cache-read']||0)+(c?.['cache-write']||0);
export async function syncRuns(p,desk){
 const state=await p.read(desk);for(const run of state.runs.filter(r=>!r.archived)){
 const proof=await p.taskProof(run.task).catch(()=>({}));const task=proof.task;if(!task)continue;
 if(JSON.stringify([run.status,run.cost])===JSON.stringify([task.status,task.cost]))continue;
 await p.lock(desk,async()=>{const s=await p.read(desk),r=s.runs.find(r=>r.id===run.id);r.status=task.status;r.cost=task.cost;
 if(task.status!=='running'&&r.phase!=='complete'){r.phase=task.status==='failed'?'failed':'partial';r.failure=task.result||'Task stopped before a verified completion checkpoint';}
 await p.save(s);});
 }
}
export async function resume(p,{desk}){
 await syncRuns(p,desk);const s=await p.read(desk),previous=s.runs.at(-1);if(!previous||!['partial','failed'].includes(previous.phase))throw Error('No partial run to resume; start Discover or Refresh');
 if(previous.status==='running')throw Error('Research is still running; inspect it before resuming');
 if((previous.resumes||0)>=1)throw Error('Automatic retry allowance exhausted. Inspect the failure and start a deliberately scoped new run.');
 const input=(previous.maxInput||80000)-inclusive(previous.cost),output=(previous.maxOutput||6000)-(previous.cost?.output||0),pages=previous.maxPages-previous.pages;
 if(input<10000||output<1000||pages<1)throw Error('Run budget exhausted. Retained evidence is available; start a separate deliberate analysis.');
 return p.run({desk,operation:previous.operation,id:previous.opportunity,resumeOf:previous.id,limits:{maxInput:input,maxOutput:output,maxPages:pages}});
}
export async function recover(p){
 for(const id of await fs.readdir(path.join(p.root,'desks')).catch(()=>[])){
 const s=await p.read(id).catch(()=>null);if(!s)continue;let changed=false;
 for(const r of s.runs){if(!r.archived){r.archived=true;r.status=r.status||'interrupted';if(r.phase!=='complete'){r.phase='partial';r.failure=r.failure||'World restarted; retained checkpoints and evidence survive.';}changed=true;}}
 if(changed)await p.save(s);
 }
}
