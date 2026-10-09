// Compare compiled score kernels after warmup, excluding module loading/startup.
// Supply two output graphs built from the baseline and current BL sources.
import {spawnSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
if(process.argv[2]==='--one'){
 const B=await import(pathToFileURL(join(resolve(process.argv[3]),'pelagic.browser.mjs')));
 const score=()=>{const rows=[];for(let i=0;i<1024;i+=16)rows.push(...B.d_score_chunk(i,16));return rows;};
 for(let i=0;i<3;i++)score();
 const samples=[];let rows;
 for(let i=0;i<7;i++){const cpu=process.cpuUsage(),before=performance.now();rows=score();const used=process.cpuUsage(cpu);samples.push({cpuMs:(used.user+used.system)/1000,wallMs:performance.now()-before});}
 console.log(JSON.stringify({samples,digest:createHash('sha256').update(JSON.stringify(rows)).digest('hex')}));
}else{
 const baseline=process.env.PELAGIC_BASELINE_OUT;if(!baseline)throw new Error('Set PELAGIC_BASELINE_OUT to a baseline compiled graph');
 const current=process.env.PELAGIC_OUT||'spikes/pelagic/dist/local/out',results=[];
 for(let repeat=0;repeat<5;repeat++)for(const mode of repeat%2?['current','baseline']:['baseline','current']){
  const run=spawnSync(process.execPath,[process.argv[1],'--one',mode==='baseline'?baseline:current],{encoding:'utf8'});
  if(run.status!==0)throw new Error(run.stderr);const value={mode,repeat,...JSON.parse(run.stdout)};
  if(value.digest!=='11d812d7eff77acc25e66e80215b366f4dc2bf5daf7b80b8e5524e94b0080b9a')throw new Error('Score changed');results.push(value);console.log(JSON.stringify(value));
 }
 const proof=process.env.PELAGIC_PREPARATION_PROOF||'spikes/pelagic/proof/native-actors/final';mkdirSync(proof,{recursive:true});writeFileSync(join(proof,'kernel.json'),JSON.stringify({node:process.version,results},null,2)+'\n');
}
