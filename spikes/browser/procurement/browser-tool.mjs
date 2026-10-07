// Infrastructure only; the model authors its own curated functions around this.
const [action,...args]=process.argv.slice(2);
try {
  const task=process.env.OMEGA_TASK_TAG?.split(':').at(-1);
  if(!task)throw Error('Run this helper inside an Omega eval shell (OMEGA_TASK_TAG).');
  const response=await fetch('http://127.0.0.1:8797/browser/tool',{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({task,action,args})});
  const result=await response.json();
  if(!response.ok || !result.ok)throw Error(result.message || 'Browser operation failed');
  console.log(JSON.stringify(result.result));
}catch(error){console.error(error.message);process.exitCode=1;}
