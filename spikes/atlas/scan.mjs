// Public daily market scan. Independent of the case; no investment ranking.
import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
import {marketMetrics} from './models.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),symbols=process.argv.slice(2).length?process.argv.slice(2):['ADBE','ADSK','CRM','MSFT','ORCL','NVDA','QQQ'];
if(symbols.some(s=>!/^([A-Z]{1,8}|\^[A-Z]{1,8})$/.test(s))||symbols.length>20)throw Error('Use up to twenty public ticker symbols');
const end=Math.floor(Date.now()/1000),start=end-90*86400;
const records=await Promise.all([...new Set([...symbols,'QQQ'])].map(async symbol=>{const url=`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${start}&period2=${end}&interval=1d`,at=new Date().toISOString();try{
 const r=await fetch(url,{signal:AbortSignal.timeout(30000)}),raw=await r.text();if(!r.ok)throw Error('HTTP '+r.status);const j=JSON.parse(raw).chart.result[0],p=j.indicators.adjclose?.[0]?.adjclose||j.indicators.quote[0].close;
 const rows=j.timestamp.map((t,i)=>({date:new Date(t*1000).toISOString().slice(0,10),close:p[i]})).filter(r=>Number.isFinite(r.close)&&r.close>0);
 const sha256=crypto.createHash('sha256').update(raw).digest('hex'),file=`data/raw/scan-${symbol}-${sha256.slice(0,12)}.txt`;await fs.writeFile(path.join(here,file),raw);
 return {symbol,status:'ok',at,url,sha256,file,rows};
}catch(e){return {symbol,status:'error',at,url,error:e.message};}}));
const benchmark=records.find(r=>r.symbol==='QQQ')?.rows||[];const scan={at:new Date().toISOString(),benchmark:'QQQ',method:'Last 20 matched daily sessions; annualized close-to-close sample volatility; maximum drawdown over same window.',rows:records.map(r=>({...r,metrics:r.status==='ok'?marketMetrics(r.rows,benchmark,20):null}))};
await fs.writeFile(path.join(here,'data/scan.json'),JSON.stringify(scan,null,2)+'\n');console.log(scan.rows.map(r=>({symbol:r.symbol,status:r.status,...r.metrics})));
