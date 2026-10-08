#!/usr/bin/env python3
"""Render the actual package shader against its actual BL-generated soundtrack."""
import os,base64,json,math,subprocess,time
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[3];PROOF=ROOT/os.environ.get('PELAGIC_PROOF','spikes/pelagic/proof/club');PROOF.mkdir(parents=True,exist_ok=True)
FRAMES=Path(os.environ.get('PELAGIC_FRAMES','/tmp/omega-pelagic-club-film-jpeg'));FRAMES.mkdir(exist_ok=True)
FPS=int(os.environ.get('PELAGIC_FPS','24'));WIDTH=960;HEIGHT=540
URL=os.environ.get('PELAGIC_URL','http://127.0.0.1:8812/?use=pelagic&layout=pelagic&file=spikes/pelagic/demo.bl.org')
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path=os.environ.get('CHROMIUM','/home/user/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'),args=['--no-sandbox','--use-gl=angle','--use-angle='+os.environ.get('PELAGIC_ANGLE','gl'),'--enable-gpu','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'])
 page=b.new_page(viewport={'width':1440,'height':1080});page.expose_function('filmProgress',lambda x: print('audio window',x,flush=True));page.goto(URL)
 page.wait_for_function('window.blEd && document.querySelector(".view-host .view-body")?.pelagic',timeout=60000)
 page.evaluate('document.querySelector(".view-host .view-body").pelagic.ready()')
 # One real OfflineAudioContext renders every UGen and effect in the BL score.
 print('Rendering original score…',flush=True)
 cached_audio=(PROOF/'pelagic.wav').exists() and not os.environ.get('PELAGIC_AUDIO_REDO')
 if cached_audio:
  print('Using the rendered score cache',flush=True)
  raw=base64.b64encode((PROOF/'pelagic.wav').read_bytes()).decode()
  result=page.evaluate('''async raw=>{const bytes=Uint8Array.from(atob(raw),c=>c.charCodeAt(0));const ctx=new AudioContext();window.filmAudio=await ctx.decodeAudioData(bytes.buffer);await ctx.close();
   const b=window.filmAudio,a=b.getChannelData(0);let peak=0,sum=0;for(const x of a){peak=Math.max(peak,Math.abs(x));sum+=x*x;}return {duration:b.duration,peak,rms:Math.sqrt(sum/a.length),sampleRate:b.sampleRate};}''',raw)
 else:
  result=page.evaluate('''async()=>{const p=document.querySelector('.view-host .view-body').pelagic;window.filmAudio=await p.renderAudio(undefined,{onProgress:x=>window.filmProgress(x)});
  const b=window.filmAudio,a=b.getChannelData(0);let peak=0,sum=0;for(const x of a){peak=Math.max(peak,Math.abs(x));sum+=x*x;}
  const bytes=new Uint8Array(p.wav(b));let s='';for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));
  return {wav:btoa(s),duration:b.duration,peak,rms:Math.sqrt(sum/a.length),sampleRate:b.sampleRate};}''')
  (PROOF/'pelagic.wav').write_bytes(base64.b64decode(result.pop('wav')))
 bpm=page.evaluate('document.querySelector(".view-host .view-body").pelagic.config().bpm')
 total=math.ceil(result['duration']*FPS);began=time.time()
 print(json.dumps(result),flush=True)
 # Freeze the UI's clock; each proof frame draws the same owned ShaderStage.
 page.evaluate('window.blEd.dispatch(window.blEd.R.hashMap(window.blEd.K("type"),window.blEd.K("pelagic/control"),window.blEd.K("control"),"freeze",window.blEd.K("value"),true));')
 for i in range(total):
  path=FRAMES/f'{i:06d}.jpg'
  if path.exists() and not os.environ.get('PELAGIC_REDO'):continue
  data=page.evaluate('''({time,width,height})=>{const p=document.querySelector('.view-host .view-body').pelagic;
   p.renderAt(time,{width,height,analyser:p.soundtrackAnalysis(window.filmAudio,time)});
   return p.shader().canvas.toDataURL('image/jpeg',.96).split(',')[1];}''',{'time':i/FPS,'width':WIDTH,'height':HEIGHT})
  path.write_bytes(base64.b64decode(data))
  if i%120==0:print(f'frame {i}/{total} · {time.time()-began:.1f}s',flush=True)
 # Musical scene frames use the actual soundtrack FFT, not a paused live analyser.
 for act,bar in enumerate([10,22,38,57]):
  data=page.evaluate('''({time,width,height})=>{const p=document.querySelector('.view-host .view-body').pelagic;
   p.renderAt(time,{width,height,analyser:p.soundtrackAnalysis(window.filmAudio,time)});
   return p.shader().canvas.toDataURL('image/png').split(',')[1];}''',{'time':(bar*4+.12)*60/bpm,'width':WIDTH,'height':HEIGHT})
  (PROOF/f'scene-{act+1}.png').write_bytes(base64.b64decode(data))
 b.close()
(PROOF/'film.json').write_text(json.dumps({**result,'fps':FPS,'frames':total,'width':WIDTH,'height':HEIGHT,'method':'actual package ShaderStage + FFT of actual OfflineAudioContext score','renderSeconds':time.time()-began,'audioCache':bool(cached_audio),'frameEncoding':'JPEG quality .96'},indent=2))
font='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
act=64*60/bpm
labels=[('BATHYMETRY','a signal beneath the surface',0,act),('CURRENT','the water remembers a pulse',act,act*2),('CATHEDRAL','architecture made of resonance',act*2,act*3),('AFTERGLOW','everything returns as light',act*3,result['duration'])]
filters=[f"drawtext=fontfile={font}:text='P E L A G I C':fontsize=13:fontcolor=0xa4c4c4:x=38:y=28"]
for name,subtitle,start,end in labels:
 filters += [f"drawtext=fontfile={font}:text='{name}':fontsize=26:fontcolor=0xd4e4df:x=38:y=h-84:enable='between(t,{start},{end})'",f"drawtext=fontfile={font}:text='{subtitle}':fontsize=12:fontcolor=0x91afb2:x=40:y=h-46:enable='between(t,{start},{end})'"]
filters += [f"fade=t=out:st={result['duration']-6}:d=6"]
subprocess.run(['ffmpeg','-hide_banner','-y','-framerate',str(FPS),'-i',str(FRAMES/'%06d.jpg'),'-i',str(PROOF/'pelagic.wav'),'-vf',','.join(filters),'-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','256k','-movflags','+faststart','-shortest',str(PROOF/'pelagic.mp4')],check=True)
print('Complete:',PROOF/'pelagic.mp4',flush=True)
