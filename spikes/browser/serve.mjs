import http from 'node:http';
import net from 'node:net';
import {WebSocketServer} from 'ws';
import {RfbInput} from './rfb.mjs';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Sessions,validId,publicSession,safeError} from './sessions.mjs';
import {Credentials} from './credentials.mjs';
import {Procurement} from '../procurement/service.mjs';
import {recover} from '../procurement/lifecycle.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
export async function startBrowserHost({root=process.env.BROWSER_DEMO_ROOT || '/tmp/omega-browser-demo',
  manager,backend=process.env.BROWSER_BACKEND || 'native',
  upstream='http://127.0.0.1:8796',port=8797,procurement=new Procurement(root,upstream),routes}={}) {
if(process.env.BL_BROWSER_ENABLED==='0')backend='off';
if(!['native','kernel','off'].includes(backend))throw Error('Choose native, kernel or off browser backend');
if(!manager){
  let adapter;
  if(backend==='off')adapter={kind:'off',shutdown:async()=>{}};
  else if(backend==='native'){const {NativeBrowser}=await import('./native.mjs');adapter=new NativeBrowser();}
  else{const {KernelBrowser}=await import('./kernel.mjs');adapter=new KernelBrowser();}
  manager=new Sessions(process.env.BROWSER_STATE_ROOT || root+'.'+backend+'.private',{adapter});
}
const instance=crypto.randomUUID().slice(0,8);
if(manager.root===path.resolve(root)||manager.root.startsWith(path.resolve(root)+path.sep))throw Error('Browser state must be outside the served document root.');
await manager.init();
const credentials=new Credentials(manager);
procurement.sessions=async()=>Array.from(manager.sessions.values(),s=>({id:s.id,status:s.status,mode:s.mode,control:s.control,task:s.task,auth:s.auth,profile:s.profile,frameAt:s.frameAt||s.artifacts?.findLast(a=>a.kind==='screenshot')?.at,url:s.url}));
await recover(procurement);
const json=(res,status,body)=>{if(res.headersSent){res.destroy();return;}res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body));};
async function body(req) {
  let value=''; for await(const chunk of req) {value+=chunk;if(value.length>65536)throw Error('Request too large');}
  return JSON.parse(value || '{}');
}
function document(id) {
  const objects=[]; let lines;
  if(id==='sessions') {
    lines=['#+TITLE: Browser sessions — task resources','',
      'Browsers · C-Enter / space b w opens interactive live view.',
      'space b p/r human/Omega · a save & close · c reconnect · f forget profile and credentials',''];
    for(const s of manager.sessions.values()) {
      objects.push({row:lines.length,type:'omega/browser',key:s.id});
      lines.push(`${s.id} · ${s.status} · ${s.mode} · ${s.control} · task:${s.task || 'manual'}`,
        `  ${s.url}`,`  auth: ${s.auth} · profile: ${s.profile} · ${s.artifacts.length} artifacts`,'');
    }
    if(!manager.sessions.size)lines.push('No browsers yet. Run a task block in demo.bl.org.');
  } else {
    const s=manager.get(id);
    lines=[`#+TITLE: Browser ${s.id} · ${s.status} · ${s.mode}`,'',
      `#+begin_browser :id ${s.id} :mode ${s.mode}`,
      `Owner: task:${s.task || 'manual'} · provider: ${s.provider} · generation: ${s.generation}`,
      `Control: ${s.control} · auth: ${s.auth} · profile: ${s.profile}`,
      `Page: ${s.url}`,`Persistence: complete ${s.provider==='native'?'native':'Kernel'} profile; saved on close.`,
      `Viewport timestamp: ${s.frameAt || s.artifacts.find(a=>a.name===s.frame)?.at || 'none; inspect capture errors'}`,
      'space b p/r human/Omega · a save & close · c reconnect · f forget profile and credentials',
      '#+end_browser','',
      ':(ed/layout "browser-observe") shows the interactive Chromium browser.',
      'Human/Omega handoff keeps the same browser running.',
      'Save & close preserves the profile; reopening restores tabs and site session state.',
      'Credentials are managed through the live panel; values never enter this buffer.','', '* Artifacts',
      ...s.artifacts.map(a=>`[[browser:${s.id}/${a.name}][${a.kind}: ${a.name} · ${a.at}]]`),
      '', '* Events',...s.events.map(e=>`${e.at} · ${e.type} · ${JSON.stringify(Object.fromEntries(Object.entries(e).filter(([k])=>!['at','type'].includes(k))))}`)];
  }
  const text=lines.join('\n');
  return {ok:true,path:`browser:${id}`,title:lines[0].slice(9),text,readOnly:true,objects,
    rev:String([...manager.sessions.values()].reduce((n,s)=>n+s.rev,0))};
}
async function virtualDoc(p) {
  const nm=p.slice(8); const [id,...rest]=nm.split('/');
  if(!rest.length)return document(id);
  const s=manager.get(id);const name=rest.join('/');
  if(!s.artifacts.some(a=>a.name===name))throw Error('Unknown artifact');
  let text;
  if(name.endsWith('.png'))text=`#+TITLE: ${name}\n\nCaptured page: ${s.artifacts.find(a=>a.name===name).url}\n\nImage: /browser/artifact/${id}/${name}\nInspect the viewport with :(ed/layout "browser-observe") in browser:${id}.`;
  else text=await fs.readFile(path.join(s.dir,name),'utf8');
  return {ok:true,path:p,title:name,text,readOnly:true,objects:[],rev:String(s.rev)};
}
function ownedDoc(doc) {
  if(!doc.ok || !doc.path?.startsWith('task:'))return doc;
  const id=manager.tasks.get(doc.path.slice(5));if(!id)return doc;
  const s=manager.get(id);
  doc.text+=`\n\n* Browser resource\n#+begin_browser :id ${id} :mode ${s.mode}\n${s.status} · control: ${s.control} · auth: ${s.auth}\n${s.url}\nArtifacts: browser:${id} · report: browser:${id}/research.bl.org\n#+end_browser\n`;
  doc.rev+=`-browser-${s.rev}`; return doc;
}
const server=http.createServer(async(req,res)=>{
  let browserTask=null;
  try {
    // These intents control a Kernel browser. Only same-origin requests may mutate it.
    const host=req.headers.host;
    const actualPort=server.address()?.port || port;
    if(![`127.0.0.1:${actualPort}`,`localhost:${actualPort}`].includes(host))return json(res,403,{ok:false,message:'Invalid host'});
    if(req.method==='POST' && req.headers.origin && ![`http://${host}`,`http://127.0.0.1:${actualPort}`,`http://localhost:${actualPort}`].includes(req.headers.origin))return json(res,403,{ok:false,message:'Invalid origin'});
    const u=new URL(req.url,`http://${host}`);const p=u.searchParams.get('path');
    // Optional domain-neutral extension point: runs only after the Host/Origin checks above.
    // routes(req,res,url,{manager,json,body}) resolves true when it answered the request.
    if(routes && await routes(req,res,u,{manager,json,body}))return;
    if(u.pathname.startsWith('/browser/live/') || u.pathname.startsWith('/browser/credentials/') || u.pathname.startsWith('/browser/native-stream/')) {
      if(req.headers['sec-fetch-site']==='cross-site' || req.headers['sec-fetch-site']==='same-site')return json(res,403,{ok:false,message:'Same-origin browser access required'});
      if(req.headers['x-omega-browser']!=='human')return json(res,403,{ok:false,message:'Open the browser panel to access this capability'});
      const id=u.pathname.split('/').at(-1);
      if(u.pathname.startsWith('/browser/native-stream/') && req.method==='GET'){const stream=manager.adapter.stream(manager.get(id).kernelId);return json(res,200,{ok:true,url:`/browser/vnc/${id}?token=${stream.token}`});}
      if(u.pathname.startsWith('/browser/live/') && req.method==='GET')return json(res,200,{ok:true,...await manager.live(id)});
      if(u.pathname.startsWith('/browser/credentials/') && req.method==='POST') {
        const b=await body(req);return json(res,200,{ok:true,result:await credentials.operation(id,b.verb,b.args)});
      }
      return json(res,405,{ok:false,message:'Method not allowed'});
    }
    if(u.pathname.startsWith('/browser/native/')){
      manager.get(u.pathname.split('/').at(-1));res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'self'; script-src 'self'; img-src 'self' data: blob:; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'self'"});return res.end(await fs.readFile(path.join(here,'native-view.html')));
    }
    if(u.pathname.startsWith('/browser/view/')) {
      manager.get(u.pathname.split('/').at(-1));
      res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'SAMEORIGIN',
        'referrer-policy':'strict-origin-when-cross-origin',
        'content-security-policy':"default-src 'self'; frame-src 'self' https://*.onkernel.com https://*.onkernel.com:8443 https://*.kernel.sh https://*.kernel.sh:8443 https://*.kernel.com https://*.kernel.com:8443; object-src 'none'; base-uri 'none'; frame-ancestors 'self'"});
      return res.end(await fs.readFile(path.join(here,'view.html')));
    }
    if(['/browser/view.mjs','/browser/view.css','/browser/native-view.mjs'].includes(u.pathname)) {
      res.writeHead(200,{'content-type':u.pathname.endsWith('.mjs')?'text/javascript':'text/css','cache-control':'no-store'});
      return res.end(await fs.readFile(u.pathname==='/browser/native-view.mjs'?path.join(here,'.native/native-view.mjs'):path.join(here,path.basename(u.pathname))));
    }
    if(u.pathname.startsWith('/procurement/artifact/')){const [id,...parts]=decodeURIComponent(u.pathname.slice('/procurement/artifact/'.length)).split('/');const a=await procurement.artifact(id,parts.join('/'));res.writeHead(200,{'content-type':a.type,'cache-control':'no-store','content-disposition':`inline; filename*=UTF-8''${encodeURIComponent(a.name)}`});return res.end(a.data);}
    if(u.pathname==='/browser/tool' && req.method==='POST') {
      const b=await body(req);
      if(!validId(b.task))throw Error('Invalid task ID');browserTask=b.task;
      await procurement.budget(b.task,b.action,b.args?.[0]);
      const verbs=new Set(['open','snapshot','links','eval','click','fill','get','scroll','download']);
      if(!verbs.has(b.action) || !Array.isArray(b.args) || !b.args.every(x=>typeof x==='string'))throw Error('Invalid browser operation');
      if(b.action==='download'){
        if(b.args.length!==2)throw Error('Download needs a browser target and a desk-local filename');
        const dest=path.resolve(root,b.args[1]);if(!dest.startsWith(path.resolve(root,'desks')+path.sep))throw Error('Download must be scoped to desks/');
        await fs.mkdir(path.dirname(dest),{recursive:true});b.args[1]=dest;
      }
      for(let i=0;i<40 && !manager.pending.has(b.task) && !manager.tasks.has(b.task);i++)await new Promise(r=>setTimeout(r,50));
      const config=manager.pending.get(b.task) || {id:`model-${instance}-${b.task}`,mode:'headful'};
      let s=manager.tasks.has(b.task)?manager.get(manager.tasks.get(b.task)):null;
      let created=false;
      if(!s || ['closed','forgotten'].includes(s.status)){if(b.action!=='open')throw Error('Open a source URL before using browser operations');s=await manager.open({...config,task:b.task,url:b.args[0]});created=true;}
      if(s.control!=='agent')throw Error('Browser is paused for human control; resume before continuing.');
      let result;
      if(b.action==='open')result={snapshot:created?await fs.readFile(path.join(s.dir,s.artifacts.findLast(a=>a.kind==='snapshot').name),'utf8'):await manager.navigate(s,b.args[0]),url:s.url};
      else result=await manager.lock(s,async()=>{
        const args=b.action==='links'?['eval','JSON.stringify([...document.querySelectorAll("a[href]")].map(a=>({text:a.innerText.trim(),url:a.href})).filter(a=>a.text).slice(0,100))']:
          b.action==='snapshot'?['snapshot','-c']:[b.action,...b.args];
        manager.requireAgent(s);
        const result=await manager.run(s,args);
        if(['click','fill','scroll'].includes(b.action))await manager.capture(s);
        manager.event(s,'model/browser-operation',{action:b.action});await manager.persist();return result;
      });
      if(['open','click'].includes(b.action)){const snapshot=result?.snapshot||await fs.readFile(path.join(s.dir,s.artifacts.findLast(a=>a.kind==='snapshot').name),'utf8');const evidence=await procurement.retainSource(b.task,s.id,s.url,snapshot);if(b.action==='open')result.evidence=evidence;}
      await procurement.browserEvent(b.task,s.id);
      return json(res,200,{ok:true,result});
    }
    if(u.pathname==='/browser/research' && req.method==='POST') {
      const b=await body(req);if(!validId(b.task))throw Error('Invalid task ID');
      return json(res,200,{ok:true,result:await manager.research(b.task)});
    }
    if(u.pathname==='/api/intent' && req.method==='POST') {
      const b=await body(req);const a=b.args || {};
      if(b.intent?.startsWith('procurement/'))return json(res,200,await procurement.intent(b.intent.slice(12),a));
      if(b.intent?.startsWith('browser/') && b.intent!=='browser/run-proof') {
        const verb=b.intent.slice(8);
        if(verb==='task-open') {
          if(!validId(a.id))throw Error('Invalid browser session ID');
          if(a.mode && !['headless','headful'].includes(a.mode))throw Error('Invalid browser mode');
          if(manager.sessions.has(a.id) && !['closed','failed'].includes(manager.get(a.id).status))throw Error('Browser ID already active; choose another ID');
          const taskResponse=await fetch(upstream+'/api/intent',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({intent:'task/open',args:{goal:a.goal,path:a.path,block:a.block}})});
          const task=await taskResponse.json();if(!task.ok)throw Error(task.message);
          manager.pending.set(task.id,{id:a.id,mode:a.mode || 'headful',profile:a.profile});
          return json(res,200,{ok:true,id:task.id,path:`task:${task.id}`});
        }
        const s=verb==='open'?await manager.open(a):await manager.action(a.id,verb);
        return json(res,200,{ok:true,path:`browser:${s.id}`,session:publicSession(s)});
      }
      const r=await fetch(upstream+req.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});
      const result=await r.text();
      if(b.intent==='task/cancel' && manager.tasks.has(a.id))await manager.action(manager.tasks.get(a.id),'close');
      res.writeHead(r.status,{'content-type':'application/json'});return res.end(result);
    }
    if(u.pathname==='/api/doc' && /^desks\/[^/]+\/qualification-(?!facts-).*\.bl\.org$/.test(p||'')) {
      const original=await (await fetch(upstream+u.pathname+u.search)).json();
      if(original.ok){const [_,desk,file]=p.split('/');const id=file.slice(14,-7);original.text=original.text.replace(/^(#\+TITLE:.*)$/m,'$1 — HISTORICAL NARRATIVE')+`\n\n* Current facts supersede this narrative\n[[desks/${desk}/qualification-facts-${id}.bl.org][Open current qualification facts]]\n`;}
      return json(res,200,original);
    }
    if(u.pathname==='/api/doc' && p?.startsWith('procurement:'))return json(res,200,await procurement.doc(p));
    if(u.pathname==='/api/rev' && p?.startsWith('procurement:')) {await new Promise(r=>setTimeout(r,1500));const d=await procurement.doc(p);return json(res,200,{ok:true,path:p,rev:d.rev,changed:d.rev!==u.searchParams.get('since')});}
    if(u.pathname==='/api/doc' && p?.startsWith('browser:'))return json(res,200,await virtualDoc(p));
    if(u.pathname==='/api/rev' && (p?.startsWith('browser:') || (p?.startsWith('task:') && manager.tasks.has(p.slice(5))))) {
      const controller=new AbortController();res.on('close',()=>controller.abort());
      for(let i=0;i<100 && !controller.signal.aborted;i++) {
        const doc=p.startsWith('browser:')?await virtualDoc(p):ownedDoc(await (await fetch(upstream+'/api/doc?path='+encodeURIComponent(p),{signal:controller.signal})).json());
        if(doc.rev!==u.searchParams.get('since') || i===99)return json(res,200,{ok:true,path:p,rev:doc.rev,changed:doc.rev!==u.searchParams.get('since')});
        await new Promise(r=>setTimeout(r,250));
      }
      return;
    }
    if(u.pathname==='/api/doc' && p?.startsWith('task:')) {
      const r=await fetch(upstream+req.url);return json(res,r.status,ownedDoc(await r.json()));
    }
    if(u.pathname.startsWith('/browser/frame/')) {
      const s=manager.get(u.pathname.slice('/browser/frame/'.length));
      if(!s.frame)throw Error('No captured viewport yet');
      res.writeHead(200,{'content-type':'image/png','cache-control':'no-store'});return res.end(await fs.readFile(path.join(s.dir,s.frame)));
    }
    if(u.pathname.startsWith('/browser/artifact/')) {
      const [id,name]=u.pathname.slice('/browser/artifact/'.length).split('/');const s=manager.get(id);
      if(!s.artifacts.some(a=>a.name===name))throw Error('Unknown artifact');
      res.writeHead(200,{'content-type':name.endsWith('.png')?'image/png':'text/plain; charset=utf-8','cache-control':'no-store'});
      return res.end(await fs.readFile(path.join(s.dir,name)));
    }
    if(u.pathname==='/browser/sessions')return json(res,200,{ok:true,sessions:[...manager.sessions.values()].map(publicSession)});
    // Storage-state files are never served by the proxy, including through file APIs.
    if(p?.includes('.browser-private') || u.pathname.includes('.browser-private'))return json(res,403,{ok:false,message:'Private browser storage'});
    if(['/api/save','/api/eval','/api/place'].includes(u.pathname) && req.method==='POST') {
      const b=await body(req);if(String(b.path).includes('.browser-private'))throw Error('Private browser storage');
      const r=await fetch(upstream+req.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});
      res.writeHead(r.status,{'content-type':'application/json'});return res.end(await r.text());
    }
    const r=await fetch(upstream+req.url,{method:req.method});
    const headers={};for(const k of ['content-type','cache-control'])if(r.headers.has(k))headers[k]=r.headers.get(k);
    res.writeHead(r.status,headers);res.end(Buffer.from(await r.arrayBuffer()));
  } catch(e) {if(browserTask)await procurement.browserEvent(browserTask,null,e.message).catch(()=>{});if(!res.destroyed)json(res,400,{ok:false,message:e.status?safeError(e):e.message});}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
const sockets=new WebSocketServer({noServer:true,maxPayload:1024*1024,perMessageDeflate:false});
server.on('upgrade',(req,socket,head)=>{
  try{
    const host=req.headers.host,actualPort=server.address()?.port;
    if(![`127.0.0.1:${actualPort}`,`localhost:${actualPort}`].includes(host)||req.headers.origin!==`http://${host}`)throw Error('Invalid viewer origin');
    const u=new URL(req.url,`http://${host}`),match=u.pathname.match(/^\/browser\/vnc\/([a-zA-Z0-9_-]+)$/);
    if(!match||manager.adapter.kind!=='native')throw Error('Invalid viewer');
    const session=manager.get(match[1]),stream=manager.adapter.stream(session.kernelId);
    if(u.searchParams.get('token')!==stream.token)throw Error('Invalid viewer capability');
    sockets.handleUpgrade(req,socket,head,ws=>{
      const upstream=net.createConnection({path:stream.socket}),filter=new RfbInput(()=>session.status==='running'&&session.control==='human');
      upstream.on('data',bytes=>{if(ws.readyState!==1)return;if(ws.bufferedAmount>4*1024*1024){ws.close();return;}ws.send(bytes);});
      ws.on('message',bytes=>{try{for(const packet of filter.push(bytes))if(!upstream.destroyed)upstream.write(packet);if(upstream.writableLength>1024*1024)ws.close();}catch{ws.close();}});
      upstream.on('error',()=>ws.close());upstream.on('close',()=>ws.close());ws.on('close',()=>upstream.destroy());ws.on('error',()=>upstream.destroy());
    });
  }catch{socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');socket.destroy();}
});
const stop=async()=>{for(const ws of sockets.clients)ws.terminate();sockets.close();server.close();server.closeAllConnections();await manager.shutdown();};
return {server,manager,stop,url:`http://127.0.0.1:${server.address().port}`};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const host=await startBrowserHost();
  console.log(`Browser desk: ${host.url}/?file=demo.bl.org&use=present,browser`);
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await host.stop();process.exit(0);});
}
