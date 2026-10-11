// Optional, read-only package observations. No scheduler or application registry.
// Responders exist only while a package owns resources. Peer reports expire.
const entries=new Map(),peers=new Map();
const session=globalThis.crypto?.randomUUID?.()||`session-${Math.random()}`;
let channel=null,lastReply=0,readers=0;
const stamp=()=>Date.now();
function snapshot(){return {session,at:stamp(),resources:[...entries].slice(0,32).map(([id,e])=>{
 try{return {id,name:e.name,data:e.read()};}catch(error){return {id,name:e.name,error:String(error.message||error)};}
})};}
function connect(){
 if(channel||typeof BroadcastChannel==='undefined')return;
 channel=new BroadcastChannel('bl-ed.package-observations.v1');
 channel.onmessage=({data})=>{
  if(data?.type==='request'&&stamp()-lastReply>400){lastReply=stamp();channel.postMessage({type:'snapshot',value:snapshot()});}
  if(data?.type==='snapshot'&&readers&&data.value?.session!==session&&Array.isArray(data.value?.resources)){
   try{if(JSON.stringify(data.value).length>131072)return;}catch{return;}
   if(peers.size>=32&&!peers.has(data.value.session))return;
   peers.set(data.value.session,{...data.value,received:stamp()});
  }
 };
}
function release(){if(!entries.size&&!readers){channel?.close();channel=null;peers.clear();}}
export function observePackage(name,read,actions={}){
 const id=`${session}/${globalThis.crypto?.randomUUID?.()||Math.random()}`;
 entries.set(id,{name,read,actions});connect();let active=true;
 return ()=>{if(active){active=false;entries.delete(id);release();}};
}
export function observations(){
 readers++;connect();let closed=false;
 return {sample(){
   if(closed)return [];
   for(const [id,p] of peers)if(stamp()-p.received>6000)peers.delete(id);
   channel?.postMessage({type:'request'});
   return [snapshot(),...[...peers.values()].map(p=>({...p,remote:true}))];
  },invoke(id,action){
   if(closed)throw new Error('Observation reader closed');
   const fn=entries.get(id)?.actions[action];
   if(!fn)throw new Error('This action is available only on a currently owned local resource');
   return fn();
  },dispose(){if(!closed){closed=true;readers--;release();}}
 };
}
