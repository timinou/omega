# Omega Pocket — a phone workbench

2026-10-08. A new bl-ed package, `mobile`, over `present`, `dwim`, `workspace`,
`places`, `references`, `buffers` and `workbench`. The optional Beam Lisp Android
companion hosts **the same editor URL and package**, rather than implementing a
second agent client. All demonstrations use isolated scripted worlds, never the
running world on port 8790.

## Try it with real files

```sh
spikes/mobile/live.sh /home/user/code/undefine/omega 8812
```

`live.sh` mounts the directory as the `project` place, starts the real Omega
model adapter, and keeps durable tasks and buffer history separately under
`~/.local/state/omega-pocket/<project-path-hash>/`. Set `OMEGA_MOBILE_STATE` to
choose another state directory. It creates no sample files and starts no
sample tasks. Publishing a file changes the actual project file.

The review machine runs this command as the enabled user service
`omega-pocket.service`. It restarts after a crash and starts at user login:

```sh
systemctl --user status omega-pocket
systemctl --user restart omega-pocket
journalctl --user -u omega-pocket -f
```

The real model uses the project's `.env` and process environment
(`OMEGA_BASE_URL`, `OMEGA_MODEL`, and `ANTHROPIC_API_KEY` for direct Anthropic).
The default model proxy is local to the server. On the review machine,
`omega-pocket-model.service` runs the existing better-ccflare installation on
**127.0.0.1:8080**, with its existing account. Pocket wants and starts after that
service. Both restart on failure and start at user login.

The service reads `~/.config/omega-pocket/model.env` (mode 600):

```sh
OMEGA_BASE_URL=http://127.0.0.1:8080
```

The phone's Tailscale HTTPS address reaches Pocket; `OMEGA_BASE_URL` reaches the
model from Pocket's server process. They are separate connections. Keep the
model proxy on loopback. After changing model configuration, use
`systemctl --user restart omega-pocket`. For connection-refused errors, check:

```sh
systemctl --user status omega-pocket-model omega-pocket
curl -I http://127.0.0.1:8080/
```

A failed task is not replayed by restarting the services. Retry it from the UI
when the model is ready. File browsing/editing does not require a model.
The configured `claude-sonnet-5-5` model was verified with a real, tool-free
request returning HTTP 200 and `OK`.

Open:

```text
http://127.0.0.1:8812/?file=workspace:all&use=present,dwim,workspace,places,references,buffers,workbench,mobile&layout=mobile
```

Tap **Places → omega → a file** to inspect real text. Tap **Edit**, change text,
then **Publish** to save it. Tap **+**, choose omega, and enter a goal to start a
real task once the model endpoint is running. Mobile task state is independent
of the world on port 8790.

For the original scripted demo instead:

```sh
spikes/mobile/build.sh
spikes/mobile/run.sh /tmp/omega-mobile 8814
```

The demo runner accepts only `/tmp/` roots and refuses port 8790. The browser
proof uses an isolated demo world, never the real project. The package build
also accepts `--package-only` after its dependencies are built.

## Private phone access in three steps

1. Install Tailscale on the phone, sign into the same tailnet as the computer,
   and switch it on.
2. On the computer run:

   ```sh
   sudo tailscale serve --bg --https=8443 http://127.0.0.1:8812
   tailscale serve status
   spikes/mobile/connect.sh 8812
   ```

   Sudo requires your password. If Tailscale prints an HTTPS enablement link,
   follow it and rerun the Serve command.
3. Open `spikes/mobile/.local/phone-qr.png` on the computer and scan it with the
   phone camera. The QR opens the real Pocket editor. Add the page to the home
   screen for subsequent visits. `connect.sh` prints the same HTTPS URL.

The QR contains a URL, not a credential. Tailnet membership and grants enforce
access; scanning alone does not enroll a phone. The host binds **127.0.0.1**
and Serve makes it reachable only through the tailnet. Anyone permitted to
reach this endpoint can use its editing/task API; restrict the host's tailnet
grant to your intended devices. No Funnel or public listener is enabled.

Serve's `--bg` mapping survives Tailscale and machine restarts. The Pocket user
service survives terminal closure and restarts on failure; it starts at login.
Keep the computer awake and online. The mobile host checks connectivity and
reconnects, but browser reloads still clear unsent reply drafts.

The service is running locally. Serve was **not enabled automatically** because
this machine requires an interactive sudo password.

### What the relay repository contributes

Inspected `/home/user/code/ora/relay`, including `docs/tailnet.md`,
`docs/tailnet-maximalist.md`, `docs/tailnet-executors.md` and deployment proof.
Relay is a model gateway with virtual-key authentication and a remote executor
capability design. Its existing simple private-network path uses Tailscale or
Headscale; no ready-made phone/browser QR pairing tunnel was found.

For this prototype, an existing Tailscale account plus Serve and a QR link is
less work than operating a Headscale coordinator or adding a new relay-based
pairing protocol. Headscale offers self-hosting rather than fewer phone setup
steps. A scan-only flow without installing/signing into Tailscale would require
an authenticated application transport with device enrollment, revocation and
reconnection; a public URL plus a QR code does not provide that protection.

References: [Serve persistence](https://tailscale.com/docs/reference/tailscale-cli/serve),
[Android setup](https://tailscale.com/docs/install/android),
[connection fallback](https://tailscale.com/docs/reference/connection-types).

## The experience

- **Work** puts questions first, then active and finished tasks. Cards include
  their place, current status and the actual question or summary. A bottom sheet
  filters by place, including descendant tasks through the existing provider.
- **Conversation** gives the pending question large Yes/No/answer controls, an
  ordinary native textarea, and folded execution details. Source remains
  inspectable through Actions. The composer follows the phone viewport.
- **Plan** opens the actual linked home at its block, or the task's working
  file through Actions. Checklists edit real heading state; source editing and
  Publish use shared-buffer revisions. Task blocks expose Start / open and
  their resulting references lead to the conversation.
- **Changes** shows the actual accepted buffer operations with attribution,
  old/new text and guarded selective undo. These are buffer operations, not
  an invented Git diff or unaccepted agent suggestions.
- **Places** browses the hierarchy, physical folders and files. Place details
  expose inherited settings and let you view tasks or create work there.
- **New task** asks for a place and a goal. **Follow-up** retains the finished
  task's place and frozen cwd. No schema map is required.
- **Host** shows connection health and explains the private connection. Failed
  sends preserve the reply and release the in-flight guard so it can be retried.
  Offline controls disable submissions and publication; local editing remains available; there is no background replay queue.

The visual treatment uses warm paper, forest ink, peach attention cards, lilac
status accents, readable system typography, generous touch targets and a quiet
three-item navigation bar. Portrait phones get one full-width surface; larger
windows show a centered pocket view. Keyboard focus and selection survive
updates, and IME composition defers DOM replacement until committed.

## Package and host contract

`mob/main.bl` exports one `bl-package` value. Its `mobile` frame layout retains
three ordinary editors (work/place rail, task conversation, working text) and
three package-owned views of them. The editor panes continue to receive normal
provider loads and revision watches. The phone surface paints their models;
it does not run a private editor loop or alternate task engine.

Commands and custom events are pure functions of editors and events. State
lives under `:pkg-state "mobile"`. Touch actions emit ordinary named commands,
visits and intents. Custom events explicitly run package after-hooks so whole
file input participates in the buffer draft protocol. File navigation refuses
to replace dirty text while the retained conversation stays available. Reply
strings are keyed by task address and survive task switches and document tabs.
Quick Yes/No answers do not consume a separately composed reply.

`host/host.mjs` is a package-owned IO/DOM resource, mounted through the existing
`package-hosts.mjs` seam used by Pelagic. It owns its stylesheet, connection
probe, event handlers and DOM mounts; dispose removes them and restores the
page title and document class. It never merges user commands or keys. The
loader is generated at `vendor/bl-ed/web/pkg/mobile.mjs`; compiled BL lives
beside the editor in `vendor/bl-ed/web/out`.

`:(ed/unuse "mobile")` or Host → Return to bl·ed removes the package and its
view resources. The frame returns to the ordinary editor. A no-interaction
use/unuse preserves the editor's original data and user tables; drive tests
cover the contract and frame-wide removal. Published task/place/buffer facts
remain facts, as in the existing packages.

Two generic browser-host fixes are recorded in `vendor/bl-ed/VENDOR.md`:
failed intent responses retain their continuation context, and save effects
can request `:require-server? true`. The mobile Publish command uses that flag
so a network failure cannot be mistaken for successful host publication by
falling back to a local file download.

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

## Verification and proof

Run the compiled package, vendor and unchanged presentation gates:

```sh
spikes/mobile/test/verify.sh
```

For the touch/browser tour, use a **fresh isolated demo root**, since it creates
tasks, answers questions and edits files:

```sh
spikes/mobile/run.sh /tmp/omega-mobile-tour-new 8814
# In another terminal:
cd spikes/mobile
npm ci
MOBILE_PORT=8814 npm run browser
```

The tour captures real bl-ed screenshots and checks actual HTTP documents,
not a fixture page. It covers native typing, distinct task drafts, plan and
working-file navigation, dirty guards, failed and successful publication,
question answering, selective undo, failed-send retention, reconnection,
place-scoped creation, six viewport sizes and package/resource unload.

All checks passed: 8 package tests, 73 vendor tests, 36 presentation variants,
14 Android assertions, and the complete touch-browser tour with no browser errors.

Evidence:

- [Work](proof/01-work.png), [conversation](proof/02-conversation.png),
  [anchored plan](proof/03-plan.png), [published working file](proof/04-published-file.png).
- [Changes](proof/05-changes.png), [offline host](proof/06-offline.png),
  [places](proof/07-places.png), [place details](proof/08-place.png),
  [new task](proof/09-new-task.png), [scoped work](proof/10-scoped-work.png).
- [320px phone](proof/11-responsive-320.png), [landscape](proof/11-responsive-844.png),
  [tablet](proof/11-responsive-768.png), [wide window](proof/11-responsive-1440.png).
- [Host](proof/12-host.png), [real editor after unload](proof/13-unloaded.png).
- [Package drive tests](proof/drive.txt), [vendor tests](proof/vendor-tests.txt),
  [presentation equivalence](proof/equivalence.txt), [Android assertions](proof/android-test.txt),
  [touch-browser tour](proof/browser.txt).

## Research translated into the prototype

[Claude Remote Control](https://code.claude.com/docs/en/remote-control) suggests
continuity with the local session. [Happy](https://github.com/slopus/happy) and
[Paseo](https://github.com/getpaseo/paseo) show the value of a dedicated mobile
client and a common interface across coding engines.
[Omnara](https://remote.omnara.com/) emphasizes attention across concurrent work;
[VibeTunnel](https://github.com/amantus-ai/vibetunnel) preserves access to the
actual execution surface. Pocket combines an attention list with conversations
and a short path to the actual working documents. Voice input can use the
phone keyboard's dictation; push notifications and native voice integration
are not implemented.

The seeded agent is the existing **scripted offline board model**. Its real
file edits, message answers, place context and buffer operations are exercised,
but this spike does not install a production model adapter or control external
Claude/Codex processes. Production execution remains the workbench's documented
`:step` adapter integration. Reply drafts are session-local and browser reloads
clear them; durable shared drafts across devices are outside this prototype.
