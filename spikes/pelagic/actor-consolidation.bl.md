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

Callable suspension proofs, canonical float/decimal arithmetic, shared compiled
core, ordinary actor lowering, live evaluator integration, and scheduler policy
must still converge. Pelagic's later job admission and five experiences build on
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
