# JS actors macros, loading latency, and a smooth-experience plan

Investigation requested after the scrolling/window-key work. This is a report and proposed implementation sequence, not a performance fix. Production code, the live world and existing worktree branches were not changed.

## 1. Macro support: distinguish the pin from the actors branch

Omega's `env.bl` pins `94700545`. The actors branch is `prototype/bl-js-actors`, with a worktree at `~/code/undefine/beam-lisp--js-actors`; its checked-in HEAD was `568103c2`. That worktree also has uncommitted changes (12 tracked files at inspection), including core/runtime performance and registry identity/rebinding work. They were read, not modified. The macro probe used a separate detached worktree of the checked-in branch, not those uncommitted changes.

The earlier statement that `bl js build` drops `defmacro` applies to Omega's pin, but is not a description of the current actors branch. The first investigation reproduced local/imported macro failures on the pin and main; the branch investigation independently built and executed successful local/imported macros. Exact pin-probe commands are not preserved in this report; the branch commands and results are preserved below.

The branch-only commit `f44000f1` changes `priv/lib/js/build.bl`:

- `compile-ns` evaluates the namespace's `defmacro` forms on the BEAM build VM, before compiling the remaining forms.
- `form-text`/`first-form-text` recover the source text for those definitions.
- Macro calls then expand during compilation. Macro definitions need not become JavaScript runtime functions.
- The commit also introduces `--self-host` work compiling `core.bl` and `rt.bl` to JS. That is a separate support/performance question from whether ordinary application macros expand.

The recent `568103c2` merge is main INTO the actors branch. At inspection, 15 commits were reachable only from the branch; `f44000f1` was not in main or Omega's pin. Omega's comment about an earlier actors merge does not imply that these later commits are present.

### Branch probe and limits

A detached `/tmp/bl-branch-probe` used a private cache (`XDG_CACHE_HOME=/tmp/bl-probe-xdg`) and copies of existing native/dependency artifacts; the shared cache and existing worktrees were only read. Command:

```
./bin/bl js build mp.main -p /tmp/mp/src --out /tmp/mp/out
node /tmp/mp/out/mp.main.mjs
```

Observed:

| case | result |
|---|---|
| local `defmacro` template | passes; prints `42` |
| imported macro via namespace alias | passes |
| imported variadic macro using `& body` and `~@` | passes; combined probe prints `42 / hi / hi / 2` |
| imported macro syntax-quoting another unqualified macro of its namespace | fails: unresolved caller-namespace name |
| same nested expansion using the fully qualified macro name | passes; prints `3` |
| macro body calling a helper `defn` in its namespace | fails: `cannot call nil`; registering macros alone does not evaluate helper definitions |

Successful `--self-host` operation was not independently tested. The application-macro tests used the default JS build mode. The branch probe took about 13 seconds after boot dependencies were available; this is not a complete cold-toolchain benchmark.

A presentation readtable entry is ordinary map/function data consumed by `pp.read`, not a Lisp reader extension. A proposed `defreader` would be `defmacro` sugar producing that data. A simple template can use the branch support; custom language reader syntax is not established by this test.

Recommendation: port the macro-registration slice with focused tests, then validate and re-pin Omega. Do not blindly adopt the entire branch, or depend on its uncommitted runtime work. Add tests for namespace resolution and helper dependencies before calling macro support complete. The plain-map package/readtable API remains the canonical value; a macro should expand to it, not establish a parallel implementation.

## 2. Measurements: three different meanings of loading

All live HTTP requests were reads. Browser probes used temporary same-origin iframes and in-memory instrumented host modules; no served source files were edited. Isolated server launch probes used offline, empty in-memory worlds on ephemeral ports and killed their process groups after measurement.

| measurement | observed |
|---|---|
| existing-server browser startup to `window.blEd` | 466 / 671 / 346 ms, three fresh iframe documents |
| first text observed during those loads | 369 / 586 / 283 ms; timer-based observation, not a paint-completion metric |
| fetched resource graph | 45–49 resources, about 1.67 MB decoded; compressed transfer sizes are smaller |
| overview API reads | 3.0 / 3.5 / 3.8 ms, with likely cache warming from watchers |
| task:t-5 API after waiting past the 1-second cache TTL | 600 / 556 / 511 ms |
| immediate task:t-5 repeats | 4.7 / 4.0 ms |
| browser task openings | t-5: 115 ms, t-1: 699 ms, t-17: 821 ms, including two animation-frame waits |
| corresponding browser fetch waits | 17 / 639 / 783 ms; task:t-5 was warm |
| repeated frame render, task:t-17 inbox | median 4.0 ms, p95 5.4 ms, max 6.2 ms; 50 synchronous samples |
| fractional scroll dispatch, same inbox | median 12.4 ms, p95 16.2 ms, max 18 ms; 60 RAF-spaced samples, excluding subsequent browser paint and glideTick's preliminary render |
| empty offline server launch, existing build/store | 5050 / 5035 / 4996 ms to successful overview API response |
| pinned launcher with a one-line program | 824 / 792 / 816 ms to exit |

These are local samples, not a p95 startup distribution, true empty-browser-cache tests, or human judgements of trackpad feel. Browser load events fire before the async editor boot is finished; do not use `loadEventEnd` as readiness.

### Startup critical path

`vendor/bl-ed/web/host.mjs` awaits REPL import/start before importing the editor; then waits for fonts and the initial document, boots/draws, loads packages, and invokes the layout through the command-line evaluator.

A diagnostic module added timing marks in memory. Its iframe location initially caused package URL resolution to fail; that run was discarded. Corrected runs supplied the real page URL as the package base and verified `:layout "inbox"` every time. Inclusive phase times for three runs:

| phase | ms |
|---|---|
| REPL import and initialization | 74 / 78 / 69 |
| editor/frame module imports | 70 / 45 / 41 |
| initial doc fetch/JSON await | 41 / 27 / 57 |
| boot, initial draw/doc handling and watchers | 39 / 29 / 29 |
| presentation package load/use | 62 / 55 / 58 |
| layout command | 8 / 9 / 7 |

Font waiting was negligible in these warm-host samples. These brackets include network, scheduling and JS work; they do not isolate compilation CPU. Serial dependencies and the eagerly initialized command-line language add avoidable time before useful content. Individual static responses were around 4 ms in the server probe. Raw network bandwidth is not established as the primary local bottleneck.

The approximately 5-second empty-world process launch is separate from page startup. The simple launcher baseline is about 0.8 seconds; the remainder includes loading/compiling Omega/editor dependencies and server initialization. Their individual costs were not instrumented. Durable-store open/recovery and a clean page rebuild were not timed. The existing launcher comment says a missing page build can take about three minutes; that is prior documentation, not this investigation's measurement.

### Task-document critical path

`src/omega/ed/providers.bl/cached` requires both equal store basis and an entry younger than 1000 ms. Its comment says unchanged basis avoids rendering, but the TTL contradicts that. `task-provider` builds a whole-world snapshot, finds one row, builds task detail and renders the document.

`vendor/bl-ed/src/bl_ed/serve.bl/api-rev` polls revisions every 250 ms. Provider revision functions call the same `cached` renderer. Once its TTL expires, even an unchanged world can cause complete document rebuilding. This is a source-backed explanation for recurring work; its exact share of live CPU was not profiled. Idle scheduler activity was observed, but attributing all of it to revision polling would overstate the evidence.

Likely expensive projection work includes `omega.loop/turns`' multi-clause datalog join, all-task snapshot/trace work, per-task trace collection and actor messages. Prior evidence in `spikes/turn-read-cost.bl.md` measured 1398 ms for a 602-turn join versus 20 ms for indexed datom traversal. That is prior data on a different fixture, not a current profile of t-5. The new API measurements establish the large render/cache-miss cost, not its internal breakdown.

### Scroll critical path

The BL renderer already memoizes read/layout stages (`pp.present/tree-of` and `screen-of`); do not prescribe another redundant cache without checking its keys and scope.

`host.mjs/dispatch` handles and draws, then calls watcher bookkeeping for non-key events. `watchDocs` renders each editor; `watchCards` renders the focused editor again. `glideTick` also renders to determine the scroll event type. Thus fractional wheel steps request multiple models beyond the one painted. The measured event cost approaches the entire 16.7-ms 60-Hz frame budget before paint; at 120 Hz the budget is only 8.3 ms.

## 3. Proposed implementation sequence

### A. Remove the repeat server work first

1. Instrument provider cache hits/misses and render phases by request type, with monotonic timings. Do this in an isolated representative world; confirm the contribution of turns, snapshot, traces and revision polling.
2. Make revision checks cheap and invalidate document projections by their real dependencies. Preserve side-file changes, query edits and rounded age updates; simply deleting the TTL without replacement could serve stale metadata.
3. Share in-flight projection work for equal dependencies. Avoid duplicate renders from simultaneous read/revision requests.
4. Replace the expensive turn join with the existing index-traversal approach, preserving ordering, content and query semantics. Avoid building a whole-world snapshot to display one task when a narrower projection suffices.
5. Bound caches and invalidate only affected projections, including unrelated-task update tests.

Acceptance: representative 600-turn cold task API under 50 ms on this host, cached under 10 ms, cheap unchanged revision reads, and no repeated full renders of an unchanged transcript. Measure idle CPU with a fixed watcher count; aim below 5% of one core. These are proposed targets, not current results.

### B. Make one frame do one frame's work

1. Produce/reuse one coherent render model per dispatch. Watcher bookkeeping should use that model or lightweight BL-owned watch metadata, not fresh full renders.
2. Audit the existing per-stage cache scope across rail/main/minimap; prove reuse and invalidation before changing it. Bound any per-editor/per-object memoization.
3. Keep view anchors, tail-follow policy, input interpretation and presentation rules in BL. The host retains physical measurements, animation scheduling, effect IO and DOM painting.
4. Make easing elapsed-time based rather than a fixed fraction per frame, so 60/120/144-Hz displays settle consistently. Test small trackpad deltas and coarse wheel notches separately; consider passing continuous trackpad motion through rather than double-smoothing it. Respect reduced-motion preferences.

Acceptance: scroll JS processing p95 below 4 ms on the reference fixture, with end-to-end RAF/paint measurements at 60 and 120 Hz; no main-thread long tasks during steady scroll. Retain the existing scroll tests and equivalence check. Add resize, wrapped-headline, ongoing-update, cursor-offscreen and composer-edit cases. Human mouse/trackpad evaluation is still required.

### C. Shorten startup and make navigation trustworthy

1. Fetch documents, packages and editor modules in parallel where their dependencies allow. Start the command-line language off the first-display critical path rather than awaiting it before the editor imports.
2. Keep the synchronous evaluator contract honest: do not silently return a Promise where BL expects a value. Queue commands/effects until language readiness with visible status, and preserve typed input. Use the existing BL frame/layout affordance to arrange the initial package without requiring command-line evaluation merely to open the inbox.
3. Preserve the last useful screen while a task loads, show which task is loading, and guard responses by pane/path/request generation. Cancel superseded visits; an older slow response must not overwrite a newer selection.
4. Consider bounded prefetch of the selected/adjacent task only after server render costs are fixed. Prefetch is not a substitute for fixing an expensive read.
5. Cache static artifacts only with correct build identities and invalidation. Split process bootstrap timings from browser metrics; avoid recurring compilation where a coherent prebuilt image can be safely reused.

Acceptance: useful warm local inbox under 200 ms, a clear cold-start/loading state, deterministic latest-request-wins navigation, no dropped first keystroke, no read-position jump on revision, and latest-follow still showing new turns. Benchmark multiple fresh-page and warm-page samples on small/long transcripts; report distributions instead of one good run.

### D. Adopt the compiler change behind parity and performance gates

Port/register compile-time macros and test local/imported/nested/helper cases before a pin change. Separately test the self-hosted single-core runtime against existing editor contracts, macro tests, collection/function identity and rebinding, then the latency fixtures above. BL maximalism should remove duplicate semantics without making interaction slower. Do not use a branch adoption as an unmeasured performance fix.

## Evidence handles

Session artifacts (raw tool output):

- Initial server source/timing analysis: `agent://1-ServerLatency`.
- Ordinary fresh-iframe startup: `artifact://159967db0c6fdff3/main/puppeteer/404.txt`.
- Task opening/frame/scroll measurements: session tool intent "Measuring task open and scrolling frames"; the complete observations are recorded in the measurement table above.
- Corrected marked startup, verified inbox: `artifact://159967db0c6fdff3/main/puppeteer/416.txt`.
- Detailed branch probe: `/tmp/omega-macro-investigation.md`, `agent://2-BranchMacroProof`; temporary probe sources/worktree remain under `/tmp` for reproduction.

No production optimization or re-pin was performed. Durable startup, a successful self-hosted build, Firefox-specific behavior and physical trackpad feel remain unverified.
