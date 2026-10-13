// Iframes inherit editor theme roles explicitly. Observe changes, never poll.
const roles=['snow','snow-2','espresso','oat','latte','mocha','roast','rose','rose-bg','apricot','peach-bg','sage','sage-bg','crema','lavender','lav-bg','butter','butter-bg','mist','mist-bg','row','font-text','font-code','radius'];
export function shareTheme(parent){
 const children=new Map();let queued=false,disposed=false;
 function paint(){
  queued=false;if(disposed)return;
  const source=parent.defaultView.getComputedStyle(parent.documentElement);
  for(const doc of children.keys())for(const role of roles){
   const name='--'+role,value=source.getPropertyValue(name);
   if(value&&doc.documentElement.style.getPropertyValue(name)!==value)doc.documentElement.style.setProperty(name,value);
  }
 }
 function schedule(){if(!queued&&!disposed){queued=true;parent.defaultView.requestAnimationFrame(paint);}}
 const observer=new MutationObserver(schedule);
 observer.observe(parent.documentElement,{attributes:true});observer.observe(parent.body,{attributes:true});
 observer.observe(parent.head,{subtree:true,childList:true,characterData:true,attributes:true});
 parent.addEventListener('load',schedule,true);parent.defaultView.addEventListener('resize',schedule);
 return {add(doc){
  const saved=roles.map(role=>{const name='--'+role;return [name,doc.documentElement.style.getPropertyValue(name),doc.documentElement.style.getPropertyPriority(name)];});
  children.set(doc,saved);paint();
  return ()=>{for(const [name,value,priority]of children.get(doc)||[])if(value)doc.documentElement.style.setProperty(name,value,priority);else doc.documentElement.style.removeProperty(name);children.delete(doc);};
 },dispose(){disposed=true;observer.disconnect();parent.removeEventListener('load',schedule,true);parent.defaultView.removeEventListener('resize',schedule);children.clear();}};
}
