import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
export async function executable(){
 if(process.env.CHROMIUM)return process.env.CHROMIUM;
 const cache=path.join(os.homedir(),'.cache/ms-playwright');
 for(const dir of (await fs.readdir(cache)).filter(x=>/^chromium-\d+$/.test(x)).sort((a,b)=>Number(b.split('-')[1])-Number(a.split('-')[1]))){
  const file=path.join(cache,dir,'chrome-linux64/chrome');if(await fs.access(file).then(()=>true,()=>false))return file;
 }
 throw Error('Install a Playwright Chromium or set CHROMIUM to run browser proofs.');
}
