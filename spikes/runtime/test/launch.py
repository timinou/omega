import os,json,signal,socket,subprocess,tempfile,time,urllib.request
from pathlib import Path
root=Path(__file__).resolve().parents[3];proof=root/'spikes/runtime/proof'
with tempfile.TemporaryDirectory(prefix='runtime-launch-') as temp:
 runtime=Path(temp)/'runtime';runtime.mkdir(mode=0o700)
 with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
 env={**os.environ,'BL_GATEWAY':'off','XDG_RUNTIME_DIR':str(runtime),'XDG_STATE_HOME':temp+'/state'}
 with (proof/'launch.log').open('w') as output:
  child=subprocess.Popen([str(root/'bin/bl'),'--cold','runtime.dev','--','--port',str(port)],cwd=root,env=env,stdout=output,stderr=subprocess.STDOUT,start_new_session=True)
  try:
   deadline=time.monotonic()+360;base=f'http://127.0.0.1:{port}'
   while True:
    if child.poll() is not None:raise RuntimeError((proof/'launch.log').read_text())
    try:
     with urllib.request.urlopen(base+'/pkg/runtime.mjs',timeout=1) as r:
      if r.status==200:break
    except OSError:pass
    if time.monotonic()>deadline:raise TimeoutError((proof/'launch.log').read_text())
    time.sleep(.2)
   req=urllib.request.Request(base+'/api/intent',data=json.dumps({'intent':'runtime/snapshot','args':{}}).encode(),headers={'Content-Type':'application/json'})
   with urllib.request.urlopen(req,timeout=15) as r:data=json.load(r)
   assert data.get('ok') is True,data
   assert data['schema']=='omega.runtime.v1',data
   (proof/'launch.json').write_text(json.dumps({'command':'bin/bl --cold runtime.dev -- --port <private>','package':True,'native-snapshot':True,'port':port,'live-world-touched':False},indent=2)+'\n')
   print('Root runtime.dev: package module and native snapshot PASS',flush=True)
  finally:
   try:os.killpg(child.pid,signal.SIGTERM);child.wait(timeout=10)
   except ProcessLookupError:pass
   except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);child.wait()
