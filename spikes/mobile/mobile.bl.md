# Omega Pocket — the shared machine

2026-10-11. Pocket is a `bl-ed` package over Omega's shared world. Root `env.bl`
launches one host; desktop, phone and shell are clients of that host. Omega uses
its own direct LLM adapter. No external coding harness owns these tasks.

```sh
bin/bl pocket -- --live
bin/bl omega.stop
```

[Launch, Tailscale, context and existing-store adoption](../../research/pocket-shared-world.bl.org)
contains the complete operating instructions. The shared launcher preserves the original durable store; independent stores
remain separate.

## Recorded usage review

[Interactive Pocket journeys](proof/milestone-7B/report.html) show the real package
in desktop, narrow and short layouts, with [after-unuse evidence](proof/milestone-7B/13-unused.png).
The private root-task launch proof exercises shared VM/world reuse, concurrent
clients, durable restart and guarded document undo. The visual audit removes
stale question/summary presentation from terminal tasks without changing their
source history. [Walkthrough](../../!tasks/reports/runtime-cutover/07B-review.bl.org).

## Behavior

- Work projects unresolved questions, active work and completed tasks from shared
  facts. Task actions answer, follow up, cancel and open context. Existing steering
  commands remain available through Commands.
- Places name actual directories, optional parents, homes and settings. Tasks
  freeze their directory and origin; browsing elsewhere changes only the view.
- Documents have their own reader: outline, find, links, return position, explicit
  passage selection and edit/publish. Selected text carries its revision and line
  anchor. The host validates the snapshot before creating work and stores it as
  an input reference as well as model input.
- Commands discovers core and package actions in a chosen pane. Native fields
  drive the editor's existing prompts, including multi-step reference attachment.
  Editor evaluation uses the browser Lisp/editor API. Machine evaluation runs in
  a world-specific human namespace, with `world` bound to the actual system.
- Task answers resolve once across concurrent clients. Other clients refresh
  without changing their focus. Buffer publication retains conflicting drafts
  and accepted history; it never overwrites a conflicting revision silently.

Copy stays short. Placement, weight, rules and restrained accents carry state;
errors and accessible labels remain explicit. The browser surface shares the editor’s theme tokens, structured document
spans and retained task facts. Physical-device validation remains a separate
proof requirement.

## Package contract

`mob/main.bl` exports one pure `bl-package`. The `mobile` layout retains three
ordinary editors and projects their models into package-owned views. Inputs emit
ordinary commands, visits and intents. State lives under `:pkg-state "mobile"`;
user command/key tables are never mutated.

`host/host.mjs` owns DOM, native fields, connection probes and browser resources.
It uses the established package-host lifecycle, removes those resources on unuse,
and restores the page title and document class. The frame returns to an ordinary
editor while the shared world and other clients keep running.

The root immutable frontend graph contains this package and its dependencies.
`spikes/mobile/build.sh` delegates to that build; it no longer installs into the
vendored editor. The explicit temporary workspace demo remains a separate test
entry. No vendored-editor changes were needed in this integration.

## Touch workbench

The approved usage review is implemented in the same package: stable DOM
reconciliation; world-scoped drafts and reading/navigation state; compact tasks
and typed full execution evidence; native place attachment/settings and directory
browsing; recent/pinned buffers; source-mapped reading; typed questions and local
attention triage; attributed file review with guarded undo; contextual command
search and a retained world REPL. Files separates home, input and output roles.
Reading live task references does not manufacture unpublished source edits.

[Touch journey screenshots and receipt](proof/touch-workbench/README.org) include
real bl-ed use and unuse. [Issue-by-issue acceptance](proof/touch-workbench/acceptance.org)
maps the 54-point review to behavior and tests. The proof uses isolated worlds.

## Current proof

### Pocket redesign (2026-10-31)

The [design review](design-review/design-review.bl.org) audited live Pocket on a
phone and proposed one inbox, places from the machine, a goal-first launch, sessions
that say what they are doing, notifications with next steps, and a shaped power
layer. This pass implements all of it, accurately to the reviewed prototypes.

**Modular Beam Lisp.** The screens are pure BL namespaces that build hiccup from
plain view data: `mob.status` (one vocabulary: Your turn · Running · Failed · Done ·
Cancelled; relative time; place hue and monogram), `mob.chrome` (header, tiles,
pills, tab bar), `mob.inbox`, `mob.session`, `mob.launch`, `mob.places`,
`mob.buffers` (Buffers and ⌘K) and `mob.view`, which composes a whole screen.
`mob.html` is the reference serializer on the BEAM. In the browser the host calls
`mob.view/tree` and serializes natively in `host/view.mjs`, because the JS target is
slow at string building but fine at structure (40 sessions: 470 ms → 16 ms). The
host keeps its DOM, field, scroll and IO boundary; reader, file review and Machine
remain host fragments placed inside the BL frame.

**Screens.**
- Work is an inbox: Needs you, Running, Done (collapsed). Place chips filter
  client-side; cards show the question and proposed next steps, answered in place
  (`:mobile/quick`) without opening the session.
- Places lists attached places with live counts; "Add places" discovers git repos
  under `~` (hidden folders and build output pruned), recent first, multi-select,
  with duplicate names prefixed by their parent and a Folder… escape hatch.
- A place opens on its sessions, with Files (git status letters, Omega data
  labelled) and Settings (launch defaults stored in the place's config).
- Launch is full screen: place chips, a large goal, references, and one summary
  line — model · checkout or worktree · permission — that expands into choices.
- A session shows its title once with place, branch and model below; a state
  strip with Stop while running; tool calls grouped as "Ran 2 commands, read 3
  files", humanised per step, raw code and output one tap away; the question ends
  with proposed next steps. Details replace the old eleven-item action sheet.
- Buffers puts Machine, Pelagic and Runtime above recent buffers. ⌘K lists this
  session's actions first, then Go to; `:` evaluates in the world (or this editor),
  `>` runs editor commands in a chosen pane, `@` opens files or any address.

**Motion.** Screens ease or push in, cards rise in sequence, the needs-you accent
grows, running state breathes, sheets spring up, the New session button folds to
its mark while scrolling, tab indicators slide. Reduced-motion turns all of it off.

**Host.** Each task may carry `:task/run` — `{:model :may :branch :worktree
:notify}`. The model overrides the provider per request; read/edit permission is an
instruction to the agent, not a sandbox, and the UI says so; a worktree is created
at `<repo>/.worktrees/<name>` on `omega/<name>` and excluded locally. Agents end
decision points with `#+next: label | instruction`, parsed by `ws.next` into
proposals for the inbox, the session and notifications. `ws.repos` serves repo
discovery and place git info as intents.

**Android.** `pocket.attention` now classifies every session, primes on first poll
so history never floods the shade, honours each session's notify choice, posts
your turn / finished / failed with next steps as actions and an inline reply sent
back as `msg/answer` or `task/say`, and keeps one quiet ongoing summary. The native
toolbar is gone: Pocket's ω mark opens a native connection panel through a
reserved blocked navigation, so the page still has no JavaScript bridge.

**Home.** On phone widths Home hides its own header and dock while Work is active,
so Pocket's chrome shows; instruments keep the workbench chrome.

**Witnessed scenario.** `test/pocket_scenario.bl` states the two-client story with
Beam Lisp's `scenario` module: the phone launches a read-only session in a chosen
place, the desktop sees it waiting and answers from its card, both converge. Its
world drives two real browser sessions through agent-browser (Chromium over CDP),
waits for motion to settle before each tap, and records every claim as witnessed
with a frame per step. It found and fixed a real race: asynchronous draft and route
restoration no longer undo what the person did since the page loaded.

Proof: [screens in the real editor](proof/pocket-redesign/), [verification
receipt](proof/pocket-redesign/verification.log). BL tests:
`spikes/mobile/test/view_test.bl`, `run_settings_test.bl`; Android:
`android/test/home_test.bl`, `attention_test.bl`.

### Pinned user prompt (2026-10-17)

The session title occupies the fixed top bar, with its place immediately below;
there is no separate scrolling title section. The existing compact header is
verified with the current immutable frontend.

Conversation adds a 24px strip immediately below the tabs, showing only the
first line of the user message for the visible part of the conversation.
Scrolling past another user message replaces the strip; scrolling back restores
the earlier one. Long lines ellipsize. Tool results do not become prompts, and
Files, Changes and reference readers have no prompt strip. Scroll restoration
and background model updates recompute the prompt without dispatching editor
events or replacing the conversation DOM.

This stays inside the existing removable `mobile` package's host boundary.
No shared tables or vendored editor source were changed. The immutable build
publishes the same package loader and host assets; the generated compatibility
copy in `vendor/bl-ed/web/out` was refreshed too.

Proof: [real session](proof/prompt-strip/03-conversation.png),
[320px session](proof/prompt-strip/session-320.png),
[after unuse](proof/prompt-strip/13-unused.png),
[browser checks](proof/prompt-strip/browser.json), and
[verification receipt](proof/prompt-strip/verification.log).
The host browser contract checks both scroll directions, multiline and long
prompts, escaping, background updates, tool-only turns, source-only turns, and
empty conversations. The real-editor session test checks the thin fixed strip,
header placement, Files/Changes, narrow/landscape/desktop layouts, and unuse.

### Compact session layout (2026-10-11)

Sessions put their title in the fixed header and their place immediately below
it; the place opens the existing textual context sheet. Conversation, Files and
Changes stay pinned below the header, with a thin selection underline. File
counts deduplicate anchored references; change counts include only session files
with recorded buffer operations, including linked human edits. A quiet dot marks
unread conversation output. Session titles and counts remain available when a
command opens a reference document.

Work / Places / Buffers is absent throughout a session, releasing its entire
height. Returning to another screen restores it with a 180ms slide and fade;
reduced-motion preferences disable that animation. Other screens retain their
navigation even in short landscape viewports. The composer retains its bottom
safe-area padding.

The same removable `mobile` package owns this layout. No vendored editor source
changes or separate rendering loop are involved. The frontend build provides the
same `pkg/mobile.mjs` loader and compiled package to `bin/bl-ed`.

Proof: [session in the real editor](proof/session-layout/03-conversation.png),
[place context](proof/session-layout/04-context.png),
[file review](proof/session-layout/14-review.png),
[after unuse](proof/session-layout/13-unused.png), and
[verification receipt](proof/session-layout/verification.log).
`host-browser.mjs` checks fixed tabs, unique counts, back navigation, reduced
motion and 320px geometry. `touch-browser.mjs` checks the same session chrome
and recorded edit counts through the real editor in an isolated world.

```sh
spikes/mobile/test/verify.sh
```

The gate builds the immutable graph, checks backend ownership/context/recovery,
runs package and vendored-editor drive tests, runs the unchanged default
presentation equivalence check, then drives two independent browser contexts
through the actual root BL launch. The browser contexts use desktop and phone
sizes, a private BL runtime, temporary files and a temporary durable store.
They never access the running world on port 8790 or the legacy Pocket listener.

Current results and real-editor used/unuse screenshots are recorded in
[`proof/shared-world/`](proof/shared-world/). This pass's source and test receipt
is recorded there separately from the original isolated spike.

## Earlier spike evidence

The 2026-10-08 isolated spike recorded 8 package tests, 73 vendor tests,
36 presentation variants, 14 Android assertions and a touch-browser tour.
Those are historical results, not the current integration's test counts.
[Original browser tour](proof/browser.txt), [package tests](proof/drive.txt),
[vendor tests](proof/vendor-tests.txt), [presentation check](proof/equivalence.txt)
and [Android assertions](proof/android-test.txt) remain available.
The original screenshots include [Work](proof/01-work.png),
[conversation](proof/02-conversation.png), [changes](proof/05-changes.png)
and [unuse](proof/13-unloaded.png).

## Android app

The companion in `android/` loads the same real Pocket package over private
Tailscale HTTPS. Install its signed, self-contained ARM64 APK on Android 9 or
later. Connect the phone's Tailscale app, enter the server's HTTPS `.ts.net`
origin (any port, e.g. Work's `:18001`), and tap Connect. The app remembers that origin across
process restarts. Server changes the address; Reload retries the current page.

Task execution and credentials stay on the server. The shell requests only
Internet and network-state permissions. Remote pages have no native JavaScript
bridge, and navigation stays within the chosen server origin.

```sh
# Requires Beam Lisp's standalone Android packaging support and the Android SDK.
spikes/mobile/android/setup.sh
# Optionally install the completed APK onto an attached development phone:
spikes/mobile/android/setup.sh --install
```

`BEAM_LISP_MOBILE_BIN` selects the builder; the default is the sibling
`beam-lisp/bin/bl`. The native app locks mob 0.9.3 independently of Omega's server
compiler. The current output is `android/release/omega-pocket-0.1.1-arm64-v8a.apk` plus its
SHA-256 receipt. The signing key and password stay outside the repository under
`~/.local/share/omega-pocket/signing/`; retain them for compatible app updates.

The APK contains OTP, Beam Lisp, libraries and the app's namespaces. First launch
verifies and installs its runtime into private storage. No runtime push or USB
connection is needed. Bundle upgrades preserve the saved server address and
replace the bundled runtime together. The release build disables Erlang
distribution.

### Notifications

While a server is connected (including a remembered one at launch), the native
screen polls the host's own `workspace:all` document every 30 s
(`pocket.attention`, pure) and posts one notification per task that is waiting
for an answer, on the high-importance channel "Needs you". An unchanged
question is announced once; a changed question re-announces; a task that is
answered, cancelled or finished is withdrawn. Tapping a notification brings the
app forward and opens that task (`?pocket=task&at=task:<id>`, the editor's
existing route parameters). Android 13+ asks for `POST_NOTIFICATIONS` on first
connection. No new host API, credential or port: the poll uses the same
Tailscale-HTTPS origin as the WebView. `release.py` keeps that permission and
beam-lisp's `BlNotifyReceiver`; the listener, reader and overlay services remain
stripped.

Limit: polling runs only while the app process is alive. There is no push
service, so a task that asks while the app is fully stopped is announced on the
next launch.

Status: desk tests only (`attention_test.bl`, `home_test.bl`). The APK has not
been rebuilt with this change and nothing is verified on a device.

Validation and screenshots are recorded in `proof/android-standalone/`.

### Harness APK (2026-11-05)

The signed ARM64 update is `android/release/omega-pocket-harness-0.1.3-arm64-v8a.apk`
(versionCode 2026110501). It uses the existing Pocket application/signing identity.
It defaults to `https://work.tailcb5318.ts.net:18079`, preloads the real Live package,
and stores its server selection in `pocket-harness-origin`, leaving the ordinary
Pocket account address in `pocket-origin` intact. The APK contains no model credentials;
the real task runs on the dedicated offline host.

Private tailnet download:
`https://work.tailcb5318.ts.net:18080/omega-pocket-harness-0.1.3-arm64-v8a.apk`.
Enable Tailscale on the phone before opening it. Work services
`omega-live-harness-20261105` and `omega-live-harness-apk-20261105` own the host and
download endpoint. The account world is unchanged.

`nix/pocket-harness.nix` builds the app modules remotely through `bin/omega-build`
using the tested base APK's own portable compiler/mobile SDK. Its host-only NIF
must match that SDK; it never enters the new runtime. `app_update.py --variant harness`
overlays the modules, adds the notification permission/private receiver already
implemented in the base DEX, patches the version and signs on Work with the
existing key. Signing secrets remain outside Nix. The base's native libraries,
DEX/resources and all 7,623 non-app runtime entries remain byte-identical.

Verification: signature and update certificate match, 12 shipped modules equal
the remotely compiled/tested modules, packaged defaults/Live loading/TLS origin
validation/exact proposal notification actions pass, and the HTTPS APK has the
correct MIME type and checksum. Evidence: [release receipt](../live/proof/apk/release.json)
and [packaged contract](../live/proof/apk/packaged-contract.log).

The isolated Android 15 emulator installs the APK but cannot complete OTP boot
(`erl_child_setup` failure under ARM translation). The unchanged 0.1.2 base
reproduces the same failure before Pocket initialization. Physical-device launch
and notification delivery are not verified in this session.

## Pocket 0.1.5 startup investigation (2026-11-06)

A physical-phone report found an immediate black APK screen while the exact
Pocket URL loaded successfully in the phone browser. Host-VM contracts had not
established native phone startup. The cause is not yet confirmed.

0.1.5 removes the crypto NIF dependency from the first-screen device identifier;
it is a routing label, not an authentication token. The packaged contract now
initializes the app, mounts its actual Mob socket and renders the first WebView.
A remotely built launcher overlay shows installation/VM startup progress until
Mob commits its root. Startup details are stored locally and copied only on
request; there is no automatic log upload. The existing native harness still
owns the screen. A browser button opens the same server-side workbench.

The signed update retains settings, the existing certificate, native libraries
and all 7,619 non-app runtime entries. Only the startup DEX and AOT app modules
change. `nix/pocket-startup.nix` runs on Build; `app_update.py --shell-dir` checks
the base launcher hash before accepting its two DEX entries. Signing stays on Work.

[Download Pocket 0.1.5](https://work.tailcb5318.ts.net:18001/downloads/omega-pocket-harness-0.1.5-arm64-v8a.apk).
[Startup screenshot and receipts](proof/startup-20261106/). The native loading
screen was observed on the isolated Android emulator. That emulator still cannot
complete ARM helper execution; physical-phone confirmation is pending.

### Pocket 0.1.6 — confirmed startup crash fix

The phone's copied diagnostics identified `undefined var: pocket.home/true?`
in `developer?`, called from the immediate `:start` handler's device report.
After six restarts Mob correctly gave up, leaving no screen. The failure was
reproduced using the actual 0.1.5 modules and bundled SDK on the host.

The phone SDK has no `true?`; use `(= true value)`. The packaged gate now tests
the real `:start` handler through its first device poll, toggles developer mode
both ways, and renders the connection panel. Only the HTTP implementation is
stubbed inside the disposable test VM; no request reaches the live host.

[Download 0.1.6](https://work.tailcb5318.ts.net:18001/downloads/omega-pocket-harness-0.1.6-arm64-v8a.apk).
[Reproduction, passing startup contract and signed receipt](proof/startup-20261106/fix-0.1.6/).
The signed APK's actual app modules and startup DEX match the remotely tested
outputs. It retains the existing signing identity/settings and startup details.
Physical-phone confirmation after this fix is still pending.
