#!/usr/bin/env python3
"""Drive each workspace extension in the real offline editor with agent-browser.
Run against a fresh /tmp demo root. No live-world requests. Requires loopback
and Chromium. Uses keyboard commands plus browser HTTP reads for assertions.
"""
import argparse,json,os,pathlib,subprocess,time,urllib.parse
p=argparse.ArgumentParser();p.add_argument('--port',type=int,default=8794);p.add_argument('--slice',choices=['places','references','buffers','all'],default='all');a=p.parse_args()
if a.port==8790:raise SystemExit('Refusing live-world port 8790')
repo=pathlib.Path(__file__).resolve().parents[3];proof=repo/'spikes/workspace/proof';proof.mkdir(exist_ok=True)
session='omega-workspace-proof';base=f'http://127.0.0.1:{a.port}'
if not os.environ.get('AGENT_BROWSER_EXECUTABLE_PATH'):
 candidates=list(pathlib.Path.home().joinpath('.cache/ms-playwright').glob('chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell'))
 if candidates:
  os.environ['AGENT_BROWSER_EXECUTABLE_PATH']=str(max(candidates,key=lambda f:int(f.parents[1].name.rsplit('-',1)[1])))

packages='present,dwim,workspace,places,references,buffers'
def ab(*args):
 r=subprocess.run(['npx','--offline','agent-browser','--session',session,*args],text=True,capture_output=True)
 if r.returncode:raise RuntimeError(r.stdout+r.stderr)
 return r.stdout.strip()
def evaluate(s):
 raw=ab('eval',s)
 try:return json.loads(raw)
 except json.JSONDecodeError:return raw
def body():return evaluate('document.body.innerText')
def wait_contains(s,timeout=15):
 deadline=time.monotonic()+timeout
 while time.monotonic()<deadline:
  if s in body():return
  time.sleep(.2)
 raise AssertionError(f'Missing {s!r}: {body()}')
def wait_loaded(path,timeout=15):
 deadline=time.monotonic()+timeout
 while time.monotonic()<deadline:
  if evaluate('document.querySelector(".file")?.textContent?.startsWith('+json.dumps(path)+') && !document.querySelector("[data-loading]")'):
   return
  time.sleep(.2)
 raise AssertionError('Document did not finish loading: '+path)
def key(s):ab('press',s)
def command(s):
 key(':');ab('type','textarea:focus',s);key('Enter')
def open_in_pane(path):
 command('(ed/cmd "workspace/visit")');wait_contains('visit:')
 ab('type','textarea:focus',path);key('Enter');wait_loaded(path)
def visit(path):
 ab('open',base+'/?'+urllib.parse.urlencode({'file':path,'use':packages,'layout':'workspace'}));ab('set','viewport','1680','1050')
 wait_contains('⊞ workspace');key('Alt+l')
 # Explicit visit selects the desired document regardless of layout bootstrap.
 open_in_pane(path)
def photo(name):ab('screenshot',str(proof/name))
def doc(path):return evaluate('await (await fetch('+json.dumps('/api/doc?path='+urllib.parse.quote(path,safe=''))+')).json()')
def current(path):
 assert path in body(),body()
def unused(name,png):
 command('(ed/unuse '+json.dumps(name)+')');wait_contains('removed '+name);photo(png)

def places():
 visit('place:boards');wait_contains('Effective configuration');wait_contains('← omega');photo('05-places-used.png')
 key('g');key('p');wait_loaded('place:omega');wait_contains('place: omega')
 command('(ed/cmd "places/attach")');wait_contains('place map:')
 ab('type','textarea:focus','{:id "proof-notes" :name "Proof notes" :parent "boards" :config {:test-command "printf notes"}}');key('Enter')
 wait_contains('place: proof-notes');wait_contains('printf notes');photo('06-subplace-created.png')
 key('g');key('p');wait_loaded('place:boards');wait_contains('place: boards')
 unused('places','07-places-unused.png')
 print('places: attachment, parent navigation, inherited configuration and unload verified',flush=True)

def references():
 visit('place:boards');key('g');key('r');wait_loaded('links:place/boards');wait_contains('References for place boards')
 photo('08-references-used.png');command('(ed/goto 4)');key('Enter');wait_loaded('work:omega/plan.bl.org')
 assert 'task block' in body(),body()
 # Add an explicit relation through the real minibuffer.
 command('(ed/cmd "links/add")');wait_contains('link map:')
 ab('type','textarea:focus','{:id "proof-board" :from {:place "boards"} :kind :output :to {:place "beam-lisp" :path "board.bl.org"}}');key('Enter')
 wait_contains('proof-board');photo('09-reference-created.png')
 command('(ed/cmd "links/remove")');wait_contains('link id:');ab('type','textarea:focus','proof-board');key('Enter');wait_contains('removed proof-board')
 unused('references','10-references-unused.png')
 print('references: anchored visit, creation, removal and unload verified',flush=True)

def buffers():
 visit('work:beam-lisp/board.bl.org');wait_contains('beam-lisp board')
 # Start its scripted task in a separate pane, before making the human draft.
 open_in_pane('work:omega/plan.bl.org');wait_contains('Two working directories')
 initial=doc('work:omega/plan.bl.org')['text']
 row=next(i+1 for i,line in enumerate(initial.splitlines()) if '#+begin_task :id beam-board' in line)
 command('(ed/goto '+str(row)+')');key('Control+Enter');wait_contains('opened t-');key('Control+s');wait_contains('Published shared text')
 plan=doc('work:omega/plan.bl.org')['text']
 import re
 ids=re.findall(r'#omega/task \{:id "([^"]+)"',plan);assert ids,plan
 task=ids[-1];task_doc='task:'+task
 # Put the board in the main pane and the task in its own pane.
 open_in_pane('work:beam-lisp/board.bl.org');wait_contains('beam-lisp board')
 key('g');key('g');key('G');key('A');ab('type','textarea:focus',' HUMAN DRAFT');key('Escape')
 # Browser-only HTTP assertion verifies that unpublished text has not reached disk's projection.
 assert 'HUMAN DRAFT' not in doc('work:beam-lisp/board.bl.org')['text']
 key('Alt+l');open_in_pane(task_doc);wait_contains('Mark this folder\'s board DONE?')
 command('(ed/goto 1)');key('y');wait_contains('answered '+task+': yes');wait_contains('Updated board.bl.org')
 key('Alt+h');wait_contains('DONE Check this folder');wait_contains('HUMAN DRAFT');photo('11-shared-draft-and-agent.png')
 key('Control+s');wait_contains('Published shared text')
 assert 'HUMAN DRAFT' in doc('work:beam-lisp/board.bl.org')['text']
 assert 'TODO Check this folder' in doc('work:omega/board.bl.org')['text']
 key('g');key('c');wait_loaded('changes:work:beam-lisp/board.bl.org');wait_contains('Changes to work:beam-lisp/board.bl.org');photo('12-attributed-changes.png')
 # Agent operation is first; human publication second. Undo the agent op only.
 command('(ed/goto 7)');key('u');wait_contains('reverted ')
 result=doc('work:beam-lisp/board.bl.org')['text'];assert 'TODO Check this folder' in result and 'HUMAN DRAFT' in result,result
 unused('buffers','13-buffers-unused.png')
 print('buffers: unpublished draft, agent edit, publish, attribution, selective undo and unload verified',flush=True)

for name,fn in [('places',places),('references',references),('buffers',buffers)]:
 if a.slice in (name,'all'):fn()
assert not ab('errors'),ab('errors')
