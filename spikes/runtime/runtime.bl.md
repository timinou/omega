# Runtime observatory: a complete prototype vertical

This is a real `bl-package` (`rtview.main/bl-package`) inside the shared Omega
frontend. It provides `runtime`, `runtime-pelagic` and `runtime-pocket` layouts.
There is no private application loop and no parallel actor scheduler.

From the repository root, run `bin/bl runtime.dev` and open the printed URL.
Or load Runtime from the package catalog. PELAGIC has a **RUNTIME** button;
Pocket has **Machine → Runtime inspector**. `space r r` opens the full inspector
once its package is loaded. **Return** restores the companion surface.

The five sections are ownership, active work, health/timing, builds/revisions,
and selected-item details. Start the explicitly labelled actor probe, select it,
cancel it, and follow its source. Export a snapshot to inspect the exact data.
The backend actor owns at most four active probes and retains at most 32 rows.
It projects the current world's tasks and current realm's owned processes and
services, without exposing environment variables or mailbox contents.

Package-owned browser observations use the same module URL across views. Peer
tabs report over a same-origin BroadcastChannel; reports expire after six
seconds. These are reported package resources, not an inventory of every tab or
browser thread. PELAGIC reports preparation pool counts, evaluator/graphics
availability, audio resources, queued edits, revisions and existing diagnostics.
No remote tab actions are offered. Local audition cancellation uses the package's
existing request API. The collector is optional; it does not own execution.

Sampling is bounded to one request in flight at 1 Hz, pauses when hidden or
paused, and stops on unmount. Package removal closes the reader and its channel
when no responders remain. Unuse restores retained companion panes; the generic
frame honors a valid replacement layout effect before removing an old layout.
The package never merges keys or commands into user tables.

Builds show the current generation, watcher state/refusals and host-pinned
candidates. Open creates a new session, leaving existing audio and module graphs
alone. Stop watch asks for confirmation and stops only this world's speculative
work. Host and realm restart remain CLI operations with visible impact text.

Physical output latency is explicitly unmeasured. Browser frame and audio-clock
submission estimates do not establish a 16 ms speaker-to-display result. Queue
contents, per-actor scheduler internals, FFT allocations and per-device latency
are future telemetry, not invented values in this prototype.

## Proof

The offline browser harness is `test/browser.py`; it starts a private memory
world and never writes to the running world on 8790. Proof outputs live in
`proof/`: used/unuse screenshots, companion preservation, peer reports, native
job cancellation, source navigation, snapshot export and candidate navigation.
The watch fixture uses the existing real watcher/service actors to offer the
already validated frontend; it does not claim to benchmark compilation.

Run the compiled package drive tests with `BLED_OUT=<frontend>/out node --test
spikes/runtime/test/drive.test.mjs`. Run backend ownership tests with
`bin/bl --cold test test/runtime_test.bl`. The standard vendored-editor drive
suite and unchanged presentation check are release gates too.

See the [live inspector](proof/used.png), [editor after unuse](proof/unused.png),
[PELAGIC companion](proof/pelagic-companion.png), and
[Pocket companion](proof/pocket-companion.png). The
[browser report](proof/browser.json), [native gates](proof/source-tests.log),
[editor regressions](proof/editor-tests.log), and
[PELAGIC regressions](proof/pelagic-tests.log) record the checks.
