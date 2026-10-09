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

The initial direct build and bridged build each emit 353 definitions. Browser
control checks pass for all four preparation modes: bounded demand, stale credits,
cancellation and replacement. Upstream executable checks cover direct imported
calls, identity across local mailboxes, native methods/undefined/conversion, and
side effects in statements and finally bodies. The original 16 actor compiler ABI
checks and six native refusal checks pass. The package's 46 tests and 23 unchanged
presentation variants pass.

Measurements and optimization conclusions follow in subsequent commits.
