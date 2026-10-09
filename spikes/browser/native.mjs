import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {chromium} from 'playwright-core';
import {BrowserPort} from './port.mjs';
import {browserOperation} from './operations.mjs';
const missing=()=>Object.assign(Error('Native browser is no longer running'),{status:404});
export class NativeBrowser {
  constructor({root=process.env.BROWSER_NATIVE_ROOT||path.join(os.homedir(),'.local/share/omega/browser'),env=process.env}={}){
    this.kind='native';this.root=path.resolve(root);this.env=env;this.handles=new Map();this.capabilities=new Map();
  }
  profilePath(name){if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(name))throw Error('Invalid native profile');return path.join(this.root,'profiles',name);}
  async ensureProfile(name){const dir=this.profilePath(name);await fs.mkdir(path.join(this.root,'profiles'),{recursive:true,mode:0o700});await fs.chmod(this.root,0o700);await fs.chmod(path.join(this.root,'profiles'),0o700);await fs.mkdir(dir,{recursive:true,mode:0o700});await fs.chmod(dir,0o700);
    const saved=await fs.readFile(path.join(dir,'.bl-saved'),'utf8').catch(()=>0);
    return {id:name,name,updated_at:new Date(Number(saved)||0).toISOString()};}
  async configure(){
    if(this.env.BROWSER_NATIVE_CONFIG&&!this.configured){const config=JSON.parse(await fs.readFile(this.env.BROWSER_NATIVE_CONFIG,'utf8'));this.env={...config,...this.env};this.configured=true;}
    if(!this.env.BL_BROWSER_PORT)throw Error('Set BL_BROWSER_PORT or run spikes/browser/native-setup.sh.');
  }
  async create(s,url){
    if(this.env.BL_BROWSER_ENABLED==='0')throw Error('Native browser is disabled (BL_BROWSER_ENABLED=0).');
    await this.ensureProfile(s.profile);s.saveBaseline=0;s.vaultId=null;
    await this.configure();
    const executable=this.env.BL_BROWSER_PORT;
    if(!executable)throw Error('Set BL_BROWSER_PORT or run spikes/browser/native-setup.sh.');
    const displayBackend=this.env.BROWSER_DISPLAY_BACKEND||'wayland';
    if(!['wayland','x11'].includes(displayBackend))throw Error('Choose wayland or x11 BROWSER_DISPLAY_BACKEND.');
    for(const key of ['CHROMIUM',...(displayBackend==='wayland'?['SWAY','WAYVNC']:['XVFB','X11VNC'])])if(!this.env[key])throw Error(`Set ${key} or run native setup.`);
    const runtime=await fs.mkdtemp(path.join(os.tmpdir(),'omega-browser-'));await fs.chmod(runtime,0o700);
    const port=new BrowserPort(executable);let browser;
    try{
      const info=await port.request({op:'launch',profile:this.profilePath(s.profile),runtime,chromium:this.env.CHROMIUM,displayBackend,compositor:this.env.SWAY,xvfb:this.env.XVFB,vnc:displayBackend==='wayland'?this.env.WAYVNC:this.env.X11VNC,...(url?{url}:{}),width:1280,height:900});
      browser=await chromium.connectOverCDP(info.cdp);
      const id=crypto.randomUUID(),token=crypto.randomBytes(24).toString('hex');
      const h={id,session:s.id,name:s.remoteName,profile:s.profile,port,browser,info,runtime,token};this.handles.set(id,h);this.capabilities.set(token,h);
      port.closed.then(()=>{this.capabilities.delete(token);this.handles.delete(id);browser.close().catch(()=>{});});
      return this.descriptor(h);
    }catch(e){await browser?.close().catch(()=>{});await port.close();throw Error(`${e.message}. Private startup logs: ${runtime}`);}
  }
  descriptor(h){return {session_id:h.id,browser_live_view_url:`/browser/native/${h.session}`,name:h.name,displayBackend:h.info.displayBackend,profile:{name:h.profile}};}
  async retrieve(id){const h=this.handles.get(id)||[...this.handles.values()].find(h=>h.name===id);if(!h||h.port.error)throw missing();await h.port.request({op:'info'});return this.descriptor(h);}
  async close(id){const h=this.handles.get(id);if(!h)throw missing();
    const result=await h.port.request({op:'stop'});if(!result.saved)throw Error('Native profile save was not acknowledged');
    this.capabilities.delete(h.token);this.handles.delete(id);await h.browser.close().catch(()=>{});await h.port.close();await fs.rm(h.runtime,{recursive:true,force:true});
  }
  async saved(profile){const p=await this.ensureProfile(profile);if(!Date.parse(p.updated_at))throw Error('Native profile needs recovery; no clean save was acknowledged. Reopen the retained profile.');return p;}
  async forget(s){if([...this.handles.values()].some(h=>h.profile===s.profile))throw Error('Close every browser using this profile first.');
    // An external helper may own the profile. Acquire the same OS lease using
    // the native helper's forget command; never delete a live writer's files.
    await this.configure();const port=new BrowserPort(this.env.BL_BROWSER_PORT);
    try{await port.request({op:'forget',profile:this.profilePath(s.profile)});}finally{await port.close();}
  }
  stream(id){const h=this.handles.get(id);if(!h||h.port.error)throw missing();return {token:h.token,socket:h.info.vncSocket};}
  async run(s,args){const h=this.handles.get(s.kernelId);if(!h||h.port.error)throw missing();
    const context=h.browser.contexts()[0],pages=context.pages();
    // The selected Chromium tab is visible; among restored pages prefer the
    // focused page, falling back to the last tab if none reports focus.
    let page;for(const p of pages)if(await p.evaluate(()=>document.hasFocus()).catch(()=>false))page=p;
    page ||= pages.at(-1)||await context.newPage();
    const data=await browserOperation(page,context,args);
    if(args[0]==='screenshot'){await fs.writeFile(args[1],Buffer.from(data.png,'base64'),{mode:0o600});return {};}
    if(args[0]==='download'){await fs.writeFile(args[2],Buffer.from(data.data,'base64'),{mode:0o600});return {saved:true};}
    return data;
  }
  async shutdown(){for(const h of [...this.handles.values()]){try{await this.close(h.id);}catch{await h.port.close();}}}
}
