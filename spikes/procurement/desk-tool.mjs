import fs from 'node:fs/promises';
const [verb,flag,file]=process.argv.slice(2);
try{if(flag!=='--arg-file'||!file)throw Error('Use desk-tool.mjs ACTION --arg-file JSON_PATH');const args=JSON.parse(await fs.readFile(file,'utf8'));const r=await fetch('http://127.0.0.1:8797/api/intent',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({intent:'procurement/'+verb,args})});const j=await r.json();if(!j.ok)throw Error(j.message);console.log(JSON.stringify(j));}catch(e){console.error(e.message);process.exitCode=1;}
