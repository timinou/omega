// Public-only, bounded acquisition. Run: node spikes/atlas/collect.mjs
import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
import {attention,eventStudy} from './models.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));const raw=path.join(here,'data/raw');await fs.mkdir(raw,{recursive:true});
export async function acquire(id,url,parse=x=>JSON.parse(x)){
 const at=new Date().toISOString();try{
  const r=await fetch(url,{headers:{'user-agent':'omega-atlas-public-research/0.1'},signal:AbortSignal.timeout(30000)});
  const body=await r.text();if(!r.ok)throw Error('HTTP '+r.status);const value=parse(body);
  const sha256=crypto.createHash('sha256').update(body).digest('hex');const file=id+'-'+sha256.slice(0,12)+'.txt';await fs.writeFile(path.join(raw,file),body);
  return {id,url,at,status:'ok',sha256,file:'data/raw/'+file,value};
 }catch(e){return {id,url,at,status:'error',error:String(e.message)};}
}
function prices(body){const j=JSON.parse(body);const r=j.chart?.result?.[0];if(!r)throw Error('Missing chart result');const q=r.indicators.adjclose?.[0]?.adjclose||r.indicators.quote[0].close;
 return r.timestamp.map((t,i)=>({date:new Date(t*1000).toISOString().slice(0,10),close:q[i]})).filter(r=>Number.isFinite(r.close)&&r.close>0);}
const epoch=s=>Math.floor(Date.parse(s)/1000);
const queries=[['artcraft','artcraft'],['adobe-clones','Adobe Rust'],['deepseek-r1','DeepSeek R1']];
const jobs=queries.map(([id,q])=>[id,'https://hn.algolia.com/api/v1/search?tags=story&hitsPerPage=100&query='+encodeURIComponent(q)]);
for(const repo of ['storytold/photocraft','storytold/filmcraft','deepseek-ai/DeepSeek-R1'])jobs.push([repo.replaceAll('/','-'),'https://api.github.com/repos/'+repo]);
for(const [symbol,start,end] of [['ADBE','2026-09-01','2026-10-10'],['QQQ','2026-09-01','2026-10-10'],['NVDA','2025-01-10','2025-02-08'],['QQQ','2025-01-10','2025-02-08']])jobs.push([symbol+'-'+start,'https://query1.finance.yahoo.com/v8/finance/chart/'+symbol+'?period1='+epoch(start)+'&period2='+epoch(end)+'&interval=1d',prices]);
const observations=await Promise.all(jobs.map(args=>acquire(...args)));await fs.writeFile(path.join(here,'data/manifest.json'),JSON.stringify(observations,null,2)+'\n');
const at=new Date().toISOString(),get=id=>observations.find(o=>o.id===id),series={};for(const x of observations)if(/^(ADBE|QQQ|NVDA)-/.test(x.id)&&x.status==='ok')series[x.id]=x.value;
const artHits=queries.slice(0,2).flatMap(([id])=>get(id)?.value?.hits||[]).filter(h=>h.created_at>='2026-09-01'&&/artcraft|photocraft|getartcraft|adobe.*rust|rust.*adobe/i.test(h.title+' '+h.url));
const studioHits=artHits.filter(h=>/controllable ai|intentional crafting engine/i.test(h.title));
const suiteHits=artHits.filter(h=>!studioHits.includes(h));
const dsHits=(get('deepseek-r1')?.value?.hits||[]).filter(h=>h.created_at>='2025-01-20'&&h.created_at<'2025-01-28');
const derived={at,series,attention:attention(suiteHits),studioAttention:attention(studioHits),historicalAttention:attention(dsHits),stories:[...new Map(artHits.map(h=>[h.objectID,{id:h.objectID,product:studioHits.includes(h)?'studio':'suite',title:h.title,date:h.created_at,points:h.points,comments:h.num_comments,url:h.url,discussion:'https://news.ycombinator.com/item?id='+h.objectID}])).values()],repositories:observations.filter(o=>o.id.startsWith('storytold-')&&o.status==='ok').map(o=>({name:o.value.full_name,stars:o.value.stargazers_count,forks:o.value.forks_count,created:o.value.created_at,url:o.value.html_url})),market:[eventStudy(series['NVDA-2025-01-10']||[],series['QQQ-2025-01-10']||[],'2025-01-27','2025-01-27'),eventStudy(series['ADBE-2026-09-01']||[],series['QQQ-2026-09-01']||[],'2026-10-05','2026-10-08')],acquisition:observations.map(({value,...r})=>r)};
await fs.writeFile(path.join(here,'data/derived.json'),JSON.stringify(derived,null,2)+'\n');
await fs.mkdir(path.join(here,'data/runs'),{recursive:true});
await fs.writeFile(path.join(here,'data/runs',at.replaceAll(':','-')+'.json'),JSON.stringify({at,acquisition:derived.acquisition,repositories:derived.repositories,attention:derived.attention},null,2)+'\n',{flag:'wx'});

console.log(JSON.stringify({at,stories:derived.stories.length,repositories:derived.repositories,market:derived.market,acquisition:derived.acquisition.map(({id,status,error})=>({id,status,error}))},null,2));
