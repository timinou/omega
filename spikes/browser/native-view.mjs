import RFBModule from '@novnc/novnc/lib/rfb.js';
const RFB=RFBModule.default || RFBModule;
const id=location.pathname.split('/').at(-1);
const response=await fetch(`/browser/native-stream/${id}`,{headers:{'x-omega-browser':'human'},cache:'no-store'});
const data=await response.json();
if(!response.ok)throw Error(data.message||'Native stream unavailable');
const url=new URL(data.url,location.href);url.protocol=location.protocol==='https:'?'wss:':'ws:';
const rfb=new RFB(document.querySelector('#screen'),url.href,{shared:true});
rfb.scaleViewport=true;rfb.resizeSession=false;rfb.viewOnly=new URL(location.href).searchParams.get('readOnly')==='true';
document.documentElement.dataset.control=rfb.viewOnly?'agent':'human';
// A transport handshake is not a visible desktop. Announce readiness only
// after noVNC has painted its front canvas (also catches blocked image tiles).
let paintRequest;
rfb.addEventListener('connect',()=>{
  const painted=()=>{const c=document.querySelector('#screen canvas');
    if(c?.width&&c.height&&c.getContext('2d').getImageData(Math.floor(c.width/2),Math.floor(c.height/2),1,1).data[3]){
      document.documentElement.dataset.connected='true';parent.postMessage({type:'KERNEL_PLAYING'},location.origin);
    }else paintRequest=requestAnimationFrame(painted);
  };painted();
});
rfb.addEventListener('disconnect',()=>{cancelAnimationFrame(paintRequest);delete document.documentElement.dataset.connected;document.querySelector('#error').textContent='Native browser disconnected. Reconnect or reopen the saved profile.';parent.postMessage({type:'KERNEL_CONNECTION_FAILED'},location.origin);});
rfb.addEventListener('clipboard',e=>{if(!rfb.viewOnly)navigator.clipboard?.writeText(e.detail.text).catch(()=>{});});
window.addEventListener('pagehide',()=>{cancelAnimationFrame(paintRequest);rfb.disconnect();});
// The DOM status exposes readiness only, never the private viewer capability.


window.addEventListener('message',event=>{if(event.source===parent&&event.origin===location.origin&&event.data?.type==='OMEGA_CONTROL'&&typeof event.data.readOnly==='boolean'){rfb.viewOnly=event.data.readOnly;document.documentElement.dataset.control=rfb.viewOnly?'agent':'human';}});
