// One conversion contract and one compiled BL graph for local and server hosts.
import * as B from '../../out/pelagic.browser.mjs';
import * as G from '../../out/pelagic.graph-js.mjs';
import * as P from '../../out/pelagic.playback-js.mjs';
import {requireNamespace,blToJS,argument} from '../../out/interop.mjs';
const browser=requireNamespace('pelagic.browser');
// Foreign JS objects retain identity. Passing them through requireNamespace
// would first turn them into BL maps, copying every shared audio graph again.
export const plain=blToJS;
export const download=browser.download,setText=browser['set-text'],audioContext=browser['audio-context'],readText=browser['read-text'];
export const createEvaluator=browser.evaluator,afterPaint=browser['after-paint'],createGraphicsWorker=browser['graphics-worker'],projectClock=browser['project-clock'],renderScale=browser['render-scale'],audibleTime=browser['audible-time'];
export const continuePreparation=B.d_continue_preparation$Q,prepareSlice=B.d_score_slice,createScoreSource=B.d_score_source,requestFrame=B.d_request_frame,cancelFrame=B.d_cancel_frame;
export const admitWork=B.d_admit_work$Q,exportWindow=playing=>blToJS(B.d_export_window(playing));
export const playbackVoices=P.d_voices,validateGraph=G.d_validate_graph,compileGraph=graph=>argument(G.d_compile_graph(graph));
export function conversions(){return B.d_to_bl;}
