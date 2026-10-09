# One actor architecture, shared language values

Work is tracked in [PLAN-014](../../!tasks/plans/PLAN-014-actor-native-consolidation.org).
This document explains the integration as it lands. Unfinished stages remain
explicit in that plan; the editor does not yet run entirely through actor lowering.

## Why values come before changing the default

An actor is a way to execute a Beam Lisp function, not another definition of a
Beam Lisp map. The prototype nevertheless had its own keyword cache, list cells,
tuples, vectors, maps, sets, equality and arithmetic. A helper returning a map
could therefore return something the caller did not recognize as a map.

The first consolidation removes the actor-owned collection classes. Actor frames
now use the same persistent vector trie and HAMT as ordinary generated modules.
Map updates share tree nodes instead of copying every entry. Mutable actor tables
remain distinct: they are owned host resources with explicit destruction and
capacity limits, rather than ordinary immutable language values.

Sharing a source file is insufficient. JavaScript caches modules by URL. Shipping
two copies of `rt.mjs` produces two sets of classes and keyword caches. The actor
artifact writer therefore links its host to the frontend's existing runtime URL.
Both local and server bundles inherit that same graph.

## Compiler-owned helper contracts

The compiler already knows namespace annotations, private definitions, generated
export names, fixed arities and variadic minima. It now writes those facts to
`native-modules.json` from the checked compilation. The actor linker consumes that
artifact; Pelagic no longer lists a helper's generated name and arities by hand.
Only retained references become imports. Application initialization is not run to
find the exports.

This deliberately distinguishes linking from messaging. An actor's direct native
helper call is a JavaScript call inside the same realm and module graph. A Worker
boundary is still a realm boundary, where explicit messages are necessary.

## Bugs found by integration

Cross-module collection tests revealed equal Number and BigInt integer keys with
different hashes. The canonical runtime now hashes them consistently. Equality
also previously rounded mixed large integers and ignored improper-list tails;
both cases now have regression coverage. This is why the migration preserves
semantic checks rather than merely comparing generated bundle sizes.

## Evidence so far

Upstream commits `ffef07b4` and `957b9ac3` contain the checked manifest and canonical
collection work. Focused native/collection tests pass, as do 37 exact-numeric
checks, 96 BEAM ordering answers, and 33 canonical runtime/lazy/interop tests.
The actor suite passes 457 language checks at each of three scheduling budgets,
plus its ingress, shutdown and failure-propagation checks.

One loaded-host sample measured changed-value persistent map updates at
0.0023 ms for 4,000 entries and 0.0024 ms for 64,000 entries. These measurements
show the removal of whole-map copying; they are not a playback latency claim.

## Remaining architectural work

Canonical values, arithmetic and checked callback entry now share their
implementation. Shared compiled core, ordinary actor lowering, live evaluator
integration and higher-order suspension specialization must still converge. Pelagic's later job admission and five experiences build on
those contracts. Safe audition must keep the active revision intact through
validation, cancellation and failure, then use the existing quantized atomic
revision boundary for commit. A validation-only preview is not an audible audition.


The fresh Pelagic graph now builds successfully with 44 frontend modules, and
all 50 package tests pass against it. Its actor imports `score-slice` directly
from the compiler-generated module. The ordinary bundle task includes that actor
without an optional copy step. The benchmark also consumes this graph, making
runtime identity part of the exercised package rather than a source-only test.
Build and measurement evidence is in `proof/actor-consolidation/linking/`.

## Callbacks do not need another evaluator

Upstream `43c8174e` gives an actor closure a checked synchronous entry into the
same frame machine. The compiler proves every arity and reachable call avoids
suspension; a `receive` in even one arity prevents use as a JavaScript callback.
Unknown calls stay unproved. A captured BL value stays a BL value, while the
shared native boundary handles float boxes and JavaScript results consistently.
Metadata wrappers preserve the callable's execution target.

This proof is separate from purity. Updating a DOM element can be synchronous;
waiting for a mailbox cannot. Actor-state operations need an actor event
entrypoint because a browser callback has no current actor identity. Long work
also belongs in an actor: the synchronous entry has a machine-step limit and a
bounded finalizer reserve on cancellation.

Measuring this path exposed allocation we could remove without inventing a fast
parallel evaluator. Callback completion no longer constructs a BL result map
that only JavaScript consumes. One sample's median fell from 5.31 to 1.82 µs;
40,000 calls consumed 341 versus 113 ms CPU. The direct route's timings also
varied on this loaded host. These batched numbers explain the optimization;
they do not establish end-to-end P95 audio/video latency. Both JSON samples and
semantic checks are in `proof/actor-consolidation/callbacks`.

## The actor runtime is a library, and preparation has one implementation

The package build now requires `js.actor` directly. Upstream `bb0ed533` owns the
compiler, BL scheduler and JavaScript engine under `priv/lib/js/actor`. Research
files reference those sources. The normal build publishes `out/actor/`; package
entrypoints re-export it. This preserves one module identity as well as one
implementation, and removes checkout discovery and source-text evaluation from
Pelagic's build module.

Preparation now always uses BL actors. The old prebuilt, worker-only and bridge
branches are removed. Disabling preparation remains a diagnostic option; score
fallback uses the same compiled BL kernel. The fixed-slice benchmark changes the
actor's budget, not its scheduler or implementation. A stale cancellation cannot
kill the replacement actor.

The fresh bundle builds successfully and all 50 package tests pass. Browser
control tests cover one-chunk demand, stale credits, cancellation, replacement,
and stale cancellation. Across three Node runs, the actor configuration's median
kernel work was 180 ms, startup 130 ms and per-run chunk P95 4.51 ms, with the
unchanged 1024-row digest. The samples are in `proof/actor-consolidation/production`.
Ordinary editor lowering and the legacy collection prelude remain tracked
upstream work; actor-only preparation does not silently stand in for that work.


## BL imports are not JavaScript conversions

Upstream `e02b1881` records the compiled BL ABI in module contracts. A direct
import of an annotated BL function keeps canonical BL maps, decimals and closures
unchanged. An actual JavaScript import retains native conversion and `#js` checks.
Both use direct calls; neither invents an actor frame or a messaging protocol.
The emitted linked-values fixture tests direct and indirect calls, including
collection identity. The upstream semantic/interop suite now passes 48 tests.

## Prepare once, use the same work everywhere

Read [score-js.bl](pelagic/score-js.bl) first: it owns a bounded catalog per
preparation job, converts each immutable instrument graph once and sends only
new graph entries plus voice controls. Cancellation drops that job's catalog;
a replacement starts its IDs at zero. The realm decoder restores shared identity,
checks bounds and prepares the compiled graph schema before playback.

[graph-js.bl](pelagic/graph-js.bl) is the native BL schema compiler. It validates
signal structure, collects envelope descriptors once and returns a control-only
lifetime function. The host caches plans only for deeply immutable graphs.
Mutable foreign graphs remain valid, but never acquire a stale cached plan.
AudioBuffer impulse/noise assets are shared by engines in the same context and
prewarmed before scheduling. Mutable AudioNodes are always owned by one engine.

[playback-js.bl](pelagic/playback-js.bl) is now the common musical projection for
live playback, audition and original-score export. It owns lane suppression,
seeded chance, transposition and fractional pattern offsets. The host creates
native nodes. Differential checks cover muted stems and canonical timeline times.
The old hand-written conversion adapter is removed: `values.mjs` now binds only
the canonical compiler boundary and compiled BL modules. Foreign native objects
retain identity instead of being copied into BL maps and back at every trigger.

[work.bl](pelagic/work.bl) states the deadline policy. Playback fills its first
second even when its ordinary turn budget expires. Preparation requires 1.5 s
reserve; export requires 2.5 s. Worker credits wait for admission, with no growing
job queue and no timeout while intentionally waiting for the reserve. Export
reuses score data and schemas, prepares graphs in bounded turns and suspends
native offline DSP every .25 s before checking admission again. This bounds work;
it does not guarantee OS-level CPU isolation or a physical 16 ms output latency.
Compile/analysis actor admission and compiler preemption remain pending.

The 1024-step output retains its original byte digest. Three actor preparation
runs have median kernel work 94.68 ms, CPU 740.70 ms, startup 98.86 ms and
per-run chunk P95 2.73 ms, versus the previous 180/1297/130/4.51 ms.
Loaded-host tails vary: one run reached a 12.28 ms chunk maximum. All 61 package
checks pass. Samples and structural/byte differential checks are in
[reuse](proof/actor-consolidation/reuse/).

## Safe audition is an audible, separate revision

[audition.bl](pelagic/audition.bl) is deliberately small. Staging stores the exact
base state, revision and serial alongside the candidate. It never changes active
history. Commit refuses a stale base, including a direct knob change that did not
allocate a new revision. A successful commit uses the existing quantized atomic
revision path. Validation errors retain the active state.

Run `pelagic/preview` (AUDITION CODE) to hear four beats through an owned quiet
monitor at 15% level, using the same projection and graph schema as playback.
COMMIT AUDITION applies it at the next bar; CANCEL AUDITION releases its voices,
decks and monitor bus. Imported samples share immutable buffers, but their source
nodes are owned by the preview. The preview does not enter the main take recorder.
A staged candidate remains available after the short preview ends; intervening
edits disable commit. Panic and package unload release the preview too.

Watch [the real-editor demo](proof/actor-consolidation/audition/safe-audition.webm).
It includes monitor audio tapped expressly for the demonstration, cancellation,
quantized commit, stale refusal, shader failure and export during playback.
[Drive evidence](proof/actor-consolidation/audition/browser.json) has no page errors;
[used](proof/actor-consolidation/audition/used.jpg) and
[unused](proof/actor-consolidation/audition/unused.jpg) show the package lifecycle.
The original presentation check is unchanged and reports 12 variants with no
mismatch for the Pelagic demo document. Four other experience demos remain open.

Offline export lifetime
-----------------------

`renderAudio` accepts an optional `AbortSignal`. Admission waits, graph-building
yields, native suspension barriers and completion all share that lifetime.
Package unload cancels every owned export, which rejects with `AbortError` and
releases its AudioNodes. Outstanding barriers resume automatically: browsers
provide no `OfflineAudioContext.close()` or native abort operation, so the
remaining silent render must retire through the browser. Its output allocation
may outlive cancellation briefly; the host does not retain the result.

The real-editor [cancellation proof](proof/actor-consolidation/export/cancellation.json)
covers cancellation before work, after graph preparation, at a suspension, and
through `ed/unuse`, preserving the document. The test is
`python3 spikes/pelagic/test/export-cancel-browser.py`. It uses an isolated static
world and the same compiled BL admission and graph modules as playback.

## Compiling the compiler is an integration test

The shared pattern traversal initially worked in focused fixtures but failed
when Pelagic compiled its browser compiler from a cold process. Target staging
can mark a namespace loaded and install forward placeholders. If the running
compiler still needs to load that same namespace, those placeholders prevent
it. The build now loads its shared pattern implementation before staging, just
as it already did for the IR walker. This preserves the running implementation
in the parent environment while compiling target definitions in an isolated fork.

The canonical-core audit compiles the actual rt/core sources through the actor
front end. It inventories provider contracts without running application
initializers. That establishes where linking must go next; it does not establish
that actor lazy forcing, receiving callbacks or evaluator execution already work.
Those remain explicit gates before deleting the old control emitter.

## A local artifact has an identity

`pelagic.artifact` inventories the completed build, rejects non-regular assets,
counts UTF-8 bytes and hashes each file. It derives the artifact identity from
those hashes and its own source/template. Repeated generation produces identical
manifest and worker bytes; generated files do not hash themselves. Editing an
asset changes the identity. The ZIP is a delivery container; byte-for-byte ZIP
reproducibility is not asserted.

The service worker owns browser cache IO. It waits for old clients to retire
before activating an update, so a live page cannot load half of a new module
graph. Cache cleanup belongs to one hosting path, preserving other performances
on the same origin. The server frontend excludes this local manifest/worker,
because its index and transport differ. `bl artifact-check` exercises the BL
contract through the same env.bl task surface as `bl bundle`.

The final artifact build pins upstream `797dc039`: 50 modules, 159 inventoried
assets. It passes 63 package checks, the BL artifact contract, independent asset
hash/identity and ZIP checks, real-editor offline reload and safe audition, and
the unchanged 12-variant presentation gate. Browser checks report no uncaught
errors or server API requests. Evidence is in
[artifact checks](proof/actor-consolidation/artifact/artifact-summary.json).
