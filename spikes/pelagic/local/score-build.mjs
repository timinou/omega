// Specialize PELAGIC's finite immutable default score through its compiled BL
// kernel. Live patterns and instrument edits remain runtime BL values.
import fs from 'node:fs/promises';import path from 'node:path';import {pathToFileURL} from 'node:url';
const root=path.resolve(process.argv[2]),B=await import(pathToFileURL(path.join(root,'out/pelagic.browser.mjs')));
const data=B.d_score_data();
await fs.writeFile(path.join(root,'pkg/pelagic/score-cache.json'),JSON.stringify(data)+'\n');
console.log('Prepared 1024 score steps using the compiled BL kernel.');
