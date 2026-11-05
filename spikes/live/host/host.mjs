// Shared inspector DOM leaf; all changes and layout policy live in Beam Lisp.
import {createInspectorHost} from '../../inspector-host.mjs';
export function createHost(){
 const host=createInspectorHost({prefix:'live',refresh:'live/refresh',layoutCSS:new URL('./layout.css',import.meta.url).href});
 const mount=host.mount;
 host.mount=(root,dispatch)=>{
  const view=mount(root,dispatch),query=matchMedia('(max-width: 720px)');
  const viewport=()=>dispatch({type:'live/viewport',compact:query.matches});
  query.addEventListener('change',viewport);viewport();
  return {...view,dispose(){query.removeEventListener('change',viewport);view.dispose();}};
 };
 return host;
}
