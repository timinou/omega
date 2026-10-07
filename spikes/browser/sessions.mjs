import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const cliRoot=path.dirname(fileURLToPath(import.meta.url));
const exec = promisify(execFile);
export const validId = id => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id);
export function publicURL(value) {
  const u = new URL(value);
  if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) throw Error('Use an HTTP(S) URL without credentials');
  return u.href;
}
export class Sessions {
  constructor(root, {run, executable = process.env.AGENT_BROWSER_EXECUTABLE_PATH} = {}) {
    this.root = root; this.sessions = new Map(); this.tasks = new Map(); this.pending = new Map();
    this.registryWrite=Promise.resolve();
    this.executable = executable; this.run = run || this.cli.bind(this);
  }
  async init() {
    await fs.mkdir(this.root, {recursive:true, mode:0o700}); await fs.chmod(this.root, 0o700);
    for(const s of JSON.parse(await fs.readFile(path.join(this.root,'sessions.json'),'utf8').catch(()=> '[]'))){
      if(!validId(s.id)||!path.resolve(s.dir).startsWith(path.resolve(this.root)+path.sep))continue;
      delete s.queue;s.status='closed';s.control='human';s.watching=false;s.busy=false;s.task=null;s.auth='unknown';
      s.profile=await fs.access(path.join(s.dir,'auth-state.json')).then(()=> 'saved-storage',()=> 'ephemeral');
      s.agentSession=`omega-${s.id}-${crypto.randomBytes(5).toString('hex')}`;this.sessions.set(s.id,s);
    }
    if (!this.executable) {
      const cache = path.join(process.env.HOME, '.cache/ms-playwright');
      const versions = await fs.readdir(cache).catch(() => []);
      for (const v of versions.filter(v => /^chromium-/.test(v)).sort().reverse()) {
        const file = path.join(cache, v, 'chrome-linux64/chrome');
        if (await fs.access(file).then(() => true, () => false)) { this.executable = file; break; }
      }
    }
  }
  async persist() {
    const content=JSON.stringify([...this.sessions.values()].map(({queue,...s})=>({...s,busy:false})),null,2);
    this.registryWrite=this.registryWrite.catch(()=>{}).then(async()=>{const file=path.join(this.root,'sessions.json');await fs.writeFile(file+'.tmp',content,{mode:0o600});await fs.rename(file+'.tmp',file);});
    await this.registryWrite;
  }
  get(id) { if (!validId(id)) throw Error('Invalid session ID'); const s = this.sessions.get(id); if (!s) throw Error('Unknown browser session'); return s; }
  event(s, type, detail = {}) {
    s.events.push({at:new Date().toISOString(), type, ...detail}); s.rev++;
  }
  async cli(s, args) {
    const env = {...process.env};
    if (this.executable) env.AGENT_BROWSER_EXECUTABLE_PATH = this.executable;
    let stdout;
    try { ({stdout} = await exec('npx', ['--no-install', 'agent-browser', '--session', s.agentSession, '--json', ...args],
      {env, cwd:cliRoot, timeout:45000, maxBuffer:4*1024*1024})); } catch(error) {
      try { const result=JSON.parse(error.stdout); throw Error(result.error || error.message); }
      catch(parsed) { if(parsed instanceof SyntaxError) throw error; throw parsed; }
    }
    const result = JSON.parse(stdout.trim());
    if (!result.success) throw Error(result.error || 'Browser command failed');
    return result.data;
  }
  async lock(s, fn) {
    const previous = s.queue || Promise.resolve();
    const next = previous.catch(() => {}).then(fn); s.queue = next;
    return next;
  }
  async open({id, mode = 'headless', url = 'https://ora-ventures.com', task = null}) {
    if (!validId(id)) throw Error('Invalid session ID');
    if (!['headless','headful'].includes(mode)) throw Error('Invalid browser mode');
    url = publicURL(url);
    let s = this.sessions.get(id);
    if (s && !['closed','failed'].includes(s.status)) {
      if (task && s.task && s.task !== task) throw Error('Session already belongs to another task');
      return s;
    }
    if (mode === 'headful' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) throw Error('Headful requires a desktop display; headless observation is available');
    if (!s) {
      const dir = path.join(this.root, id, crypto.randomBytes(6).toString('hex')); await fs.mkdir(dir, {recursive:true,mode:0o700});
      s = {id, dir, agentSession:`omega-${id}-${crypto.randomBytes(5).toString('hex')}`, task,
        provider:'local', mode, status:'starting', control:'agent', auth:'unknown', profile:'ephemeral',
        url, tabs:[], events:[], artifacts:[], rev:0, watching:false, generation:1};
      this.sessions.set(id,s);
    } else { s.status = 'starting'; s.control='agent'; s.mode = mode; s.url = url; s.task = task || s.task; s.generation++; }
    if (task) this.tasks.set(task,id);
    this.event(s,'session/opening',{mode,task});
    try {
      await this.run(s,[...(mode === 'headful' ? ['--headed'] : []),...(s.profile==='saved-storage'?['--state',path.join(s.dir,'auth-state.json')]:[]),'open',url]);
      s.status='running'; this.event(s,'session/opened',{url});
      await this.capture(s); await this.persist(); return s;
    } catch (e) {
      // A redirect can invalidate page.title after the browser has launched.
      try { await this.run(s,['get','url']); s.status='running'; this.event(s,'navigation/recovered',{message:e.message}); await this.capture(s); await this.persist(); return s; }
      catch { s.status='failed'; this.event(s,'session/failed',{message:e.message}); throw e; }
    }
  }
  async capture(s) {
    const n = String(s.artifacts.length + 1).padStart(3,'0');
    const name = `${n}-viewport.png`; const snapshot = `${n}-snapshot.txt`;
    const data = await this.run(s,['snapshot','-c']);
    const text = data.snapshot || (typeof data === 'string' ? data : JSON.stringify(data));
    await fs.writeFile(path.join(s.dir,snapshot),text,{mode:0o600});
    s.url = (await this.run(s,['get','url'])).url || s.url;
    s.artifacts.push({name:snapshot,kind:'snapshot',url:s.url,at:new Date().toISOString()});
    try {
      await this.run(s,['screenshot',path.join(s.dir,name)]);
      await fs.chmod(path.join(s.dir,name),0o600);
      s.artifacts.push({name,kind:'screenshot',url:s.url,at:new Date().toISOString()});
      s.frame = name; this.event(s,'artifact/captured',{name,url:s.url});
    }catch(error) { this.event(s,'artifact/capture-failed',{message:error.message,url:s.url}); }
    return text;
  }
  async refreshFrame(s) {
    // Observation keeps one mutable latest image; navigation evidence stays immutable.
    const name='watch-viewport.png';
    try {
      await this.run(s,['screenshot',path.join(s.dir,name)]);
      await fs.chmod(path.join(s.dir,name),0o600);
      s.frame=name; s.frameAt=new Date().toISOString(); s.rev++;
      const existing=s.artifacts.find(a=>a.name===name);
      if(existing){existing.at=s.frameAt;existing.url=s.url;}
      else s.artifacts.push({name,kind:'latest-viewport (mutable)',url:s.url,at:s.frameAt});
    }catch(error){s.watching=false;this.event(s,'observation/failed',{message:error.message});}
  }
  async navigate(s,url) {
    return this.lock(s,async () => {
      if(s.status !== 'running') throw Error('Browser is not running');
      s.url=publicURL(url); this.event(s,'navigation/start',{url:s.url});
      try { await this.run(s,['open',s.url]); } catch(e) {
        const now = await this.run(s,['get','url']);
        if (!now.url || new URL(now.url).hostname !== new URL(s.url).hostname) throw e;
        this.event(s,'navigation/recovered',{message:e.message});
      }
      return this.capture(s);
    });
  }
  async switchMode(s,mode) {
    if(mode === s.mode) return;
    if (mode === 'headful' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) throw Error('Headful requires DISPLAY or WAYLAND_DISPLAY; use browser-observe to watch headless');
    return this.lock(s,async () => {
      if(s.status !== 'running') throw Error('Only a running browser can switch mode');
      const old=s.mode; const state=path.join(s.dir,'auth-state.json');
      s.status='switching'; this.event(s,'mode/switching',{from:old,to:mode});
      try {
        const tabs = await this.run(s,['tab','list']); s.tabs=tabs.tabs || [];
        await this.run(s,['state','save',state]); await fs.chmod(state,0o600); s.profile='saved-storage';
        await this.run(s,['close']);
        // New daemon identity ensures launch flags are not ignored by an existing daemon.
        s.agentSession=`omega-${s.id}-${crypto.randomBytes(5).toString('hex')}`;
        await this.run(s,[...(mode==='headful'?['--headed']:[]),'--state',state,'open','about:blank']);
        for (const [i,tab] of s.tabs.entries()) {
          if (tab.url && /^https?:/.test(tab.url)) await this.run(s,[i===0?'open':'tab',...(i===0?[]:['new']),tab.url]);
        }
        if(!s.tabs.length) await this.run(s,['open',s.url]);
        s.mode=mode; s.generation++; s.status='running';
        this.event(s,'mode/switched',{from:old,to:mode,restored:'cookies/localStorage and tab URLs; no JS memory or form drafts'});
        await this.capture(s);
      } catch(e) { s.status='failed'; this.event(s,'mode/failed',{message:e.message}); throw e; }
    });
  }
  async action(id,verb) {
    const s=this.get(id);
    if(['headful','headless'].includes(verb)) await this.switchMode(s,verb);
    else if(verb==='save-profile') {
      if(s.status!=='running')throw Error('Save storage from a running browser');
      await this.lock(s,async()=>{const file=path.join(s.dir,'auth-state.json');await this.run(s,['state','save',file]);await fs.chmod(file,0o600);s.profile='saved-storage';this.event(s,'profile/saved',{auth:'Storage retained; login validity remains unknown'});});
    }
    else if(verb==='watch') {if(s.status!=='running')throw Error('Session is closed; reopen its browser declaration before watching');s.watching=true; await this.lock(s,() => this.refreshFrame(s));}
    else if(verb==='pause') {s.control='human'; s.auth='needs-human'; this.event(s,'control/paused');}
    else if(verb==='resume') {s.control='agent'; s.auth='unknown'; this.event(s,'control/resumed',{auth:'User resumed; login validity is unverified'});}
    else if(verb==='close') await this.lock(s,async () => {
      s.watching=false; s.control='human';
      await this.run(s,['close']); s.status='closed'; this.event(s,'session/closed');
    });
    else if(verb==='forget') {
      if(s.status !== 'closed') throw Error('Close the session before forgetting saved auth');
      await fs.rm(path.join(s.dir,'auth-state.json'),{force:true}); s.profile='ephemeral'; s.auth='unknown'; this.event(s,'profile/forgotten');
    } else throw Error('Unknown browser action');
    await this.persist(); return s;
  }
  async waitControl(s) {
    while(s.control==='human' && s.status==='running') await new Promise(r => setTimeout(r,250));
    if(s.status!=='running') throw Error('Browser research stopped because its session closed');
  }
  async research(task) {
    for(let i=0;i<40 && !this.pending.has(task);i++) await new Promise(r=>setTimeout(r,50));
    const config=this.pending.get(task) || {id:`research-${task}`,mode:'headless'};
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
          const links=await this.lock(s,() => this.run(s,['eval',
            'JSON.stringify(Array.from(document.querySelectorAll("a[href]")).map(a=>({title:a.innerText.trim(),url:a.href})).filter(a=>/digital|num[eé]rique|CRM|ERP|intelligence|marketing|transformation|diagnostic|toolbox|information system|communication|appels? d.offre|consultant|PACT/i.test(a.title)).slice(0,25))']));
          let parsed=[]; try {parsed=JSON.parse(links.result || '[]');} catch {}
          if(label!=='ora')candidates.push(...parsed.filter(a=>/digital|num[eé]rique|CRM|ERP|intelligence|marketing|transformation|diagnostic|toolbox|information system|communication/i.test(a.title) && !/projets\/$/.test(a.url)));
          findings.push({label,url,observedAt:new Date().toISOString(),matches:lines.slice(0,35),links:parsed,
            status:'candidate — deadline and eligibility need source verification'});
          this.event(s,'research/source',{label,matches:lines.length});
        } catch(e) { findings.push({label,url,error:e.message}); this.event(s,'research/source-failed',{label,message:e.message}); }
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
        }catch(e){findings.push({label:candidate.title,url:candidate.url,error:e.message});}
      }
      const report=['#+TITLE: Ora browser research — candidate sources',
        `Observed: ${new Date().toISOString()}`,
        'Scripted discovery, using a real local browser. No application was submitted.',
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
  async shutdown() {
    await Promise.allSettled([...this.sessions.values()].filter(s=>s.status!=='closed').map(s=>this.action(s.id,'close')));
  }
}
