# Native browser inside bl-ed

The default backend is a native Linux external process. `br.main/bl-package`
loads into the real editor with `?use=present,browser`, contributes layouts and
commands, and emits effects to the browser host. The host owns `bl-browser-port`,
a Rust executable speaking packet-4 JSON. The same executable has a Beam Lisp
`browser.port` client upstream, ready for supervised BEAM callers.

The executable starts regular, headed Chromium, Xvfb and x11vnc. bl-ed embeds
the desktop through noVNC over a local WebSocket; clicks and typing reach the
actual browser, including its toolbar and extension UI. This is a desktop
stream, rather than a supplier-site iframe or periodic screenshots. Chromium
keeps its normal UA and sandbox. No Docker, Podman, VM or NIF is required.
The existing Node host currently owns the executable; BEAM ownership is tested
through the upstream client and is available for future scenario integration.

## Prepare and run

```sh
npm --prefix spikes/browser ci
spikes/browser/native-setup.sh --nix
spikes/browser/build.sh
spikes/browser/run.sh
```

Nix provides pinned Chromium, Xvfb and x11vnc without requiring NixOS. If those
executables are already installed, run `native-setup.sh` without `--nix` instead;
set `CHROMIUM`, `XVFB` and `X11VNC` when they are outside PATH. Rust/Cargo and Node
are build prerequisites. Setup compiles the helper and viewer and writes local
executable paths to ignored `.native/paths.json`. Runtime starts browsers on
request and does not silently install services or extensions.

Open <http://127.0.0.1:8797/?file=demo.bl.org&use=present,browser>.
The demo runs an isolated in-memory world on 8796 and refuses occupied ports.
It never writes to the user's live world on 8790. Existing hosts must be
restarted deliberately to load changes.

`BROWSER_NATIVE_ROOT` selects the private profile store (default
`~/.local/share/omega/browser`). `BROWSER_NATIVE_CONFIG` selects a JSON file of
executable paths; environment variables override it. Set `BL_BROWSER_PORT`,
`CHROMIUM`, `XVFB`, and `X11VNC` directly for an independently built runtime.
Native and cloud hosts use separate private registries. Switching backend does
not import credentials or reinterpret an old cloud session as a local browser.

## Sign in, hand off, save

```org
#+begin_browser :id supplier :profile omega-supplier :url https://example.com
C-Enter opens this persistent browser inside bl-ed.
#+end_browser

#+begin_task :id scan :browser supplier-scan :browser-profile omega-supplier-scan
Read the supplier's current notices. Retain sources; do not submit anything.
#+end_task
```

Manual browsers start under human control; tasks start under Omega control.
Human/Omega handoff keeps the same browser and profile. The host independently
filters keyboard, pointer, clipboard and resize input during agent control,
including input from a previously connected viewer. Observation continues.

- `space b s`: sessions, owners, profiles and saved status.
- `space b w`: interactive desktop beside its session.
- `space b p` / `space b r`: human / Omega control.
- `space b a` or `space b x`: save the complete profile and close.
- `space b c`: reconnect, or recover a retained profile after process loss.
- `space b f`: after closing, forget the managed profile.

Save requests `Browser.close`, waits for the browser to exit, and acknowledges
only a clean close. The normal Chromium profile retains cookies, local storage,
preferences, extensions and restored tabs. It does not retain a running JS heap.
Reopen without an explicit URL restores tabs; an explicit URL opens that site.
Host shutdown closes and saves its native browsers. Abrupt helper loss retains
the profile for Chromium recovery and cannot claim a new successful save.
An OS writer lock prevents two helpers from opening the same profile. Forget
requires that lock and a managed-profile marker; arbitrary directories and
symlink profiles are refused. Retained reports and screenshots are separate.

## 1Password

In human control, expand **Sign in**, then choose **Install 1Password** to open
the official Chrome Web Store listing inside this Chromium profile. Approve
installation using Chromium's UI; **Manage extensions** opens its extension
manager. Pin and unlock the extension there, sign in to the supplier, then hand
control back to Omega. Save and close retains the extension's profile storage.
No account password or Secret Key is sent through an Omega credential form.

The browser extension can be installed on supported desktop browsers; desktop
app integration has additional browser checks. For a custom/Nix Chromium,
follow 1Password's [additional-browser instructions](https://support.1password.com/additional-browsers/)
and its [Linux installation guidance](https://support.1password.com/install-linux/)
if app unlock integration is wanted. A working standalone extension does not
prove desktop app integration or biometric unlock. Omega does not rewrite the
system's trusted-browser configuration or install 1Password desktop itself.
See the official [extension setup](https://support.1password.com/browser-extension/).

The proof exercises the real Chromium extension manager and the official
installation entry point is implemented. Installing and unlocking a user's
1Password account, desktop integration and autofill remain human acceptance
checks; no automated proof claims they succeeded. Prefer a dedicated profile
and vault access appropriate to the work: browser automation can observe pages
after credentials have been filled.

## Local boundaries

Profiles and runtime directories are mode 0700; Xauthority cookie files are
0600. Xvfb has no TCP listener and requires a random MIT cookie. VNC uses a Unix
socket inside the private runtime directory with no TCP VNC listener. The local
host validates viewer Origin and a per-browser random capability; public session
documents omit CDP endpoints, filesystem paths, viewer tokens and credential
values. Viewer image CSP permits noVNC's local data/blob tiles.

CDP binds a random loopback TCP port. Other processes able to reach host
loopback can access it; this is a trusted local workstation backend, not a
multi-tenant isolation boundary. Chromium's sandbox stays enabled. No password
storage API is added to the external-port protocol. Private diagnostics are
retained on startup failure; browser artifacts may contain page content.

## Other backend choices

`BROWSER_BACKEND=kernel KERNEL_API_KEY=… spikes/browser/run.sh` retains the hosted
Kernel backend, its SDK, persistent cloud profiles and cloud credential controls.
Optional settings are `KERNEL_PROJECT_ID`, `KERNEL_REGION`,
`KERNEL_BROWSER_NAMESPACE`, `KERNEL_BASE_URL`/`KERNEL_BASE` and
`KERNEL_BROWSER_EXTENSIONS`. Kernel saves must be confirmed by its profile
metadata, and uncertain mutations are never retried blindly. The native backend
requires no Kernel service or key. Hypeman/MicroVM support remains a possible
backend choice; it is not implemented by this native change.

## Verification

```sh
npm --prefix spikes/browser test
BROWSER_NATIVE_CONFIG="$PWD/spikes/browser/.native/paths.json" \
  node spikes/browser/test/native-real.mjs
# Start a separate offline editor for the real package proof:
bin/bl-ed --offline --memory --port 8838 --root /tmp/omega-native-editor-proof
BROWSER_NATIVE_CONFIG="$PWD/spikes/browser/.native/paths.json" \
  node spikes/browser/test/native-editor-proof.mjs
BLED_OUT=vendor/bl-ed/web/out BLED_ROOT=../beam-lisp node --test vendor/bl-ed/test/*.test.mjs
node spikes/present/test/check.mjs vendor/bl-ed/web/welcome.bl.org \
  spikes/browser/demo.bl.org spikes/present/web/welcome.bl.org
```

The real native drive covers rendered framebuffer pixels, mouse/keyboard input,
localhost access, normal UA, old-viewer input denial, profile writer conflicts,
viewer authorization, clean save/reopen, cookies/storage/tabs, raw CDP, helper
crash recovery, host restart and guarded forgetting. Editor proof uses the real
package, verifies same-browser handoff and extension controls, then `unuse`
restores the single layout with every embed removed. Screenshots and reports
are in `proof/native/`; earlier hosted fixture proofs remain in `proof/`.
Upstream Rust framing tests and Beam Lisp external-port tests are retained with
the vendored source. The default-presentation equivalence checker is unchanged.

Scenario runner work is tracked separately in
`!tasks/follow-ups/native-browser-scenario-runner.org`: reuse the port and the
existing scenario world contract; build editor presentation later.
