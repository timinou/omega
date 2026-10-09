// Realm IO only. BL actors own generations, credits, cancellation and work.
let actor=null,initialized=false,closed=false;
self.addEventListener('message',({data})=>{
 if(closed)return;
 try{
  if(data.op==='init'){
   if(initialized)throw new Error('Preparation already initialized');
   initialized=true;
   const budget=data.budgetMs??4;
   if(!Number.isFinite(budget)||budget<0||budget>8)throw new Error('Invalid preparation budget');
   self.pelagicPrepareBudget=budget;
   import('./actor/host.mjs').then(H=>{
    actor=H;return import('./actor/out/prepare.mjs');
   }).catch(fail);
  }else{
   if(!actor||!['prepare','credit','ping','cancel'].includes(data.op)||!Number.isSafeInteger(data.id))
    throw new Error('Invalid preparation event');
   actor.enqueueData(data.op,data.id);
  }
 }catch(error){fail(error);}
});
function fail(error){if(closed)return;closed=true;self.postMessage({op:'error',error:error.message||String(error)});}
