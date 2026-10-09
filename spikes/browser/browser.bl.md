# Kernel browsers inside bl-ed

Migrated 2026-10-09. `br.main/bl-package` loads in the real editor as
`?use=present,browser`. Kernel provisions and retains the browser; the package
provides layouts and commands; the host embeds Kernel's interactive live view.
There is no local Chromium launcher, agent-browser daemon, screenshot polling,
private editor page, or alternative package implementation.

## Run

```sh
npm --prefix spikes/browser ci
spikes/browser/build.sh
# Export KERNEL_API_KEY in the host environment; never put it in an org file.
spikes/browser/run.sh
```

Open <http://127.0.0.1:8797/?file=demo.bl.org&use=present,browser>.
The runner uses an isolated in-memory world on 8796. It refuses occupied ports
and does not change the user's running world on 8790. Existing running browser
hosts must be restarted deliberately to load the migration; this change does
not restart another session's processes.

Optional host configuration: `KERNEL_PROJECT_ID`, `KERNEL_REGION`,
`KERNEL_BROWSER_NAMESPACE` (defaults to `omega`), `KERNEL_BASE_URL` (or the
Beam Lisp-compatible `KERNEL_BASE`), and comma-separated
`KERNEL_BROWSER_EXTENSIONS` naming extensions already uploaded to Kernel.
A base URL override must implement the Kernel control-plane API. A bare
`kernel-images` CDP port is **not** a drop-in control-plane API; self-hosting
needs a lifecycle/profile/vault adapter and is not implemented here.

`@onkernel/sdk` is pinned to 0.121.0. Playwright Core is a development dependency
used only for offline browser proof; production operations run beside Chromium
through Kernel's Playwright execution endpoint, one request per operation.
The Beam Lisp checkout contains a Kernel design and client contract tests;
the corresponding client implementation was not found. This migration uses
the official SDK rather than claiming that missing implementation is reusable.

## Open, sign in, hand off, save

```org
#+begin_browser :id supplier :profile omega-supplier :url https://example.com
C-Enter opens this persistent browser inside bl-ed.
#+end_browser

#+begin_task :id scan :browser supplier-scan :browser-profile omega-supplier-scan
Read the supplier's current notices. Retain sources; do not submit anything.
#+end_task
```

Manual browsers start under human control. Tasks start under Omega control.
The browser is regular, headed Chromium, with stealth disabled and the toolbar
and tabs visible. Old `:mode headless` declarations are accepted for migration
but now open the same headed Kernel browser; there is no mode restart toggle.
The actual browser UA is used without spoofing. Native UA overrides are not
exposed by the pinned Kernel creation API.

- `space b s`: sessions, owners, profiles and saved status.
- `space b w`: live view beside the session, with sign-in and handoff controls.
- `space b p` / `space b r`: human / Omega control, keeping the same browser.
- `space b a` or `space b x`: save the complete profile and close.
- `space b c`: reattach the same browser or check a pending save.
- `space b f`: after closing, delete the profile and its credential vault.

The panel also provides Reopen saved session. It restores saved tabs rather
than supplying `start_url`, which would discard them. A declaration with an
explicit URL deliberately opens that URL when creating a new browser.

Kernel persists profiles on browser deletion or idle expiry, not on CDP
connection closure. Save-and-close waits until the profile's `updated_at`
advances; a pending or failed save blocks reopening. Full profile persistence
preserves site data, tabs and Chromium preferences, not a running process's JS
heap, in-progress downloads or arbitrary unsaved form state. No universal
login-validity claim is made; resume leaves authentication `unknown`.

Only one local host can own a registry, and only one browser can write a
profile. Existing remote writers are checked before creation. Kernel does not
provide an atomic profile-writer lease: use a dedicated project/namespace if
several independently deployed hosts might create the same profile concurrently.
Profiles are snapshots that replace, not merge, state.

The private registry is atomic and mode 0600, its directory mode 0700, outside
the served root. It records session IDs and profile names, not passwords,
cookies, SDK keys, CDP URLs, OAuth tokens or live-view URLs. Host restart
reattaches retained browser IDs under human control; old in-memory task owners
are detached to prevent fresh task IDs from claiming an old browser. A lost
creation response is reconciled by its durable unique name before another
creation attempt. Old local-browser artifacts remain readable; exported local
login state is not silently imported into Kernel.

Host shutdown preserves running Kernel sessions. There is no persistent local
CDP connection keeping them alive. With no browser operations or live viewer,
Kernel's five-minute idle timeout ends the session and saves its profile. Hide
or unload the pane to stop streaming; background tabs detach the viewer. The
panel polls only local session metadata, never browser screenshots.

## Credentials and 1Password

Each profile gets a same-named Kernel vault. Credential controls are available
only in human mode. Their provider URLs are delivered privately to the panel,
never to task documents or model tool results.

**1Password Agentic Autofill**: Link 1Password opens Kernel-managed OAuth on the
human's device. Request this site's login asks for an origin-scoped login;
Check approval polls the request; Fill & sign in fills and submits using the
extension Kernel installs on demand. Credential values are not returned through
Omega. The user explicitly confirms submission. An uncertain or lost fill
response is recorded before the call and cannot be retried in that browser.
Declined/failed login requests can be retried with a fresh item key.

This upstream feature is in preview. It supports logins in private non-shared
vaults; shared vaults and passkeys are unsupported by this flow. It needs a
compatible 1Password account/app and human approval. This is distinct from
installing and manually unlocking the ordinary browser extension, and does
not promise that local desktop biometrics work inside a remote browser.

**Kernel-hosted saved login**: Store login with Kernel opens Kernel's encrypted
collection form; username and password fields are write-only. Fill saved Kernel
login requires the human to specify the current page's CSS selectors. It does
not submit the form. Item bindings use the actual current HTTPS origin read
from Kernel, not a client-supplied destination. Storage fallback is an explicit
human choice; failure in 1Password never silently copies credentials to Kernel.
Manual sign-in in the live browser remains available.

For ordinary extension installation, upload the extension through Kernel's
extension tooling and configure its name in `KERNEL_BROWSER_EXTENSIONS` before
launch. Compatibility/unlocking with the standard 1Password extension still
requires a real account test. Agentic Autofill's on-demand installation avoids
manual extension sideloading for that supported flow.

Forgetting deletes the Kernel profile and its entire credential vault after
closure, while retaining evidence. It does not promise to revoke an external
1Password account grant or destroy legacy local storage exports; manage those
separately in their owning application/private directory.

Authoritative references: [profiles](https://kernel.sh/docs/browsers/profiles),
[save and reuse](https://kernel.sh/docs/browsers/profiles/save-and-reuse),
[live view](https://kernel.sh/docs/browsers/live-view),
[1Password integration](https://kernel.sh/docs/vaults/1password),
[credential collection](https://kernel.sh/docs/vaults/credentials), and
[extensions](https://kernel.sh/docs/browsers/extensions).

## Package and host boundaries

`br.main` exports one pure `bl-package` value. It contributes browser-inbox,
browser-observe and procurement-review layouts and a generic `:embed` view
model. It does not mutate user command/key tables. `ed/unuse` restores every
pane and removes the iframe, without deleting a task's resource.

The vendor host has one generic same-origin iframe painter; no Kernel or Omega
knowledge goes into `ed/*`. The browser host owns session lifecycle, Kernel
capabilities and credential operations. The same-origin panel nests Kernel's
live view, supports clipboard delegation, checks message origin/source, waits
for `KERNEL_PLAYING` and reports connection failure. The agent view is read-only;
human/Omega switching is enforced at serialized automation boundaries. The
read-only viewer parameter is a UI control, not an authorization boundary
against someone who already possesses a writable live-view capability.

Only explicit navigation/agent actions retain screenshots and snapshots.
These can contain private page content and should be treated accordingly.
Neither document refresh nor human sign-in causes a screenshot loop.

## Verification and proof

Local migration verification passed: browser contract tests, all 73 vendor
editor drive tests, the real-editor fixture drive, and presentation equivalence.
Logs are under [proof/kernel](proof/kernel/). The
[cloud check](proof/kernel/cloud-check.txt) stopped with exit 2 because this
environment has no `KERNEL_API_KEY`; no real Kernel browser or 1Password
account was exercised. The live deployment therefore remains unverified.

```sh
npm --prefix spikes/browser test
BLED_OUT=vendor/bl-ed/web/out BLED_ROOT=/home/user/code/undefine/beam-lisp \
  node --test vendor/bl-ed/test/*.test.mjs
PP_OUT=vendor/bl-ed/web/out node spikes/present/test/check.mjs \
  vendor/bl-ed/web/welcome.bl.org spikes/browser/demo.bl.org \
  spikes/present/web/welcome.bl.org
```

Real editor proof uses an isolated offline world. Launch from its directory
because the current `bin/bl-ed` prepends `--root "$PWD"` (existing FUP-012):

```sh
mkdir -p /tmp/omega-kernel-editor-proof
(cd /tmp/omega-kernel-editor-proof && \
  /home/user/code/undefine/omega/bin/bl-ed --offline --memory --port 8836)
node spikes/browser/test/editor-proof.mjs
```

Screenshots: [human live panel](proof/kernel/01-human-live-panel.png),
[Omega live panel](proof/kernel/02-omega-live-panel.png),
[saved session](proof/kernel/03-saved-session.png),
[after unuse](proof/kernel/04-after-unuse.png).
[Editor drive results](proof/kernel/editor.json) explicitly identify the
simulated Kernel service/live-view fixture. The editor, package, host and input
are real; these screenshots **do not establish cloud or 1Password compatibility**.

Contract checks cover the official SDK wire requests, lifecycle, serialization,
writer conflicts, uncertain creation, save ordering, restart recovery, private
capabilities, credential approval/collection and uncertain submission. The
serialized browser operation code is also exercised against actual Chromium.
The default-presentation equivalence checker is unchanged.

With `KERNEL_API_KEY` configured, run `node spikes/browser/test/real-browser.mjs`
for an actual cloud persistence smoke test. It creates its own isolated profile,
sets only synthetic browser-local state, verifies regular UA and restores saved
state, then deletes its test profile/vault. A missing key exits explicitly;
no cloud success is inferred from fixture results. Human 1Password approval
must be checked separately in the live panel.
