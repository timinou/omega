#!/usr/bin/env python3
"""Hold the clock fixed: prove that audible samples change GPU pixels."""
import os,base64,json
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[3];PROOF=ROOT/'spikes/pelagic/proof/club'
URL=os.environ.get('PELAGIC_URL','http://127.0.0.1:8812/?use=pelagic&layout=pelagic&file=spikes/pelagic/demo.bl.org')
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path=os.environ.get('CHROMIUM','/home/user/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'),args=['--no-sandbox','--use-gl=angle','--use-angle='+os.environ.get('PELAGIC_ANGLE','gl'),'--enable-gpu','--ignore-gpu-blocklist'])
 page=b.new_page();page.goto(URL)
 page.wait_for_function('document.querySelector(".view-host .view-body")?.pelagic',timeout=60000)
 page.evaluate('document.querySelector(".view-host .view-body").pelagic.ready()')
 result=page.evaluate('''async raw=>{
 const p=document.querySelector('.view-host .view-body').pelagic;
 const context=new AudioContext(),bytes=Uint8Array.from(atob(raw),c=>c.charCodeAt(0));
 const audio=await context.decodeAudioData(bytes.buffer);await context.close();
 const silence={getByteFrequencyData:a=>a.fill(0),getByteTimeDomainData:a=>a.fill(128)};
 const gl=p.shader().gl;
 const draw=(time,analyser)=>{
  p.renderAt(time,{width:640,height:360,analyser});
  const pixels=new Uint8Array(640*360*4);gl.readPixels(0,0,640,360,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
  return {pixels,features:{...p.shader().features},png:p.shader().canvas.toDataURL().split(',')[1]};
 };
 // Find the strongest audible kick near the main drop, not an invented beat envelope.
 const bpm=p.config().bpm,beatSeconds=60/bpm;
 let best={bass:-1};const samples=[];
 for(let j=0;j<48;j++){
  const time=(128+j/16)*beatSeconds;
  const a=p.soundtrackAnalysis(audio,time);
  const image=draw(time,a);samples.push({time,...image.features});
  if(image.features.bass>best.bass)best={time,bass:image.features.bass};
 }
 const live=draw(best.time,p.soundtrackAnalysis(audio,best.time));
 const muted=draw(best.time,silence);
 let difference=0,changed=0;
 for(let i=0;i<live.pixels.length;i+=4){
  let d=0;for(let c=0;c<3;c++)d+=Math.abs(live.pixels[i+c]-muted.pixels[i+c]);
  difference+=d/3;if(d>18)changed++;
 }
 return {time:best.time,meanPixelDifference:difference/(640*360),changedPixelPercent:changed/(640*360)*100,
  audible:live.features,silent:muted.features,samples,audiblePNG:live.png,silentPNG:muted.png};
}''',base64.b64encode((PROOF/'pelagic.wav').read_bytes()).decode())
 for key,name in [('audiblePNG','response-audible.png'),('silentPNG','response-silent.png')]:
  (PROOF/name).write_bytes(base64.b64decode(result.pop(key)))
 assert all(v==0 for v in result['silent'].values()),result['silent']
 assert result['meanPixelDifference']>5,result['meanPixelDifference']
 assert result['changedPixelPercent']>15,result['changedPixelPercent']
 assert result['audible']['bass']>.1,result['audible']
 (PROOF/'reactivity.json').write_text(json.dumps(result,indent=2)+'\n')
 print(json.dumps({k:v for k,v in result.items() if k!='samples'},indent=2))
 b.close()
