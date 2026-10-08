import path from 'node:path';
import {pathToFileURL} from 'node:url';
export const out=process.env.PELAGIC_OUT
  ? pathToFileURL(path.resolve(process.env.PELAGIC_OUT)+path.sep)
  : new URL('../../../vendor/bl-ed/web/out/',import.meta.url);
export const imp=name=>import(new URL(name+'.mjs',out));
