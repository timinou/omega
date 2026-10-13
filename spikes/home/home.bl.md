# Omega — one adaptive Lisp workbench

Home is the removable `home` bl-ed package, compiled through the same immutable
frontend as Pocket, Pelagic and Runtime. Work opens immediately, with one compact
header and one navigation dock. Shared `ws.workbench` BL policy projects the
existing provider objects into exclusive urgency groups, context and navigation. No
second task registry, backend or editor renderer is introduced.

The workbench uses three retained same-origin editor viewers: Work
(Pocket, immediate), Pelagic and Runtime (lazy). They share the host/store but have separate JS
execution contexts. A zero-width pane stays mounted and becomes inert and hidden
from accessibility navigation. Switching Home does not recreate its iframe,
editor, draft or audio graph. This is bounded prototype composition, not a claim
of zero-copy shared browser realms or durable session restoration.

The native entry uses Loom's Wry backend to attach a window to the existing host.
`loom.desktop/serve-window` would create another server, so this entry uses its
underlying `wry/open` URL API in a small isolated display process instead. WebKit can
inherit OS listening descriptors when embedded in the host VM; actor cleanup
alone cannot retire those foreign copies. The display client owns no world,
server or frontend build. Closing the window retracts its receiver;
it does not own or stop the realm's host. `omega.stop` remains explicit.

```sh
bin/bl omega                         # native Home, durable live world
bin/bl omega -- --demo               # scripted durable world
bin/bl omega -- --browser            # same Home URL without a native window
bin/bl home.dev                      # browser prototype, scripted by default
```

Use matching mode, database and port when attaching another preset. An existing
incompatible world is refused before mutation. This adds a root task, not
an OS installer; prepared release distribution remains slice 5.

## Acceptance

- [Package drive](test/drive.test.mjs): layers, bounded projections, identity
  validation, lazy viewers, stable URLs and exact use/unuse.
- [Browser journey](test/workbench.py): actual root launcher in private XDG state,
  task continuation, draft retention, playing engine identity, inspector and
  unload; owns and closes its disposable world.
- [Native journey](test/native.bl): actual Wry/WebKit on a private compositor;
  capabilities and errors retained separately from Chromium evidence.
- [Recorded review](proof/workbench/report.html): screenshots used and after unuse,
  walkthrough, checks and native feature support.
- Vendored editor drive gates and unchanged default presentation checker.

No test writes to the live world or opens a window on the user's desktop.
Browser evidence may include pre-existing concurrent Pocket/workspace edits;
those source changes are preserved outside this work's commits.

## What native testing changed

Retained hidden editors now abort their document/card long polls and resume
observation when shown. Their editor state, actors and audio remain alive.
Without aborting the HTTP requests, three viewers could consume the browser's
HTTP/1 connection allowance and prevent the live compiler Worker from loading.
This fix belongs to the generic editor host, not a Home-only watcher.

Pelagic probes WebGL in its graphics Worker before transferring the visible
canvas. Chromium uses the Worker; this machine's WebKit cannot create that
context, so it uses the same `SceneStage` in the window. Cancellation terminates
an unfinished probe. There is one rendering implementation and no browser-name
switch. Actual native playback, submitted frames and a non-silent offline render
are checked, separately from mere API availability.

The private native proof uses software graphics. It validates functionality,
not smooth physical output or the 16 ms latency goal. Native frame costs remain
a slice 6 measurement and optimization task. Closing a window intentionally
ends its local audio; moving between Home activities preserves it.

## Reproduce

```sh
# Build once; unchanged BL graphs are reused for host-asset edits.
bin/bl --cold omega.build
python3 spikes/home/test/workbench.py
# Native only, still a private world and private compositor:
HOME_NATIVE_ONLY=1 python3 spikes/home/test/browser.py
bin/bl runtime.review
```

Open `http://localhost:8820/spikes/home/proof/workbench/report.html` for the captures,
video and acceptance records. The native harness requires sway, grim,
wayland-scanner, a C compiler, Wayland development libraries and Tesseract
with its English model (or `TESSDATA_PREFIX` pointing to it); Chromium
acceptance uses Playwright. None of those are application launch dependencies.

## Native lifecycle ownership

The root task acquires the canonical shared host once, then runs
`omega.window` as a cold display client. Explicit display environment reaches
the client even when the shared host predates the desktop session. The client
only opens the existing Home URL; the three editor viewers remain browser
contexts over that one host. The extra process is a GUI lifetime boundary.

Upstream Wry now checks the native thread, rather than trusting an event proxy
whose GTK receiver can outlive the window. Native failures raise as documented;
Rustler's previous error return was a value and fooled a polling caller. Omega
pins the minimal upstream lifecycle backport `65c25b33`; main has `d6a9f79a`.
The actual root entry is closed through the private window manager in acceptance,
then its host is queried and explicitly stopped. The port must close and the
shared VM must remain the same. This catches ownership gaps that actor-only
inspection cannot see. There is no local native library override in delivery.

## Composition and removal

`home.main` owns layouts and pure events; `ws.workbench` owns shared projection
policy; `ws.actions` supplies the loaded packages' contextual object actions.
`host/editor-bridge.mjs` selectively reads painted metadata and translates events.
`host/theme.mjs` propagates editor theme roles without polling. The existing
Pocket host retains its readers, structured conversation, input and command sheet.
Tools use the real generic editor prompt; results surface in parent feedback.
The parent chrome becomes inert while a child dialog owns focus.

Async editor readiness is explicit: `bl-ed-ready` follows the initial painted
frame and public API installation. Iframe load alone cannot establish readiness.
Every subscription, ready listener, stylesheet and theme override has a disposal
path. Child editor state stays under each package's ordinary ownership boundary.

Superseded: Home's landing hero/launch tiles, private green palette, fixed side
rail, inline task categorization and duplicate global chrome. There is no second
Home renderer. Navigation variants are one BL data policy over the same views.
Desktop and Pocket now share task state labels/classification. The generic
inspector inherits the editor's theme instead of keeping a green shadow palette.

See [the first-use showcase](01-home.bl.org), [implementation walkthrough](02-workbench.bl.org)
and [PLAN-022](../../!tasks/plans/PLAN-022-adaptive-lisp-workbench.bl.org).
The previous native-first [baseline report](proof/report.html) remains historical
proof; its old landing screenshots are not the shipping entry.
