#!/usr/bin/env python3
"""Real editor workbench tour. Offline demo only; keyboard/pointer and HTTP assertions."""
import argparse,json,os,pathlib,subprocess,time
p=argparse.ArgumentParser();p.add_argument('--port',type=int,default=8801);p.add_argument('--slice',type=int,default=1);a=p.parse_args()
if a.port==8790:raise SystemExit('Refusing live world')
repo=pathlib.Path(__file__).resolve().parents[3];proof=repo/'spikes/workspace/proof';session='omega-desk'
if not os.environ.get('AGENT_BROWSER_EXECUTABLE_PATH'):
 paths=list(pathlib.Path.home().joinpath('.cache/ms-playwright').glob('chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell'))
 if paths:os.environ['AGENT_BROWSER_EXECUTABLE_PATH']=str(max(paths,key=lambda f:int(f.parents[1].name.rsplit('-',1)[1])))
def ab(*args):
 r=subprocess.run(['npx','--offline','agent-browser','--session',session,*args],capture_output=True,text=True)
 if r.returncode:raise RuntimeError(r.stdout+r.stderr)
 return r.stdout.strip()
def ev(js):
 raw=ab('eval',js)
 try:return json.loads(raw)
 except json.JSONDecodeError:return raw
def wait(js):
 until=time.monotonic()+20
 while time.monotonic()<until:
  if ev(js):return
  time.sleep(.15)
 raise AssertionError(js+'\n'+ab('eval','document.body.innerText'))
def contains(s):wait('document.body.innerText.includes('+json.dumps(s)+')')
def key(k):ab('press',k)
def cmd(s):key(':');ab('type','#input-sink',s);key('Enter')
def photo(name):ab('screenshot',str(proof/name))
def open():
 ab('open',f'http://127.0.0.1:{a.port}/?file=workspace:all&use=present,dwim,workspace,places,references,buffers,workbench&layout=desk');ab('set','viewport','1500','950')
 contains('Tasks, in their places');contains('Refresh the Omega board')
 wait('window.blEd && !document.querySelector("[data-loading]")')
def row(ty,part):
 # Resolve source from current typed objects, then navigate with the public editor command.
 r=ev('(()=>{const {R,K}=blEd;return [...blEd.state().get(K("obj-index"))].find(([r,o])=>o.get(K("type"))==='+json.dumps(ty)+' && String(o.get(K("key"))).includes('+json.dumps(part)+'))?.[0]})()')
 assert isinstance(r,int),r;cmd('(ed/goto '+str(r+1)+')')
def one():
 open();photo('16-workbench-welcome.png')
 row('omega/task','t-');contains('Waiting for your answer');photo('17-task-rail-conversation.png')
 key('j');contains('Finish the Beam Lisp checklist')
 key('Enter');wait('blEd.frame().get(blEd.K("focus")).name === "main"');contains('Mark this folder')
 key('Alt+h');row('desk/scope','beam-lisp');key('Enter')
 wait('blEd.state().get(blEd.K("path")) === "workspace:beam-lisp"');photo('18-place-scoped-rail.png')
 # Every visible task belongs to this place, without filtering the global store.
 assert ev('(()=>{const {K}=blEd;return [...blEd.state().get(K("obj-index"))].filter(([r,o])=>o.get(K("type"))==="omega/task").every(([r,o])=>o.get(K("place"))==="beam-lisp")})()')
 key('n');contains('New task in beam-lisp');ab('type','#input-sink','Review the release notes');key('Enter')
 contains('Review the release notes');wait('blEd.frame().get(blEd.K("focus")).name === "main"');photo('19-new-task-goal.png')
 cmd('(ed/unuse "workbench")');contains('removed workbench');wait('document.querySelectorAll(".pane.editor").length === 1');photo('20-workbench-unloaded.png')
 print('slice 1: presented rail, preview, focus, scoped tasks, goal-only creation, unload passed',flush=True)
if a.slice==1:one()
assert not ab('errors'),ab('errors')
