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
