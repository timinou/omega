import fs from 'node:fs/promises';
// Infrastructure only; the model authors its own curated functions around this.
const [action,...args]=process.argv.slice(2);
try {
  if(args[0]==='--args-file'){
    if(args.length!==2)throw Error('Use ACTION --args-file PATH for literal argument arrays');
    const values=JSON.parse(await fs.readFile(args[1],'utf8'));if(!Array.isArray(values)||!values.every(v=>typeof v==='string'))throw Error('Argument array must contain strings');args.splice(0,args.length,...values);
  }
  if(args[0]==='--arg-file'){
    if(args.length!==2)throw Error('Use ACTION --arg-file PATH for one literal argument.');
    const argument=await fs.readFile(args[1],'utf8');args.splice(0,args.length,argument);
  }
  const task=process.env.OMEGA_TASK_TAG?.split(':').at(-1);
  if(!task)throw Error('Run this helper inside an Omega eval shell (OMEGA_TASK_TAG).');
  const briefExists=await fs.access('company.bl.org').then(()=>true,()=>false);
  if(briefExists){
    const functions=await fs.readFile('search.bl','utf8').catch(()=> '');
    const strategy=await fs.readFile('search.bl.org','utf8').catch(()=> '');
    if(!functions.includes('(defn ') || !strategy.includes('#+begin_src'))
      throw Error('Research checkpoint: company brief exists. Before further browser operations, author named curated defn functions in search.bl and matching documented source blocks in search.bl.org, then execute those functions inside Omega eval.');
  }
  let operation=action,operationArgs=args;
  if(action==='wait'){
    const ms=Number(args[0]);
    if(args.length!==1 || !Number.isInteger(ms) || ms<0 || ms>10000)throw Error('Wait duration must be 0..10000 ms');
    operation='eval';operationArgs=[`new Promise(resolve=>setTimeout(()=>resolve("page wait complete"),${ms}))`];
  }
  const response=await fetch('http://127.0.0.1:8797/browser/tool',{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({task,action:operation,args:operationArgs})});
  const result=await response.json();
  if(!response.ok || !result.ok)throw Error(result.message || 'Browser operation failed');
  const value=result.result;
  // Keep browser launch diagnostics out of model context; preserve useful page data.
  let output=value?.result ?? value;
  if(typeof output==='string'){
    try {output=JSON.parse(output);}catch {}
  }
  if(output && typeof output==='object' && !Array.isArray(output)){
    output={...output};delete output.lifecycle;
  }
  if(action==='snapshot' && output?.snapshot)console.log(output.snapshot);
  else if(typeof output==='string')console.log(output);
  else console.log(JSON.stringify(output));
}catch(error){console.error(error.message);process.exitCode=1;}
