#!/usr/bin/env python3
"""Compress the actual uncut live capture and a clearly labelled 150-second excerpt."""
from pathlib import Path
import subprocess,json,hashlib
root=Path(__file__).resolve().parents[3];proof=root/'spikes/pelagic/proof/performance/set';source=proof/'live.webm'
mobile=proof/'mobile';mobile.mkdir(parents=True,exist_ok=True)
def ff(*args):subprocess.run(['ffmpeg','-y','-v','error',*map(str,args)],check=True)
ff('-i',source,'-vf','scale=480:270,fps=24','-c:v','libx264','-preset','medium','-crf','32','-maxrate','200k','-bufsize','400k','-threads','2','-pix_fmt','yuv420p','-c:a','aac','-b:a','96k','-movflags','+faststart',mobile/'pelagic-full.mp4')
ff('-i',source,'-vn','-c:a','aac','-b:a','96k','-movflags','+faststart',mobile/'pelagic-live.m4a')
ff('-i',source,'-vn','-c:a','libmp3lame','-b:a','128k',mobile/'pelagic-live.mp3')
ff('-ss','465','-i',source,'-t','150','-vf','scale=640:360,fps=24','-c:v','libx264','-preset','medium','-crf','29','-threads','2','-pix_fmt','yuv420p','-c:a','aac','-b:a','112k','-movflags','+faststart',mobile/'pelagic-highlight.mp4')
files=[source,*sorted(mobile.glob('*'))];manifest={'capture':'actual live mix and stage; uncut original and full phone copy','highlight':{'startSeconds':465,'durationSeconds':150},'files':{}}
for path in files:
 probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(path)]))
 # Decode every frame and audio packet, not just inspect the container header.
 subprocess.run(['ffmpeg','-v','error','-i',str(path),'-f','null','-'],check=True)
 digest=hashlib.sha256()
 with path.open('rb') as stream:
  for chunk in iter(lambda:stream.read(1024*1024),b''):digest.update(chunk)
 manifest['files'][str(path.relative_to(root))]={'bytes':path.stat().st_size,'sha256':digest.hexdigest(),'duration':float(probe['format']['duration']),'streams':[{k:s.get(k) for k in ['codec_type','codec_name','width','height','sample_rate','channels']} for s in probe['streams']],'fullDecode':'passed'}
(proof/'media.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps(manifest,indent=2))
