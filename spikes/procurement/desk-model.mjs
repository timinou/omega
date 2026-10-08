// Pure procurement projections. No editor or IO dependencies.
export function urgency(o,now=new Date()) {
 const raw=String(o.deadline||'');const day=/^\d{4}-\d{2}-\d{2}/.test(raw)?raw.slice(0,10):null;
 if(!day)return 'Deadline unknown';
 const days=Math.round((Date.parse(day+'T00:00:00Z')-Date.parse(now.toISOString().slice(0,10)+'T00:00:00Z'))/86400000);
 return days<0?'Deadline passed':days===0?'Due today':`${days} ${days===1?'day':'days'} left`;
}
export function shortlist(items,sort='deadline') {
 const rows=[...items];return rows.sort((a,b)=>sort==='blockers'?(b.unknowns?.length||0)-(a.unknowns?.length||0):sort==='verified'?String(b.verifiedAt||b.updated||'').localeCompare(String(a.verifiedAt||a.updated||'')):String(a.deadline||'9999').localeCompare(String(b.deadline||'9999')));
}
export function changedFields(before,after) {return ['decision','stage','deadline','availability','rationale','nextAction'].filter(k=>JSON.stringify(before?.[k])!==JSON.stringify(after?.[k])).map(k=>`${k}: ${before?.[k]||'none'} → ${after?.[k]||'unknown'}`);}
export const clip=(text,n=110)=>String(text||'No next action recorded').replace(/\s+/g,' ').slice(0,n)+(String(text||'').length>n?'…':'');
export const phases=['prepare','search','publish','complete','partial','failed'];
