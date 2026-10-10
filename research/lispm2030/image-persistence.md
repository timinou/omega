# Live image & persistence: omega vs. a 2030 Lisp machine

Scope: is state/code a live, inspectable, persistent image? Compared: the datom store (`.omega/db`), task persistence, hot reload, the `bl:` image view. Read-only survey; no source changed. Items marked (inferred) come from reading code, not from running it.

## 1. Omega today (grounded)

**State is a persistent fact world, not an image.**
- All tasks, messages, traces and turns are datoms in one fjall store per project, `<project>/.omega/db` (`README.md` "Where tasks are kept"; `src/omega/env.bl` `db-path`, `open-durable!`).
- The schema is data (`src/omega/schema.bl`): five entity kinds, string identity attributes, open payload attributes (`:msg/data`, `:trace/data`, `:turn/content`) that hold any BEAM term.
- History is a datom feature: `env/history` returns every value an attribute has held. `env/sense` is a datom watch, so one task perceives another without polling.
- `docs/domain-model.bl.md` is the runnable model with its invariants.
- `src/omega/env.bl` says "no global": an env is a map `{:conn :world :clock :ids}`. That is the opposite of a single address space. It makes tests hermetic, but nothing is reachable by name from anywhere.

**Persistence is of data, not of computation.**
- `task/recover!` (`src/omega/task.bl:315`) re-attaches to the tasks in a reopened env. A task that was `:open`, `:running` or `:waiting` is marked `:idle` with the result "interrupted: omega stopped while this task was running. Send a message to continue." It also leaves a `:blocker` trace. Executors are then restarted (`start-executor!`).
- So a restart is a coarse resume at a turn boundary. Conversation, status and mailboxes survive (`test/durable_test.bl`: `tasks-and-turns-survive-a-restart`, `a-task-running-when-omega-stopped-comes-back-interrupted`).
- These do not survive (inferred): the process stack, the mid-turn model call, the pending `wait`, the eval cell, and the definitions a task made in its `omega.w.<world>.<task>` namespace.
- That namespace is where `(defn …)` in an eval cell lives (`src/omega/codemode.bl` `task-ns`). "Definitions persist between calls" holds only for the life of the VM. The datom turn record keeps the cell's source text, so it could be replayed. Nothing replays it today.
- A store is single-OS-process (`open-durable!` throws "another omega already has … open"). Two omegas in one project cannot share the world.
- Known scale problem: a long task slows down because every step re-reads all turns. Measured 1.2 s growing to 2.7 s per trivial step by step 160 (`spikes/hot-task.bl.md`, `spikes/turn-read-cost.bl.md`). A lisp machine's world does not re-parse its history on each step.

**Code is live, but the live-ness is not recorded.**
- The only tool is `eval` (`src/omega/codemode.bl`): beam-lisp run in the live VM, in a monitored process with heap cap and deadline. Hot reload is free from beam-lisp: `defn` is an atomic per-var relink.
- `vendor/bl-ed/src/bl_ed/image.bl` (the `bl:` provider, wired in `src/omega/ed/main.bl`) is the nearest thing to an inspector of the image:
  - It lists namespaces and, per var, shows ✓ matches source / ✎ source changed / ⚠ live-only / + not loaded.
  - It has intents `bl/reload` (through `reload/commit`'s coherence gate, which holds rather than forces) and `bl/undefine`.
  - It is a read-only text document, with no per-var inspection of values, processes or closures.
- `spikes/live-image.bl.md` and `research/domain/interface/checkpoints-and-the-live-image.bl.md` are the design. They split change into four layers: source, image code, live state, builds.
  - Image code is recoverable from var-level source hashes.
  - Live state is explicitly not restorable: "No checkpoint can bring it back."
  - Observed: a redefined `defserver` runs new handlers on old state without `code_change`. Closures made by old code keep the old body.
  - Observed: `env/fork` and `ward/run` leak into the live image. Only `run-sandboxed` is safe.
  - Observed: whole-ns eval is superlinear (100 fns = 4.2 s), so reload per var.
  - Observed: a held `datom/db` value is a correct snapshot, but a conn's head is never rewound.
- **The checkpoint/historian system is designed and spiked, not shipped.** In `src/`, `grep checkpoint` hits only a comment in `loop.bl:183`. History lives in `spikes/history.bl.md`, `step-checkpoint.bl.md` and `async-checkpoint.bl.md` (p50 3.8 ms async, exact). The `:image` part of a change exists only in the spike.
- Presentation work (`spikes/present-pipeline.bl.md`, `scroll-and-type.bl.md`) has "objects with sources" on screen. It is for tasks and documents, not yet for arbitrary live values.

## 2. What a 2030 Lisp machine has

1. **One persistent object world.** Every object (function, process, buffer, task, conversation, closure) is an addressable heap object. The image is saved and resumed whole: "the machine" does not restart, it resumes. Orthogonal persistence also covers continuations and process state.
2. **Everything inspectable by reference.** Click any presented object, in any pane, to open an inspector. The object is a live reference, not a serialised copy. Code is reachable from its running instances, and the reverse.
3. **Redefinition is a first-class, versioned, reversible event.** Redefining a class or function runs `update-instance-for-redefined-class` or `code_change` migration. Old versions are kept, and the system says which live closures or instances are stale. Undo restores the definition and offers state migration.
4. **Time travel over the whole world.** Because history is intrinsic, the world can be rewound or forked at object granularity. A world fork is cheap and isolated (copy-on-write).
5. **Source and image are one thing.** Definitions know their source locations (Genera "edit definition"). Edit-in-place re-evaluates the form, and drift (image differs from file) is impossible or always visible.
6. **Agents are objects in the world.** An agent's state, plans, tool calls and memory are ordinary persistent objects. A crash lands in the debugger with the agent's stack available to inspect, restart and resume. The agent itself edits the world through the same mechanisms as the human.
7. **Multi-user, one world.** Several users and agents share the image with object-level transactions and capability-style access, not one-process locking.

## 3. The gap

| axis | Lisp machine 2030 | omega today | gap |
|---|---|---|---|
| unit of persistence | whole heap incl. processes | datoms for the task graph; payloads can hold any term | **large**: no process/continuation/closure persistence |
| resume | exact | turn-boundary "interrupted", agent told to carry on | medium: acceptable for LLM agents, but cell state is lost |
| code in the persistent world | code objects are persistent | code is files plus VM registry; task-ns defs vanish on restart | **large**: image code is not in the store |
| redefinition semantics | versioned, migrating, stale-aware | atomic relink; every body module kept forever; closures stale; defserver silently mismatched | large, though mapped precisely (`spikes/live-image.bl.md`) |
| inspection | any object by reference | `bl:` var-state view (text); task/turn/trace views as org documents | medium: strong on the fact world, weak on live values and processes |
| history / undo | intrinsic | datom history per attribute; file/image history only in spikes | medium: designed, mostly unbuilt |
| sharing | shared image, many writers | one OS process per store; one image, no per-task image (observed) | medium |
| isolation / forks | cheap world fork | `env/fork` leaks; per-task namespaces; `peer` jail in `spikes/beam-jail.bl.md` | medium |
| drift | none | acknowledged (checkpoints doc §6); `bl:` shows it | small, visible |

**Where omega is better than a classic Lisp machine.**
- It has an explicit, queryable, schema'd fact log, with `sense` as a datom watch (stigmergy).
- Every agent action is attributable and replayable at the turn level.
- A crashed VM loses little. The image-as-source-of-truth model is dangerous in a way omega avoids: the *facts* are the truth, and processes are "disposable executors" (`schema.bl` header).
- It is honest that live state cannot be rewound.

This is a deliberate design choice: omega is a **fact-sourced** system with a disposable image. A Lisp machine is **image-sourced**. 2030 would want both: a durable fact log (omega's strength) and a durable image where the objects live.

## 4. Three concrete next steps

1. **Ship the `:image` checkpoint into the store (small, designed).**
   - Move the var-hash recorder from `spikes/live-image.bl.md` into `src/` as a `:tool/after` hook (`src/omega/ext.bl`).
   - Add `:cell/*` or `:image/*` attributes to `schema.bl`: ns, var, hash, prev, source text, task, cell id.
   - Make `recover!` replay a task's namespace from these records, so a restart restores the task's definitions (a replayable per-task image) and not just its conversation.
   - Add a stale-closure and `defserver`-handler-changed warning, as the checkpoints doc §5.1 `:state` proposes. Acceptance test: kill, reopen, the cell's `defn` still resolves.
2. **Make the `bl:` view an inspector of live objects, not only of vars.**
   - Extend `vendor/bl-ed/src/bl_ed/image.bl` with presented objects for processes (`defserver` state via `sys:get_state`), datom conns (head and `datom/db` snapshots), closures (defining var and version) and tasks' executors.
   - Use the presentation pipeline (`present-pipeline.bl.md`): the object under the cursor is the reference, and every `pr-str`'d value in a task transcript links to it.
   - This unifies the task, trace and image documents into one navigable world and gives the human the "click anything" experience.
3. **Add a world fork and a migration protocol.**
   - Use `run-sandboxed` or a `peer` node (`spikes/beam-jail.bl.md`) to give each task, or each risky step, a disposable fork of the image plus a `:mem` env forked from the store at a datom `db` value.
   - Add a `defserver` redefinition hook that runs or warns about `code_change`.
   - Fix the hot-task O(turns) read (C8: thread the turn list through `turn!` as a value) so a persistent task can live indefinitely.
   - Then "back to step 12" is source + image code + datom head fork, with state loss reported rather than hidden.

## 5. Evidence index
`README.md`; `omega.bl.md`; `AGENTS.md`; `src/omega/{env,schema,task,codemode,loop}.bl`; `src/omega/ed/main.bl`; `vendor/bl-ed/src/bl_ed/image.bl`; `test/durable_test.bl`; `spikes/{live-image,hot-task,turn-read-cost,history,async-checkpoint,beam-jail}.bl.md`; `research/domain/interface/checkpoints-and-the-live-image.bl.md`.
