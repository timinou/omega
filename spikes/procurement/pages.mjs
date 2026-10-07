import fs from 'node:fs/promises';
const [file,...wanted]=process.argv.slice(2);
try{const text=await fs.readFile(file,'utf8'),pages=text.split('\f');if(!pages.at(-1).trim())pages.pop();if(!wanted.length){console.log(JSON.stringify({file,pages:pages.length}));}else for(const n of wanted.map(Number)){if(!Number.isInteger(n)||n<1||n>pages.length)throw Error('Page outside document');console.log(`\n[${file} — PDF page ${n}]\n${pages[n-1]}`);}}catch(e){console.error(e.message);process.exitCode=1;}
