#!/usr/bin/env python3
"""Publish uncut phone proof plus labelled, mastered listening copies/excerpt."""
from pathlib import Path
import subprocess,json,hashlib,csv,sys
root=Path(__file__).resolve().parents[3];proof=root/'spikes/pelagic/proof/performance/set';source=proof/'live.webm'
mobile=proof/'mobile';mobile.mkdir(parents=True,exist_ok=True)
def ff(*args):subprocess.run(['ffmpeg','-y','-v','error','-threads','2',*map(str,args)],check=True)
def packet_timeline(path):
 # Streaming MediaRecorder WebM has no duration header. Read packet clocks instead.
 process=subprocess.Popen(['ffprobe','-v','error','-show_entries','packet=stream_index,pts_time,duration_time','-of','csv=p=0',str(path)],stdout=subprocess.PIPE,text=True)
 streams={}
 for row in csv.reader(process.stdout):
  try:index=int(row[0]);pts=float(row[1]);duration=float(row[2]) if len(row)>2 and row[2]!='N/A' else 0.
  except (ValueError,IndexError):continue
  s=streams.setdefault(index,{'packets':0,'durationSumSeconds':0.,'endSeconds':0.,'positiveTimestampDeviationsSeconds':0.,'positiveTimestampDeviations':0,'lastEnd':None})
  if s['lastEnd'] is not None and pts-s['lastEnd']>.003:s['positiveTimestampDeviationsSeconds']+=pts-s['lastEnd'];s['positiveTimestampDeviations']+=1
  s['packets']+=1;s['durationSumSeconds']+=duration;s['endSeconds']=max(s['endSeconds'],pts+duration);s['lastEnd']=pts+duration
 if process.wait():raise RuntimeError('Cannot inspect recording packets')
 for s in streams.values():s.pop('lastEnd')
 return {'duration':max(s['endSeconds'] for s in streams.values()),'streams':streams,'interpretation':'Positive timestamp deviations are not a dropout count: negative deviations may overlap them. Video packet durations are container hints, not held-frame durations. Audio duration sums describe the encoded sample stream; its wall-clock span can differ.'}
timeline=packet_timeline(source)
probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',str(source)]))
audioIndex=next(s['index'] for s in probe['streams'] if s['codec_type']=='audio')
audioSeconds=timeline['streams'][audioIndex]['durationSumSeconds'];fadeStart=max(0,audioSeconds-12)
listeningFilter=f'asetpts=N/SR/TB,volume=3dB,afade=t=out:st={fadeStart}:d=12'
if '--check-only' not in sys.argv:
 if '--reuse-full' not in sys.argv:
  ff('-i',source,'-vf','scale=480:270,fps=24','-c:v','libx264','-preset','medium','-crf','32','-maxrate','200k','-bufsize','400k','-threads','2','-pix_fmt','yuv420p','-c:a','aac','-b:a','96k','-movflags','+faststart',mobile/'pelagic-full.mp4')
 ff('-i',source,'-vn','-af',listeningFilter,'-c:a','aac','-b:a','96k','-movflags','+faststart',mobile/'pelagic-live.m4a')
 ff('-i',source,'-vn','-af',listeningFilter,'-c:a','libmp3lame','-b:a','128k',mobile/'pelagic-live.mp3')
 ff('-ss','1020','-i',source,'-t','180','-vf','scale=640:360,fps=24,fade=t=out:st=178:d=2','-c:v','libx264','-preset','medium','-crf','31','-maxrate','240k','-bufsize','480k','-threads','2','-pix_fmt','yuv420p','-c:a','aac','-b:a','112k','-af','volume=3dB,afade=t=out:st=170:d=10','-movflags','+faststart',mobile/'pelagic-highlight.mp4')
 ff('-i',mobile/'pelagic-full.mp4','-map','0','-c','copy','-f','segment','-segment_time','300','-segment_format','mp4','-segment_format_options','movflags=+faststart','-reset_timestamps','1','-segment_list',mobile/'parts.csv',mobile/'pelagic-part-%02d.mp4')
files=[source,*sorted(path for path in mobile.glob('*') if path.suffix in ['.mp4','.m4a','.mp3'])]
manifest={'capture':'actual live mix and stage; original and full phone video uncut and without level edits','packetTimeline':timeline,
 'highlight':{'startSeconds':1020,'durationSeconds':180,'editorialChanges':'3 dB gain, last 10 seconds audio fade, last 2 seconds video fade'},
 'listeningCopies':{'files':['pelagic-live.m4a','pelagic-live.mp3'],'editorialChanges':'continuous encoded audio samples with timestamps reset, 3 dB gain and 12-second ending fade','fadeStartSeconds':fadeStart},
 'parts':{'method':'Full phone video split at keyframes near five-minute boundaries; copied streams, local timestamps reset','segments':[{'file':row[0],'startSeconds':float(row[1]),'endSeconds':float(row[2])} for row in csv.reader((mobile/'parts.csv').open())] if (mobile/'parts.csv').exists() else []},'files':{}}
for path in files:
 probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(path)]))
 subprocess.run(['ffmpeg','-v','error','-threads','2','-i',str(path),'-f','null','-'],check=True)
 digest=hashlib.sha256()
 with path.open('rb') as stream:
  for chunk in iter(lambda:stream.read(1024*1024),b''):digest.update(chunk)
 duration=float(probe['format'].get('duration',timeline['duration']))
 manifest['files'][str(path.relative_to(root))]={'bytes':path.stat().st_size,'sha256':digest.hexdigest(),'duration':duration,'streams':[{k:s.get(k) for k in ['codec_type','codec_name','width','height','sample_rate','channels']} for s in probe['streams']],'fullDecode':'passed'}
(proof/'media.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps(manifest,indent=2))
