# Omega vs. a 2030 Lisp machine — ecosystem, hardware, maturity

Area: dependencies (vendor/), Erlang/Elixir host, performance, offline operation, security/capabilities,
community/maintenance risk, roadmap realism. Nothing under src/ was modified. Claims cite files read;
git facts come from `git log` in this checkout.

## 1. Where omega is today

**Host and substrate.** omega is not an OS or an image-on-bare-metal. It is ~4.1k lines of beam-lisp
(`src/omega/*.bl`, `src/omega/*/*.bl`) running on the BEAM (OTP 29 per `erl_crash.dump`) under a **pinned
beam-lisp commit** (`env.bl`: `:bl "commit:94700545"`, built once by an external `bl` launcher at
`~/.local/bin/bl`; README "Requirements"). Beam-lisp itself is a separate repo (`~/code/undefine/beam-lisp`),
so omega's whole language, compiler, reload system, datom store and `live.app` UI toolkit are an upstream
that omega does not own. The README "Known beam-lisp gotchas" lists ~15 host defects (right-to-left argument
evaluation, a qualified call running CORE on first cold call = upstream BUG-109, `json/encode` refusing vectors,
missing `range`/`vector`, `live.diff` key bugs BUG-110) and `!tasks/bugs/BUG-003/004` are upstream bugs found by omega.
The runtime is therefore young and co-evolving, not mature.

**Dependencies (vendor/).**
- `vendor/bl-ed/` (2.6 MB) is the editor, **vendored from `beam-lisp/apps/bl-ed`** at `55f0a2af`
  "temporary, by the user's decision on 2026-10-04" (`vendor/bl-ed/VENDOR.md`). It already carries a long delta
  table (new `ed/pkg.bl`, `ed/frame.bl`, `ed/docs.bl`, `ed/omega.bl`, `src/bl_ed/serve.bl`, `image.bl`; changes to
  `ed/main.bl`, `keymap.bl`, `web/host.mjs`). That is a fork with a re-merge debt, and some files are still modified
  and uncommitted (`git status`: `vendor/bl-ed/ed/docs.bl`, `frame.bl`, `web/host.mjs`).
- The in-page language is compiled to JS from beam-lisp source (`vendor/bl-ed/build.sh` needs `$BL_TREE` checked out at the
  pin and refuses otherwise): building the editor requires a second checkout of the host repo. `web/out`, `web/pkg` are gitignored build outputs.
- `research/vendor/pi/` (42 MB, gitignored, pinned by `research/vendor/pi.lock.md`) is reference reading, not a runtime dependency.
- Runtime externals: Anthropic Messages endpoint (default = local **better-ccflare proxy** at `localhost:8080`, which
  only routes requests whose first system block is the Claude Code identity string — `src/omega/llm.bl` lines 16-37; this is a
  third-party-policy-fragile arrangement), a `llm/usage.bl` vendored from relay, `datom.store-fjall` (Rust fjall LSM) for
  durability (`src/omega/env.bl:26,76`), optional Jev (`TYPESAFE_API_KEY`), wry/GTK + sway for the native and headless UI.
  A Python / gcc toolchain is needed only by spikes.

**Performance (measured by the spikes, not benchmarks of the whole).** `spikes/hot-task.bl.md`: a long task slows from
1.2 s to 2.7 s per trivial step by step 160 (O(turns) re-read; `turn-read-cost.bl.md` 0.84 s at 300 turns; the fix C8
is designed, 4.4x on 120 steps). Whole-namespace eval is superlinear (100 fns = 4.2 s; `live-image.bl.md`). Checkpoints:
~55 ms p50 blocking vs 3.8 ms async (`async-checkpoint.bl.md`; historian 27-36 commits/s). `omega.bl.md` playground takes ~15 s;
`claim!` costs ~100 ms per call (`file-port.bl.md`). Editor rendering through presentations is within ~0.5 ms of the plain path
(`present-pipeline.bl.md`); typing <=1 ms, relayout 3-7 ms (`scroll-and-type.bl.md`). Cold sandbox run 7-8 s. These are
good for an interactive agent harness and bad for a "everything is a live object" substrate: latency is dominated by
re-reading datoms and recompiling, not by the VM.

**Offline.** Good for the *harness*, not for *intelligence*. `--offline`, `--demo` and the playground use scripted models
(`src/omega/cli.bl:62-68, 275-279`; README); cassettes (`--cassette`) record/replay a model; the suite (`bin/bl test`, 20 test
files in `test/`) and the playground run offline. But there is **no local-model provider**: `omega.llm` has only `:anthropic`
(`defaults` map) and the prompt-cache spike designs OpenAI/Responses providers that are not implemented. A real offline agent
(llama.cpp/Ollama-style) does not exist. Build itself needs the pin to be pre-built in `~/.cache/bl/build-trees/<sha>` and the
beam-lisp tree for bl-ed; `erl_crash.dump` (gitignored) is a boot failure `cannot get bootfile .../drop/.../start.boot`,
a sign that the launcher/release layer is a real fragility.

**Security / capabilities.** Today: **"No OS sandbox — full rights by default (D10)"** (`src/omega/codemode.bl` header).
Mitigations that exist in `src/`: per-eval process with `max_heap_size` 64M words (~512 MB, `:kill true`) and a 120 s deadline
(`codemode.bl` `TIMEOUT-MS`, `HEAP-WORDS`); per-task OS-process reaping by env tag (`src/omega/reap.bl`; escapable with `env -i`);
claims on paths that are **advisory** (`spikes/claims-advisory.bl.md`); credentials read from omega's home, never the project
(README); one writer per store (`.omega/db`). The real capability story is only in spikes/research: `spikes/beam-jail.bl.md` +
`research/domain/tools/beam-in-charge.bl.md` (Landlock `--rw` enforces, seccomp user-notify asks BEAM per write/exec/connect, ~70-135 us/event,
Landlock needed since notify-alone is TOCTOU-racy: 724-747/3000 escapes vs 0/3000). `grep` finds no Landlock use under `src/`, `bin/`, `tools/`:
**not wired in**. Also Linux-only, kernel-version dependent, and a ~190-line C wrapper. Namespaces per task are `omega.w.<world>.<task>` (`codemode.bl`),
i.e. a naming convention, not a capability boundary: any cell can call `erlang/*` or `File/*` (spike `fs-capture` traces them rather than prevents).
BUG-001 (`!tasks/bugs`) "two omega worlds in one VM cross-write" shows the isolation is leaky even logically.

**Community / maintenance.** One author in git (69 commits, 2026-10-01 to 2026-10-04, i.e. four days of very dense work; AGENTS.md and
the commit messages are written largely for/by agents). Bus factor 1 for omega, and a second, correlated single-maintainer risk for beam-lisp,
the editor upstream and the proxy. Documentation is unusually good (15 literate research notes, `research/domain/README.bl.md`, decision register,
spike table in `spikes/README.md`, plans PLAN-001..004 in `!tasks/plans`), which mitigates but does not replace users. No releases, no packaging beyond
`bin/*` shell wrappers that depend on `~/.local/bin/bl` and absolute-ish paths (`~/code/undefine/omega`). No CI evidence in the tree.
Test status quoted in commits: suite 16/16 at the pin, headless 8/9 (one content-dependent flaky live-model scenario, `env.bl` comment).

## 2. What a 2030 Lisp machine would have (in this area)

- **Substrate it owns end-to-end**: one language, one address space, one persistent heap/store; the OS, compiler, editor and debugger are the
  same image (Genera / Interlisp-D lineage). Hardware is either commodity with a thin verified microkernel/hypervisor or tagged-architecture
  (CHERI-like capability pointers + type tags in hardware, hardware GC barriers). The boot, upgrade and rollback story is part of the image
  (world loads, "snapshot of the whole world").
- **Object-capability security as the base**: every object reference *is* the authority; agents run with explicit, attenuated capabilities
  (a file *directory object*, a *network endpoint object*), revocable, auditable; effects are mediated by the condition system so a denied
  capability is a restartable condition, not an EPERM.
- **Local-first AI**: on-device models (quantised, NPU/GPU) as a system service with a cloud fallback; deterministic replay of every model call;
  offline is the default and the network a capability.
- **Performance**: image-wide persistence with incremental, transparent checkpoints; microsecond-scale introspection; incremental compilation per form.
- **Maintenance model**: a long-lived multi-vendor / community ecosystem (like the Common Lisp libraries + Genera patch system), versioned patch sets and a
  "system definition" facility, plus stable ABI between world and microcode.

## 3. The gap

| dimension | omega today | 2030 lisp machine | gap |
|---|---|---|---|
| Substrate ownership | BEAM + pinned external beam-lisp; vendored, forked editor; 15 documented host defects | one owned image | Large, structural: omega cannot fix its own compiler/launcher (needs a beam-lisp checkout + `BL_TREE` for the editor) |
| Single address space | many BEAM processes; state persists in a datom store (fjall), **processes and closures do not** (`live-image.bl.md`: only code comes back on restore, not process state; closures keep old bodies) | persistent objects incl. processes | Large; the "image" is files + datoms + a var-hash diff |
| Capabilities | none by default (D10); heap cap + deadline + env-tag reaping; Landlock/seccomp jail proven only in a spike | ocap/CHERI, effect mediation as conditions | Medium-large: the mechanism exists (beam-jail) but is unwired, Linux-only, and not an object model |
| Offline | harness fully offline; model not | local model service | Medium: need a provider seam implementation (the seam `llm/step` exists) |
| Performance | fine for interactive; O(turns) re-read and ns-eval superlinearity known; fixes designed (C8, async checkpoint) not shipped | transparent, incremental | Medium; engineering, not research |
| Reliability of base | pins, cassettes, 20 test files; one flaky headless scenario; boot crash dump | years of hardening | Medium |
| Community / bus factor | 1 author, 4 days of history, forked editor, proxy-dependent live path | vendors / community | Large and non-technical |
| Docs / rationale | excellent literate research, spikes with OBSERVED results | — | omega is ahead here |

Where omega is **genuinely closer to the 2030 vision** than a Lisp machine of 1990: AI-native tasks as first-class actors; a datom log as a
queryable introspectable history; reload with a coherence gate (`bl:` provider in `vendor/bl-ed/src/bl_ed/image.bl`); presentations and frames re-invented
in the editor; stigmergic coordination. Where it is **farther**: ownership of the stack, and security-by-construction.

## 4. Roadmap realism toward 2030

- The *software-layer* parts (jail wired in, local model provider, C8 turn cache, async checkpoints, image-diff in history) are 2026-27-sized
  and all have spikes that say "yes" with numbers. Realistic.
- The *machine-layer* parts (single persistent address space, ocap hardware, owning the VM) are not reachable on BEAM: BEAM processes cannot be
  snapshotted, and there is no tagged hardware. Realistic 2030 target is a **"Lisp machine as a Linux-hosted Landlocked VM image"**: a jailed BEAM node
  (`JAIL_ONLY=1` + `peer`, per `beam-jail.bl.md`) with an image = pinned beam-lisp + datom store + checkpoint of var sources.
- The biggest risk is upstream coupling and maintainer concentration, not technology: the vendored-editor "temporary" fork plus pinned compiler
  with unfixed gotchas will compound each re-pin (the pin moved `2360b32e` -> `94700545` in four days, `env.bl`).
- Model dependence: the live path depends on a proxy relying on a Claude Code identity line (`llm.bl`); a policy change breaks the headline
  demo. Direct API and OpenAI/local paths are designed (prompt-cache spike) but absent.

## 5. Three concrete next steps

1. **Make the capability floor real (S, ~1-2 wks).** Wire `spikes/beam-jail.bl.md`'s Landlock `--rw` (and `JAIL_ONLY=1` node start) into
   `omega.reap`/`omega.codemode` `sh`, driven per task by its `:scope`, with seccomp-notify denials surfaced as `trace`s / asks to the human.
   Replaces D10 "full rights"; add a test in `test/reap_test.bl` that a cell cannot write outside scope, and document the Linux/kernel requirement
   with graceful degradation.
2. **Cut the upstream and provider coupling (M).** (a) Upstream the `vendor/bl-ed` deltas listed in `VENDOR.md` (or make bl-ed a dependency with a stable
   `:provides`/package seam, which packages.bl.md already designs) and commit/CI the vendored tree; (b) add a second `llm` provider (OpenAI-compatible,
   so Ollama/llama.cpp = a real offline agent) behind the existing `llm/step` seam, with a cassette-backed test; drop the proxy/identity dependency from the
   default path. Add a one-command `bin/doctor` that checks pin built, `BL_TREE`, fjall, proxy, kernel Landlock.
3. **Ship the image story that BEAM can honour (M).** Land C8 (thread turns as a value) and async checkpoints, then implement the `:image` part from
   `live-image.bl.md` (var-hash diffs + restore-by-replay, only changed vars), and state plainly what is not restored (process state, closures). Add a
   basic benchmark suite (step latency at 300 turns, ns reload, checkpoint) in CI so performance claims stop living only in spikes; also reduce bus factor
   (CI, a CONTRIBUTING + release tag of the pin, second maintainer for beam-lisp-facing code).
