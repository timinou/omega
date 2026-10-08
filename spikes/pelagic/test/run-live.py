#!/usr/bin/env python3
"""Real-time soak or agent-operated set. Local control acts only on an offline editor.

soak: deterministic stress/rehearsal actions; never described as improvisation.
set: no musical action script; POST live choices to the local control endpoint.
"""
import argparse,base64,json,queue,threading,time,subprocess,traceback,os
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[3]
parser=argparse.ArgumentParser();parser.add_argument('--kind',choices=['soak','set'],required=True);parser.add_argument('--seconds',type=int,default=1200);parser.add_argument('--port',type=int,default=8813);args=parser.parse_args()
PROOF=ROOT/'spikes/pelagic/proof/performance'/args.kind;PROOF.mkdir(parents=True,exist_ok=True)
URL=os.environ.get('PELAGIC_URL','http://127.0.0.1:8812/?use=pelagic&layout=pelagic&file=spikes/pelagic/demo.bl.org')
if args.kind=='soak':
 fixture=ROOT/'spikes/pelagic/proof/performance/fixture.wav'
 if not fixture.exists():
  import wave,math,struct
  with wave.open(str(fixture),'wb') as output:
   output.setparams((1,2,22050,0,'NONE','not compressed'))
   output.writeframes(b''.join(struct.pack('<h',int(1500*math.sin(2*math.pi*110*i/22050))) for i in range(66150)))
commands=queue.Queue();status={'phase':'starting'}
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  data=json.dumps(status).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(data)
 def do_POST(self):
  try:
   command=json.loads(self.rfile.read(int(self.headers.get('Content-Length',0))));event=threading.Event();result={};commands.put((command,event,result))
   if not event.wait(45):raise TimeoutError('Browser action timed out')
   data=json.dumps(result).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(data)
  except Exception as e:
   self.send_response(500);self.end_headers();self.wfile.write(str(e).encode())
server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
report={'kind':args.kind,'requestedSeconds':args.seconds,'url':URL,'sourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'checkpoints':[],'actions':[],'errors':[]}
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path=os.environ.get('CHROMIUM','/home/user/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'),args=['--no-sandbox','--use-gl=angle','--use-angle=gl','--enable-gpu','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'])
 page=browser.new_page(viewport={'width':1440,'height':1200});page.on('pageerror',lambda e:report['errors'].append(str(e)))
 page.goto(URL);page.wait_for_function('document.querySelector(".view-host .view-body")?.pelagic',timeout=60000)
 Q='document.querySelector(".view-host .view-body").pelagic';page.evaluate(Q+'.ready()')
 page.get_by_role('button',name='▶ PERFORM',exact=True).click()
 page.locator('#input-sink').focus();page.keyboard.press('Control+Enter')
 page.wait_for_function(Q+'.stats().patterns.includes("melody")',timeout=30000)
 page.evaluate(Q+'.record()');page.wait_for_function(Q+'.stats().recording',timeout=15000)
 cdp=page.context.new_cdp_session(page);cdp.send('Performance.enable')
 report['renderer']=page.evaluate('''()=>{const g=document.querySelector('.view-host .view-body').pelagic.shader().gl,e=g.getExtension('WEBGL_debug_renderer_info');return e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):g.getParameter(g.RENDERER);}''')
 started=time.monotonic();next_checkpoint=0;next_action=20;number=0;last_metrics=0
 def operation(command):
  op=command.get('op');result={}
  if op=='eval':
   result=page.evaluate('(source)=>'+Q+'.evaluate(source)',command['source'])
  elif op=='edit':
   # Existing editor commands and keyboard input: edit the real buffer, then C-Enter.
   old=page.evaluate(Q+'.stats().evalCount');page.locator('#input-sink').focus();page.keyboard.press('Escape')
   page.evaluate('window.blEd.dispatch(window.blEd.R.hashMap(window.blEd.K("type"),window.blEd.K("command"),window.blEd.K("command"),window.blEd.K("select-all")))')
   page.keyboard.press('c');page.keyboard.insert_text('#+TITLE: PELAGIC / LIVE SET\n\n#+begin_src beam-lisp\n'+command['source']+'\n#+end_src\n')
   page.keyboard.press('Escape');page.keyboard.press('Control+Enter')
   page.wait_for_function(Q+f'.stats().lastEvaluation?.id>{old}',timeout=30000);result=page.evaluate(Q+'.stats().lastEvaluation')
  elif op=='request':result=page.evaluate('(request)=>'+Q+'.request(request)',command['request'])
  elif op=='import':
   deck=command.get('deck','a');page.get_by_label('Load audio into deck '+deck.upper()).set_input_files(command['file'])
   page.wait_for_function(Q+f'.decks().{deck}.hash',timeout=20000)
   page.evaluate('(deck)=>{const p='+Q+';p.decks()[deck].action("loop",8);p.decks()[deck].action("cue",0);}',deck);result={'ok':True}
  elif op=='clear':page.evaluate('(deck)=>'+Q+'.decks()[deck].action("clear",0)',command.get('deck','a'));result={'ok':True}
  elif op=='mix':
   page.get_by_role('slider',name=command['name'],exact=True).fill(str(command['value']));result={'ok':True}
  elif op=='shot':
   path=PROOF/(command.get('name','studio')+'.jpg');page.screenshot(path=str(path),type='jpeg',quality=85);result={'ok':True,'file':str(path)}
  elif op=='session':result=page.evaluate(Q+'.session()')
  else:raise ValueError('Unknown operation '+str(op))
  report['actions'].append({'elapsed':round(time.monotonic()-started,3),'command':command,'result':result})
  (PROOF/'actions.json').write_text(json.dumps(report['actions'],indent=2)+'\n');return result
 try:
  while time.monotonic()-started<args.seconds:
   elapsed=time.monotonic()-started
   try:
    command,event,result=commands.get_nowait()
    try:result.update(operation(command))
    except Exception as e:result.update({'ok':False,'error':str(e)});report['errors'].append(str(e))
    finally:event.set()
   except queue.Empty:pass
   if args.kind=='soak' and elapsed>=next_action:
    scene=['current','cathedral','afterglow','bathymetry'][number%4]
    source=f'(av/commit {{:quantize :bar :edits [(av/launch :{scene} {{:transition :{["crossfade","iris","dissolve"][number%3]} :beats 4}}) (av/variation {{:density {0.75 if number%2 else 1} :seed {37+number}}})]}})'
    operation({'op':'eval','source':source})
    if number%5==0:operation({'op':'eval','source':'(av/session (av/configure {:space 0.1}) (t/start "void main(){bad;}"))'})
    if number==1:operation({'op':'request','request':{'kind':'snapshot','name':'soak-home'}})
    if number%7==4:operation({'op':'request','request':{'kind':'gesture','name':'break'}})
    if number%7==5:operation({'op':'request','request':{'kind':'gesture','name':'drop'}})
    if number%12==3:operation({'op':'import','deck':'a','file':str(ROOT/'spikes/pelagic/proof/performance/fixture.wav')})
    if number%12==5:operation({'op':'clear','deck':'a'})
    if number%12==7:operation({'op':'request','request':{'kind':'undo'}})
    if number%12==8:operation({'op':'request','request':{'kind':'recall','name':'soak-home'}})
    if number%12==9:
     shader=(ROOT/'spikes/pelagic/shaders/pelagic.glsl').read_text()+'\n// prepared during live rehearsal\n'
     source='(av/session (av/scene :rehearsal {:shader '+json.dumps(shader)+' :mappings {:zoom {:signal [:stem :bass :level] :amount 0.2}}}) (av/launch :rehearsal))'
     operation({'op':'eval','source':source})
    number+=1;next_action+=25
   if elapsed>=next_checkpoint:
    # Consistent post-GC heap checkpoints; GC pauses remain included in timing metrics.
    cdp.send('HeapProfiler.collectGarbage');heap={x['name']:x['value'] for x in cdp.send('Performance.getMetrics')['metrics']}.get('JSHeapUsedSize')
    checkpoint={'elapsed':round(elapsed,3),'heapBytes':heap,'stats':page.evaluate(Q+'.stats()'),'metrics':page.evaluate(Q+'.diagnostics()')}
    report['checkpoints'].append(checkpoint);(PROOF/'progress.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'elapsed':round(elapsed),'heapMB':round(heap/1e6,2),'metrics':checkpoint['metrics']}),flush=True);next_checkpoint+=300
    page.screenshot(path=str(PROOF/f'studio-{int(elapsed):04d}.jpg'),type='jpeg',quality=80)
   if elapsed-last_metrics>=5:
    status={'phase':'running','kind':args.kind,'elapsed':round(elapsed,1),'remaining':round(args.seconds-elapsed,1),'stats':page.evaluate(Q+'.stats()'),'metrics':page.evaluate(Q+'.diagnostics()')}
    last_metrics=elapsed
   page.wait_for_timeout(100)
  cdp.send('HeapProfiler.collectGarbage');heap={x['name']:x['value'] for x in cdp.send('Performance.getMetrics')['metrics']}.get('JSHeapUsedSize')
  report['checkpoints'].append({'elapsed':round(time.monotonic()-started,3),'heapBytes':heap,'stats':page.evaluate(Q+'.stats()'),'metrics':page.evaluate(Q+'.diagnostics()')})
  manifest=page.evaluate(Q+'.stopRecording({save:false})');report['take']=manifest
  report['metrics']=page.evaluate(Q+'.diagnostics()');report['session']=page.evaluate(Q+'.session()');report['events']=page.evaluate(Q+'.events()')
  (PROOF/'session.pelagic.json').write_text(json.dumps(report['session'],indent=2)+'\n')
  if args.kind=='set':
   with (PROOF/'live.webm').open('wb') as output:
    page.expose_function('writeChunk',lambda raw:output.write(base64.b64decode(raw)))
    page.evaluate('''async()=>{const p=document.querySelector('.view-host .view-body').pelagic;
     await p.exportRecording({write:async blob=>{const bytes=new Uint8Array(await blob.arrayBuffer());let s='';for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));await window.writeChunk(btoa(s));},close:async()=>{}});
    }''')
  before=page.evaluate('window.blEd.R.printStr(window.blEd.state().get(window.blEd.K("text")))')
  page.evaluate('window.oldEngine='+Q+'.engine();window.oldShader='+Q+'.shader();')
  page.locator('#input-sink').focus();page.keyboard.press('Escape');page.keyboard.press(':');page.keyboard.insert_text('(ed/unuse "pelagic")');page.keyboard.press('Enter')
  page.wait_for_function('window.oldEngine.ctx.state==="closed"');assert page.evaluate('window.oldEngine.disposed&&window.oldShader.disposed')
  assert before==page.evaluate('window.blEd.R.printStr(window.blEd.state().get(window.blEd.K("text")))')
  page.screenshot(path=str(PROOF/'unused.jpg'),type='jpeg',quality=85)
  report['duration']=time.monotonic()-started;report['unuse']='source retained; audio closed; graphics disposed'
  m=report['metrics'];timing=m['audioTiming'];report['gates']={
   'duration':manifest['duration']>=args.seconds,
   'audioDeadlines':m['missedEvents']==0,
   'nativeClockProgress':.99<=(m.get('audioClock') or {}).get('rate',0)<=1.01,
   'frameP95':m['frameP95']<=40,
   'frameLongIntervals':m['framesOver100Percent']<1,
   'AVSubmit':m['avSubmitP95Ms'] is not None and m['avSubmitP95Ms']<=50,
   'sampleProbe':timing['samples']>0 and timing['p95Ms']<=5 and timing['maxMs']<=15,
   'boundedResources':m['history']<=32 and m['namespaces']==0 and m['gpu']['targets']==3 and m['gpu']['programs']<=11,
   'boundedRecording':all((c['metrics'].get('recording') or {}).get('pendingBytes',0)<=16*1024*1024 for c in report['checkpoints'])}
  late=[c for c in report['checkpoints'] if c['elapsed']>=900]
  if len(late)>1:report['heapGrowthPercent']=(late[-1]['heapBytes']/late[0]['heapBytes']-1)*100;report['gates']['heapPlateau']=report['heapGrowthPercent']<10
  report['status']='passed' if not report['errors'] and all(report['gates'].values()) else 'needs-review'
 except Exception as e:
  report['errors'].append(str(e));report['traceback']=traceback.format_exc();report['status']='failed';print(report['traceback'],flush=True)
 finally:
  status={'phase':'complete','status':report.get('status'),'kind':args.kind}
  (PROOF/'report.json').write_text(json.dumps(report,indent=2)+'\n');browser.close();server.shutdown()
 print(json.dumps({'status':report['status'],'duration':report.get('duration'),'metrics':report.get('metrics'),'errors':report['errors']},indent=2),flush=True)
 if report['status']!='passed':raise SystemExit(1)
