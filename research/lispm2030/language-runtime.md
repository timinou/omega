# Language & runtime: omega/beam-lisp vs. a 2030 Lisp machine

Area: beam-lisp itself (macros, conditions/restarts, errors, types, compiler, JS target, BEAM concurrency) and OS integration (processes, scheduling, namespaces, networking).

Evidence. omega-side claims cite files in this repo. beam-lisp claims cite `~/code/undefine/beam-lisp` (the pinned upstream, `env.bl` pins `commit:94700545`). I read headers and docs, and ran nothing new. Where I did not find something, I say "not found", not "absent".

## 1. The yardstick: a Lisp machine of 2030

Symbolics, LMI and Interlisp-D heritage, projected forward:

- **One live image, one address space.** The language is the OS. Every object is inspectable and every definition is redefinable in place. Old closures and instances are *upgraded* via `update-instance-for-redefined-class`, not left stale.
- **Condition system with restarts.** Errors *signal* and do not unwind. The debugger runs on top of the live stack and offers restarts (retry, use-value, skip). The programmer fixes the code, then resumes the same computation.
- **Types and meta-object protocol.** CLOS, MOP, generic functions, and optional gradual types that the compiler and editor use.
- **Native incremental compiler.** A sub-second compile of one function, with its source, arglist and callers recorded (Who-Calls, Edit Definition).
- **Processes and scheduler in the image.** Lisp-level processes, wait functions, and a visible scheduler (Peek/Process Browser). Every process can be stopped, inspected, debugged and resumed.
- **Namespaces and security.** Packages, plus in 2030 *capabilities* in place of ambient authority (every call is an object you hold).
- **Network as extension of the image.** Chaosnet/NFS-like transparent remote objects, remote debugging, and a name service.
- **Persistent objects.** The image or heap is durable (Statice-style).
- **AI-native.** Agents are first-class citizens of the image. They use the same inspector, debugger and restarts as a human, and their effects are mediated by the image.

## 2. Where omega + beam-lisp are today

### 2.1 Language shape: a Clojure dialect on the BEAM

- `README.md` ("Known beam-lisp gotchas") and `~/code/undefine/beam-lisp/README.md`: Clojure semantics compiled to Elixir quoted forms, then to BEAM bytecode. The upstream README claims real `clojure.string/set/walk/edn` run unmodified.
- Programs are `.bl` files and literate `.bl.md` or `.bl.org` documents (`omega.bl.md`, `docs/domain-model.bl.md`, `spikes/*.bl.md`). Spikes are runnable notebooks that print OBSERVED output (`spikes/README.md`).
- The language is homoiconic, with `defmacro`, `defserver`, `defmulti`, `defprotocol`, `defrecord` and `deftype`. The last five show up in the DEFS list of `vendor/bl-ed/src/bl_ed/image.bl`. omega's own `src/` defines no macros (grep for `defmacro` in `src/` is empty). The only mention is a restriction: `AGENTS.md` and `research/domain/interface/packages.bl.md:265` say `bl js build` **drops user `defmacro`s**, so editor packages are plain maps and fns.
- Maturity warts, all in `README.md`'s gotcha list:
  - arguments evaluate right-to-left;
  - a qualified call to a fn named like a core fn runs CORE on the cold call (BUG-109);
  - `read-string`, `ffirst` and `range` with a step are missing;
  - demand loading can leave a top-level `swap!` unrun;
  - `live.diff` keys are only honoured when all siblings are keyed (BUG-110).
  
  These are not Lisp-machine-grade semantics yet.

### 2.2 Conditions, restarts, errors

- **Not found.** I grepped `priv/`, `docs/` and `lib/` of beam-lisp for `with-restarts`, `invoke-restart`, `handler-bind` and `define-condition`. There are no hits. The language has Clojure's `try`/`catch`/`throw`/`ex-info`, plus Erlang links, monitors and supervisors. Errors *unwind first*.
- omega's practice is exactly that: errors become **values at boundaries**.
  - `loop.bl:139-140`: a tool's throw becomes `{:error (ex-message err)}` for the model.
  - `task.bl:123-130`: the turn process is wrapped, and a failure becomes `{:status :failed :error …}`. `finish!` then records a `:blocker` trace and notifies the owner (`task.bl` `finish!`).
  - `ext.bl:33-55`: a throwing hook is skipped with a `:finding` trace, and a throwing event handler dies in its own process.
  - `env.bl:121-126` and `exit-on-user-error` use `ex-info` with `:reason` to mean "expected condition". This is a hand-rolled, one-level condition taxonomy.
  - `jev.bl` models "questions as values, declared decisions with fail direction". That is the closest omega comes to a restart: a *decision point declared in data*, but not tied to a live stack.
- beam-lisp has an unusually rich **diagnostic** layer: `priv/std/errors.bl` renders every diagnostic in one shape with source excerpts, `priv/std/repair.bl` produces ranked *fix options* by running the analysis backwards, and `priv/std/deferred.bl` defers constraints on unknown names. These are compile-time/analysis conditions with restarts-in-spirit (candidate repairs), not run-time ones.
- Crucial gap: when an eval cell fails, the agent gets an error string, the cell process is gone, and the stack with it. `codemode.bl:run-eval` returns `{:error text}`, and the model must re-issue the whole program. In a Lisp machine the debugger would hold the live frame.

### 2.3 Types

- `priv/std/typed.bl` is a checker where "a type is a set of tags" (`docs/typing/typed-on-the-compiler.bl.md`). It runs on the compiler itself.
- Also present: an effect lattice `pure < atom < process < io` (`priv/std/effects.bl`), a termination prover for `loop/recur` (`termination.bl`), and z3-backed `defserver` invariant verification (`docs/typing/verified-processes.typ`, `priv/std/reload/upgrade.bl`). `docs/typing/guarantees-compose.bl.md` projects process guarantees into a datom store and joins them with datalog.
- This is *ahead* of a classical Lisp machine on static assurance, and *behind* it on dynamics: no CLOS/MOP-style class redefinition protocol was found. omega itself uses plain maps plus a datom schema (`src/omega/schema.bl`); `omega.loop` and `ext.bl` use maps and fns as protocols.
- The `^{:args [int]}` annotation is opt-in. Checking is a separate tool (`bl check`, `bl lsp`), not what the evaluator enforces at the REPL.

### 2.4 Compiler and the live image

- The compiler is self-hosted (`priv/boot/compiler.bl`, `docs/self/the-language-compiles-itself.bl.md`). `priv/std/vm/hotpatch.bl` recompiles boot namespaces inside the running VM. `priv/std/reload.bl` and `reload/*` give a staged reload with a **static coherence check** that *holds* an incoherent bundle. It also has a journal, subscribe, drift and migrate.
- `spikes/live-image.bl.md` is the key omega document. It reports, with measurements:
  - `defn` is an atomic per-var relink, so qualified calls and var values see new code;
  - **closures made by old code keep the old body**;
  - a `defserver` keeps its state across redefinition and `code_change` is not run on a plain re-eval;
  - there is **no undo of a reload**; undo means re-evaluating the earlier source;
  - `env/fork` does **not** isolate an existing namespace (it leaks, obs 6), and only `ward/run-sandboxed` is safe;
  - a whole-ns eval is superlinear (100 vars is 4.2 s); a one-var eval is 15–200 ms;
  - loaded modules grow with redefinition (obs 7a: each `defn` gets its own body module that is never purged).
- `vendor/bl-ed/src/bl_ed/image.bl` is a first Genera-style *image browser*: the `bl:` provider shows per-var state (matches source, source changed, live-only, not loaded) and reloads through `reload/commit`. `bl js build` retargets the same language to ES modules (`vendor/bl-ed/build.sh`, `spikes/present/build.sh`). The editor runs in the browser on the same language.
- JS target limits: macros are dropped by the build (see 2.1). The in-page language is a compiled `js.eval` (`--stub lower --with reader`), so the page can eval beam-lisp. Building needs a beam-lisp checkout at the pin (`build.sh` refuses otherwise), about 3 minutes cold.

### 2.5 Concurrency and the scheduler (BEAM)

This is the strongest match to the Lisp-machine ideal, and it comes free from the BEAM.

- One process per task executor: `task.bl:165` is a `defserver executor` under `BeamLisp.Supervisor/server … {:restart :temporary}` (`task.bl:201`). Each turn runs in its own monitored process so the executor stays responsive to steer/cancel (`task.bl:112-125`).
- Each eval cell runs in its own process with `max_heap_size … :kill true` (64M words) and a deadline (`codemode.bl`, `HEAP-WORDS`, `TIMEOUT-MS`). `omega.stream` broadcasts over `pg`.
- A reactive substrate: `env/sense` is a datom watch; the executor senses its own inbox (`task.bl` `init`, `actor/sense-inbox`).
- Upstream adds `priv/std/proc/sched.bl` (a deadline queue where recurrence is "declared, named, inspectable"), `proc/fence.bl` (bounded isolation that turns a computation into a value), the bus, queue and reconcile modules, and `docs/the-maximalist-supervisor.md`. That last one claims a `defserver`'s code *is* a queryable transition graph (`system.model/graph`, `verify-process`, `find-lasso`).
- Missing vs. a Lisp-machine Process Browser: I found no omega UI that lists BEAM processes with their stack, mailbox and wait reason, or attaches to one. omega's UI is the **task** view (`src/omega/ui/model.bl`), not the process view. I found no process-level introspection in `src/omega` beyond the `reap` /proc scan and the `stream.bl` activity broadcast (the call or `sh` running now).

### 2.6 OS integration: processes, namespaces, network

- **OS processes.** `sh` is a plain function (`prelude.bl`, `sh`). Every child is tagged with `OMEGA_TASK_TAG` and `OMEGA_CELL_TAG`. `reap.bl` finds the whole tree by scanning `/proc/*/environ` (one grep), and kills by tag when a cell dies or a task ends. It is inventive, but it is a *userland census of /proc*, not a process group, cgroup or pidfd. A child with `env -i` escapes (stated in `reap.bl`'s header).
- **Namespaces (name spaces).** A task's code lives in a per-task, per-world ns `omega.w.<world>.<task>` with the prelude referred (`codemode.bl:task-ns`). That is a cheap per-agent *image slice* for names, but not isolation. `spikes/live-image.bl.md` obs 6 and story (d) say there is one global var registry and two tasks reloading the same ns silently replace each other; claims can only warn.
- **Sandbox.** `codemode.bl`: "No OS sandbox — full rights by default (D10)". The designed answer is `research/domain/tools/beam-in-charge.bl.md` plus `spikes/beam-jail.bl.md`: a ~190-line C wrapper with **Landlock** (kernel-enforced write floor) and **seccomp user-notify** (write/exec/connect become BEAM messages). Landlock is the enforcer and notify the observer, because notify alone had a TOCTOU hole (747/3000 escapes, finding 8). It also covers a jailed `peer` node as a task's eval node, at ~100 µs per notified event. It is a spike, not in `src/`.
- **Capabilities.** Upstream has `priv/std/vm/scope.bl` (scope destructive host effects, e.g. `System/halt`, to the calling VM) and `docs/trust-boundary.md`/`docs/the-five-bundles.md` (not read in depth). omega does not use them: its authority is by convention (claims are *advisory*, `spikes/claims-advisory.bl.md`).
- **Networking.** omega's only network code is the HTTP client to the model (`llm.bl`, OTP httpc), the `live.app` socket for the UI (`ui/web.bl`) and bl-ed's server (`bl_ed/serve.bl`). Distribution (`net_kernel`, `peer`) is used only in the beam-jail spike. There is no remote task, no cross-node `spawn`, no `pg` beyond local streaming, and a store is **one process's at a time** (`README.md`: a second omega in the same project exits).
- **Scheduling.** Within the BEAM, preemptive per-process scheduling and per-process GC, free. At the agent level, there is no scheduler: `spawn` starts a task at once, with no priority, budget or fairness. Cost lives in `:task/cost` (datom) but does not drive scheduling. `proc/sched.bl` upstream could provide the timing half.

### 2.7 Persistence

Persistent *data*, not persistent *objects*. All tasks, turns, messages and traces are datoms in a durable fjall store at `<project>/.omega/db` (`README.md`, `src/omega/env.bl`). `recover!` returns a mid-turn task as *idle (interrupted…)*. Executors are disposable caches (`task.bl` header). Live image state (a `defserver`'s state, definitions made in a cell) is **not** persisted. `spikes/live-image.bl.md` says restoring "back to the image at step 12" cannot rewind process state or the datom conn head. Vars defined in a cell are stored nowhere unless the agent writes a file.

## 3. The gap (language & runtime)

| 2030 capability | omega + beam-lisp today | gap |
|---|---|---|
| Conditions + restarts, debugger on the live stack | try/catch/ex-info; a failed cell dies; error becomes a string or `:blocker` trace (`loop.bl`, `task.bl`, `codemode.bl`) | **Large.** No signal-without-unwind, no resumable error, no restart objects, no stack preserved for human or agent. The most Lisp-machine-defining thing missing. |
| Redefinition protocol (CLOS update-instance, old closures) | atomic per-var relink; old closures stale; no undo; module growth (`live-image` obs 3, 7a) | Medium. Per-var relink is good. Staleness is a known, *measured* hole, with no tool that lists stale closures. |
| Inspector / process browser for everything | `bl:` image provider (vars) and the task view; no process/mailbox/stack browser | Medium. Namespace and task layers exist; the process and heap layer does not. |
| Capabilities | ambient authority + advisory claims; jail only as spike | **Large** for an AI-native machine: it is the safety story. |
| Unified, durable image | datoms durable, image volatile | Medium–large. The line between *code-as-image* and *code-as-files* is manual (`live-image` story b). |
| Native incremental compiler | self-hosted, per-var eval 15–200 ms, whole-ns superlinear | Small to medium; the coherence-gated reload is already ahead of CL. |
| Static assurance | typed/effects/termination/z3 upstream, opt-in; omega uses little of it | omega leaves it untapped. Ahead of the Lisp machine in potential. |
| Macros everywhere | `defmacro` exists; dropped by the JS build; omega defines none | Small, but it blocks one-language-front-and-back. |
| Network transparency | none beyond HTTP; distribution only spiked | Large, but least urgent. |
| Agent-level scheduling | none (spawn-and-run) | Medium. |

The one structural insight: BEAM *already* provides the processes, links, monitors, supervisors, hot code loading and distribution the Lisp machine needed custom microcode for. What it lacks is **resumability**: the VM unwinds or kills, and never pauses at the point of error. A Lisp machine's whole edit-debug loop assumes it can. omega's "cell is killed, the task retries from the next turn" is the BEAM-native substitute, and it costs one model round trip per error.

## 4. Three concrete next steps

1. **Add a restart-bearing error path to the eval cell (a poor man's condition system).** In `codemode.bl`/`prelude.bl`, introduce a prelude macro or fn `(with-restarts …)` / `(signal …)` and a *parked cell*. When a cell raises, keep the cell process alive and blocked, return `{:error … :cell id :restarts [:retry :use-value :skip :abort]}`, and give the model a `(resume cell-id restart value)` prelude fn. Build it on a plain `receive` in the cell process: signal sends `[:signal c]` to a handler process and blocks for `[:restart r v]`. Keep the stack frame as a *process* (the BEAM's version of a stack) and cap parked cells by heap and deadline, as `HEAP-WORDS` already does. Record each signal and resume as traces (`trace.bl`), so the human sees the same restarts in bl-ed. Success test: a cell that fails on a missing file resumes with `:use-value` without re-running its first half. Spike it as `spikes/restarts.bl.md` first.
2. **Promote the jail from spike to the default `sh`, and make authority a value.** Port `spikes/beam-jail.bl.md` (Landlock floor, notify observer) behind `prelude/sh` and the eval node (`peer`), driven by a per-task *capability map* (`{:write [root] :net false :exec …}`) stored as a datom. Replace the `/proc/*/environ` census in `reap.bl` with a cgroup or pidfd-based tree, keeping the env tags as a fallback. A denied syscall becomes a *restartable condition* (step 1): `allow-once`, `allow-for-task`, `deny`. This ties OS-level mediation to the condition system, which is the 2030 picture.
3. **Make the image inspectable and durable at the process level.** (a) Extend the `bl:` provider (`vendor/bl-ed/src/bl_ed/image.bl`) with a *process browser*: per-task cell pids, `process_info` (stack via `current_stacktrace`, mailbox length, heap, reductions), attach/kill/`erlang:trace`, rendered as another provider document next to tasks. (b) Close the `live-image` obs 3 gap: a *stale-closure report* (functions whose captured module differs from the current var body) and a per-cell definition journal (var hashes, as in `spikes/live-image.bl.md` §3.2) stored as datoms, so a restart can *replay the image* from the store. This yields durable code-as-image without needing durable process state.

Deferred (after those three): cross-node tasks over `peer`/distribution, an agent-level scheduler with budgets driven by `:task/cost` and `proc/sched.bl`, and upstreaming `defmacro` support to `bl js build`.
