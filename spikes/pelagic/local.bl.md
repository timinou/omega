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

## Transparent browser performance

Live patches use the same functions, aliases and Overtone macros. The bundle
preloads `pelagic.overtone` functions and private macro helpers, and captures
its macros during the build. `pelagic.worker` reads and evaluates patches;
`js.worker` implements the bounded message transport in annotated BL. The
host applies the returned data to its audio and graphics resources. Unload
terminates the worker, and failed evaluations release their temporary names.

String operations use automatic ASCII fast paths and a bounded Unicode
segmentation cache. The editor batches geometry measurements and coalesces
resizes. Graphics initialization starts after the first paint through
`pelagic.browser/after-paint`. These optimizations require no changes in live
patch syntax. The page evaluator starts on demand for editor commands such as
`ed/unuse`; those commands retain access to the live editor on the main thread.

## Verification

The bundle uses compiler `a8749d88`, with the runtime/compiler changes also
committed on upstream main as `cb485ab3`. It contains 43 modules, 2,598,967 bytes
of static files and a 591,392-byte ZIP (integrity checked).

The bundle passes **30 PELAGIC tests**, **73 vendored editor tests**,
**51 runtime tests**, native live interop and **14 static browser checks**.
The unchanged presentation gate passes all 23 variants. The browser proof
covers real C-Enter and Overtone macros during audio playback, worker isolation,
main-thread heartbeats during a long evaluation, overlapping edits, failed
compilation cleanup, local saves, offline reload and real package unload.
It makes zero server API requests and reports zero uncaught browser errors.

Three fresh browser contexts per bundle on this host gave these medians
([raw timing report](proof/local/startup.json)):

| Measurement | Previous bundle | Optimized bundle |
| --- | ---: | ---: |
| Editor ready | 4,805 ms | 3,005 ms |
| Graphics ready | 7,351 ms | 4,675 ms |
| First patch evaluation | 1,520 ms | 280 ms |
| Repeated small evaluation | 79 ms | 229 ms |

The worker keeps the UI responsive, but adds scheduling overhead and starts
with a cold compiler. Repeated tiny edits are slower in this run; this is a
responsiveness tradeoff rather than a uniform latency improvement. GPU compilation still runs on the main thread after first paint. These measurements do not establish sustained audio timing limits.

[Build log](proof/local/build.log), [runtime tests](proof/local/runtime-tests.log),
[native live interop](proof/local/native-live.log), [package tests](proof/local/contract-tests.log),
[editor tests](proof/local/editor-tests.log), [browser drive](proof/local/browser.log),
[browser report](proof/local/report.json), [real editor with PELAGIC](proof/local/01-used.png),
[after unuse](proof/local/02-unused.png), [presentation equivalence](proof/local/equivalence.log).

Reproduce the checks after building:

```sh
PELAGIC_OUT=$PWD/spikes/pelagic/dist/local/out node --test spikes/pelagic/test/*.test.mjs
BLED_ROOT=/path/to/beam-lisp BLED_OUT=$PWD/spikes/pelagic/dist/local/out \
  BLED_WEB=$PWD/spikes/pelagic/dist/local node --test vendor/bl-ed/test/*.test.mjs
python3 spikes/pelagic/test/local-browser.py
bin/bl run spikes/pelagic/test/legacy-build.bl
```

The browser proof and `test/startup.py` start temporary static servers and need Python
Playwright/Chromium; `CHROMIUM` overrides its executable. This optional build
does not resolve the timing release failures recorded in the sustained
performance proof.
