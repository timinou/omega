// Keep live fields, disclosures and browser ranges attached across model updates.
const key=n=>n.nodeType===1?(n.dataset.key||n.dataset.field&&'field:'+n.dataset.field||null):null;
const compatible=(a,b)=>a.nodeType===b.nodeType&&(a.nodeType!==1||a.tagName===b.tagName)&&key(a)===key(b);
function patch(a,b){
 if(a.nodeType!==1){if(a.nodeValue!==b.nodeValue)a.nodeValue=b.nodeValue;return;}
 const value=['INPUT','TEXTAREA','SELECT'].includes(b.tagName)?b.value:null;
 for(const attr of [...a.attributes])if(!b.hasAttribute(attr.name)&&!(a.tagName==='DETAILS'&&attr.name==='open'))a.removeAttribute(attr.name);
 for(const attr of b.attributes)if(a.getAttribute(attr.name)!==attr.value)a.setAttribute(attr.name,attr.value);
 children(a,b);
 if(value!==null&&a.value!==value)a.value=value;
}
function children(a,b){
 const wanted=[...b.childNodes];let cursor=a.firstChild;
 for(const next of wanted){
  let old=cursor;
  if(!old||!compatible(old,next)){
   old=key(next)?[...a.childNodes].find(n=>compatible(n,next)):null;
   if(old)a.insertBefore(old,cursor);else{old=next.cloneNode(true);a.insertBefore(old,cursor);}
  }
  patch(old,next);cursor=old.nextSibling;
 }
 while(cursor){const next=cursor.nextSibling;cursor.remove();cursor=next;}
}
export function reconcile(root,html){const t=document.createElement('template');t.innerHTML=html;children(root,t.content);}
