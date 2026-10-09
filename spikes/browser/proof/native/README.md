# Native browser proof — 2026-10-09

All browser profiles, credentials fixtures and pages used for these checks were
disposable and synthetic. The editor world was offline, in-memory, rooted at
`/tmp/omega-native-editor-proof`, port 8838. No test wrote to live world 8790.

- `real.json`: regular headed Nix Chromium, actual Unix-socket VNC mouse/keyboard
  input and painted framebuffer, localhost, private Wayland sockets (X11 authentication in x11/), server
  control gating on an existing viewer, exclusive writer, viewer origin/token
  rejection, raw CDP, clean profile save/restored tabs/cookies/localStorage,
  forced helper death with child exit, recovery, host restart and guarded forget.
- `editor.json`: actual compiled `br.main/bl-package` in bl-ed; rendered desktop
  typing, same-browser and same-viewer handoff, save/reopen, real Chromium extension manager,
  cloud credential controls hidden on native, and exact single-pane restoration
  after `(ed/unuse "browser")`. No page errors.
- `01-real-desktop.png`: native desktop from the real drive.
- `02-editor-human.png`, `03-editor-omega.png`: editor desktop and handoff.
- `04-editor-saved.png`, `05-editor-extensions.png`: save/reopen and extensions.
- `06-editor-after-unuse.png`: editor after package removal.
- `contract-tests.txt`: 46 Node tests, including native packet framing/timeouts
  and RFB input gating alongside the retained hosted Kernel contract checks.
- `rust-tests.txt`: Rust feature matrix (4 Wayland-only / 3 X11-enabled checks).
- `beam-port-tests.txt`: 4 files / 10 assertions through actual Erlang external
  ports, including headed CDP evaluation and clean closure.
- `vendored-port-test.txt`: 4 assertions using the copied client and built vendored executable.
- `packaging-tests.txt`: no default helper/dependency closure and exclusion from core build/release trees.
- `wayland-review.md`: review findings, feature boundaries and local performance samples.
- `x11/`: explicit X11 compatibility desktop/profile drive.
- `vendor-tests.txt`: vendored editor drive/regression checks.
- `equivalence.txt`: unchanged presentation equivalence checker, zero bad
  variants for the editor welcome, browser demo and presentation welcome.

Setup built the helper from vendored source and prepared the pinned Nix runtime.
The final native/editor drives used `.native/paths.json` and that vendored binary.
Beam Lisp tests used Omega's pinned runtime and explicitly opted-in optional package sources.

The 1Password install action opens the official store listing; the real drive
exercises Chromium's extension manager. No user account was installed/unlocked,
no autofill or desktop-app integration was verified, and no such success is
claimed. Hypeman/MicroVM and scenario execution are future backend/harness work.
