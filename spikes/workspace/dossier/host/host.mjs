// Package-owned DOM boundary. The real editor owns text, drafts and publication.
export function createHost(){
 return {mount(root,send){
  const bar=document.createElement('div'),edit=document.createElement('button'),frame=document.createElement('iframe');
  edit.textContent='Edit';edit.onclick=()=>send({type:'dossier/edit'});bar.append(edit);
  frame.title='Interactive document';frame.style.cssText='border:0;flex:1;min-height:0;width:100%;background:transparent';
  root.style.cssText='height:100%;display:flex;flex-direction:column';root.replaceChildren(bar,frame);
  const message=e=>{if(e.source!==frame.contentWindow||e.origin!==location.origin)return;
   if(e.data?.type==='omega-document-open')send({type:'dossier/open',path:e.data.path});
  };window.addEventListener('message',message);
  return {update(model){if(frame.getAttribute('src')!==model.url)frame.src=model.url;},dispose(){window.removeEventListener('message',message);root.replaceChildren();root.removeAttribute('style');}};
 }};
}
