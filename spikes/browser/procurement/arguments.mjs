import fs from 'node:fs/promises';
export function normalizeTarget(action,args){
 if(['click','fill','download'].includes(action)&&/^e\d+$/.test(args[0]||''))return ['@'+args[0],...args.slice(1)];
 return args;
}
export async function literalArguments(args){
 if(!['--arg-file','--args-file','--args-lines'].includes(args[0]))return args;
 if(args.length!==2)throw Error('Literal arguments require a flag and one filename');
 const text=await fs.readFile(args[1],'utf8');
 if(args[0]==='--arg-file')return [text];
 const values=args[0]==='--args-lines'?text.trimEnd().split('\n'):JSON.parse(text);
 if(!Array.isArray(values)||!values.every(v=>typeof v==='string'))throw Error('Argument array must contain strings');
 return values;
}
