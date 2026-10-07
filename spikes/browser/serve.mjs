import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Sessions,validId} from './sessions.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=process.env.BROWSER_DEMO_ROOT || '/tmp/omega-browser-demo';
const manager=new Sessions(process.env.BROWSER_STATE_ROOT || root + '.private');
await manager.init();
const upstream='http://127.0.0.1:8796';
const json=(res,status,body)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body));};
async function body(req) {
  let value=''; for await(const chunk of req) {value+=chunk;if(value.length>65536)throw Error('Request too large');}
  return JSON.parse(value || '{}');
}
function publicSession(s) {
  return {id:s.id,task:s.task,provider:s.provider,mode:s.mode,status:s.status,control:s.control,
    auth:s.auth,profile:s.profile,url:s.url,generation:s.generation,artifacts:s.artifacts,events:s.events,rev:s.rev};
}
function document(id) {
  const objects=[]; let lines;
  if(id==='sessions') {
    lines=['#+TITLE: Browser sessions — task resources','',
      'Headless browsers are visible here. C-Enter / space b w to inspect.',
      'space b h/l mode · p/r handoff · x close · f forget saved auth',''];
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
      `Page: ${s.url}`,`Capture: ${s.watching ? 'enabled; refreshed while viewport is displayed' : 'on navigation only'}`,
      `Viewport timestamp: ${s.frameAt || s.artifacts.find(a=>a.name===s.frame)?.at || 'none; inspect capture errors'}`,
      'space b h/l mode · p/r handoff · x close · f forget saved auth',
      '#+end_browser','',
      ':(ed/layout "browser-observe") shows the captured viewport.',
      'Mode switches restart Chromium: cookies/localStorage and tab URLs restored.',
      'JS memory, form drafts, sessionStorage and IndexedDB are not promised.',
      'Auth values are private; this buffer contains metadata only.','', '* Artifacts',
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
  try {
    // These intents control a local browser. Only same-origin requests may mutate it.
    const host=req.headers.host;
    if(!['127.0.0.1:8797','localhost:8797'].includes(host))return json(res,403,{ok:false,message:'Invalid host'});
    if(req.method==='POST' && req.headers.origin && ![`http://${host}`,'http://127.0.0.1:8797','http://localhost:8797'].includes(req.headers.origin))return json(res,403,{ok:false,message:'Invalid origin'});
    const u=new URL(req.url,`http://${host}`);const p=u.searchParams.get('path');
    if(u.pathname==='/browser/tool' && req.method==='POST') {
      const b=await body(req);
      if(!validId(b.task))throw Error('Invalid task ID');
      const verbs=new Set(['open','snapshot','links','eval','click','fill','get','scroll']);
      if(!verbs.has(b.action) || !Array.isArray(b.args) || !b.args.every(x=>typeof x==='string'))throw Error('Invalid browser operation');
      for(let i=0;i<40 && !manager.pending.has(b.task) && !manager.tasks.has(b.task);i++)await new Promise(r=>setTimeout(r,50));
      const config=manager.pending.get(b.task) || {id:`model-${b.task}`,mode:'headless'};
      let s=manager.tasks.has(b.task)?manager.get(manager.tasks.get(b.task)):null;
      if(!s)s=await manager.open({...config,task:b.task,url:b.action==='open'?b.args[0]:'https://ora-ventures.com/en/'});
      if(s.control!=='agent')throw Error('Browser is paused for human control; resume before continuing.');
      let result;
      if(b.action==='open')result={snapshot:await manager.navigate(s,b.args[0]),url:s.url};
      else result=await manager.lock(s,async()=>{
        const args=b.action==='links'?['eval','JSON.stringify([...document.querySelectorAll("a[href]")].map(a=>({text:a.innerText.trim(),url:a.href})).filter(a=>a.text).slice(0,100))']:
          b.action==='snapshot'?['snapshot','-c']:[b.action,...b.args];
        const result=await manager.run(s,args);
        if(['click','fill','scroll'].includes(b.action))await manager.capture(s);
        manager.event(s,'model/browser-operation',{action:b.action});return result;
      });
      return json(res,200,{ok:true,result});
    }
    if(u.pathname==='/browser/research' && req.method==='POST') {
      const b=await body(req);if(!validId(b.task))throw Error('Invalid task ID');
      return json(res,200,{ok:true,result:await manager.research(b.task)});
    }
    if(u.pathname==='/api/intent' && req.method==='POST') {
      const b=await body(req);const a=b.args || {};
      if(b.intent?.startsWith('browser/') && b.intent!=='browser/run-proof') {
        const verb=b.intent.slice(8);
        if(verb==='task-open') {
          if(!validId(a.id))throw Error('Invalid browser session ID');
          if(a.mode && !['headless','headful'].includes(a.mode))throw Error('Invalid browser mode');
          if(manager.sessions.has(a.id) && !['closed','failed'].includes(manager.get(a.id).status))throw Error('Browser ID already active; choose another ID');
          const taskResponse=await fetch(upstream+'/api/intent',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({intent:'task/open',args:{goal:a.goal,path:a.path,block:a.block}})});
          const task=await taskResponse.json();if(!task.ok)throw Error(task.message);
          manager.pending.set(task.id,{id:a.id,mode:a.mode || 'headless'});
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
      if(s.watching && s.status==='running' && !s.busy)await manager.lock(s,()=>manager.refreshFrame(s));
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
  } catch(e) {if(!res.destroyed)json(res,400,{ok:false,message:e.message});}
});
server.listen(8797,'127.0.0.1',()=>console.log('Browser demo: http://127.0.0.1:8797/?file=demo.bl.org&use=present,browser'));
async function stop() {server.close();await manager.shutdown();process.exit(0);}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
