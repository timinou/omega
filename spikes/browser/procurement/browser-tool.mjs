// Infrastructure only; the model authors its own curated functions around this.
const [action,...args]=process.argv.slice(2);
try {
  const task=process.env.OMEGA_TASK_TAG?.split(':').at(-1);
  if(!task)throw Error('Run this helper inside an Omega eval shell (OMEGA_TASK_TAG).');
  const response=await fetch('http://127.0.0.1:8797/browser/tool',{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({task,action,args})});
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
  console.log(JSON.stringify(output));
}catch(error){console.error(error.message);process.exitCode=1;}
