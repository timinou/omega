# Omega Home — native first vertical

Home is the removable `home` bl-ed package, compiled through the same immutable
frontend as Pocket, Pelagic and Runtime. Its pure BL module projects the existing
`workspace:all` provider's task/place objects and emits navigation effects. No
second task registry, backend or editor renderer is introduced.

The first slice uses three lazy, retained same-origin editor viewers: Work
(Pocket), Pelagic and Runtime. They share the host/store but have separate JS
execution contexts. A zero-width pane stays mounted and becomes inert and hidden
from accessibility navigation. Switching Home does not recreate its iframe,
editor, draft or audio graph. This is bounded prototype composition, not a claim
of zero-copy shared browser realms or durable session restoration.

The native entry uses Loom's Wry backend to attach a window to the existing host.
`loom.desktop/serve-window` would create another server, so this entry uses its
underlying `wry/open` URL API instead. Closing the window retracts its receiver;
it does not own or stop the realm's host. `omega.stop` remains explicit.

```sh
bin/bl omega                         # native Home, durable live world
bin/bl omega -- --demo               # scripted memory world
bin/bl omega -- --browser            # same Home URL without a native window
bin/bl home.dev                      # browser prototype, scripted by default
```

Use matching mode, database and port when attaching another preset. An existing
incompatible world is refused before mutation. This slice adds a root task, not
an OS installer; prepared release distribution remains slice 5.

## Acceptance

- [Package drive](test/drive.test.mjs): layers, bounded projections, identity
  validation, lazy viewers, stable URLs and exact use/unuse.
- [Browser journey](test/browser.py): actual root launcher in private XDG state,
  task continuation, draft retention, playing engine identity, inspector and
  unload; owns and closes its disposable world.
- [Native journey](test/native.bl): actual Wry/WebKit on a private compositor;
  capabilities and errors retained separately from Chromium evidence.
- [Recorded review](proof/report.html): screenshots used and after unuse,
  walkthrough, checks and native feature support.
- Vendored editor drive gates and unchanged default presentation checker.

No test writes to the live world or opens a window on the user's desktop.
Browser evidence may include pre-existing concurrent Pocket/workspace edits;
those source changes are preserved outside this work's commits.
