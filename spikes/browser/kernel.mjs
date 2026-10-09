import Kernel from '@onkernel/sdk';
import fs from 'node:fs/promises';

// Only this boundary speaks Kernel. No local Chromium, daemon or CLI subprocess.
export class KernelBrowser {
  constructor({client, env = process.env} = {}) { this.client = client; this.env = env; }
  api() {
    if (!this.client) {
      if (!this.env.KERNEL_API_KEY) throw Error('Set KERNEL_API_KEY in the browser host environment to connect Kernel.');
      this.client = new Kernel({apiKey:this.env.KERNEL_API_KEY, projectID:this.env.KERNEL_PROJECT_ID || undefined,
        baseURL:this.env.KERNEL_BASE_URL || this.env.KERNEL_BASE || undefined, maxRetries:0, timeout:60000,
        logLevel:'off'});
    }
    return this.client;
  }
  async ensureProfile(name) {
    const api = this.api();
    try { return await api.profiles.retrieve(name); }
    catch (e) { if (e.status !== 404) throw e; }
    try { return await api.profiles.create({name}); }
    catch (e) { if (e.status !== 409) throw e; return api.profiles.retrieve(name); }
  }
  async create(s, url) {
    const api = this.api();
    const profile = await this.ensureProfile(s.profile);
    s.saveBaseline = Date.parse(profile.updated_at) || 0;
    // Avoid silently overwriting a profile used by another host. Kernel snapshots
    // replace state rather than merge it. The local host lease covers local races.
    for await (const b of api.browsers.list({query:s.profile, status:'active'})) {
      if (b.profile?.id === profile.id && b.profile_save_changes !== false)
        throw Error('This Kernel profile already has a running browser. Reattach its session or choose another profile.');
    }
    const vault = await api.vaults.upsert({name:s.profile});
    s.vaultId = vault.id;
    return api.browsers.create({name:s.remoteName, headless:false, stealth:false, kiosk_mode:false,
      profile:{id:profile.id, save_changes:true}, vaults:[{id:vault.id}],
      ...(url ? {start_url:url} : {}), timeout_seconds:s.idleSeconds,
      viewport:{width:1280,height:800,refresh_rate:25},
      ...(this.env.KERNEL_REGION ? {region:this.env.KERNEL_REGION} : {}),
      ...(this.env.KERNEL_BROWSER_EXTENSIONS ? {extensions:this.env.KERNEL_BROWSER_EXTENSIONS.split(',').filter(Boolean).map(name=>({name:name.trim()}))} : {}),
      tags:{application:'omega', session:s.id}});
  }
  retrieve(id) { return this.api().browsers.retrieve(id); }
  close(id) { return this.api().browsers.deleteByID(id); }
  async saved(profile, since, {timeout = 60000} = {}) {
    const deadline = Date.now() + timeout;
    do {
      const p = await this.api().profiles.retrieve(profile);
      if (Date.parse(p.updated_at) > since) return p;
      await new Promise(r=>setTimeout(r,500));
    } while (Date.now() < deadline);
    throw Error('Kernel profile save is still pending. Retry Save status before reopening.');
  }
  async forget(s) {
    for await (const b of this.api().browsers.list({query:s.profile,status:'active'})) {
      if (b.profile?.name === s.profile) throw Error('Close every browser using this profile before forgetting it.');
    }
    // Keep each handle until its deletion is acknowledged, so partial failure is retryable.
    if (s.vaultId) { try { await this.api().vaults.delete(s.vaultId); } catch(e) { if(e.status!==404)throw e; } s.vaultId=null; }
    try { await this.api().profiles.delete(s.profile); } catch(e) { if(e.status!==404)throw e; }
  }
  async run(s, args) {
    const result = await this.api().browsers.playwright.execute(s.kernelId, {
      code:`return await (${browserOperation.toString()})(page, context, ${JSON.stringify(args)});`, timeout_sec:40});
    if (!result.success) throw Error('Kernel browser operation failed; inspect the live browser and retry.');
    const data = result.result;
    if (args[0] === 'screenshot') { await fs.writeFile(args[1],Buffer.from(data.png,'base64'),{mode:0o600}); return {}; }
    if (args[0] === 'download') { await fs.writeFile(args[2],Buffer.from(data.data,'base64'),{mode:0o600}); return {saved:true}; }
    return data;
  }
}

// Executed beside Chromium in Kernel's VM: one RPC per operation. Argument values
// are JSON data, never executable snippets (except the explicit model eval tool).
export async function browserOperation(page, context, args) {
  const [verb,...a] = args;
  const target = value => /^@?e\d+$/.test(value) ? page.locator(`[data-omega-ref="${value.replace('@','')}"]`) : page.locator(value);
  const snapshot = async () => {
    const refs = await page.locator('a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=link]').evaluateAll(nodes => {
      window.__omegaNextRef ||= 1;
      return nodes.filter(el=>el.getClientRects().length).map(el=>{
        el.dataset.omegaRef ||= 'e' + window.__omegaNextRef++;
        return `[ref=${el.dataset.omegaRef}] ${el.tagName.toLowerCase()} ${el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.textContent?.trim().slice(0,180) || el.getAttribute('name') || ''}`;
      });
    });
    return {snapshot:(await page.locator('body').ariaSnapshot())+'\n\nTargets (use @eN or CSS):\n'+refs.join('\n'),url:page.url()};
  };
  if (verb === 'open') { await page.goto(a[0],{waitUntil:'domcontentloaded',timeout:30000}); return {url:page.url()}; }
  if (verb === 'snapshot') return snapshot();
  if (verb === 'capture') return {...await snapshot(),png:(await page.screenshot()).toString('base64')};
  if (verb === 'screenshot') return {png:(await page.screenshot()).toString('base64')};
  if (verb === 'eval') return {result:await page.evaluate(a[0])};
  if (verb === 'get') {
    if(a[0]==='url')return {url:page.url()};
    if(a[0]==='title')return {title:await page.title()};
    if(a[0]==='text')return {text:await target(a[1] || 'body').innerText()};
    if(a[0]==='attribute')return {value:await target(a[1]).getAttribute(a[2])};
    throw Error('Unsupported get operation');
  }
  if (verb === 'click') { await target(a[0]).click({timeout:10000}); return {url:page.url()}; }
  if (verb === 'fill') { await target(a[0]).fill(a[1],{timeout:10000}); return {filled:true}; }
  if (verb === 'scroll') {
    const amount=Number(a[1] || 600);if(!Number.isFinite(amount))throw Error('Invalid scroll distance');
    await page.mouse.wheel(a[0]==='left'?-amount:a[0]==='right'?amount:0,a[0]==='up'?-amount:a[0]==='down'?amount:0);return {};
  }
  if (verb === 'tab' && a[0] === 'list') return {tabs:context.pages().map(p=>({url:p.url()}))};
  if (verb === 'download') {
    const pending=page.waitForEvent('download',{timeout:20000});await target(a[0]).click();
    const download=await pending,stream=await download.createReadStream(),chunks=[];let size=0;
    for await(const chunk of stream){size+=chunk.length;if(size>32*1024*1024)throw Error('Download exceeds 32 MiB');chunks.push(chunk);}
    return {data:Buffer.concat(chunks).toString('base64')};
  }
  throw Error('Unsupported browser operation');
}
