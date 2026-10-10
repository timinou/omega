#!/usr/bin/env python3
"""First-ever shared task, preset reuse and graceful stop in a private runtime."""
import json,os,signal,socket,subprocess,tempfile,time,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
LAUNCHER=os.environ.get('PELAGIC_LAUNCHER',str(Path.home()/'.local/bin/bl'))
PROOF=ROOT/'spikes/pelagic/proof/shared-launch';PROOF.mkdir(parents=True,exist_ok=True)
with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
with tempfile.TemporaryDirectory(prefix='omega-shared-launch-') as d:
 runtime=Path(d)/'runtime';runtime.mkdir(mode=0o700)
 env={**os.environ,'XDG_RUNTIME_DIR':str(runtime),'XDG_STATE_HOME':str(Path(d)/'state')}
 samples=[]
 def task(name,*args):
  start=time.perf_counter();r=subprocess.run([LAUNCHER,name,'--',*args],cwd=ROOT,env=env,text=True,capture_output=True,timeout=1800)
  (PROOF/(name+'.log')).write_text(r.stdout+r.stderr)
  assert r.returncode==0,(name,r.stdout,r.stderr)
  samples.append({'task':name,'ms':1000*(time.perf_counter()-start),'stdout':r.stdout})
  return r
 def owners():
  found=[]
  for p in Path('/proc').iterdir():
   if not p.name.isdigit():continue
   try:
    if f'XDG_RUNTIME_DIR={runtime}'.encode()+b'\0' in (p/'environ').read_bytes() and b'BeamLisp' in (p/'cmdline').read_bytes():found.append(int(p.name))
   except (FileNotFoundError,PermissionError,ProcessLookupError):pass
  return found
 try:
  task('pelagic.dev','--port',str(port));initial=owners();assert len(initial)==1,initial
  with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/doc?path=launch:identity',timeout=5) as r:identity=json.loads(r.read())['text']
  for name,view in [('spikes.pelagic.dev','00-start.bl.org'),('omega.dev','package:catalog')]:
   r=task(name,'--port',str(port));assert view in r.stdout,r.stdout;assert owners()==initial,owners()
   with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/doc?path=launch:identity',timeout=5) as r:assert json.loads(r.read())['text']==identity
  for i in range(30):
   task('pelagic.dev','--port',str(port));assert owners()==initial,owners()
  task('omega.stop');assert owners()==initial,owners()
  with socket.socket() as s:assert s.connect_ex(('127.0.0.1',port))!=0,'Listener survived stop'
  result={'oneSharedOwner':True,'presetsReuseWorld':True,'gracefulStop':True,'samples':samples}
  (PROOF/'shared.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
 finally:
  owned=owners()
  for pid in owned:
   try:os.kill(pid,signal.SIGTERM)
   except ProcessLookupError:pass
  deadline=time.monotonic()+5
  while owners() and time.monotonic()<deadline:time.sleep(.05)
  for pid in owners():
   try:os.kill(pid,signal.SIGKILL)
   except ProcessLookupError:pass
