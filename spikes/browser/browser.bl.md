# Browser work as an Omega resource

Local prototype, 2026-10-07. The editor extension is `br.main/bl-package`, loaded
in real bl-ed as `?use=present,browser`. `world.bl` creates a separate in-memory
Omega task system with a scripted model and a real browser research tool. It
uses the same task executor, providers, intents and editor host as `bin/bl-ed`.
No writes to the running world on 8790. Ports 8796/8797 avoid existing offline
worlds on 8792/8793.

## Run and try it

```sh
npm --prefix spikes/browser ci
# If the presentation package has not been built:
spikes/present/build.sh pkg
spikes/browser/build.sh
spikes/browser/run.sh
```

Open <http://127.0.0.1:8797/?file=demo.bl.org&use=present,browser>.
Put the cursor inside the task block and press C-Enter. The usual Omega task
reference and card are written beneath it. The task executes the browser tool;
`space b s` shows its browser even while Chromium is headless. With the cursor
on that session, `space b w` opens its session buffer and enables capture.
`:(ed/layout "browser-observe")` puts the viewport beside it.

`:(ed/layout "browser-inbox")` shows the task rail, selected task and session
registry. Plain `inbox` is available unchanged. `:(ed/unuse "browser")` removes
browser keys, drawing and layouts from every pane; the underlying documents,
existing presentations and user command tables remain intact. Unloading an
editor package does not terminate task resources. Close a browser explicitly.

The host resolves the compiled loader at `vendor/bl-ed/web/pkg/browser.mjs`.
There is no private editor page or render loop. `serve.mjs` is a localhost host
adapter forwarding the existing editor to the isolated world, adding browser
providers/intents and augmenting task documents with their browser resources.
The demo uses `npx --no-install agent-browser` from this spike's directory;
`package-lock.json` pins 0.38.2 without replacing the system's 0.6.0 installation.
The runner chooses an installed Playwright Chrome, or accepts
`AGENT_BROWSER_EXECUTABLE_PATH`. If Chrome is missing, run
`cd spikes/browser && npx agent-browser install`. Headful needs an interactive display.

## The syntax

A task requests a resource. A browser block declares or refers to one:

```org
#+begin_task :id ora-tenders :browser ora :browser-mode headless
Find tender opportunities for Ora. Preserve sources and deadlines.
#+end_task

#+begin_browser :id ora :mode headless :url https://ora-ventures.com
#+end_browser
```

Browser task handling calls the existing `ed.omega/eval-task`, changing only
the new task's opening intent. Reference creation, same-body focus and edited
body refinement stay with the task implementation. A browser ID has one active
task owner. Close it or choose a new ID before starting another owner. The
scripted tool is specifically an Ora discovery demonstration: arbitrary task
goals are recorded but do not change the search strategy. This is not a new
language evaluator or a claim of general autonomous research.

User-authored browser bodies are prose; only explicit header attributes issue
host actions. Opening a document does not open a browser. C-Enter on an ordinary
task or code cell falls through to existing behavior. Session blocks generated
in task livebooks are references to resources, not another browser per refresh.

Future syntax, deliberately not interpreted by this prototype:

```org
#+begin_browser :id ora :provider kernel :profile ora-procurement :mode headful :view live
#+end_browser
```

Keep launch **mode** separate from observation **view**. `headless` describes
Chromium, not invisibility in Omega. `:view snapshot` can show headless activity;
a Kernel live view is a separately acquired capability. A headful browser can
be unobserved. Switching display mode is a restart, not a CSS toggle.

## Kernel's architecture, reused at the resource boundary

Kernel separates creating browser sessions, attaching automation transports,
observing them, and saving profiles. Its returned session ID is the durable
handle for lifecycle operations; CDP endpoint and live-view URL are capabilities
of that particular running session. A profile is the reusable identity/state,
not the execution. See [Kernel overview](https://www.kernel.sh/docs),
[browser API](https://www.kernel.sh/docs/api-reference/browsers/list-browser-sessions)
and [profiles](https://www.kernel.sh/docs/browsers/profiles).

This prototype adopts that separation, rather than Kernel's VM infrastructure:

| Concept | Local proof | Remote adapter contract |
|---|---|---|
| Session | Omega ID plus isolated agent-browser daemon identity | Omega ID mapped to Kernel session ID |
| Provision | agent-browser launches local Chromium | Kernel create browser with profile/mode |
| Control | npx commands and accessibility refs | same operations via returned CDP endpoint |
| Observe | screenshots, snapshots, task-linked event log | live-view capability, screenshots, replay IDs |
| Persistent state | private storage-state file; explicitly restored on restart | Kernel profile with explicit `save_changes` |
| Terminate | close CLI session | delete Kernel browser; disconnect alone is insufficient |
| Handoff | task pauses at next browser operation; human uses desktop | pause agent; human controls authorized live view |

`sessions.mjs` owns lifecycle and state; its `run(session, argv)` seam performs
control. `br.main` knows only IDs, document paths and intents. A production
remote adapter must implement provisioning/deletion, attach through CDP, and
resolve private view/profile capabilities without changing org syntax or task
ownership. There is **no remote adapter implementation or cloud call** here.
A remote restart must wait for profile save completion before creating the
replacement; capabilities and generation change together. No API keys or CDP
URLs belong in an org file or a provider object.

Kernel profiles are complete browser user-data snapshots. This local prototype
uses the narrower cookies/localStorage state export, plus tab URLs. It does not
promise parity for IndexedDB, sessionStorage, service workers, form drafts,
page JS memory, download progress or navigation history.

## What users need to know and do

| State | Meaning | Useful action |
|---|---|---|
| starting | resource exists; browser not ready | inspect start event; wait |
| running / agent | task can operate at browser boundaries | watch, pause, close |
| running / human | task yielded browser control | login on desktop; resume |
| switching | saved state, restarting browser | inspect from/to and generation |
| failed | launch, restart or capture failed | inspect event; reopen or close |
| closed | execution ended; artifacts still available | inspect report; forget saved auth |
| auth unknown | no evidence that login is valid | inspect website; do not infer signed-in |
| auth needs-human | blocked source or requested handoff | inspect affected origin; manual login |

Session documents expose owner, local/remote provider, headless/headful mode,
control owner, auth uncertainty, profile policy, URL, generation and timestamped
artifacts/events. They deliberately do not expose passwords, cookies or bearer
capabilities. `resume` does not assert authentication succeeded.

The editor commands are `space b s` sessions; `space b w` watch;
`space b h/l` headful/headless; `space b p/r` pause/resume;
`space b x` close; `space b f` forget saved auth after closing.
Browser mutations are serialized per session. Handoff takes effect between
operations, not halfway through a click or navigation. No two tasks silently
share an active session. Closing while research is paused lets its tool exit.

A light dashboard should show one status row and origin per task, opening a
session buffer only when needed. The current `browser-inbox` adds the registry
as the third pane instead of modifying `present` or its `inbox` definition.
The task livebook links to the same resource. These are views of one session,
not parallel sessions or permanent per-task screen allocations.

Observation is a five-second **captured viewport**, not remote desktop video.
Navigation captures immutable screenshots and snapshots. Observation overwrites
one explicitly labelled latest viewport, keeping disk use bounded while watching.
Capture is on navigation by default; `watch` allows refreshed screenshots when
the viewport is visible. It does not run a background screenshot loop while
all panes are closed. Historical screenshot paths show that exact artifact;
snapshot/report paths are ordinary read-only virtual text buffers. Artifact
retention is manual in this spike: screenshots, snapshots and research reports
remain in private storage, including after a session closes.

## Auth, profiles, and persistence

Private state is outside the served document root: by default
`/tmp/omega-browser-demo.private`, directories mode 0700, state files mode 0600.
Only named public artifacts are served. `auth-state.json` is never an artifact.
These files may contain credentials; there is no encryption-at-rest claim.
Screenshots and snapshots can also reveal private page content: use the same
retention/access policy in a production host.

A mode restart saves storage before closing, launches a **fresh** daemon with
`--state` at browser creation, and reopens tab URLs. The first implementation
used the installed 0.6.0 `state load`; real-browser testing showed that command
is a success-returning no-op. The spike now pins 0.38.2 and loads state at launch.
The test uses synthetic localhost cookie/localStorage values and checks both
headless → headful and headful → headless. Saved state is not printed or copied
into proof artifacts.

Ephemeral sessions are the default; this prototype saves storage for a mode
restart. A production `browser:profiles` buffer should be distinct from
`browser:sessions`: profile name, allowed origins, last save/check, expiration,
read-only seed vs sole writer, attached sessions and forget action. One profile
must have one writer, with explicit immutable clones for parallel research.
Kernel also warns that concurrent profile snapshots do not merge.

Needed next: explicit save/reuse policy across host restarts, origin-scoped auth
checks, profile encryption and expiration, resource leases/timeouts, crash
recovery, download artifacts, human-input audit events and credential-vault
integration. The in-memory registry intentionally does not pretend to recover
old running sessions after the host restarts. Files remain for inspection.

## Use cases to preserve

1. A scheduled tender scan stays headless. A browser status row appears as soon
   as it opens; the task links to its screenshots and dated research report.
2. A procurement portal needs login. Pause, switch headed, log in manually,
   switch back and resume. Site-specific auth is checked, never inferred from
   a successful mode restart. The prototype exposes uncertainty; it does not
   implement a credential vault or universal login detector.
3. A result looks suspicious. Navigate from the task to its session to the exact
   snapshot/screenshots and original URLs; compare observation time with the
   publication date and actual tender deadline.
4. Two client accounts run in parallel. Independent session IDs and profile
   writers keep cookies isolated; cloning a seed is explicit.
5. Close an execution but retain its evidence. The task can finish before the
   browser closes; closing a browser does not delete its report. Forgetting
   credentials is a separate operation from deleting evidence.
6. Move execution to Kernel. Task and session document paths stay stable;
   backend IDs, generation, capabilities and transport change. Observation
   reports whether it is a local captured frame or an authorized remote view.

## Verification and proof

- [Browser block in real bl-ed](proof/01-browser-block.png).
- Inbox screenshot pending replacement: the original capture showed only the
  loading screen and was removed. Fresh capture requires localhost browser access.
- [Captured headless viewport beside the session](proof/03-headless-observe.png).
- [Headful session](proof/04-headful-observe.png).
- [After unuse, plain editor restored](proof/05-unuse-restores-editor.png).
- [Task reference created by C-Enter](proof/06-task-browser-reference.png).
- [Real cookie/localStorage handoff](proof/storage-handoff.json).
- [Browser discovery report](proof/discovery.bl.org).
- [Ora shortlist, including original-PDF deadline verification](proof/ora-shortlist.bl.org).
- [Contract test output](proof/contract-tests.txt), [vendor tests](proof/vendor-tests.txt),
  and [unchanged equivalence checker output](proof/equivalence.txt).

```sh
node --test spikes/browser/test/package.test.mjs spikes/browser/test/sessions.test.mjs
node spikes/browser/test/real-browser.mjs
BLED_OUT=vendor/bl-ed/web/out BLED_ROOT=/home/user/code/undefine/beam-lisp \
  node --test vendor/bl-ed/test/*.test.mjs
node spikes/present/test/check.mjs vendor/bl-ed/web/welcome.bl.org \
  spikes/browser/demo.bl.org spikes/present/web/welcome.bl.org
```

The existing default-presentation equivalence checker is unchanged. Vendor
changes are generic host support for an image view model and removal of the
input sink from cloned pane skeletons. No Omega browser concepts went below
`vendor/bl-ed/ed/*`. Existing workspace changes were preserved.

The original GIZ DigiTPME DAO 10048906, scanned PDF physical page 3, confirms
a 22/10/2026 submission deadline. Ora's fit is strongest on digital adoption;
the required women-entrepreneur digitalisation reference and training capacity
still need eligibility review. The attached shortlist separates that evidence
from a second candidate whose original DAO has not yet been verified.

Final verification: browser contract tests 11/11; vendor suite 66/66; real
headless/headful/headless cookie and localStorage restoration; unchanged
default-presentation equivalence passes (11/6/11 variants). An encountered
screenshot storage failure is recorded independently of source reading.
Evidence has separate snapshot/screenshot timestamps, and session directories
are unique per host run so reopening a logical ID cannot overwrite old captures.
