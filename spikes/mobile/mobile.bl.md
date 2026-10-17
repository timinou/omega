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

Validation and screenshots are recorded in `proof/android-standalone/`.
