#!/usr/bin/env python3
"""Root task integration, with an owned offline host and a read-only conflict fixture."""
import functools,http.server,json,os,signal,socket,subprocess,sys,threading,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3];PROOF=ROOT/'spikes/pelagic/proof/session-launch'
PROOF.mkdir(parents=True,exist_ok=True)
BL=str(Path.home()/'.local/bin/bl')
def free_port():
 with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]
def sha(path):
 import hashlib
 return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None
vendor=[ROOT/'vendor/bl-ed/web/out/ed.main.mjs',ROOT/'vendor/bl-ed/web/pkg/pelagic.mjs']
before=[sha(p) for p in vendor]
port=free_port();report={'port':port,'checks':[]}
def task(*args,name="pelagic.dev"):
 start=time.monotonic();r=subprocess.run([BL,'--cold',name,'--',*args],cwd=ROOT,text=True,capture_output=True,timeout=120)
 return r,time.monotonic()-start
log=open(PROOF/'host.log','w')
host=subprocess.Popen([BL,'--cold','pelagic.dev','--','--port',str(port)],cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
try:
 deadline=time.monotonic()+180
 while time.monotonic()<deadline:
  if host.poll() is not None:raise RuntimeError((PROOF/'host.log').read_text())
  if 'Omega + PELAGIC' in (PROOF/'host.log').read_text():break
  time.sleep(.2)
 else:raise TimeoutError('Owned Omega host did not start')
 r,elapsed=task('--port',str(port))
 assert r.returncode==0 and 'already running' in r.stdout,(r.stdout,r.stderr)
 report['checks'].append({'compatibleHostReused':True,'commandSeconds':elapsed,'stdout':r.stdout})
 r,elapsed=task('--port',str(port),'--live')
 assert r.returncode!=0 and 'incompatible host' in r.stdout+r.stderr,(r.stdout,r.stderr)
 report['checks'].append({'differentHostModeRejected':True})
 class Handler(http.server.SimpleHTTPRequestHandler):
  def log_message(self,*args):pass
 fixture=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(PROOF)))
 threading.Thread(target=fixture.serve_forever,daemon=True).start()
 try:
  r,_=task('--port',str(fixture.server_port))
  assert r.returncode!=0 and 'incompatible host' in r.stdout+r.stderr,(r.stdout,r.stderr)
  report['checks'].append({'unrelatedListenerRejected':True})
 finally:fixture.shutdown();fixture.server_close()
 fixture=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT/'spikes/pelagic/dist/local')))
 threading.Thread(target=fixture.serve_forever,daemon=True).start()
 try:
  r,_=task('--port',str(fixture.server_port),name='pelagic.local')
  assert r.returncode==0 and 'demo already running' in r.stdout,(r.stdout,r.stderr)
  report['checks'].append({'compatibleStandaloneServerReused':True})
 finally:fixture.shutdown();fixture.server_close()
 env={**os.environ,'PELAGIC_SESSION_URL':f'http://127.0.0.1:{port}/?use=pelagic&layout=pelagic&file=spikes/pelagic/live-set.bl.org'}
 with open(PROOF/'browser.log','w') as output:
  subprocess.run([sys.executable,str(ROOT/'spikes/pelagic/test/session-browser.py')],cwd=ROOT,env=env,stdout=output,stderr=subprocess.STDOUT,check=True,timeout=240)
 assert [sha(p) for p in vendor]==before,'Launch modified installed vendor output'
 report['checks'].append({'vendorOutputUnchanged':True})
finally:
 if host.poll() is None:
  os.killpg(host.pid,signal.SIGTERM)
  try:host.wait(timeout=15)
  except subprocess.TimeoutExpired:os.killpg(host.pid,signal.SIGKILL);host.wait()
 log.close();(PROOF/'cli.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
