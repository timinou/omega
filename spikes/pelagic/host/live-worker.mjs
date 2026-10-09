// Realm bootstrap only. Evaluation and the message protocol are compiled BL.
import * as W from '../../out/ns/js.worker.mjs';
import {start} from '../../out/repl.mjs';
import {releaseNamespace} from '../../out/interop.mjs';
let evaluator;
const ready=start(async f=>{
  const response=await fetch(new URL('../../out/src/'+f,import.meta.url));
  if(!response.ok)throw new Error('Cannot load worker language: '+f);
  return response.text();
}).then(async()=>{
  evaluator=await import('../../out/ns/pelagic.worker.mjs');
  evaluator.d_install$B();
});
W.d_serve(ready,pieces=>{
  try {return evaluator.d_evaluate(pieces);}
  finally {releaseNamespace(evaluator.d_session_namespace);}
});
