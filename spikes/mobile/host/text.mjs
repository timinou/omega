// Escaped presentation only. Document block boundaries come from ed.org's
// canonical bl.doc.spans partition; source rows remain selection addresses.
export const escape=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function inline(text){
 const pattern=/`([^`]+)`|\*\*([^*]+)\*\*|\[\[([^\]]+)\](?:\[([^\]]+)\])?\]|\[([^\]]+)\]\(([^)]+)\)/g;let out='',at=0;
 for(const m of String(text).matchAll(pattern)){out+=escape(text.slice(at,m.index));out+=m[1]?`<code>${escape(m[1])}</code>`:m[2]?`<strong>${escape(m[2])}</strong>`:`<button class="text-button inline-link" data-act="document-link" data-path="${escape(m[3]||m[6])}">${escape(m[4]||m[5]||m[3]||m[6])}</button>`;at=m.index+m[0].length;}
 return out+escape(text.slice(at));
}
export function rich(text,{pane,structure,query='',selection,path}={}){
 const lines=String(text||'').split('\n'),out=[];
 const attrs=row=>pane?` data-row="${row}" data-end="${row+1}" data-pane="${pane}" class="reader-line ${query&&lines[row].toLowerCase().includes(query.toLowerCase())?'match':''} ${selection?.path===path&&row>=selection.start&&row<selection.end?'passage':''}"`:'';
 const line=(row,tag='span',content=lines[row])=>`<${tag}${attrs(row)}>${inline(content)}</${tag}>`;
 const code=(from,to)=>`<pre class="code-block"><code>${lines.slice(from,to).map((s,i)=>`<span${attrs(from+i)}>${escape(s)||' '}</span>`).join('\n')}</code></pre>`;
 // Canonical spans mark executable/source blocks, including unfinished cells.
 const spans=new Map((structure?.blocks||[]).map(b=>[b.from,b]));
 for(let i=0;i<lines.length;){const l=lines[i],span=spans.get(i);
  if(span&&['cell','prose-code','block','result'].includes(span.kind)){
   const from=span['code-from']??i+1,to=span['code-to']??Math.max(from,span.to-1);
   out.push(code(from,to));i=span.to;continue;
  }
  if(/^(```|~~~|#\+begin_src)/i.test(l)){const start=++i;while(i<lines.length&&!/^(```|~~~|#\+end_src)/i.test(lines[i]))i++;out.push(code(start,i));i++;continue;}
  if(/^#\+TITLE:/i.test(l)){out.push(line(i++,'h1',l.replace(/^#\+TITLE:\s*/i,'')));continue;}
  const h=l.match(/^(#{1,6}|\*+) (.*)$/);if(h){const level=Math.min(6,h[1].length+(h[1][0]==='*'?1:0));out.push(line(i++,`h${level}`,h[2]));continue;}
  if(/^\s*[-+] |^\s*\d+[.)] /.test(l)){const ordered=/^\s*\d/.test(l),tag=ordered?'ol':'ul';let items='';while(i<lines.length&&/^\s*([-+] |\d+[.)] )/.test(lines[i])){items+=line(i,'li',lines[i].replace(/^\s*([-+] |\d+[.)] )/,''));i++;}out.push(`<${tag}>${items}</${tag}>`);continue;}
  if(/^\|/.test(l)){let rows='';while(i<lines.length&&/^\|/.test(lines[i])){if(!/^\|[-+: |]+\|?$/.test(lines[i]))rows+=`<tr${attrs(i)}>${lines[i].replace(/^\||\|$/g,'').split('|').map(c=>`<td>${inline(c.trim())}</td>`).join('')}</tr>`;i++;}out.push(`<div class="table-scroll"><table>${rows}</table></div>`);continue;}
  if(/^> /.test(l)){out.push(line(i++,'blockquote',l.slice(2)));continue;}
  if(!l.trim()||/^#\+/.test(l)){i++;continue;}
  let paragraph='';while(i<lines.length&&lines[i].trim()&&(paragraph===''||!/^([*#]+ |[-+] |\d+[.)] |```|~~~|\||> |#\+)/.test(lines[i]))&&!((spans.get(i))&&['cell','prose-code','block','result'].includes(spans.get(i).kind))){paragraph+=(paragraph?'\n':'')+line(i++);}
  if(paragraph)out.push(`<p>${paragraph}</p>`);else i++;
 }
 return out.join('');
}
export function unified(oldText,newText){
 const a=String(oldText??'').split('\n'),b=String(newText??'').split('\n');let start=0,end=0;
 while(start<a.length&&start<b.length&&a[start]===b[start])start++;
 while(end<a.length-start&&end<b.length-start&&a[a.length-1-end]===b[b.length-1-end])end++;
 const before=a.slice(Math.max(0,start-3),start),after=b.slice(b.length-end,Math.min(b.length,b.length-end+3));
 const rows=[...before.map(x=>[' ',x]),...a.slice(start,a.length-end).map(x=>['-',x]),...b.slice(start,b.length-end).map(x=>['+',x]),...after.map(x=>[' ',x])];
 return `<pre class="diff"><code><span class="diff-range">@@ -${Math.max(0,start-3)+1},${before.length+a.length-end-start+after.length} +${Math.max(0,start-3)+1},${before.length+b.length-end-start+after.length} @@</span>${rows.map(([p,x])=>`<span class="${p==='-'?'removed':p==='+'?'added':'context'}">${p}${escape(x)}</span>`).join('')}</code></pre>`;
}
