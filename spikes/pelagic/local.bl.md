# PELAGIC, compiled for local use

This optional build packages the real bl-ed editor, PELAGIC, its live Beam Lisp
compiler, shaders and example patches as static files. It needs no Omega world
or BEAM server at runtime. Omega's normal compiler pin/output are unchanged.

From `spikes/pelagic`, run the Beam Lisp launcher:

```sh
bl bundle
```

From the repository root, `spikes/pelagic/build.sh --local` invokes the same task.
Set `PELAGIC_BL=/path/to/beam-lisp/bin/bl` to use an explicit checkout.

The local `env.bl` pins the native-JS interop compiler and declares the `bundle`
task, whose implementation is `bundle.bl`. For a checked-out compiler at that
commit, `/path/to/beam-lisp/bin/bl bundle` works from the same directory. The
build requires Node and Python 3 and runs one compilation graph with one runtime.
The launcher may take tens of minutes to build the pinned compiler on first use;
subsequent builds reuse that compiler.
It produces `dist/local/` and `dist/pelagic-local.zip`. Other packages and a
universal bundle manifest are outside this task's scope.

Unzip and serve the `local` directory with any static HTTP server, for example:

```sh
python3 -m http.server 8792 --directory dist/local
```

Open `http://localhost:8792/`. Static hosting is needed for browser modules and
worklets; opening `index.html` through `file://` is not supported. After the first
complete load and service-worker installation, reload works offline on the same
origin. Service workers require localhost or HTTPS. Changing the hosting port
changes the browser storage origin.

Press PERFORM, then C-Enter to run the bundled patch. Edit BL and evaluate again.
The same `bl-package` is loaded through the editor's package layers and layouts;
`:(ed/unuse "pelagic")` returns to the source editor and releases its resources.

Editor saves use IndexedDB with atomic revision checks and 32 prior revisions
per document. Reload restores the saved source. PELAGIC's existing session,
imported-audio and partial-recording stores remain local too. Concurrent stale
saves fail rather than overwriting a newer revision. Local storage is scoped to
this browser/origin; clearing site data removes it. Arbitrary filesystem browsing,
world intents and editor image storage are outside this PELAGIC bundle.

`pelagic.browser` is annotated `^:js` and owns explicit `bl->js` / `js->bl`
conversion, audio-context creation, asset fetching, DOM text updates and downloads. Its public JS bridge unboxes numeric
results. `pelagic.bridge` declares live namespace names and BL values directly,
removing handwritten generated-name mangling. The DSP/GL interpreters remain
native JS. The legacy Omega build uses a small compatibility boundary because
its older compiler does not have annotated native interop.

## Verification

The installed-launcher build passed with compiler `26073421`: 41 modules,
2,562,016 bytes of static files and a 581,805-byte ZIP (integrity checked).
The compiler also rebuilt all 363 of its own sources with zero failures, and
its focused native-interop suite passed all 21 checks. The pin includes the
ordinary BEAM `set!` compatibility fix committed upstream as `407a87d7`.

The final bundle passed all **27 PELAGIC tests**, **73 vendored editor tests**
and **11 static browser checks**.
The older-pin scratch compilation also passed its hash, reverse-search, package
and live-binding checks. The unchanged presentation gate passed all 23 variants.
The browser drive exercises real C-Enter live evaluation and audio, native JS
interop in the bundled language, invalid-code recovery, C-s persistence, failed
save/retry, atomic concurrent revision conflicts, bounded history, reload,
complete offline reload and real `ed/unuse`. It made **zero server API requests**
and reported **zero uncaught browser errors**.

[Build log](proof/local/build.log), [upstream interop tests](proof/local/upstream-interop-tests.log), [package tests](proof/local/contract-tests.log),
[editor tests](proof/local/editor-tests.log), [browser drive](proof/local/browser.log), [browser report](proof/local/report.json),
[real editor with PELAGIC](proof/local/01-used.png),
[after unuse](proof/local/02-unused.png), [older-pin build](proof/local/legacy-build.log),
[unchanged presentation equivalence](proof/local/equivalence.log).

Reproduce the checks after building:

```sh
PELAGIC_OUT=$PWD/spikes/pelagic/dist/local/out node --test spikes/pelagic/test/*.test.mjs
BLED_ROOT=/path/to/beam-lisp BLED_OUT=$PWD/spikes/pelagic/dist/local/out \
  BLED_WEB=$PWD/spikes/pelagic/dist/local node --test vendor/bl-ed/test/*.test.mjs
python3 spikes/pelagic/test/local-browser.py
bin/bl run spikes/pelagic/test/legacy-build.bl
```

The browser proof starts its own temporary static server and needs Python
Playwright/Chromium; `CHROMIUM` overrides its executable. This optional build
does not resolve the timing release failures recorded in the sustained
performance proof.
