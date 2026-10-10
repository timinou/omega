# Agents & AI-nativeness: omega today vs a 2030 Lisp machine

*Area report, read-only study. Every omega claim cites a file I read. "BUILT" = in `src/` and used by `bin/omega`; "SPIKED" = proven only in `spikes/`; "DESIGNED" = only in `research/` or `!tasks/`.*

## 1. Where omega is today

### Task model: BUILT, and close to the right idea
- **A task is a datom entity plus a disposable executor.** `src/omega/task.bl` header: the entity is the truth, and the executor (a `defserver`) is a cache that "can be killed and rebuilt from the facts". Schema is in `src/omega/schema.bl` (`:actor/* :task/* :msg/* :trace/* :turn/*`).
- **Statuses:** `:open :running :idle :waiting :done :failed :cancelled` (`task.bl` `STATUSES`). Ownership is an edge, `:task/owner`. Cancel cascades top-down (`cancel!`). Failure propagates bottom-up as a `:note` to the owner (`finish!`).
- **Durability:** the store is fjall at `<project>/.omega/db` (README "Where tasks are kept"). `recover!` turns tasks that were mid-turn into `:idle` with a `:blocker` trace. It does not resume them.
- **Humans and tasks are the same kind of actor.** Both have mailboxes that are facts (`src/omega/actor.bl`). Message kinds: `:prompt :steer :ask :reply :note :cancel`.
- **Every conversation turn is a fact** (`:turn/*`, `loop.bl` `append!`). Token cost is summed per task (`:task/cost`).

### Stigmergy: BUILT
- `src/omega/trace.bl`: open-vocabulary kinds with a `GLOSSARY` (`:claim :intent :finding :blocker :completion :heartbeat :tool`).
- Strength is `2^-(age/half-life)`, computed at read time. Nothing is deleted. Reads reinforce a trace (decay is measured from `:trace/at`, which a read refreshes) and count in `:trace/reads`.
- Claims are advisory path-overlap traces. The conflict test is a replaceable function, `*claim-conflict?*`. The claims rule can be `:ignore`, advisory or `:refuse` (`prelude.bl` `guard!`).
- The `claims-advisory` and `c9-claim-conflict` spikes show that advisory claims do not stop a second writer, but telling the agent who else holds the path works (~12 lines).
- `omega.bl.md` section 2 demonstrates the full cycle: B never addresses A, reads A's claim in the traces, `wait`s on A, then uses A's `:finding`.

### spawn / wait / send / done: BUILT
All four are in `src/omega/prelude.bl`.
- `spawn` calls `open!` with `:owner`, so a subtask is a first-class task.
- `wait` senses the status datom (no polling, no tokens) and never outlives the eval cell. It returns `{:pending true}` before the deadline, and the model calls it again.
- `send` accepts a task id or `human:me`. `ask` therefore reaches a human exactly as it reaches a task.

### Tools through a single `eval`: BUILT (`src/omega/codemode.bl`)
- The model sees exactly one tool, `eval`. Its input is beam-lisp, run in the task's own persistent namespace `omega.w.<world>.<task>`. The prelude supplies `read write edit ls glob sh spawn wait send done trace traces q`.
- Each cell is a monitored process with a 64M-word (~512 MB) heap cap (`:kill true`) and a 120 s deadline.
- Writes go through a pluggable **file port** (`prelude.bl` `DISK`, C6), so a bl-ed buffer server can receive agent edits instead of the disk.
- `q` is Datalog over the whole world, so an agent can introspect the task/trace/turn graph.
- Extension surface (`src/omega/ext.bl`): extensions are values with `:on` events, `:hooks` (`:tool/before` call-predicate, `:tool/after`, `:context`) and `:tools`. A throwing hook is skipped and leaves a `:finding`.

### Models: thin
- One seam, `step: request → response` (`loop.bl`). `src/omega/llm.bl` implements Anthropic Messages only, default `claude-sonnet-5-5`, via a local better-ccflare proxy that needs the Claude Code identity line (`CLAUDE-CODE-IDENTITY`). `OMEGA_MODEL` and `OMEGA_BASE_URL` override this.
- `--cassette` records and replays. Replay fails loud on an unseen request.
- `src/omega/jev.bl` provides typed closed-question decisions (TypeSafe Jev), with declared fail directions. `ext/jev_gate.bl.md` uses it for a done-gate and scope check that fail open.
- **One model per system**, set in `task/start-system` (`:step`). There is no per-task or per-role model choice, no router, and no budget enforcement. `:task/cost` is recorded but nothing reads it as a limit.
- OpenAI and Responses support are specified in `spikes/prompt-cache.bl.md` but not in `llm.bl`.

### Safety / sandboxing: weak by decision
- `codemode.bl` header: "No OS sandbox, full rights by default (D10)". Eval code can call any Elixir/Erlang module (the DESCRIPTION says so). `sh` is plain `System/cmd`.
- What exists: the heap cap, the deadline, and `src/omega/reap.bl`. `reap.bl` tags every `sh` child with `OMEGA_TASK_TAG` / `OMEGA_CELL_TAG` in its environment and kills the tree by tag when a cell or task ends. It is escapable with `env -i`.
- The one policy hook is `:tool/before`. It is a call-predicate over the *code string* (`test/ext_test.bl:27` greps for `sh`), which is easy to evade.
- The `beam-jail` spike shows a ~190-line C wrapper with Landlock plus seccomp user-notify. Landlock enforces: 0/3000 escapes versus 724–747/3000 with notify alone. Overhead is ~70–135 µs per notified syscall, and the verdict is a beam-lisp function. The design is in `research/domain/tools/beam-in-charge.bl.md`. It is **not in `src/`**.
- Neither `bin/omega` nor `src/omega/cli.bl` starts a jail (grep for jail/landlock in `src/` finds only `ed/providers.bl`).
- The "capability-stripped env fork with `:caps []`" in `research/domain/tools/codemode.bl.md` and `omega-at-a-glance.bl.md` is **DESIGNED, not built**. Today a task has the authority of the whole VM.

### Provenance and undo: mostly SPIKED
- **Provenance that is built.** Every message has `:msg/from`. Every task has `:task/opened-by` and `:task/owner`. Every tool call leaves a `:tool` trace with its input (`loop.bl` `run-tool`). Every turn is stored with its usage. So "what did the agent see and do" is answerable by `q`.
- **Undo that is not built.** `src/` has no history, checkpoint or revert code. The checkpoint design (`research/domain/interface/checkpoints-and-the-live-image.bl.md`) and its spikes are:
  - `history`: CAS objects with line blame, ~55 ms p50.
  - `async-checkpoint`: exact per-step snapshots at ~4 ms on the agent's side.
  - `fs-capture`: exact for BEAM-side writes, a post-hoc scan for `sh` writes.
  - `live-image`: var-level source hashes give an exact `:image` diff.
- The checkpoint doc is explicit that live state (processes, datom heads) "cannot be rewound", only restarted (section 1, thing 3).
- FEAT-010 ("effectful cells are not re-runnable") and FEAT-021 (`effects:<id>`) design an effect ledger. FEAT-021 v0 derives effects from turns only.

### Where agents live in the UI
`omega-ui` is a `live.app`. `bin/bl-ed` runs omega and the editor in one VM, with tasks as `#+begin_task` blocks and virtual documents `omega:overview`, `task:<id>`, `q:<id>`, `bl:<ns>` and `effects:<id>` (`src/omega/ed/providers.bl`, `README.md`). `src/omega/ed/providers.bl` states it "holds NO authority of its own" (it maps intents onto the public task verbs).

## 2. What a 2030 Lisp machine would have

1. **Agents are image citizens.** An agent is an ordinary live object, like a Genera process or a window. It has an identity and a principal. It can be inspected, suspended, resumed, forked and migrated. Its conversation, its pending continuation and its half-finished cell are all inspectable. They are not a transcript reconstructed from a database.
2. **Capabilities, not ambient authority.** An agent holds an explicit capability set: which packages, which files or objects, which network, which model budget, and which restarts it may invoke. Delegation is by passing capabilities. A subagent gets an attenuated subset. Authority is enforced below the language (the Lisp machine's tagged memory, or Landlock/seccomp on commodity hardware), so no `env -i` escape exists.
3. **Everything an agent does is an operation on the one image,** with a recorded principal, a justification (the prompt and turn that caused it) and an inverse. Provenance is per object and per slot ("who set this, why, from which model call"). Undo is first-class and structural: rewind the agent's effects as a group, including live objects, not just files. Merge or revert by agent, task or time.
4. **The condition system is the agent protocol.** When an agent hits an error, it signals a condition with restarts. A human, another agent or a supervisor model picks one. Debugger, inspector and agent transcript are the same tool. A stuck agent presents its stack and its restarts to whoever can unstick it, and a human can edit the code and resume the frame.
5. **Models are a system service.** There is a model router with budgets, caches (prompt caching) and per-task model choice (small model for gates, large for planning). Every call is a logged, replayable, addressable object (a cassette, but native and queryable). Local models are available for closed questions.
6. **Persistent, queryable agent memory.** Traces, findings, plans and conversations live in the same persistent store as code and data. They have a schema and decay or consolidation policy. Agents consult them as ordinary data and also by semantic retrieval.
7. **Presentations all the way.** Any object an agent returns is a presentation tied to its identity, so the human can click an agent's output and get the live object, not text.

## 3. The gap

| dimension | omega today | 2030 machine | gap size |
|---|---|---|---|
| Agent as live object | Entity (facts) + killable executor. Strong on durability, weak on liveness: an interrupted turn becomes `:idle` and does not resume. The model's conversation is not an inspectable continuation. | Suspend/resume/fork a running agent with its continuation | medium. The fact-log-as-truth design is a good base. |
| Stigmergy / coordination | Built, decaying, reinforcing, with a plug-in claim policy | Same, plus semantic retrieval and a consensus protocol | **small**. This is omega's strongest area. |
| Capabilities | None. `:task/scope` is "a hint, not a lock" (`schema.bl`). Authority is the whole VM. The `:caps []` fork is designed only. | Per-agent attenuated capability set, enforced | **large**. |
| OS sandbox | Spike proves Landlock+seccomp works on this machine; not wired. | Kernel/hardware-enforced, mediated | medium (the hard research is done). |
| Provenance | Task, owner, `:msg/from`, `:tool` traces, turns. No per-edit or per-slot attribution in `src/`. The history store is spiked only. | Per-object, per-slot, with the causing turn | medium–large. |
| Undo | No agent-level undo in `src/`. Designed: step checkpoints, revert by merge. Live state cannot be rewound by design. | Structural undo of effects, live objects included | **large**. |
| Conditions and restarts | Tool errors come back as a string to the model. `ask` to the human is a message, not a restart. No resumable-error protocol and no debugger-on-stuck-agent (a `:blocker` trace is the nearest thing). | Conditions with restarts shared by human, agent and supervisor | **large**. |
| Models | One Anthropic provider, one model per system, no budgets, no routing. A seam is in place and Jev is a second decision engine. | A router service with budgets and local models | medium (seam is good, content is thin). |
| Unified editor/REPL/inspector | bl-ed plus `bl:<ns>` image documents, `q:` queries, task cells and presentations. Agents' file edits can route through a buffer port. | Single surface | **small–medium**. This is ahead of most harnesses. |
| Everything-in-one-image | Agents run in the same BEAM VM as omega and bl-ed (a real Lisp-machine property), but the live-image spike shows `ward/run` and same-ns `env/fork` leak into the live image. | One image with isolation by capability | medium. |

The structural point is this. omega already has the fact log, the actor model, stigmergy and a language-level tool surface (one `eval`). It lacks the three things that make an agent *safe to give a live image*: **capabilities, an effect journal with inverses, and a restart-bearing error protocol**. The research and spikes cover the first two. The third (conditions/restarts) is not designed anywhere I found.

## 4. Three concrete next steps

1. **Wire the jail and a per-task capability value.** Productionise `spikes/beam-jail.bl.md` as an optional launcher for `sh` and for the eval node. Then make `:task/scope` an enforced capability set. A spawned child gets an attenuated copy, and the verdict function runs on every mediated write, exec and connect. This closes the "full rights by default (D10)" gap. It also replaces the evadable string grep in `:tool/before` with an enforced capability. Concretely: add `:caps` to `omega.task/open!`, thread it through `prelude.bl`'s `ctx`, and give `reap.bl` a jailed variant. Record every denial as a `:blocker` trace.
2. **Land the effect journal and step checkpoints as a `:tool/after` hook,** using `async-checkpoint` (exact, ~4 ms on the agent's side) and `fs-capture` hybrid capture. Store `:effect/*` facts with the task, cell, turn, paths and an inverse (CAS parent). Ship `revert-task` (revert by merge) on the `effects:<id>` provider (FEAT-021 v1). Mark what cannot be inverted (live state, network) and refuse mixed irreversible effects, as D6 leans. This gives provenance and undo for files first, and `live-image` var hashes give them for code.
3. **Make agent errors and asks resumable: a conditions-and-restarts layer.** Turn the `:blocker` trace and the `:ask` message into a signalled condition `{:kind :restarts [...] :frame ...}`. Examples are `:retry-with-edit`, `:grant-capability`, `:skip`, `:abort-subtree`. A supervisor task, Jev or the human picks one in bl-ed. Pair this with a per-task model/budget field on the task entity, so a closed supervisory question goes to a cheap model and a hard task to a large one. A budget overrun is then also a condition with restarts, not a silent cost.

## Sources read
`README.md`, `AGENTS.md`, `omega.bl.md`, `src/omega/{task,trace,schema,codemode,prelude,reap,ext,loop,llm,actor,jev,cli}.bl`, `src/omega/ed/providers.bl`, `spikes/README.md` (index, plus beam-jail, fs-capture, live-image headers), `research/domain/tools/{beam-in-charge,codemode}.bl.md`, `research/domain/interface/checkpoints-and-the-live-image.bl.md`, `research/domain/synthesis/{decisions,omega-at-a-glance}.bl.md`, `!tasks/features/FEAT-010/011/021`, `vendor/bl-ed/VENDOR.md`, `test/ext_test.bl`.
