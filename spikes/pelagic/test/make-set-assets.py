#!/usr/bin/env python3
"""Original seamless D-minor field and an eight-beat loop from our own score."""
from pathlib import Path
import wave,math,struct,subprocess
root=Path(__file__).resolve().parents[3];proof=root/'spikes/pelagic/proof/performance/assets';proof.mkdir(parents=True,exist_ok=True)
sr=44100;n=round(sr*8*60/122)
cycles=[round(f*n/sr) for f in [146.8324,174.6141,220.0,293.6648]]
with wave.open(str(proof/'deep-field.wav'),'wb') as out:
 out.setparams((2,2,sr,0,'NONE','not compressed'))
 for begin in range(0,n,4096):
  frames=[]
  for i in range(begin,min(n,begin+4096)):
   left=sum(math.sin(2*math.pi*k*i/n+j*.2)*(.017 if j<3 else .005) for j,k in enumerate(cycles))
   right=sum(math.sin(2*math.pi*k*i/n+j*.5)*(.017 if j<3 else .005) for j,k in enumerate(cycles))
   frames.append(struct.pack('<hh',round(left*32767),round(right*32767)))
  out.writeframesraw(b''.join(frames))
score=root/'spikes/pelagic/proof/club/pelagic.wav'
if not score.exists():raise SystemExit('Render the original score first with test/film.py')
subprocess.run(['ffmpeg','-y','-v','error','-ss','39.344262','-i',str(score),'-t','3.934426','-c:a','pcm_s16le',str(proof/'current-loop.wav')],check=True)
