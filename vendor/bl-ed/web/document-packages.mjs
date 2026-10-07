// Declarative file-local packages. Only installed bare names, never URLs or code.
export function documentPackages(text,{loaded=new Set(),suppressed=new Set()}={}) {
 const names=[];
 for(const line of String(text||'').split('\n').slice(0,12)){
  const hit=/^#\+USE:\s*(.*)$/i.exec(line);if(!hit)continue;
  for(const name of hit[1].split(/[\s,]+/).filter(Boolean))
   if(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(name)&&!loaded.has(name)&&!suppressed.has(name)&&!names.includes(name))names.push(name);
 }
 return names;
}
