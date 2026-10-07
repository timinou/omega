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
def cmd(s):
 key(':');wait('blEd.state().get(blEd.K("mode")).name === "command" && blEd.state().get(blEd.K("minibuf")).get(blEd.K("kind")).name === "eval"');ab('type','#input-sink',s);key('Enter');wait('blEd.state().get(blEd.K("mode")).name !== "command" && !blEd.state().get(blEd.K("awaiting"))')
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
def document(path):return ev('fetch("/api/doc?path="+encodeURIComponent('+json.dumps(path)+')).then(r=>r.json())')
def task_title(title):
 r=ev('(()=>{const {K}=blEd;return [...blEd.state().get(K("obj-index"))].find(([r,o])=>o.get(K("title"))==='+json.dumps(title)+')?.[0]})()')
 assert isinstance(r,int),r;cmd('(ed/goto '+str(r+1)+')')
def two():
 open();task_title('Finish the Beam Lisp checklist');contains('Waiting for your answer');key('Enter')
 wait('blEd.frame().get(blEd.K("focus")).name === "main"');contains('g b  board.bl.org')
 key('i');ab('type','#input-sink','Keep this reply draft');key('Alt+h');key('g');key('b')
 wait('document.querySelectorAll(".pane.editor").length === 3');contains('beam-lisp board')
 assert ev('blEd.R.printStr(blEd.F.d_editor(blEd.frame(),blEd.K("aside")).get(blEd.K("minibuf"))).includes("Keep this reply draft")')
 photo('21-working-file-and-retained-reply.png');assert ev('document.activeElement.id')=='input-sink'
 cmd('(ed/goto 4)');assert ev('blEd.state().get(blEd.K("sels")).nth(0).get(blEd.K("head")).nth(0)')==3;key('A');wait('blEd.state().get(blEd.K("mode")).name === "insert"');ab('type','#input-sink',' HUMAN DRAFT');key('Escape');contains('HUMAN DRAFT')
 assert 'HUMAN DRAFT' not in document('work:beam-lisp/board.bl.org')['text']
 key('g');key('t');contains('discard a draft');assert ev('blEd.frame().get(blEd.K("layout")).get(blEd.K("name"))')=='desk-artifact'
 key('Alt+l');key('Escape');cmd('(ed/goto 1)');key('y');contains('answered');contains('✓ DONE')
 key('Alt+h');contains('HUMAN DRAFT');wait('document.body.innerText.includes("✓ Check this folder") || document.body.innerText.includes("DONE Check this folder")')
 photo('22-presented-shared-edit.png');key('Control+s');contains('Published shared text')
 assert 'TODO Check this folder' in document('work:omega/board.bl.org')['text']
 key('g');key('c');contains('Changes');contains('revision 2');photo('23-presented-changes.png')
 row('buffer/op','@1');key('u');contains('reverted');key('Control+o');contains('HUMAN DRAFT');photo('24-presented-selective-undo.png')
 key('g');key('t');wait('document.querySelectorAll(".pane.editor").length === 2');contains('g H  Plan')
 key('g');key('H');contains('Two working directories');wait('document.querySelectorAll(".pane.editor").length === 3');contains('TASK');photo('25-plan-task-presentation.png')
 assert ev('blEd.state().get(blEd.K("sels")).nth(0).get(blEd.K("head")).nth(0)')==8
 key('g');key('v');contains('#+begin_task');photo('26-plan-source-inspection.png');key('g');key('v')
 cmd('(ed/unuse "workbench")');contains('removed workbench');wait('document.querySelectorAll(".pane.editor").length === 1');photo('27-artifact-package-unloaded.png')
 print('slice 2: retained composer, artifact draft protection, shared agent edit, attribution, selective undo, anchored presented plan, source toggle and unload passed',flush=True)
def three():
 open();ab('click','[data-pane="rail"] [data-command="desk/open"]:has-text("Refresh the Omega")')
 wait('blEd.frame().get(blEd.K("focus")).name === "main"');contains('g b  board.bl.org')
 task_id=ev('blEd.state().get(blEd.K("doc")).get(blEd.K("data")).get(blEd.K("task-id"))')
 ab('click','[data-pane="main"] [data-command="desk/actions"]');contains('Attach reference');photo('28-contextual-actions.png')
 ab('click','#overlay [role="button"]:has-text("Attach reference")');contains('i input / o output')
 ab('type','#input-sink','i');key('Enter');contains('File or document');ab('type','#input-sink','board.bl.org');key('Enter')
 contains('References');contains('INPUT');photo('29-presented-input-output-references.png')
 doc=document('links:task/'+task_id);assert len(doc['objects'])==2,doc
 r=ev('(()=>{const {K}=blEd;return [...blEd.state().get(K("obj-index"))].find(([r,o])=>o.get(K("relationship"))==="input")?.[0]})()')
 cmd('(ed/goto '+str(r+1)+')');key('?');key('d');contains('type remove');ab('type','#input-sink','keep');key('Enter');contains('Reference kept')
 assert len(document('links:task/'+task_id)['objects'])==2
 key('?');key('d');ab('type','#input-sink','remove');key('Enter');contains('removed');wait('[...blEd.state().get(blEd.K("obj-index"))].length === 1')
 key('Control+o');contains('Refresh the Omega board');key('Alt+h');key('g');key('f')
 wait('blEd.state().get(blEd.K("path")) === "place:omega"');contains('Effective configuration');photo('30-place-files-and-inheritance.png')
 assert ev('blEd.F.d_editor(blEd.frame(),blEd.K("rail")).get(blEd.K("path"))')=='workspace:all'
 key('?');key('f');contains('New place');ab('type','#input-sink','Release notes');key('Enter');contains('blank inherits');key('Enter')
 wait('blEd.state().get(blEd.K("path")) === "place:omega-release-notes"');contains('Release notes');photo('31-guided-inherited-subplace.png')
 inherited=ev('blEd.state().get(blEd.K("doc")).get(blEd.K("data")).get(blEd.K("root"))');assert inherited.endswith('/omega'),inherited
 key('g');key('r');contains('No references yet');ab('click','[data-pane="main"] [data-command="desk/link"]')
 ab('type','#input-sink','c');key('Enter');ab('type','#input-sink','@beam-lisp/board.bl.org');key('Enter');contains('CONTEXT');contains('work:beam-lisp/board.bl.org');photo('32-cross-place-context-reference.png')
 ab('click','[data-pane="main"] [data-command="desk/open"]:has-text("work:beam-lisp/board.bl.org")')
 wait('document.querySelectorAll(".pane.editor").length === 3');contains('beam-lisp board');photo('33-reference-opens-working-text.png')
 key('g');key('t');wait('document.querySelectorAll(".pane.editor").length === 2')
 key('Alt+h');row('desk/scope','omega-release-notes');key('Enter');contains('No tasks here yet')
 key('n');ab('type','#input-sink','Review release notes in this place');key('Enter');contains('Review release notes in this place');wait('blEd.frame().get(blEd.K("focus")).name === "main"')
 assert ev('blEd.state().get(blEd.K("doc")).get(blEd.K("data")).get(blEd.K("cwd"))')==inherited
 photo('34-task-in-inherited-directory.png')
 key('?');key('c');contains('type cancel');ab('type','#input-sink','keep');key('Enter');contains('Task kept')
 key('?');key('c');ab('type','#input-sink','cancel');key('Enter');contains('Task cancelled')
 wait('blEd.state().get(blEd.K("doc")).get(blEd.K("data")).get(blEd.K("task-status")) === "cancelled"')
 key('i');contains('New task in omega-release-notes');photo('35-follow-up-keeps-task-place.png');key('Escape')
 key('Alt+h');row('desk/scope','workspace:all');key('Enter');task_title('Refresh the Omega board');key('Enter');contains('g b  board.bl.org')
 ab('click','[data-pane="main"] [data-command="desk/artifact"]');wait('document.querySelectorAll(".pane.editor").length === 3');wait('blEd.state().get(blEd.K("path")) === "work:omega/board.bl.org" && !document.querySelector("[data-loading]")')
 ab('set','viewport','1000','780');wait('blEd.state().get(blEd.K("view")).get(blEd.K("cols")) < 60');photo('36-compact-workbench.png')
 assert ev('document.documentElement.scrollWidth <= window.innerWidth')
 cmd('(ed/unuse "workbench")');contains('removed workbench');wait('document.querySelectorAll(".pane.editor").length === 1');photo('37-actions-package-unloaded.png')
 print('slice 3: pointer commands, contextual actions, guided input/context references, confirmed removal, retained task rail, inherited subplace and cwd, cross-place files, confirmed cancellation, scoped follow-up, compact headings and unload passed',flush=True)
if a.slice==1:one()
if a.slice==2:two()
if a.slice==3:three()
assert not ab('errors'),ab('errors')
