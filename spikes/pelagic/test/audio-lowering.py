#!/usr/bin/env python3
"""Compare native DSP lowering against the committed interpreter, including ctl."""
import os,json,threading,http.server,functools,subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'spikes/pelagic/dist/local'
PROOF=ROOT/'spikes/pelagic/proof/realtime';PROOF.mkdir(parents=True,exist_ok=True)
BASELINE=subprocess.check_output(['git','show','fdd32b4:spikes/pelagic/host/audio.mjs'],cwd=ROOT)
class Handler(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  if self.path in ['/blank.html','/pkg/pelagic/audio-baseline.mjs']:
   data=b'<!doctype html><title>Native DSP proof</title>' if self.path=='/blank.html' else BASELINE
   self.send_response(200);self.send_header('Content-Type','text/html' if self.path=='/blank.html' else 'text/javascript');self.end_headers();self.wfile.write(data)
  else:super().do_GET()
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(OUT)));threading.Thread(target=server.serve_forever,daemon=True).start()
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(headless=True,executable_path=os.environ.get('CHROMIUM','/home/user/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'),args=['--no-sandbox'])
  page=browser.new_page();page.goto(f'http://127.0.0.1:{server.server_port}/blank.html')
  report=page.evaluate('''async()=>{
   const [{AudioEngine:Before},{AudioEngine:After},S,J]=await Promise.all([import('/pkg/pelagic/audio-baseline.mjs'),import('/pkg/pelagic/audio.mjs'),import('/out/pelagic.score.mjs'),import('/out/interop.mjs')]);
   const plans=[];for(let i=128;i<160;i++)for(const voice of J.blToJS(S.d_step(i,S.d_defaults)))plans.push({voice,time:.12+(i-128)*60/122/4});
   async function render(Engine){const ctx=new OfflineAudioContext(2,44100*12,44100),engine=new Engine(ctx);let controlled=false;
    for(const {voice,time}of structuredClone(plans)){const id=engine.trigger(voice,time);if(!controlled&&voice.synth==='lantern'){engine.ctl(id,{amp:.031,freq:500},time+.5);controlled=true;}}
    const nodes=engine.resources().nodes,voices=engine.resources().voices,buffer=await ctx.startRendering();engine.dispose();return {buffer,nodes,voices,controlled};}
   const before=await render(Before),after=await render(After);let max=0,energy=0,error=0;
   for(let channel=0;channel<2;channel++){const a=before.buffer.getChannelData(channel),b=after.buffer.getChannelData(channel);for(let i=0;i<a.length;i++){const d=a[i]-b[i];max=Math.max(max,Math.abs(d));energy+=a[i]*a[i];error+=d*d;}}
   return {baseline:'fdd32b4',voices:after.voices,nodesBefore:before.nodes,nodesAfter:after.nodes,nodeReductionPercent:100*(1-after.nodes/before.nodes),maxSampleDifference:max,relativeRMSError:Math.sqrt(error/energy),controlled:before.controlled&&after.controlled};
  }''')
  assert report['controlled'];assert report['nodesAfter']<=report['nodesBefore'];assert report['maxSampleDifference']<.0002,report;assert report['relativeRMSError']<.00001,report
  (PROOF/'audio-lowering.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2));browser.close()
finally:server.shutdown();server.server_close()
