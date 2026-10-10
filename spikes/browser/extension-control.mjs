// Use only Chromium's privileged extensions page; never attach to supplier pages.
export const onePasswordId='aeblfdkhhhdcdjpifhhbdiojplfjncoa';
export async function setOnePassword(port,enabled){
  const cdp=(method,params={},sessionId)=>port.request({op:'cdp',method,params,...(sessionId?{sessionId}:{})});
  const {targetId}=await cdp('Target.createTarget',{url:'chrome://extensions/',background:true});
  let sessionId;
  try{
    ({sessionId}=await cdp('Target.attachToTarget',{targetId,flatten:true}));
    for(let attempt=0;attempt<50;attempt++){
      const r=await cdp('Runtime.evaluate',{expression:`typeof chrome.management?.getAll === 'function'`,returnByValue:true},sessionId);
      if(r.result?.value===true)break;
      if(attempt===49)throw Error('Chromium extension controls unavailable');
      await new Promise(r=>setTimeout(r,100));
    }
    const result=await cdp('Runtime.evaluate',{
      expression:`(async()=>{const id=${JSON.stringify(onePasswordId)},enabled=${enabled?'true':'false'};const before=(await chrome.management.getAll()).find(x=>x.id===id);if(!before)return {installed:false,enabled:false};if(before.enabled!==enabled)await chrome.management.setEnabled(id,enabled);const after=await chrome.management.get(id);if(after.enabled!==enabled)throw Error('1Password state did not change');return {installed:true,enabled:after.enabled};})()`,
      awaitPromise:true,returnByValue:true,userGesture:true,
    },sessionId);
    if(result.exceptionDetails||!result.result?.value)throw Error('Could not verify 1Password handoff; browser control unchanged');
    return result.result.value;
  }finally{
    if(sessionId)await cdp('Target.detachFromTarget',{sessionId}).catch(()=>{});
    await cdp('Target.closeTarget',{targetId});
  }
}
