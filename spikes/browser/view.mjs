const id=decodeURIComponent(location.pathname.split('/').at(-1));
const $=s=>document.querySelector(s),message=$('#message'),viewport=$('#viewport');
let session,frame,liveURL,timer,watchdog,busy=false,retries=0;
const headers={'content-type':'application/json','x-omega-browser':'human'};
async function request(url,body){
  const r=await fetch(url,{method:body?'POST':'GET',headers,cache:'no-store',...(body?{body:JSON.stringify(body)}:{})});
  const j=await r.json();if(!r.ok||j.ok===false)throw Error(j.message||'Browser request failed');return j;
}
function detach(){clearTimeout(watchdog);frame?.remove();frame=null;liveURL=null;}
function mount(url){
  if(liveURL===url&&frame)return;
  detach();frame=document.createElement('iframe');frame.title='Interactive Chromium desktop';frame.allow='autoplay; clipboard-read; clipboard-write; fullscreen';
  frame.referrerPolicy='strict-origin-when-cross-origin';frame.src=url;liveURL=url;viewport.replaceChildren(frame);
  message.textContent='Connecting to browser desktop…';
  watchdog=setTimeout(()=>{message.textContent='Live view has not started. Use Reload view or Reconnect.';},15000);
}
function paint(s){
  session=s;$('#native-credentials').hidden=s.provider!=='native';$('#kernel-credentials').hidden=s.provider==='native';$('#identity').textContent=`Browser ${s.id}`;$('#state').textContent=`${s.status} · ${s.control==='human'?'You have control':'Omega has control'}`;
  $('#profile').textContent=`Profile ${s.profile}${s.savedAt?' · saved '+new Date(s.savedAt).toLocaleString():''}`;
  $('#control').textContent=s.control==='human'?'Give control to Omega':'Take control';$('#control').disabled=busy||s.status!=='running';
  for(const b of document.querySelectorAll('[data-auth]'))b.disabled=busy||s.status!=='running'||s.control!=='human';
  $('[data-action="save-profile"]').disabled=busy||!['running','saving','disconnected'].includes(s.status);
  $('[data-action="open"]').hidden=!['closed','forgotten','failed'].includes(s.status);
  $('#forget').disabled=busy||!['closed','forgotten'].includes(s.status);
}
async function refresh(){
  clearTimeout(timer);
  if(document.hidden){detach();return;}
  try{const j=await request(`/browser/live/${id}`);paint(j.session);if(j.liveURL)mount(j.liveURL);else{detach();message.textContent=j.session.status==='closed'?'Session saved. Reopen to restore your tabs and logins.':`Browser ${j.session.status}.`;}}
  catch(e){message.textContent=e.message;}
  timer=setTimeout(refresh,3000);
}
async function action(verb){
  busy=true;if(session)paint(session);if(['resume','close','save-profile','forget'].includes(verb))detach();
  try{await request('/api/intent',{intent:`browser/${verb}`,args:{id}});message.textContent='Browser updated.';}
  catch(e){message.textContent=e.message;}
  finally{busy=false;await refresh();}
}
$('#control').onclick=()=>action(session.control==='human'?'resume':'pause');
for(const b of document.querySelectorAll('[data-action]'))b.onclick=()=>action(b.dataset.action);
$('#retry').onclick=()=>{detach();retries=0;refresh();};
$('#forget').onclick=()=>{if(confirm(`Delete profile ${session.profile} ${session.provider==='native'?'including its local cookies and extensions':'and its Kernel credential vault'}? Retained screenshots and reports stay available.`))action('forget');};
for(const b of document.querySelectorAll('[data-auth]'))b.onclick=async()=>{
  const verb=b.dataset.auth,args={};
  if(verb==='fill'&&!confirm('1Password will fill and submit the login form for the current website. Continue?'))return;
  if(verb==='fill-kernel'){
    args.username=prompt('CSS selector for the username field','input[autocomplete="username"]');if(!args.username)return;
    args.password=prompt('CSS selector for the password field','input[type="password"]');if(!args.password)return;
  }
  busy=true;paint(session);$('#approval').hidden=true;$('#auth-status').textContent='Working…';
  try{
    const j=await request(`/browser/credentials/${id}`,{verb,args}),result=j.result;
    $('#auth-status').textContent=`${result.status}${result.errorCode?' · '+result.errorCode:''}${result.origin?' · '+result.origin:''}. Check the website before handing control back.`;
    if(result.action?.url){const url=new URL(result.action.url);if(url.protocol!=='https:')throw Error('Invalid provider approval URL');$('#approval').href=url.href;$('#approval').textContent=result.action.name==='collect'?'Open secure credential form':'Open provider approval';$('#approval').hidden=false;}
  }catch(e){$('#auth-status').textContent=e.message+(session.provider==='native'?' Use the extension in the browser toolbar.':' You can sign in manually in the live browser or choose Store login with Kernel.');}
  finally{busy=false;paint(session);}
};
window.addEventListener('message',event=>{
  if(!frame||event.source!==frame.contentWindow||event.origin!==new URL(liveURL,location.href).origin)return;
  if(event.data?.type==='KERNEL_PLAYING'){clearTimeout(watchdog);message.textContent=session.control==='human'?'Click the browser to type. You have control.':'Live view · Omega is browsing. Take control to interact.';retries=0;}
  if(['KERNEL_CONNECTION_FAILED','KERNEL_CONNECTION_TIMEOUT'].includes(event.data?.type)){
    clearTimeout(watchdog);message.textContent='Browser live view disconnected. Use Reload view or Reconnect.';
    if(event.data.reason==='transport'&&retries++<1){detach();refresh();}
  }
});
window.addEventListener('pagehide',()=>{clearTimeout(timer);detach();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(timer);detach();}else refresh();});
await refresh();
