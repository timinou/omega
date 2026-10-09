// Pure, transport-free numerical functions shared by collection, desk and tests.
export function notebook(source){
 const match=source.match(/^#\+begin_atlas\s*\n([\s\S]*?)^#\+end_atlas\s*$/mi);
 if(!match)throw Error('Notebook needs one #+begin_atlas JSON block');
 const d=JSON.parse(match[1]);
 if(d.version!==1||!Array.isArray(d.evidence)||!Array.isArray(d.scenarios))throw Error('Unsupported Atlas schema');
 if(d.scenarios.length<2||d.scenarios.some(s=>!Number.isFinite(s.probability)||s.probability<0||!Number.isFinite(s.return)))throw Error('Invalid scenarios');
 const sum=d.scenarios.reduce((a,s)=>a+s.probability,0);if(Math.abs(sum-1)>1e-6)throw Error('Scenario probabilities must sum to one');
 const ids=new Set(d.evidence.map(e=>e.id));if(ids.size!==d.evidence.length)throw Error('Evidence IDs must be unique');
 for(const c of d.claims||[])for(const id of c.evidence||[])if(!ids.has(id))throw Error('Unknown evidence '+id);
 return d;
}
export function returns(rows){return rows.slice(1).map((r,i)=>({date:r.date,return:r.close/rows[i].close-1}));}
export function eventStudy(asset,benchmark,start,end){
 const a=returns(asset),b=new Map(returns(benchmark).map(r=>[r.date,r.return]));
 const sample=a.filter(r=>r.date>=start&&r.date<=end);
 if(!sample.length||sample.some(r=>!b.has(r.date)))return {status:'missing',reason:'No fully matched event window'};
 const total=Math.expm1(sample.reduce((v,r)=>v+Math.log1p(r.return),0));
 const market=Math.expm1(sample.reduce((v,r)=>v+Math.log1p(b.get(r.date)),0));
 return {status:'ok',n:sample.length,asset:total,benchmark:market,abnormal:total-market,method:'buy-and-hold difference; descriptive, beta=1; not causal'};
}
export function posterior(prior,likelihoodRatios){
 if(!(prior>0&&prior<1)||likelihoodRatios.some(x=>!(x>0&&Number.isFinite(x))))throw Error('Invalid prior or likelihood');
 const logOdds=Math.log(prior/(1-prior))+likelihoodRatios.reduce((a,x)=>a+Math.log(x),0);
 return 1/(1+Math.exp(-logOdds));
}
export function shortModel(scenarios,{borrow=.03,months=6,friction=.005,notional=10000}={}){
 if(![borrow,months,friction,notional].every(Number.isFinite)||borrow<0||months<0||friction<0||notional<0)throw Error('Invalid short assumptions');
 const carry=borrow*months/12+friction;
 const outcomes=scenarios.map(s=>({...s,pnl:(-s.return-carry)*notional}));
 return {carry,expected:outcomes.reduce((a,s)=>a+s.pnl*s.probability,0),worst:Math.min(...outcomes.map(s=>s.pnl)),outcomes,unboundedLoss:true};
}
export function attention(hits){
 const by=new Map();for(const h of hits){if(!h.objectID||by.has(h.objectID))continue;by.set(h.objectID,h);}
 const days=new Map();for(const h of by.values()){const date=h.created_at.slice(0,10),v=days.get(date)||{date,stories:0,points:0,comments:0};v.stories++;v.points+=h.points||0;v.comments+=h.num_comments||0;days.set(date,v);}
 return [...days.values()].sort((a,b)=>a.date.localeCompare(b.date));
}
export function readiness(d){
 const missing=d.gates.filter(g=>g.status!=='met');return {label:missing.length?'WAIT / RESEARCH':'READY FOR HUMAN REVIEW',missing};
}
export function normalized(rows){if(!rows.length)return [];return rows.map(r=>({...r,index:100*r.close/rows[0].close}));}
