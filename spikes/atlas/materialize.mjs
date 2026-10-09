// Refresh snapshot fields in an explicit new proposal while retaining the authored thesis.
import fs from 'node:fs/promises';import {fileURLToPath} from 'node:url';import path from 'node:path';import {notebook} from './models.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),source=await fs.readFile(path.join(here,'desk.bl.org'),'utf8'),d=notebook(source);
d.data=JSON.parse(await fs.readFile(path.join(here,'data/derived.json'),'utf8'));
d.scan=JSON.parse(await fs.readFile(path.join(here,'data/scan.json'),'utf8'));
const text=source.replace(/^#\+begin_atlas\s*\n[\s\S]*?^#\+end_atlas\s*$/mi,'#+begin_atlas\n'+JSON.stringify(d,null,2)+'\n#+end_atlas');notebook(text);
const target=process.argv[2];if(!target)throw Error('Provide a NEW proposal path. Use revise-movement.mjs for new movement/sentiment observations.');
await fs.writeFile(target,text,{flag:'wx'});console.log('Created '+target+'; authored thesis retained. Movement study has its own capture timestamps and refresh path.');
