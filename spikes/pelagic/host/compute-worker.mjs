import {d_lease_id as leaseId,d_lease_room$Q as leaseRoom,d_idle_milliseconds as idleMilliseconds} from '../../out/pelagic.compute.mjs';
// Worker lifetime and message routing only. CPU admission/fair turns are BL actors.
const realms=new Map();let created=0,forced=0;
function emit(client,type,event){for(const fn of client.listeners.get(type)||[])fn(event);}
function end(record,error){
 if(record.closed)return;record.closed=true;clearTimeout(record.idle);
 for(const timer of record.resetting.values())clearTimeout(timer);
 record.resetting.clear();record.worker.terminate();realms.delete(record.key);
 for(const client of record.clients.values())emit(client,'error',{message:error?.message||'Preparation worker ended'});
 record.clients.clear();
}
function send(record,data){
 if(record.ready)record.worker.postMessage(data);else record.pending.push(data);
}
function idle(record){
 clearTimeout(record.idle);
 if(!record.clients.size&&!record.resetting.size&&record.retire){end(record);return;}
 if(!record.clients.size&&!record.resetting.size)record.idle=setTimeout(()=>end(record),idleMilliseconds);
}
function connect(client,budget,url,factory){
 const key=`${url}\n${budget}`;let record=realms.get(key),fresh=false;
 if(record&&!leaseRoom(record.clients.size,record.resetting.size))throw new Error('Preparation capacity exhausted');
 if(!record){
  const worker=factory();if(!worker)throw new Error('Preparation worker unavailable');
  record={id:++created,key,worker,clients:new Map(),resetting:new Map(),ready:false,closed:false,idle:0,pending:[],observation:null,observedAt:null,observationRequested:-Infinity};
  realms.set(key,record);fresh=true;
  worker.addEventListener('error',event=>end(record,new Error(event.message||'Preparation worker failed')));
  worker.addEventListener('messageerror',()=>end(record,new Error('Preparation message could not be decoded')));
  worker.addEventListener('message',({data})=>{
   if(record.closed)return;
   if(data.op==='ready'){
    record.ready=true;
    try{for(const pending of record.pending.splice(0))record.worker.postMessage(pending);}catch(error){end(record,error);return;}
    for(const target of record.clients.values())emit(target,'message',{data});
   }else if(data.op==='observation'){
    if(data.value?.schema==='bl.runtime.observation.v1'&&Array.isArray(data.value.resources)&&data.value.resources.length<=32){
     record.observation=data.value;record.observedAt=performance.now();
    }
   }else if(data.op==='cancelled'){
    clearTimeout(record.resetting.get(data.id));record.resetting.delete(data.id);idle(record);
   }else if(data.op==='error'&&!Number.isSafeInteger(data.id))end(record,new Error(data.error));
   else{
    const target=record.clients.get(data.id);
    if(target)emit(target,'message',{data:{...data,id:target.localId}});
   }
  });
 }
 record.retire=false;clearTimeout(record.idle);client.id=leaseId();client.record=record;record.clients.set(client.id,client);
 if(fresh){try{record.worker.postMessage({op:'init',budgetMs:budget});}catch(error){end(record,error);throw error;}}
 else if(record.ready)queueMicrotask(()=>{if(!client.closed)emit(client,'message',{data:{op:'ready'}});});
}
export function createPreparationWorker(url,factory){
 const client={listeners:new Map(),id:null,localId:1,record:null,closed:false};
 return {
  addEventListener(type,fn){if(!client.listeners.has(type))client.listeners.set(type,new Set());client.listeners.get(type).add(fn);},
  postMessage(data){
   if(client.closed)throw new Error('Preparation lease closed');
   if(data.op==='init'){
    if(client.record)throw new Error('Preparation lease already initialized');
    connect(client,data.budgetMs??4,url,factory);
   }else{
    if(!client.record||client.record.closed)throw new Error('Preparation lease unavailable');
    client.localId=data.id;
    try{send(client.record,{...data,id:client.id});}catch(error){end(client.record,error);throw error;}
   }
  },
  terminate(){
   if(client.closed)return;client.closed=true;client.listeners.clear();
   const record=client.record;if(!record||record.closed)return;
   record.clients.delete(client.id);
   // A non-yielding actor must not occupy a pooled thread indefinitely.
   record.resetting.set(client.id,setTimeout(()=>{forced++;end(record,new Error('Preparation cancellation did not yield'));},1000));
   try{send(record,{op:'cancel',id:client.id});}catch(error){end(record,error);}idle(record);
  }
 };
}
function urlFor(record){return record.key.split('\n')[0];}
export function preparationWorkers({observe=false}={}){
 const now=performance.now(),actors=[];
 for(const record of realms.values()){
  // Pull only while an observer asks. Real Worker boundaries require messages;
  // actor enumeration itself is the direct BL call inside the worker namespace.
  if(observe&&record.ready&&!record.closed&&now-record.observationRequested>=1000){
   record.observationRequested=now;
   try{record.worker.postMessage({op:'observe',id:0});}catch(error){end(record,error);}
  }
  actors.push({id:record.id,generation:urlFor(record),scope:'pooled worker',available:record.observation!==null,ageMs:record.observedAt===null?null:now-record.observedAt,
               snapshot:record.observation});
 }
 return {workers:realms.size,active:[...realms.values()].reduce((n,r)=>n+r.clients.size,0),
         resetting:[...realms.values()].reduce((n,r)=>n+r.resetting.size,0),created,forced,actors};
}
export function closeIdlePreparationWorkers({whenDrained=false}={}){for(const r of realms.values())if(!r.clients.size){if(whenDrained){r.retire=true;idle(r);}else if(!r.resetting.size)end(r);}}
