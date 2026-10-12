import {createInspectorHost} from '../../inspector-host.mjs';
import {d_observations as observations} from '../../out/js.observation.mjs';
const json=x=>JSON.stringify(x??null,null,2);
export function createHost(){
 const host=createInspectorHost({prefix:'runtime',refresh:'runtime/refresh',
  layoutCSS:new URL('./layout.css',import.meta.url).href,
  effect(e){
  if(e.op==='export'){
   const url=URL.createObjectURL(new Blob([json(e.args)],{type:'application/json'}));
   const a=document.createElement('a');a.href=url;a.download='omega-runtime.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }else if(e.op==='candidate'){
   const url=new URL(e.args.url,location.href);
   if(url.origin!==location.origin||!/^\/generations\/[a-f0-9]{64}\/$/.test(url.pathname))throw new Error('Candidate must be an admitted same-origin generation');
   window.open(url.href,'_blank','noopener');
  }else if(e.op==='audition-cancel'){
   const reader=observations();try{reader.invoke(e.args.id,'audition-cancel');}finally{reader.dispose();}
  }
 } });
 const mount=host.mount;
 host.mount=(root,dispatch)=>{
  const view=mount(root,dispatch),controller=new AbortController();
  fetch(new URL('../../out/evidence.json',import.meta.url),{signal:controller.signal})
   .then(response=>{if(!response.ok)throw new Error('Compiler evidence unavailable');return response.json();})
   .then(data=>{if(!controller.signal.aborted&&data.schema==='bl.js.evidence')dispatch({type:'runtime/evidence',data});})
   .catch(error=>{if(error.name!=='AbortError'&&!controller.signal.aborted)dispatch({type:'runtime/evidence-error',message:error.message});});
  return {...view,dispose(){controller.abort();view.dispose();}};
 };
 return host;
}
