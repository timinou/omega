import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {KernelBrowser} from './kernel.mjs';
export const validId = id => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id);
export const validProfile = name => typeof name === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(name);
export function publicURL(value) {
  const u=new URL(value);
  if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw Error('Use an HTTP(S) URL without credentials');
  return u.href;
}
export function safeError(e) {
  if(e.status)return `Kernel request failed (HTTP ${e.status}${e.error?.code?', '+String(e.error.code).replace(/[^a-zA-Z0-9_-]/g,''):''}).`;
  if(/^(Set KERNEL_API_KEY|Set BL_BROWSER_PORT|Set CHROMIUM|Set XVFB|Set X11VNC|Native profile|This Kernel profile|Kernel profile save|Close every browser)/.test(e.message||''))return e.message;
  return 'Browser operation failed. Inspect the live browser or retry its status.';
}
const fields=['id','dir','task','provider','mode','status','control','auth','profile','vaultId','url','kernelId','remoteName',
  'idleSeconds','events','artifacts','rev','generation','frame','frameAt','savedAt','saveBaseline','credentialKeys'];
const stored=s=>Object.fromEntries(fields.map(k=>[k,s[k]]));
export const publicSession=s=>Object.fromEntries(['id','task','provider','mode','status','control','auth','profile','url',
  'generation','artifacts','events','rev','savedAt','idleSeconds'].map(k=>[k,s[k]]));
export class Sessions {
  constructor(root,{adapter=new KernelBrowser(),namespace=process.env.KERNEL_BROWSER_NAMESPACE||'omega'}={}) {
    if(!validProfile(namespace))throw Error('Invalid Kernel namespace');
    this.root=path.resolve(root);this.adapter=adapter;this.namespace=namespace;
    this.sessions=new Map();this.tasks=new Map();this.pending=new Map();this.registryWrite=Promise.resolve();
    this.run=(s,args)=>this.adapter.run(s,args);
  }
  async init() {
    await fs.mkdir(this.root,{recursive:true,mode:0o700});await fs.chmod(this.root,0o700);
    const lease=path.join(this.root,'host.lock');
    try{this.lease=await fs.open(lease,'wx',0o600);}catch(e){
      if(e.code!=='EEXIST')throw e;const pid=Number(await fs.readFile(lease,'utf8'));
      try{process.kill(pid,0);throw Error('This browser registry already has a running host.');}catch(err){if(err.code!=='ESRCH')throw err;}
      await fs.unlink(lease);this.lease=await fs.open(lease,'wx',0o600);
    }
    await this.lease.writeFile(String(process.pid));
    const records=JSON.parse(await fs.readFile(path.join(this.root,'sessions.json'),'utf8').catch(e=>{if(e.code==='ENOENT')return '[]';throw e;}));
    for(const s of records){
      if(!validId(s.id)||!validProfile(s.profile)||!path.resolve(s.dir).startsWith(this.root+path.sep))continue;
      if(this.adapter.kind==='native'){s.provider='native';s.status='closed';s.kernelId=null;s.liveURL=null;s.vaultId=null;this.event(s,'profile/recovery-available');}
      else if(s.provider!=='kernel'){s.provider='kernel';s.profile=`${this.namespace}-${s.id}`;s.mode='headful';s.status='closed';s.kernelId=null;s.credentialKeys={};}
      s.credentialKeys ||= {};
      Object.assign(s,{control:'human',auth:'unknown',busy:false});this.sessions.set(s.id,s);
      if(s.task){this.event(s,'task/detached',{previousTask:s.task});s.task=null;}
      if(s.kernelId&&!['closed','forgotten'].includes(s.status)){
        try{const b=await this.adapter.retrieve(s.kernelId);if(b.deleted_at)s.status=s.saveBaseline!==undefined?'saving':'closed';else{this.attach(s,b);s.status='running';this.event(s,'session/reattached');}}
        catch(e){if(e.status===404)s.status=s.saveBaseline!==undefined?'saving':'closed';else{s.status='disconnected';this.event(s,'session/reconnect-needed',{message:safeError(e)});}}
      }
    }
    await this.persist();
  }
  async persist(){
    const content=JSON.stringify([...this.sessions.values()].map(stored),null,2);
    this.registryWrite=this.registryWrite.catch(()=>{}).then(async()=>{const file=path.join(this.root,'sessions.json');await fs.writeFile(file+'.tmp',content,{mode:0o600});await fs.chmod(file+'.tmp',0o600);await fs.rename(file+'.tmp',file);});return this.registryWrite;
  }
  get(id){if(!validId(id))throw Error('Invalid session ID');const s=this.sessions.get(id);if(!s)throw Error('Unknown browser session');return s;}
  event(s,type,detail={}){s.events.push({at:new Date().toISOString(),type,...detail});if(s.events.length>200)s.events.splice(0,s.events.length-200);s.rev++;}
  async lock(s,fn){const next=(s.queue||Promise.resolve()).catch(()=>{}).then(fn);s.queue=next;return next;}
  attach(s,b){s.kernelId=b.session_id;s.liveURL=b.browser_live_view_url;}
  async open({id,mode='headful',url,task=null,profile}){
    if(!validId(id))throw Error('Invalid session ID');if(!['headless','headful'].includes(mode))throw Error('Invalid browser mode');if(url)url=publicURL(url);
    let s=this.sessions.get(id);
    if(!s){
      profile=profile||`${this.namespace}-${id}`;if(!validProfile(profile))throw Error('Invalid Kernel profile name');
      const dir=path.join(this.root,id,crypto.randomBytes(6).toString('hex'));
      s={id,dir,task,provider:this.adapter.kind||'kernel',mode:'headful',status:'closed',control:task?'agent':'human',auth:'unknown',profile,
        url:url||'https://example.com',events:[],artifacts:[],rev:0,generation:0,idleSeconds:300,credentialKeys:{}};this.sessions.set(id,s);
    }
    return this.lock(s,async()=>{
      await fs.mkdir(s.dir,{recursive:true,mode:0o700});
      if(profile&&profile!==s.profile)throw Error('This session already has a profile; choose another session ID to change it.');
      if(task&&s.task&&s.task!==task){if(!['closed','forgotten'].includes(s.status))throw Error('Session already belongs to another task');this.tasks.delete(s.task);}
      if(task){s.task=task;this.tasks.set(task,id);}
      if(s.status==='running'){await this.persist();return s;}if(s.status==='saving')await this.finishSave(s);
      if(['starting','failed','disconnected'].includes(s.status)&&s.remoteName){
        try{const b=await this.adapter.retrieve(s.kernelId||s.remoteName);if(!b.deleted_at){this.attach(s,b);s.status='running';await this.persist();return s;}s.status='saving';await this.finishSave(s);}
        catch(e){if(e.status!==404)throw Error(safeError(e));if(s.kernelId){if(this.adapter.kind==='native'){s.status='closed';s.kernelId=null;}else{s.status='saving';await this.finishSave(s);}}}
      }
      for(const other of this.sessions.values())if(other.id!==id&&other.profile===s.profile&&!['closed','forgotten'].includes(other.status))throw Error('Profile already has a writer; use its existing browser.');
      s.status='starting';s.control=task?'agent':'human';s.generation++;s.remoteName=`${this.namespace}-${id}-${s.generation}`;
      this.event(s,'session/opening');await this.persist();
      try{
        let b;try{b=await this.adapter.create(s,url||(s.generation===1?s.url:undefined));}
        catch(e){if(!e.status||e.status>=500){try{b=await this.adapter.retrieve(s.remoteName);}catch{throw e;}}else throw e;}
        this.attach(s,b);s.status='running';s.auth='unknown';this.event(s,'session/opened');await this.persist();
        if(task){try{await this.capture(s);await this.persist();}catch{this.event(s,'artifact/capture-failed');}}return s;
      }catch(e){s.status='failed';this.event(s,'session/failed',{message:safeError(e)});await this.persist();throw Error(safeError(e));}
    });
  }
  requireAgent(s){if(s.status!=='running')throw Error('Browser is not running');if(s.control!=='agent')throw Error('Browser is paused for human control; resume before continuing.');}
  async execute(s,args){return this.lock(s,async()=>{this.requireAgent(s);return this.run(s,args);});}
  async capture(s){
    const n=String(s.artifacts.length+1).padStart(3,'0'),name=`${n}-viewport.png`,snapshot=`${n}-snapshot.txt`;let data;
    try{data=await this.run(s,['capture']);}catch{data=await this.run(s,['snapshot','-c']);this.event(s,'artifact/capture-failed');}
    if(data.url)s.url=publicURL(data.url);const text=data.snapshot||'';
    await fs.writeFile(path.join(s.dir,snapshot),text,{mode:0o600});s.artifacts.push({name:snapshot,kind:'snapshot',url:s.url,at:new Date().toISOString()});
    if(data.png){await fs.writeFile(path.join(s.dir,name),Buffer.from(data.png,'base64'),{mode:0o600});s.frame=name;s.frameAt=new Date().toISOString();s.artifacts.push({name,kind:'screenshot',url:s.url,at:s.frameAt});}
    this.event(s,'artifact/captured');return text;
  }
  async navigate(s,url){return this.lock(s,async()=>{this.requireAgent(s);await this.run(s,['open',publicURL(url)]);const text=await this.capture(s);await this.persist();return text;});}
  async finishSave(s){await this.adapter.saved(s.profile,s.saveBaseline??0);s.status='closed';s.savedAt=new Date().toISOString();s.kernelId=null;s.liveURL=null;this.event(s,'profile/saved');await this.persist();}
  async close(s){
    if(['closed','forgotten'].includes(s.status))return;if(s.status==='saving'){await this.finishSave(s);return;}
    if(!s.kernelId)throw Error('Session creation is unresolved. Reconnect before closing.');
    if(s.status==='disconnected'&&s.saveBaseline!==undefined){
      let deleted=false;try{deleted=Boolean((await this.adapter.retrieve(s.kernelId)).deleted_at);}catch(e){if(e.status!==404)throw e;deleted=true;}
      if(deleted){s.status='saving';await this.finishSave(s);return;}
    }
    // Keep the launch baseline: idle expiry may already have saved the profile
    // before the operator presses Close. A fresh timestamp would wait forever.
    if(s.saveBaseline===undefined){const p=await this.adapter.ensureProfile(s.profile);s.saveBaseline=Date.parse(p.updated_at)||0;}
    s.status='saving';s.control='human';s.liveURL=null;
    this.event(s,'profile/saving');await this.persist();
    try{await this.adapter.close(s.kernelId);}catch(e){if(e.status!==404){s.status='disconnected';await this.persist();throw e;}}
    await this.finishSave(s);
  }
  async action(id,verb){const s=this.get(id);return this.lock(s,async()=>{
    if(verb==='close'||verb==='save-profile')await this.close(s);
    else if(verb==='forget'){
      if(!['closed','forgotten'].includes(s.status))throw Error('Close and save the session before forgetting its profile and credentials.');
      for(const other of this.sessions.values())if(other.id!==id&&other.profile===s.profile&&!['closed','forgotten'].includes(other.status))throw Error('Close every browser using this profile first.');
      await this.adapter.forget(s);s.status='forgotten';s.auth='unknown';s.credentialKeys={};this.event(s,'profile/forgotten');
    }else if(verb==='reconnect'){
      if(s.status==='saving')await this.finishSave(s);else{
        let b;
        try{b=await this.adapter.retrieve(s.kernelId||s.remoteName);}catch(e){if(e.status!==404)throw e;}
        if(!b||b.deleted_at){
          s.liveURL=null;
          if(s.kernelId){if(this.adapter.kind==='native'){s.status='closed';s.kernelId=null;}else{s.status='saving';await this.finishSave(s);}}else s.status='closed';
        }else{this.attach(s,b);s.status='running';s.control='human';this.event(s,'session/reattached');}
      }
    }else if(['watch','pause','resume','headful','headless'].includes(verb)){
      if(s.status!=='running')throw Error('Session is closed or disconnected; reopen or reconnect it.');
      if(verb==='headless')throw Error('The browser stays headed for live viewing and 1Password. Hide the pane to stop viewing; no browser restart is needed.');
      if(verb==='pause'){s.control='human';s.auth='needs-human';this.event(s,'control/paused');}
      if(verb==='resume'){s.control='agent';s.auth='unknown';this.event(s,'control/resumed');}
    }else throw Error('Unknown browser action');await this.persist();return s;
  });}
  async live(id){const s=this.get(id);if(s.status!=='running')return {session:publicSession(s)};
    if(!s.liveURL){const b=await this.adapter.retrieve(s.kernelId);if(b.deleted_at){s.status='saving';await this.finishSave(s);return {session:publicSession(s)};}this.attach(s,b);}
    const url=new URL(s.liveURL,'http://native.local');if(this.adapter.kind!=='native'&&url.protocol!=='https:')throw Error('Kernel live view must use HTTPS');url.searchParams.set('readOnly',String(s.control!=='human'));
    return {session:publicSession(s),liveURL:this.adapter.kind==='native'?url.pathname+url.search:url.href};
  }
  async waitControl(s){while(s.control==='human'&&s.status==='running')await new Promise(r=>setTimeout(r,250));if(s.status!=='running')throw Error('Browser research stopped because its session closed');}
  async research(task) {
    for(let i=0;i<40 && !this.pending.has(task);i++) await new Promise(r=>setTimeout(r,50));
    const config=this.pending.get(task) || {id:`research-${task}`,mode:'headful'};
    const s=await this.open({...config,task}); s.busy=true;
    const findings=[]; const candidates=[];
    const sources=[
      ['ora','https://ora-ventures.com'],
      ['devactu','https://www.devactu.com/fr/contenus/appels-offres/'],
      ['marocpme','https://marocpme.gov.ma/'],
      ['procurement','https://www.marchespublics.gov.ma/'],
      ['undp','https://procurement-notices.undp.org/']
    ];
    try {
      for(const [label,url] of sources) {
        await this.waitControl(s);
        try {
          const snapshot=await this.navigate(s,url);
          if(/Web Page Blocked|Access Denied|verify you are human|captcha|Just a moment/i.test(snapshot)) {
            s.auth='needs-human'; this.event(s,'source/blocked',{url});
            throw Error('Site blocked browser access; human intervention required for this origin');
          }
          const lines=snapshot.split('\n').filter(l => /digital|digitale|num[eé]rique|CRM|ERP|intelligence artificielle|marketing|transformation|diagnostic|toolbox|information system|communication|appels? d.offre|deadline|cl[oô]ture|2026|PACT|consultant/i.test(l));
          const links=await this.execute(s,['eval',
            'JSON.stringify(Array.from(document.querySelectorAll("a[href]")).map(a=>({title:a.innerText.trim(),url:a.href})).filter(a=>/digital|num[eé]rique|CRM|ERP|intelligence|marketing|transformation|diagnostic|toolbox|information system|communication|appels? d.offre|consultant|PACT/i.test(a.title)).slice(0,25))']);
          let parsed=[]; try {parsed=JSON.parse(links.result || '[]');} catch {}
          if(label!=='ora')candidates.push(...parsed.filter(a=>/digital|num[eé]rique|CRM|ERP|intelligence|marketing|transformation|diagnostic|toolbox|information system|communication/i.test(a.title) && !/projets\/$/.test(a.url)));
          findings.push({label,url,observedAt:new Date().toISOString(),matches:lines.slice(0,35),links:parsed,
            status:'candidate — deadline and eligibility need source verification'});
          this.event(s,'research/source',{label,matches:lines.length});
        } catch(e) { findings.push({label,url,error:safeError(e)}); this.event(s,'research/source-failed',{label,message:safeError(e)}); }
      }
      // Follow candidate detail pages, rather than treating a portal listing as evidence.
      for(const candidate of [...new Map(candidates.map(c=>[c.url,c])).values()].slice(0,5)) {
        await this.waitControl(s);
        try {
          const snapshot=await this.navigate(s,candidate.url);
          findings.push({label:candidate.title,url:candidate.url,observedAt:new Date().toISOString(),
            matches:snapshot.split('\n').filter(l=>/deadline|cl[oô]ture|2026|digital|diagnostic|toolbox|eligib|date|d[eé]lai|soumission|formation|entrepreneu|information system/i.test(l)).slice(0,60),
            status:'detail page read — confirm deadline/eligibility in original tender attachment'});
          this.event(s,'research/detail',{url:candidate.url,title:candidate.title});
        }catch(e){findings.push({label:candidate.title,url:candidate.url,error:safeError(e)});}
      }
      const report=['#+TITLE: Ora browser research — candidate sources',
        `Observed: ${new Date().toISOString()}`,
        'Scripted discovery, using a Kernel browser. No application was submitted.',
        'Candidates are not confirmed open tenders. Check publication date, deadline, eligibility and tender documents.',
        'Ora fit: AI systems, CRM/ERP, process audits, digital transformation and growth strategy.',
        ...findings.flatMap(f=>[`\n* ${f.label}`,f.url,f.error?`FAILED: ${f.error}`:f.status,
          ...(f.matches || []).map(l=>l.trim()),...(f.links || []).map(l=>`${l.title} — ${l.url}`)])].join('\n');
      await fs.writeFile(path.join(s.dir,'research.bl.org'),report,{mode:0o600});
      s.artifacts.push({name:'research.bl.org',kind:'report',at:new Date().toISOString()});
      this.event(s,'research/done',{sources:findings.length});
      return `Browser discovery complete: ${findings.filter(f=>!f.error).length}/${findings.length} sources read.\nSession browser:${s.id}; report browser:${s.id}/research.bl.org.\nCandidates require deadline/eligibility verification; discovery does not certify open tenders.`;
    } finally {s.busy=false;}
  }
  async shutdown(){if(this.stopped)return;this.stopped=true;
    if(this.adapter.kind==='native'){for(const s of this.sessions.values()){if(!['closed','forgotten'].includes(s.status)){try{await this.action(s.id,'close');}catch{s.status='closed';s.kernelId=null;s.liveURL=null;this.event(s,'profile/recovery-available');}}}await this.adapter.shutdown();}
    await Promise.allSettled([...this.sessions.values()].map(s=>s.queue));await this.persist();await this.lease?.close();await fs.unlink(path.join(this.root,'host.lock')).catch(()=>{});}
}
