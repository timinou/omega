import {hostImport} from './host-runtime.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const {plain,validateGraph}=await hostImport('audio.mjs');
globalThis.BL_HOST={};
import {out,imp} from './paths.mjs';
const {start}=await imp('repl');const repl=await start(f=>fs.readFileSync(new URL('src/'+f,out),'utf8'));
Object.assign(globalThis.BL_HOST,{'eval-ed':(s,a)=>repl.evalWith(s,'ed',a),'eval-cells':c=>repl.evalCells(c)});
const [R,M,F,P,G,S,O]=await Promise.all(['rt','ed.main','ed.frame','pelagic.main','ed.pkg','pelagic.score','pelagic.overtone'].map(imp));
const K=R.kw,get=(x,k)=>x?.get(K(k),null),event=x=>R.hashMap(...Object.entries(x).flatMap(([k,v])=>[K(k),v]));
const use=ed=>M.d_handle(ed,event({type:K('use'),package:P.d_bl_package}));
const [base]=M.d_take_effects(M.d_boot('A normal document\nKeep my cursor and history.','test.bl.org')).toArray();
test('passive use/unuse is exact; no foreign package or user table dependency',()=>{
 const ed=use(base);assert.equal(get(ed,'user-commands'),get(base,'user-commands'));assert.equal(get(ed,'user-keys'),get(base,'user-keys'));
 assert.equal(R.printStr(M.d_render(ed).dissoc(K('message')).dissoc(K('packages'))),R.printStr(M.d_render(base).dissoc(K('message')).dissoc(K('packages'))));
 const removed=G.d_unuse(ed,'pelagic');assert.equal(R.printStr(M.d_render(removed).dissoc(K('message')).dissoc(K('packages'))),R.printStr(M.d_render(base).dissoc(K('message')).dissoc(K('packages'))));
 assert.equal(get(removed,'pkg-state'),get(base,'pkg-state'));assert.equal(get(removed,'effects').cnt,0);
});
test('commands and controls emit host effects; IO is absent from the reducer',()=>{
 let ed=use(base);ed=M.d_handle(ed,event({type:K('command'),command:K('pelagic/play')}));
 let [clean,fx]=M.d_take_effects(ed).toArray();assert.equal(get(fx.nth(0),'kind'),K('package-host'));assert.equal(get(fx.nth(0),'op'),K('play'));
 clean=M.d_handle(clean,event({type:K('pelagic/control'),control:'bpm',value:900}));
 assert.equal(get(get(clean,'pkg-state').get('pelagic'),'bpm'),180);
 const removed=G.d_unuse(clean,'pelagic');assert.equal(get(removed,'pkg-state')?.get('pelagic',null),null);
 assert.ok(get(removed,'effects').toArray().some(e=>get(e,'op')===K('stop')));
 assert.equal(get(removed,'user-keys'),get(base,'user-keys'));
});
test('real command evaluator removes the package layout and returns the original pane',()=>{
 let fr=F.d_arrange(F.d_single(use(base)),P.d_stage);
 assert.equal(get(F.d_render(fr),'layout'),'pelagic');assert.equal(get(F.d_render(fr),'panes').cnt,2);
 fr=F.d_handle(fr,event({type:K('key'),key:':'}));
 fr=F.d_handle(fr,event({type:K('text'),text:'(ed/unuse "pelagic")'}));
 fr=F.d_handle(fr,event({type:K('key'),key:'Enter'}));
 assert.equal(get(F.d_render(fr),'layout'),'single');assert.equal(F.d_editor_ids(fr).cnt,1);
 assert.equal(get(F.d_focused(fr),'text'),get(base,'text'));assert.equal(get(F.d_focused(fr),'sels'),get(base,'sels'));
});
test('score has four acts, deterministic graphs and a restrained rhythmic opening',()=>{
 assert.equal(plain(S.d_timeline(S.d_defaults)).length,1024);
 assert.deepEqual(plain(S.d_step(516,S.d_defaults)),plain(S.d_step(516,S.d_defaults)));
 const first=plain(S.d_step(0,S.d_defaults)),peak=plain(S.d_step(516,S.d_defaults));
 assert.ok(first.some(x=>x.synth==='tide'));assert.ok(!first.some(x=>x.synth==='kick'));assert.ok(peak.some(x=>x.synth==='snare'));
 for(let i=0;i<1024;i++)for(const v of plain(S.d_step(i,S.d_defaults)))validateGraph(v.graph);
 const muted=S.d_defaults.assoc(K('kick'),false);assert.ok(!plain(S.d_step(512,muted)).some(x=>x.synth==='kick'));
});
test('dance arrangement keeps four-floor kicks, offbeat bass and two deliberate breakdowns',()=>{
 const stems=bar=>Array.from({length:16},(_,p)=>plain(S.d_step(bar*16+p,S.d_defaults)));
 for(const bar of [8,16,32,48,56]){
   const events=stems(bar);
   assert.deepEqual(events.flatMap((e,p)=>e.some(x=>x.synth==='kick')?[p]:[]),[0,4,8,12]);
   assert.deepEqual(events.flatMap((e,p)=>e.some(x=>x.synth==='bass')?[p]:[]),[2,6,10,14]);
 }
 for(const bar of [0,7,28,31,52,55,60,63])assert.ok(stems(bar).flat().every(x=>x.synth!=='kick'));
});
test('pitch and rhythm match the upstream Overtone conventions',()=>{
 assert.equal(O.d_note(K('D4')),62);assert.equal(O.d_note('eb2'),39);assert.equal(O.d_note(null),null);
 assert.ok(Math.abs(plain(O['d_midi_$Ghz'](69))-440)<1e-8);
 assert.deepEqual(plain(O.d_chord(K('D3'),K('minor9'))),[50,53,57,60,64]);
 assert.equal(plain(O.d_beat_ms(4,120)),2000);
 assert.throws(()=>O.d_chord(60,K('unknown')));
});
test('self-hosted definst uses real BL macros, parameter defaults and UGen arithmetic',()=>{
 repl.Env.in_ns('pelagic.overtone');repl.evalString(fs.readFileSync(new URL('../pelagic/overtone.bl',import.meta.url),'utf8').replace('(ns pelagic.overtone)',''));
 repl.Env.in_ns('user');const voice=plain(repl.evalString('(pelagic.overtone/definst glass [freq 440 amp 0.1] (* amp (pelagic.overtone/sin-osc freq))) (glass 220 :amp 0.2)'));
 assert.throws(()=>repl.evalString('(glass :freq)'));assert.throws(()=>repl.evalString('(glass :unknown 1)'));
 assert.equal(voice.synth,'glass');assert.deepEqual(voice.params,{freq:220,amp:.2});assert.equal(voice.graph.ugen,'mul');validateGraph(voice.graph);
});
