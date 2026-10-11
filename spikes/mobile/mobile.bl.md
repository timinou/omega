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

## Optional Android companion

The companion is in `android/`, using the sibling `beam-lisp--mobile` worktree.
Its native connection screen accepts an HTTPS `.ts.net` origin on port 443 or
8443 and then loads the exact editor URL above. Navigation is restricted to
that origin. No agent credentials or Erlang-distribution port are exposed over
the network; Tailscale handles transport and device access.

```sh
# Build the ARM64 debug APK; the mobile worktree must be present.
spikes/mobile/android/setup.sh
# With one development phone attached by USB:
spikes/mobile/android/setup.sh --install
```

`BEAM_LISP_MOBILE_BIN` can select a different checkout's `bin/bl`. The app pins
mob 0.9.3 in its own lock file and does not change Omega's compiler pin.
The default app ABI is `arm64-v8a`; use `x86_64` in its env for an emulator.
As in the mobile framework's documented development flow, **install alone is
insufficient**: `android push` copies the runtime and compiled namespaces onto
the device, and `android up` launches it. The setup script performs all three
when passed `--install`.

The ARM64 APK build succeeded at:

```text
android/_build/android/android/app/build/outputs/apk/debug/app-debug.apk
```

Native connection validation and screen trees pass 14 desk assertions. The
Android doctor found SDK, NDK, JDK, Zig and mob runtimes, but no attached device.
On-device startup, keyboard behavior and TLS loading remain unverified. The
browser version requires no Android build and is the directly usable prototype.
