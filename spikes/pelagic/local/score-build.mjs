// Specialize PELAGIC's finite immutable default score through its compiled BL
// kernel. Live patterns and instrument edits remain runtime BL values.
import fs from 'node:fs/promises';import path from 'node:path';import {pathToFileURL} from 'node:url';
const root=path.resolve(process.argv[2]),B=await import(pathToFileURL(path.join(root,'out/pelagic.browser.mjs')));
const steps=[];for(let start=0;start<1024;start+=16)steps.push(...B.d_score_chunk(start,16));
await fs.writeFile(path.join(root,'pkg/pelagic/score-cache.json'),JSON.stringify({schema:'pelagic.score.v1',steps})+'\n');
console.log('Prepared 1024 score steps using the compiled BL kernel.');
