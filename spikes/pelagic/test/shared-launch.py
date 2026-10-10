#!/usr/bin/env python3
"""First-ever shared task, preset reuse and graceful stop in a private runtime."""
import http.client,json,os,signal,socket,subprocess,tempfile,time,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
LAUNCHER=os.environ.get('PELAGIC_LAUNCHER',str(Path.home()/'.local/bin/bl'))
PROOF=Path(os.environ.get('PELAGIC_SHARED_LAUNCH_PROOF',ROOT/'spikes/pelagic/proof/shared-launch'));PROOF.mkdir(parents=True,exist_ok=True)
with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
with tempfile.TemporaryDirectory(prefix='omega-shared-launch-') as d:
 runtime=Path(d)/'runtime';runtime.mkdir(mode=0o700)
 env={**os.environ,'XDG_RUNTIME_DIR':str(runtime),'XDG_STATE_HOME':str(Path(d)/'state'),'BL_GATEWAY':'off'}
 samples=[]
 watch_probe=ROOT/"vendor/bl-ed/web/omega-watch-proof.css"
 assert not watch_probe.exists(),str(watch_probe)
 watch_probe_owned=False
 def task(name,*args):
  start=time.perf_counter();r=subprocess.run([LAUNCHER,name,'--',*args],cwd=ROOT,env=env,text=True,capture_output=True,timeout=1800)
  (PROOF/(name+'.log')).write_text(r.stdout+r.stderr)
  assert r.returncode==0,(name,r.returncode,r.stdout,r.stderr)
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
  connection=http.client.HTTPConnection('127.0.0.1',port,timeout=10)
  connection.request('GET','/',headers={'Host':'pelagic.dev'});response=connection.getresponse()
  assert response.status==307 and 'use=pelagic' in response.getheader('Location'),response.status
  response.read();connection.close()
  task('omega.watch')
  def candidate(previous=None):
   deadline=time.monotonic()+600
   while time.monotonic()<deadline:
    r=task('omega.watch')
    status=next((json.loads(line[len('Frontend watch: '):]) for line in r.stdout.splitlines() if line.startswith('Frontend watch: ')),{})
    if status.get('status')=='held':raise RuntimeError(status)
    if status.get('status')=='ready' and status.get('candidate',{}).get('generation')!=previous:return status['candidate']
    time.sleep(1)
   raise TimeoutError(status)
  first_candidate=candidate()
  watch_probe.write_text('/* Owned watch proof: asset-only edit. */\n');watch_probe_owned=True
  latest=candidate(first_candidate['generation'])
  assert latest['generation']!=first_candidate['generation']
  base_files=ROOT/'spikes/pelagic/dist/frontend'/first_candidate['generation']
  next_files=ROOT/'spikes/pelagic/dist/frontend'/latest['generation']
  for relative in ['build.json','out/dependencies.json','pkg/pelagic/actor/out/prepare.mjs']:
   assert (base_files/relative).read_bytes()==(next_files/relative).read_bytes(),relative
  for offered in [first_candidate,latest]:
   with urllib.request.urlopen(offered['url'],timeout=10) as response:assert response.status==200
  with urllib.request.urlopen(latest['url']+'omega-watch-proof.css',timeout=10) as response:assert b'Owned watch proof' in response.read()
  candidate_proof=PROOF/'candidate';candidate_proof.mkdir(exist_ok=True)
  with (candidate_proof/'browser.log').open('w') as output:
   subprocess.run(['python3',str(ROOT/'spikes/pelagic/test/session-browser.py')],cwd=ROOT,
    env={**env,'PELAGIC_SESSION_URL':latest['url']+'?use=pelagic&layout=pelagic&file=spikes/pelagic/live-set.bl.org',
         'PELAGIC_SESSION_PROOF':str(candidate_proof)},stdout=output,stderr=subprocess.STDOUT,check=True,timeout=300)
  task('omega.watch.stop')
  with urllib.request.urlopen(latest['url'],timeout=10) as response:assert response.status==200
  watch_probe.unlink();watch_probe_owned=False
  task('pelagic.bundle');assert owners()==initial,owners()
  task('omega.stop');assert owners()==initial,owners()
  with socket.socket() as s:assert s.connect_ex(('127.0.0.1',port))!=0,'Listener survived stop'
  restart_started=time.perf_counter()
  restarted=subprocess.run([LAUNCHER,'realm','restart'],cwd=ROOT,env=env,text=True,capture_output=True,timeout=120)
  (PROOF/'realm-restart.log').write_text(restarted.stdout+restarted.stderr)
  assert restarted.returncode==0,(restarted.stdout,restarted.stderr)
  assert owners()==initial,owners()
  task('pelagic.dev','--port',str(port));assert owners()==initial,owners()
  with urllib.request.urlopen(f'http://127.0.0.1:{port}/',timeout=10) as response:assert response.status==200
  restart_ms=1000*(time.perf_counter()-restart_started)
  task('omega.stop')
  result={'oneSharedOwner':True,'presetsReuseWorld':True,'gracefulStop':True,'hostPresetRedirect':True,'assetEditReusesGraph':True,'immutableCandidates':[first_candidate,latest],'watchStopPreservesCandidate':True,'candidateTwoAudibleSessions':True,'realmRestartPreservesSharedOwner':True,'realmRestartAndHostMs':restart_ms,'samples':samples}
  (PROOF/'shared.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
 finally:
  for index,log in enumerate(Path(d).rglob('*.log')):
   (PROOF/f'owner-{index}.log').write_text(log.read_text(errors='replace'))
  if watch_probe_owned:watch_probe.unlink(missing_ok=True)
  owned=owners()
  for pid in owned:
   try:os.kill(pid,signal.SIGTERM)
   except ProcessLookupError:pass
  deadline=time.monotonic()+5
  while owners() and time.monotonic()<deadline:time.sleep(.05)
  for pid in owners():
   try:os.kill(pid,signal.SIGKILL)
   except ProcessLookupError:pass
