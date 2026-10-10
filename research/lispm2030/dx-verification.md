# Developer experience & verification: omega today vs. a 2030 Lisp machine

*Area: tests, spikes, literate docs, introspection, reproducibility, documentation, live debugging, time-travel. Grounded in files read on this checkout. I did not modify source. Claims marked OBSERVED were run here.*

## 1. Where omega is today

**Tests.** `bin/bl test` (`bin/bl` → pinned beam-lisp, `-p src -p vendor/bl-ed/src`) ran **17 files, all green** (OBSERVED: ~100 s wall, `ward: warm isolated test run`, e.g. task-test 29, ed-test 47, ui-theme-test 51). Tests are `deftest` files in `test/*.bl` (about 1,600 lines in 17 files, including `test/task_test.bl` driving the whole task system with `loop/scripted` models). Three things make them deterministic:
- Injected clock and ids: `docs/domain-model.bl.md` §3.
- Scripted models: `loop/scripted`, `loop/call-tool`.
- **Cassettes**: `omega.llm/cassette` (`src/omega/llm.bl:250-290`). It keys on a sha256 of the canonical request, `:replay` fails loudly on a miss, and tapes are term files (`test/tapes/jev-probe.tape`).

A second tier is scenarios, not deftests: `bin/omega-headless` / `test/headless/ui.bl` drive the real UI in a private sway with WebKit and grim screenshots. The vendored editor has its own JS drive tests (`vendor/bl-ed/test/*.test.mjs`, 29 per FEAT-021's note) and screenshot proofs (`vendor/bl-ed/proof/*.png`). Gaps:
- The README says "the suite (offline; 7 files)" but there are 17 (README.md "Try it").
- The headless tier is not in `bin/bl test`. `env.bl` records that one headless check is content-dependent on a live model.
- There is no coverage or mutation tooling, and no CI config in the tree.
- `erl_crash.dump` (870 KB) sits in the repo root.

**Spikes methodology.** `spikes/README.md` states the contract: a spike is a runnable literate file (`bin/bl run spikes/<n>.bl.md`) that asks one question, prints OBSERVED output, and ends in `## Findings`. A spike that disproves the design counts as a success. Spikes are "deleted or turned into tests once the feature lands". There are 21 files (~7,700 lines), and the README table gives the question and a one-line answer for each. The method has real results: for example `convergence.bl.md` found the position rebase diverges on 63% of random pairs, and `hot-task.bl.md` plus `c8-turn-cache.bl.md` measured the slowdown and its fix. `AGENTS.md` adds a proof obligation for editor-facing spikes: before/after-`unuse` screenshots, a drive test, and the equivalence check. Weak points:
- Findings are prose in the file. Nothing re-checks them automatically, so they rot silently.
- Nothing runs the 21 spikes together; some need a different beam-lisp (`task-cell.bl.md`).
- The deletion promise is not tracked.

**Docs as executable literate files.** This is omega's strongest area. `omega.bl.md` (the playground, ~15 s offline), `docs/domain-model.bl.md` (runs against the real `omega.*` namespaces and prints invariants), and `src/omega/ext/*.bl.md` and `src/omega/ui/screens.bl.md` (code and design reasoning in one source file) all run with `bin/bl run`. `research/domain/README.bl.md` says every `*.bl.md` there passes `bl run`, but the design notes are explicitly "no runnable blocks" (`synthesis/day-to-day.bl.md` header). So "executable" means "loads and exits 0" for much of the research set. The code docstring is the unit of API doc (for example `env/history`, `task/recover!`). `schema.bl` carries `:db/doc` per attribute, and `tools/lens.bl` and `tools/nav.bl` are ad-hoc regex-based indexers over the source (schema lens, ns/def index). They are heuristic and not part of the image.

**Introspection and self-documentation.**
- The strongest piece is the datom log. Every task, turn, message and trace is queryable (`env/q`, `env/history` → `datom/changes`, `env/sense` watches). Reading `docs/domain-model.bl.md` §1 shows the stated principle: "nothing lives only in a process".
- `trace.bl` has an open vocabulary and a glossary.
- Codemode's `eval` prelude lists its own functions in the system prompt (`src/omega/codemode.bl:~105`).
- Editor-side views (FEAT-017..021, `research/domain/interface/providers/*.bl.md`): `omega:overview`, `task:<id>` as a livebook, `q:<id>` live datalog, `effects:<id>`, and `bl:<ns>` for per-var drift, live-only vars, reload and `undefine_var` (`bl.bl.md`). `bl:<ns>` is the closest thing omega has to an inspector or Document Examiner. `effects:` is v0: `sh` effects are `:opaque` until the jail lands.

**Reproducibility.**
- `env.bl` pins beam-lisp by commit (`:bl "commit:94700545"`), built once in a clean tree. `bin/bl` forces the VM to start in omega's root and sets the search path.
- Models are made reproducible by cassettes.
- Dev work is not reproducible at the dependency level: `vendor/bl-ed` is vendored with a delta list in `VENDOR.md`, but git is dirty with edits to vendor and spikes.
- Prompt byte-stability is tested (`spikes/prompt-cache.bl.md`, 9/9 pairs).
- Note that `bin/bl test` timed out at my first 110 s limit and printed a raw Erlang `badarg` from the kill. The suite is slow enough that interactive use needs `&`.

**Live debugging.** Today this is thin and mostly delegated to the BEAM:
- A codemode cell runs in a monitored process with a heap cap (`max_heap_size ... :kill true`) and a deadline. A killed cell reaps its OS processes (`reap.bl`).
- Failures are values (`{:error {...}}`, `ex-info` with `:reason`, `cassette-miss`).
- Durable restart converts mid-turn tasks to `:idle` with a `:blocker` trace (`task/recover!`, `src/omega/task.bl:315`).
- There is **no condition system with restarts**. A grep for `restart|handler-bind|with-restart` finds only the supervisor `:restart :temporary` in `task.bl:201`. There is no break loop, and no "resume this failed cell with a fixed value".
- The repl (`bin/bl repl`) is only suggested for copying blocks.

**Time-travel / undo.**
- Datoms keep every past value, so history is free at the data level (`env/history`).
- Step checkpoints with line-blame, merges and revert-by-merge are **designed and spiked** (`history.bl.md`: ~55 ms p50; `async-checkpoint.bl.md`: 3.8 ms inline) and are not product code yet (FEAT-005 and FEAT-004 are ITEMs in `!tasks/features`).
- `research/domain/interface/checkpoints-and-the-live-image.bl.md` §1 separates four things: source, image code, live state and builds. Only source and image code are restorable, and live state is "a thing you can restart or migrate, not rewind".
- FUP-009 (open) lists the holes: no process-state snapshot API, a redefined `defserver` runs new handlers on old state, stale closures, and leaked old modules.
- `synthesis/day-to-day.bl.md` proposes `task/replay`, but no `replay` verb exists in `src/omega` (OBSERVED by grep); only the model cassette exists.

## 2. What the 2030 Lisp machine has

- **Document Examiner as the living manual.** Every function, variable, condition and command has its doc record in the image. Bookmarks, cross-references and "who calls this" all come from the live system, and the manual cannot disagree with the code.
- **Tests are objects in the image.** A test is a first-class thing with its last result, the code it covers and a coverage map. Editing a function re-runs the affected tests incrementally, and CI is the image itself running.
- **Condition system with restarts, and a debugger that is the editor.** An error is a live stack with inspectable frames. You edit the function in the frame, recompile and *resume* the frame (`Resume`, `Retry`, `Return a value`). AI-native: an agent subscribes to conditions and proposes restarts, with the human as a handler of last resort.
- **Inspector, REPL and editor unified.** Any printed object is a presentation (CLIM-style) you can click, inspect, describe and pass to a command.
- **Persistent single address space with a time axis.** Orthogonal persistence plus an append-only world log means "as-of" for everything (code, data, process state, window layout). Undo is an image operation, and replaying an agent session is a deterministic re-execution against recorded effects.
- **Reproducibility by construction.** The world is content-addressed, so building the image from a manifest gives the same bytes. Bug reports are image snapshots.
- **Agent-native DX.** The agent and the human use the same verbs, every agent action is a recorded effect, and an agent can *explain* any value (provenance) from the log.

## 3. The gap

| dimension | omega today | 2030 | size |
|---|---|---|---|
| Literate executable docs | Strong for `docs/` and `src/*.bl.md`; research notes only load | Docs are checked against the image | small |
| Tests | 17 green files, deterministic, cassettes; no incremental or affected-test selection, no coverage, headless tier separate | Tests live in the image and re-run on edit | medium |
| Spikes → regression | Findings are prose and not rechecked | Findings are executable assertions | small-medium |
| Doc browser | `bl:<ns>` and `q:` providers, docstrings, regex `tools/nav` | Document Examiner over docs, schema, traces and code | medium |
| Debugging | Process kill, deadline, error values; no restarts, no frames | Resumable conditions, edit-and-continue | **large** (needs upstream beam-lisp) |
| Time-travel | Datom as-of in principle; code checkpoints designed; process state unrecoverable; no session replay | Whole-world as-of and deterministic replay | **large** |
| Reproducibility | Pinned VM commit, cassettes; vendored editor and dirty tree | Content-addressed world | medium |

The central structural point: omega already has the *data* half of a Lisp-machine DX (a complete fact log, literate files, drift view). It lacks the *control* half (conditions, frames, resumption, process-state history), and the BEAM only partly offers that.

## 4. Three concrete next steps

1. **Make verification one command and make spikes regress.** Add `bin/bl check-all` (or a `test/spikes_test.bl`) that:
   - runs `omega.bl.md`, `docs/*.bl.md` and the fast spikes;
   - asserts a small `## Findings` table of numbers with tolerances (for example "convergence 0/6000", "hot-task slope < X");
   - includes the headless scenarios when sway is present.

   Fix the README "7 files" claim, delete `erl_crash.dump`, and print a warning instead of the raw `badarg` on timeout.
2. **Session replay (`task/replay`) from the datom log.** The pieces exist: `env/history` and turns as datoms, cassette keyed digests, and an injected clock/ids. Build `task/replay {task from-tx}`, which re-drives the loop with recorded model replies and recorded tool results (not re-executing `sh`). Expose it as a `replay:<id>` provider next to `effects:<id>`, with an as-of scrub (the head-`t` recording FUP-009 item 2 already asks for). This delivers time-travel for the part that *can* be rewound, and it is the debugging story for agent failures.
3. **A minimal condition/restart layer at the harness seam.** Today a failing cell yields an error value the model must interpret. Introduce named restarts in codemode and the ext hooks (`:retry-cell`, `:skip-tool`, `:use-value`, `:ask-human`), recorded as facts, with `Needs you` rendering restarts as buttons (the card UI in FEAT-015 already has y/n/a). Then add a `docs:`/`describe:` provider that unifies `bl:<ns>` docstrings, `schema.bl :db/doc`, `trace.bl` glossary, and the cell prelude listing into one Document Examiner. That gives a single "what is this?" for humans and agents.
