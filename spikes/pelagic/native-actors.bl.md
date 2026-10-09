# Native actor namespace prototype

PELAGIC's optional actor preparation now uses one annotated Beam Lisp namespace:

```clojure
(ns ^:js pelagic.prepare (:require [pelagic.browser :as browser]))
```

Its actor calls `browser/score-chunk` through a static ES import, directly. The
same function handles native JavaScript expressions and actor receive/spawn/send.
The generated kernel call has no actor call frame, encoder, Promise or host-emitter
round trip. Native objects retain identity through local actor messages. The only
Worker messages are the explicit cross-thread boundary to the editor.

This is an upstream checked-actor-compiler prototype, not yet an extension of the
ordinary synchronous `js/build!` profile. Both profiles share the native expression
emitter. `system.js` checks native operation boundaries; annotated namespace bounds
and ordinary source privacy/alias resolution remain in the existing BL compiler.
Linked synchronous BL helpers use native JS arguments/results; profile-specific BL
collections still need explicit conversion. A suspending actor function cannot be
used as a synchronous JavaScript callback.

The package build owns the native-link manifest and checks export arities. Package
users write normal annotated BL and requires. `actor/prepare-bridge.bl` remains a
measurement baseline; it is excluded from shipped optional actor assets.

```
cd spikes/pelagic
bl actors
PELAGIC_ACTORS=1 bl bundle
```

The default remains the build-time BL score cache. `?prepare=actor` exercises the
native actor namespace; `?prepare=worker` uses the native Worker comparison.
The benchmark also supports `actor-bridge` without shipping it in the package.

The compiler now prunes checked, reachable definitions (including function values
and hidden receive helpers). Dynamic `host/ref` lookup conservatively retains the
whole registry. Native argument guards disappear only where `system.js` proves a
raw native value; unknown values keep their checks. Pelagic retains 84 of 353
actor definitions: generated native actor code falls from 1,224,489 to roughly
335,000 bytes (73%). Reference auditing and native-boundary validation happen
before pruning.

Instrument macros now prepare immutable parameter names/default maps once, alongside
the graph. Calls reuse that plan and update only supplied arguments. Score defaults
avoid a redundant merge when the original immutable default map is passed. These
optimizations sit behind existing instrument and score APIs. `score-slice` checks a
4 ms budget between steps, makes at least one step of progress, and caps a slice at
16 rows. This is cooperative yielding: a single step and browser scheduling can
exceed the budget. `actor-fixed` and `worker-slice` are benchmark controls.

Correctness checks compare all 1,024 steps against the original SHA-256 digest
`11d812d7eff77acc25e66e80215b366f4dc2bf5daf7b80b8e5524e94b0080b9a`.
Instrument checks cover positional/keyword parameters, duplicate keys, invalid
arguments and unchanged defaults. The initial unpruned and pruned measurements
are in [round 1](proof/native-actors/round-1/) and
[round 2](proof/native-actors/round-2/).

The benchmark rotates mode order and uses fresh realms/processes. Node CPU time
includes all process threads, startup and GC; it is not a worker-only CPU timer.
Browser wall time is heavily affected by this host's scheduling and I/O pressure.
The final verification rebuilds five changed BL modules through `js.build` and
reuses the existing common editor graph; it does not represent a cold rebuild of
all 44 modules. The live macro cache and both actor programs are regenerated.

Final measurements and real-editor proof are recorded below.
