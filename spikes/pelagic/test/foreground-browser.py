#!/usr/bin/env python3
"""One foreground VM, the shared frontend, real editor/audio and session teardown."""
import json,os,shutil,signal,socket,subprocess,tempfile,time,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
PROOF=Path(os.environ.get('PELAGIC_FOREGROUND_PROOF',ROOT/'spikes/pelagic/proof/foreground-session'));PROOF.mkdir(parents=True,exist_ok=True)
with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
with tempfile.TemporaryDirectory(prefix='omega-foreground-') as d:
 world=Path(d)/'world';documents=world/'spikes/pelagic';documents.mkdir(parents=True)
 for name in ['live-set.bl.org','demo.bl.org']:shutil.copy2(ROOT/'spikes/pelagic'/name,documents/name)
 shutil.copytree(ROOT/'spikes/pelagic/tutorials',documents/'tutorials')
 runtime=Path(d)/'runtime';runtime.mkdir(mode=0o700)
 env={**os.environ,'XDG_RUNTIME_DIR':str(runtime),'XDG_STATE_HOME':str(Path(d)/'state'),'BL_GATEWAY':'off'}
 started=time.monotonic()
 with (PROOF/'host.log').open('w') as log:
  host=subprocess.Popen([str(ROOT/'bin/bl-ed'),'--offline','--memory','--port',str(port),'--root',str(world)],cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
  try:
   deadline=time.monotonic()+240
   while True:
    if host.poll() is not None:raise RuntimeError((PROOF/'host.log').read_text())
    try:
     with urllib.request.urlopen(f'http://127.0.0.1:{port}/',timeout=1) as response:
      if response.status==200:break
    except (OSError,TimeoutError):pass
    if time.monotonic()>deadline:raise TimeoutError((PROOF/'host.log').read_text())
    time.sleep(.1)
   startup=1000*(time.monotonic()-started)
   base=f'http://127.0.0.1:{port}/'
   for script,extra in [
    ('browser.py',{'PELAGIC_URL':base+'?use=pelagic&layout=pelagic&file=spikes/pelagic/demo.bl.org','PELAGIC_PROOF':str(PROOF/'browser')}),
    ('session-browser.py',{'PELAGIC_SESSION_URL':base+'?use=pelagic&layout=pelagic&file=spikes/pelagic/live-set.bl.org','PELAGIC_SESSION_PROOF':str(PROOF/'sessions')})]:
    with (PROOF/(script+'.log')).open('w') as output:
     subprocess.run(['python3',str(ROOT/'spikes/pelagic/test'/script)],cwd=ROOT,env={**env,**extra},stdout=output,stderr=subprocess.STDOUT,check=True,timeout=300)
   result={'foreground':True,'startupMs':startup,'world':str(world),'port':port,'realEditor':True,'twoAudibleSessions':True}
   (PROOF/'foreground.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
  finally:
   if host.poll() is None:
    os.killpg(host.pid,signal.SIGTERM)
    try:host.wait(timeout=5)
    except subprocess.TimeoutExpired:os.killpg(host.pid,signal.SIGKILL);host.wait()
