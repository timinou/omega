# Editor / UI / inspector / debugger unification: omega vs. a 2030 Lisp machine

*Area: bl-ed, omega-ui `live.app`, the packages contract. Read-only survey; no source was changed. Every claim cites a file I read.*

## 1. Where omega is today

**Two front ends, one of them the future.**
- `omega-ui` (`src/omega/ui/web.bl`, `screens.bl.md`, `model.bl`) is a server-rendered `live.app`. Screens are pure `state → hiccup`, patched over a socket. The only writes are three intents (`:new-task :say :answer`, `web.bl` `intents`). Clicks are `[:assign …]` locals or `[:intent …]`. A row is not a typed object. The screen is a closed dashboard with no inspect action and no generic object model. Streaming deltas are mirrored into an ephemeral `ui` conn (`stream-pump`).
- `bin/bl-ed` (`src/omega/ed/main.bl`) runs the task world and the editor server in ONE VM. It serves `vendor/bl-ed/web`. Documents need not be files: schemes `omega:` `task:` `q:` `effects:` `bl:` come from providers (`src/omega/ed/providers.bl`). Every view is an org document with a rev and a `:objects` table of `{:row :type :key}`. The README makes bl-ed the direction: "every view is a document".

**Presentations exist, in embryo.**
- The row under the cursor can BE an object. `ed/keymap.bl` `presentation-binds` gives a type's keys priority on that row. `ed/omega.bl` `presentation-keys` binds types `omega/task`, `omega/msg`, `omega/cell`, `omega/trace`, `omega/effect`, `bl/ns`, `bl/var`. Example: `y/n/a` answers an ask, `e` shows effects, `c` copies a cell to scratch, `r` reloads a var.
- The same keys work wherever the object appears (card, overview, query table). That is the Genera idea of a presentation, but it is keyed by row and is keyboard-first. A click only moves the cursor (`web/host.mjs` mousedown dispatches `:click` with a row/col).
- `research/domain/interface/presentation-pipeline.bl.md` and `spikes/present/pp/*` design the full pipeline: readtable → presenters (isa chain, `:around` advice, LOD) → marks → layout. The doc states the CLIM/Genera lineage outright. Equivalence is tested 785/785 and 38/38. It lives in a spike (`spikes/present/pp/present.bl`), not the vendored core.

**Packages and frames are a real, disciplined extension model.**
- `vendor/bl-ed/ed/pkg.bl` makes a package a plain map. Its layers are `:commands :keys :intercept :on-event :adopt :render :provides :owns`. They are consulted, never merged. `unuse` is exact.
- `ed/frame.bl` + `research/domain/interface/frames.bl.md` give Genera-style program frames: editor panes, view panes, links (a rail selection visits the main pane).
- `AGENTS.md` makes this a rule: any spike that touches the editor must be a package, pure, with a drive test and an equivalence check.
- `ed/omega.bl` is still statically installed in `ed/main.bl` and not yet a package (VENDOR.md "moves into omega's package with FUP-010").

**Live image, read-only-ish.**
- `vendor/bl-ed/src/bl_ed/image.bl` gives `bl:` / `bl:<ns>`. It marks each var as ✓ matches, ✎ changed, ⚠ live-only, + not loaded or lazy, by form hash against the source. Intents `bl/reload` (through `reload/commit`'s coherence gate) and `bl/undefine`. `space a i` opens it. This is the nearest thing to a Genera namespace/inspector.
- The editor's `:` line evaluates real BL, but IN THE PAGE (`ed/main.bl` `eval-command` → `js/eval-ed`, bound to the `ed` API). `:eval-cell` goes to the BEAM through a provider's `:eval`. In practice only task cells and scratch cells with `:ns omega.task.<id>` run (`providers.bl` `scratch-provider :eval`). A cell run this way is replayed to the task as a steer message.

**Debugger / condition system: absent.**
- A failing eval cell returns `{:error text}` plus stdout (`src/omega/codemode.bl`, lines ~88–95). A cell is killed by deadline or heap cap and its OS processes are reaped.
- There are no restarts, no stack inspection, no "fix and continue". `grep` for restart/debugger/backtrace finds only OTP supervisor restarts and design prose. `impeccable.bl.md` §7.4 specs a tool-call inspector that is not built.
- Beyond the `bl:` document, nothing makes a process, mailbox, datom or conn clickable.

**Provenance and effects are summarised, not live.** `providers.bl` `effect-rows` extracts effects by REGEX over cell source (`(edit|write …)`, `(sh …)`). The doc itself notes sh effects are `:opaque` until the jail (FEAT-021) lands.

## 2. What a 2030 Lisp machine would have

1. **One image, one address space.** The editor, REPL, debugger and inspector all run in the SAME live image as the objects they show. There is no page-VM and server-VM split.
2. **Presentation types as the universal UI substrate** (Genera/CLIM). Every printed object is a presentation with a type, a source object and a context-sensitive command set. The mouse is the primary way to say "this one": click ANY object (a task, a datom, a pid, a stack frame, a model turn) and get the command menu for its type. `accept` also reads typed values back (this is `present`'s dual).
3. **Zmacs/Dynamic Windows.** The buffer is an object; the editor can edit any object's printed form; the output history is a scrollable, re-inspectable record rather than text.
4. **Condition system + debugger as first-class UI.** An error signals a condition with restarts. The debugger is a live window onto the suspended stack: frames, locals, edit-function-and-resume, return-from-frame. Agents hit the same debugger and may pick restarts; the human may take over the same suspended computation.
5. **Persistent objects and time travel.** The inspector shows any object's history. `Undo` crosses sessions; redefining a function is undoable and versioned (Genera's patch/versioned definitions).
6. **AI-native.** The agent uses the same presentations and commands as the human (not a parallel API), sees what the human is pointing at (attention), and its edits and debugging are visible in the same buffers and frames as the human's.

## 3. The gap

| dimension | omega today | 2030 | size |
|---|---|---|---|
| single image | task world + editor server in ONE BEAM VM (`ed/main.bl`), a real step. But the editor runs in a browser JS VM, and `:` evals there. | one image | **M**: the editor cannot `:`-eval against the world. |
| presentation types | keyed rows, `:objects` tables, `presentation-keys`; pipeline designed + spiked (`spikes/present`) | any object, mouse + keyboard, `accept` | **M**: foundation is right; it needs generalising and promoting from spike to core. |
| click-any-object inspect | none; click = move cursor (`host.mjs`); live.app screens have none | universal | **L**. |
| inspector | `bl:` namespace/var table; task/effects docs; no value inspector, no datom/process/conn/mailbox inspector | universal | **L** |
| debugger / conditions | `{:error text}` string to the model; none for the human | restarts, live stack, resume | **XL**. beam-lisp has no condition system, so this needs a design decision first. |
| editor/REPL/inspector unity | `bl:`, `q:`, `task:` documents are in one editor (good). Eval results are echoed as text, not as presentations. | unified | **M** |
| package/layer discipline | exact `unuse`, layers, frames. Arguably AHEAD of Emacs. | same, plus runtime reload | **S** |
| live redefinition | `bl/reload` through the coherence gate; var-level drift (`image.bl`); no undo of a reload, no per-definition history (`spikes/live-image.bl.md`) | versioned definitions | **M** |
| two UI stacks | omega-ui (hiccup/live.app) and bl-ed duplicate the task views (`screens.bl.md` vs `ed/render.bl`) | one | **M**: the README already points at bl-ed. |
| AI-human symmetry | humans act via intents (`task/say`, `msg/answer`); agents via `eval`. Human re-running a cell goes back to the agent as a steer (`providers.bl` `:eval`). Good. No shared attention/cursor yet (designed in `bl-ed.bl.md` §5, not built). | symmetric | **M** |

Net: omega's *design* is already Lisp-machine-shaped (documents-as-views, presentations, frames, layers, provenance). The *build* is a dashboard plus an org editor. The core missing pieces are universal object presentation, a debugger, and an in-image REPL.

## 4. Three concrete next steps

1. **Make presentations an object model rather than a row table, and add a click/menu path.**
   - Promote `spikes/present/pp/present.bl` + `read.bl` into a vendored `ed/present.bl`. Keep the equivalence check (`spikes/present/test/check.mjs`) as the gate, per `AGENTS.md`.
   - Add a generic `:inspect` command to every presentation type, and a context menu on click and right-click in `web/host.mjs` that lists the type's `presentation-keys`.
   - Register types for datoms, entities, pids, turns and cells (`providers.bl` already emits `:objects`). `RET`/click on any of these opens a `inspect:<ref>` document through a new provider.
   - Success test: a drive test that clicks a `bl/var`, a task, a datom and a pid and gets distinct, typed command menus.

2. **Give the human the same eval the agent has: a `:`-line that runs in the world VM, with typed results.**
   - Route a second command-line mode (`::`, say) through an intent to `cm/run-eval` (`codemode.bl`) against the live omega image. Return the value as a presentation (a `:objects` row) instead of echoed text, so results are clickable (step 1).
   - Keep the page-local `:` for editor config. This closes the editor/REPL split without breaking the pure-editor rule in `AGENTS.md`.
   - Test: eval `(task/all sys)`, click a returned task.

3. **A minimal debugger as a document: failed cells become a `debug:<cell>` suspended-frame view with restarts.**
   - Today a cell error is a string. Capture the error value, the cell form, the bindings and the call trace (`erlang:trace` is already in `spikes/fs-capture.bl.md`) in the effects/provider store. Render it as an org doc with presentation rows (frame, binding).
   - Start with three restarts as intents on the existing seam: `retry`, `edit-and-retry` (opens the cell in scratch with `:ns omega.task.<id>`; this already exists), and `abort-task`. Give the agent the same restart list, via the existing steer path.
   - Real condition-system semantics (resumable signals) are a beam-lisp upstream question; record it in `research/domain/synthesis/decisions.bl.md` rather than building around it.

**Side effort (cheap, unblocks the rest).** Finish FUP-010: move `ed/omega.bl` out of the vendored core into a real package, so every addition above is an `unuse`-able layer. Then retire the duplicate omega-ui screens, or have it embed the bl-ed pane host.
