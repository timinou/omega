# Live: edit the running world through Changes

This is a removable bl-ed package, `liveview.main/bl-package`, over one
world-owned Beam Lisp experiment. The frontend and test runtime use public
Beam Lisp v2026.10. This checkout's pins change; the installed live account
host and frontend are not cut over.

Run `spikes/live/run`. It builds the compiler selection and frontend through
`bin/omega-build` on Build, then starts an offline, in-memory host on 8792
with a fresh `/tmp` root. Open the printed editor URL. `LIVE_PORT` and
`LIVE_WORLD` can select another disposable instance. Never point a test at
the account world.

1. Start the demonstration. Choose Claude, Codex or DeepSeek, then a publication
   policy. Run harness opens a real, model-driven Omega task to change the worker
   to count by five while preserving its PID, protocol and accepted work.
2. The task reads the running target and edits `live-worker.bl` through CodeMode
   and the existing shared buffer port. Rehearsal leaves the old worker serving.
3. In review policy, submit records an exact proposal and parks the model turn.
   Open harness task in Pocket: its existing question card offers Apply, Revise
   and Discard, each bound to this proposal. The same choices are in Live.
4. Apply resumes that same task. It applies the approved candidate, verifies
   two requests through the original client protocol, and finishes. The worker's
   world-owned traffic continues after the task finishes.
5. Scoped policy authorizes only the exact count-by-five source edit on this
   owner and runtime epoch. The controller rejects any wider edit. Passing
   changes apply without another decision.
6. Choose an earlier behavior from history, rehearse and apply. This installs
   another generation against current state; accepted work and later source
   remain. Manual source editing, invalid migration refusal and Changes return
   actions are still available alongside task-driven editing.

`space r l` opens the drawer beside the current layout. Closing it or
`:(ed/unuse "live")` retains every existing editor, draft and user table.
It uses the shared inspector renderer and package-provided layout value;
there is no private editor, render loop or execution scheduler.

## One history, two kinds of publication

The existing shared-buffer service still owns source publication and
attribution. Its operations gain an optional `:op/runtime` value. Rehearsals,
refusals, applications, discards and returns append operations on that same
buffer, including the source snapshot, before/after image identities and
outcome. The existing Changes provider returns them. Live projects those
operations; it does not keep a second durable timeline.

Source publication and VM publication are separate. A return never silently
rewrites the current file. The drawer explicitly reports source/image drift.
Failed candidates remain visible. Inspections read owner status and the most
recent actual worker result; they do not dispatch business messages or advance
the actor revision.

## The harness is a participant

The `live` world tool remains available across package execution profiles; a
package cannot replace it by changing its own tool table. Inspect, rehearse,
submit, apply, verify, receipt and discard use the same owning controller as
Live. CodeMode source writes and live operations carry the actual task and cell.

The visible harness uses the configured provider's real API through
`omega.llm/step`. It is an ordinary durable Omega task, not a scripted consumer.
Provider selection is explicit; an unavailable provider produces a task failure
rather than silently changing providers. Claude uses Messages, Codex uses
Responses with retained reasoning items, and DeepSeek uses Chat Completions.
Credentials stay host-side in the configured environment; they do not enter the
frontend or Nix derivations. Optional `OMEGA_CLAUDE_MODEL`, `OMEGA_CODEX_MODEL`
and `OMEGA_DEEPSEEK_MODEL` select models.

World-owned traffic exercises the original worker protocol every 500 ms. It is
independent of the model/task lifetime; cancelling or finishing an editing task
leaves the application running. Submitting a review proposal parks the turn
without another model request, and any later calls in that same batch are
recorded as not run.

`omega.change` stores proposal identity, task, source/basis, runtime epoch,
policy, question, exact decision, publication intent, receipt and verification in
the same world fact store. The question and ready proposal commit atomically.
These are change states, not another task engine. Each lifecycle event also
appears in the existing shared Changes history. Free-text replies request a
revision; they cannot authorize publication. First exact decision wins.

Before publication the controller checks task ownership/liveness, policy,
approval, candidate, installed generation, source and outstanding drafts. An
apply retry returns the exact durable receipt without another native commit.
A task ending cannot revoke a commit already accepted by its owner. These are
publication checks; CodeMode retains Omega's existing full host rights.

A stable per-world controller owns candidate preparation and the initializer's
resource bindings. Beam Lisp's retained candidate graphs and `proc.evolve`
own rehearsal, preparation, revision comparison and publication. An obsolete
source or candidate ID refuses. Confirmed stale preparation is retried with
current state, at most three times; an uncertain publication is never replayed.
The experiment's call gate finishes accepted worker calls, queues new calls
for the preparation/commit window, and then resumes them under the original
request protocol. Compilation and rehearsal leave that gate open. This is a
cooperative admission boundary around the owned worker, not a general VM pause.
Mutation is restricted to the
worker this offline experiment owns; an observed PID grants no authority.

## Pocket and desktop, one world

Open the same offline host with
`?use=present,dwim,workspace,places,references,buffers,workbench,mobile&layout=mobile&file=workspace:all`.
In Pocket, choose Buffers, then Live. The package loads on demand and occupies
the available viewport, including landscape and tablet widths. Closing it
restores Pocket's existing layout and retained editors.

Open worker source uses Pocket's file editor; Open harness task uses the
existing task conversation. The Work list and unsent task reply survive those
visits. Publish in the source editor still only publishes source; rehearsal
and apply remain explicit Live operations. Both clients see the same worker,
candidate, history and task. This is a web preview, not a rebuilt Android APK.

The [harness lifecycle audit](../../research/domain/coordination/harness-live-editing.bl.org)
maps the implementation, current contracts and remaining generalization work.
The next extension is another explicitly owned application target, followed by
supported harness components; the current target remains this isolated worker.

## What a checkpoint promises

It records source and code identity with state observations. A return is a
checked forward transition to earlier behavior using current state. It is not
a heap, mailbox, database or external-effect rewind. Invalid conversion refuses.
An unconfirmed publication is reported as uncertain and is never automatically
replayed. The prototype retains at most 16 candidate graphs. Proposal records and receipts
survive reopening a durable world, but native candidates and the demo worker
are VM-local. A runtime epoch change makes pending proposals stale and interrupted
publication intents uncertain. Recovery never reconstructs a VM preparation or
replays publication. This is not automatic recovery of the worker's live state,
arbitrary server migration or replacement of the native SDK/OS in place.

## Proof

`test/live_test.bl` covers review parking and continuation, exact decisions,
controller policy, cancellation, stale source, receipts, restart classification,
shared Changes and current-state returns. `test/llm_test.bl` covers provider wire
formats and Responses reasoning/tool-call continuation. `test/task_test.bl`
checks that parking stops later calls in the same model batch.

Opt-in real-provider proofs:

- `spikes/live/test/providers.bl`: real tool call and continuation for each
  configured provider; prints model identities, usage and error categories only.
- `spikes/live/test/harness.bl`: a real provider edits source, rehearses, parks,
  resumes after a decision, publishes, verifies and finishes. `LIVE_PROVIDER`
  selects the provider. Uses a fresh durable `/tmp` world and cleans it up.
- `spikes/live/test/harness-browser.py`: the same flow through actual desktop
  and Pocket controls, including unsent reply retention and package removal.
  `mobile-browser.py` delegates to this real-harness walkthrough.
- `spikes/live/test/browser.py`: manual editing, invalid migration refusal,
  return through existing Changes, and exact workspace retention on unuse.

Set `LIVE_FRONTEND` to the remotely built candidate and `OMEGA_BL` to its
matching compiler. Browser proofs require Playwright; `LIVE_CHROMIUM` can select
an installed Chromium. All tests own disposable offline worlds.

Current evidence is under `proof/harness/`: real provider transcripts and task,
proposal, receipt and verification records; phone review/completion screenshots;
desktop Live; Changes; after unuse; browser assertions and regression logs.
Earlier mechanism and mobile proofs under `proof/` and `proof/mobile/` remain
historical evidence. The default presentation checker is unchanged.

Recorded verification: 89 Live assertions, 67 provider assertions, 44 task
assertions, and the 241-assertion compatibility suite (task assertions overlap).
The compiled Pocket/Live drive has 26 passing tests; all 89 editor tests pass.
Both real Pocket/desktop and manual desktop walkthroughs have seven checks and
zero page exceptions. Four documents pass the unchanged presentation checker.

See [regressions](proof/harness/regressions.txt),
[real Claude task](proof/harness/real-claude.json),
[real Pocket task and receipt](proof/harness/browser.json),
[phone review](proof/harness/phone-review.png),
[desktop Live](proof/harness/desktop-live.png),
[after unuse](proof/harness/unuse.png) and
[artifact identities](proof/harness/artifact.json).
