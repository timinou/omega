# Day to day with omega — interactions, peeking, and how an agent develops it

> **Literate**, no runnable blocks (everything here is proposal). `bl run` exits 0 on it by construction.
> Screens are drafted in `../interface/impeccable.bl.md` §7. This note covers *flows*, the
> *observability contract*, and the *agent-developer surface* that those screens sit on top of.

**Abstract.** The user asked us to think about "all the interactions we'll have, how we'll peek into the
system, how the day to day will look, the screens, and how you (an agent developing the system) will
understand, test and improve it". This note answers in four parts:
1. a small set of **verbs** that every surface (TUI, desktop, CLI, MCP) exposes identically;
2. **walkthroughs** of a normal day, written as concrete sequences;
3. an **observability contract**: what is inspectable, and how;
4. the **developer loop**: how an agent changes omega safely while omega is running.

All of it is INFERRED design built on the domain notes. Where a claim rests on observed behaviour, the note
is cited.

## 1. One verb set, four surfaces

pi's RPC mode (command + response id + event stream) is the template (`../loop/pi-architecture.bl.md`
§5.7, Q11): define the operations once, over the task registry and the environment, and make every surface
a client. Then the TUI, the desktop, the CLI and an MCP client cannot drift, and an agent testing omega uses
the *same* verbs a human does.

| verb | meaning | human surface | agent/CLI surface |
|---|---|---|---|
| `task/new {goal scope? parent? waits-on?}` | create a task (a prompt) | `n` in overview, palette `> New task` | `omega new "goal" --scope src/x` · MCP `task_new` |
| `task/say {task text mode}` | message a task; `mode` = steer (next turn boundary) or follow-up (when idle) | composer in task detail | `omega say <slug> "…"` |
| `task/steer`, `task/pause`, `task/cancel` | control | `s` `p` `x` | same verbs |
| `task/answer {task question choice}` | resolve `input-required` (permission, plan gate, ask) | inline in "Needs you" | `omega answer …` |
| `review/accept`, `review/request`, `review/reject` | close the loop on a diff | review screen | same verbs |
| `env/q {datalog}` | ask the environment anything | palette `#` and saved queries | `omega q '[:find …]'` |
| `env/watch {pattern}` | live stream of matching traces | any list view is one | `omega watch '[?e :trace/kind :blocker]'` |
| `task/replay {task from-tx}` | re-drive a task's turns from its log with recorded model replies | time scrub in graph | `omega replay <slug>` |
| `view/render {screen state format}` | render a screen as hiccup, or as plain-text cells | — | `omega view overview --text` |

NB: `view/render --text` is what lets an agent *see* the TUI. It is the headless cells → plain-text
renderer proposed in `../interface/impeccable.bl.md` §6 and `../interface/tui-ratatui.bl.md` §10.

## 2. A normal day, as sequences

### 2.1 Morning: open the project

```
$ omega                          # TUI (or `omega desktop`) on the project's warm VM
→ overview: 2 need you · 3 running · 1 stale     (impeccable §7.1)
```
- **Needs you** is first. It contains one review (a task finished overnight) and one `input-required`
  (a plan gate). That's the only accent-coloured group.
- **Stale** = no trace within the heartbeat lease. It's either a hung process or a task waiting on an
  external event. The row says which (`waiting on fix-reader-hex` vs `no heartbeat 23m`).
- Nothing was lost overnight, because tasks are facts plus resumable executors. A VM restart replays the
  fact log and the supervisor restarts executors (`../coordination/tasks-and-stigmergy.bl.md` §3.1,
  rule 3; open question D2).

### 2.2 Give work: a prompt becomes a task

```
n  "Reader: accept 0x hex literals"
→ draft: omega proposes scope [lib/boot/reader*, test/reader/**]   (Jev: in-scope? overlap?)
→ ready → active (claim txn granted)
```
- Scope is *proposed*, not typed by the human. A cheap model or Jev classifies the touched area. The
  harness checks the proposal against live claims (`overlap?`, `../coordination/tasks-and-stigmergy.bl.md`
  §3.4). On a conflict, the task shows `waiting on <holder>` immediately, before spending a token.
- Follow-ups to a *finished* task create a **new** task in the same context with a `:refines` edge (A2A
  immutability). Follow-ups to a running task are `task/say`.

### 2.3 Work in parallel; tasks find each other

- Task A posts a `finding` ("reader API stable at `read-number/1`"). Task B's scope overlaps the subject,
  so B's next context includes it. That is a context-transform reading the environment, not a message.
- Task C needs an answer from A, so it *messages* A (`task/say`). The message is also a trace, so the
  human timeline is complete (`../coordination/tasks-and-stigmergy.bl.md` §4).
- Task D waits on `[:task/status :done]` of A. Its context is frozen and it spends zero tokens while
  parked (§5.1 there; proven by the toy in `omega-at-a-glance.bl.md` §3).
- The graph screen (impeccable §7.3) shows A→D waits, the C→A message and claim contention. A
  wait-cycle is the only red item, and it comes with its recovery action.

### 2.4 Steer, interrupt, answer

- Steering is a **counter**, not a lost message. The keeper bumps `:steers`, and the loop compares it at the
  next boundary (`../coordination/processes-and-harness.bl.md` §2.8, the harness pattern already shipping).
- `input-required` comes from three sources: a permission ask (call-predicate returned `[:ask q]`), a plan
  gate, or a model's explicit `ask_user`. All three use the same `task/answer` verb and the same UI row
  (`../tools/plugins.bl.md` §6.6, Q8).

### 2.5 Review and close

- Review screen (impeccable §7.5) with tests run, files outside the claimed scope flagged, and the
  turn-snapshot ref to roll back.
- `request changes` bundles the inline comments into one message, and the task goes back to `active`.
  `accept` writes a `completion` trace (immutable), releases claims and wakes the dependents.

### 2.6 Evening: what happened today?

`omega q` with saved queries: tasks completed, cost per task (cost ledger facts), blockers > 10 min,
findings cited by more than one task. A daily digest is a *query*, not a feature.

## 3. Observability contract

Rule: **every interesting thing is either a fact, an event, or a value.** Nothing is visible only in a log
line.

| question | answered by | cost |
|---|---|---|
| what is task X doing right now? | latest `:trace/*` facts of X + live bus events (streaming tokens) | query |
| why did X start / stop / wait? | `as-of` / `history` over X's status + the triggering trace | query |
| what exactly ran? | codemode run fact: script hash, calls, writes, outcome (`../tools/codemode.bl.md` §5.7) | query + artifact |
| why was a tool call denied? | call-predicate decision event `{:task :tool :decision :rule}` (`../tools/plugins.bl.md` §8) | event + fact |
| what did the model see? | the context of turn N = a pure function of (log, transforms). Re-render it on demand | recompute |
| what did Jev decide and how sure was it? | decision fact: question hash, probabilities, gate verdict, cassette key (`../coordination/jev.bl.md` §7–8) | query |
| what did it cost? | ledger rows per model call and per Jev call | query |
| is a process alive / restarting? | `proc.reg` + `proc.super/children` + `vm.owner` (`../coordination/processes-and-harness.bl.md` §6) | REPL |
| what does the screen look like? | `view/render` → hiccup or text cells | value |

Corollaries:
- **Raw transcripts are a projection.** A task's `.bl.md` (human-readable, `bl run`-able, Stream-compatible)
  is rendered from the log, not stored as the authority. This is still open (D3), but every note leans
  this way.
- **Context is recomputable.** Debugging "why did the model do that" = re-render turn N's exact context
  and replay it against a cassette or a different model.

## 4. The developer loop — how an agent improves omega

The user wants it to be *easy for an agent to understand, test and improve* omega. Concretely:

1. **Everything is a pure function first.** Reducers, views, layout, catalog budgeting, decay, overlap,
   Jev request building and validation, and cut-point logic for compaction are all pure. Each note already
   proves some of them with `bl run` blocks (`../coordination/jev.bl.md` §7.3,
   `../interface/tui-ratatui.bl.md` §8, `../tools/plugins.bl.md`).
2. **The model is a seam.** Scripted `:step` functions (harness today) and cassettes keyed by the canonical
   request digest (relay, knowledger, spell-app) make every integration test offline and deterministic.
   *One* cassette mechanism serves chat, tools and Jev (`../loop/llm-relay.bl.md` Q7).
3. **Scenario tests are tasks.** A scenario is `(env₀, [verb …], scripted models)` → assertions over the
   final env and over `view/render --text` snapshots. The same harness runs it, so it tests the real
   thing. spell-app's scenarios/cassettes are the precedent (`../lineage/spell.bl.md` §2.9).
4. **Live, not rebuild.** omega runs in a warm VM. A changed namespace reloads, and the running tasks pick up
   new tool or view code at the next turn boundary (`../coordination/processes-and-harness.bl.md` §2.7).
   The agent's own loop: edit → `bl check` → reload → `omega view … --text` → `omega q` → done.
5. **omega develops omega.** The harness's MCP face (`harness.mcp`: `eval`/`start_turn`/`steer_turn`)
   generalises to the verb set in §1. Spell, Claude Code, or omega itself can drive omega with the same
   operations a human uses, so dogfooding starts at the first working loop.
6. **Proof where it's cheap.** `system/verify` and `system.model/graph` can check a `defserver` protocol
   ("every park edge reaches a drain edge ⇒ no leaked waiter"). Use them on the task protocol, not
   everywhere (`../lineage/spell.bl.md` Q3).

## 5. Open questions specific to interactions

1. **Default surface.** Should `omega` open the TUI or the desktop? TUI is closer to where coding happens and
   cheaper to ship. Desktop gets the graph canvas and richer diffs. Both share §1, so this is only a default.
2. **Is the human a task?** Treating the human as an actor with a mailbox makes `input-required`, messages
   and waits uniform: a task can `wait-on {:human …}`. The alternative is a special-cased UI queue. Uniform
   is simpler in code, but risks the human getting chatty traffic from tasks. That needs a policy for what
   may interrupt.
3. **Notifications.** Push a desktop notification on `needs you`, or only show it on screen? A notification
   is a trace-subscriber, so it's cheap, but noisy.
4. **How visible is Jev?** Show every decision inline (transparency, noise) or only at gates and on hover
   (cleaner, less auditable)?

## 6. With bl-ed (designed, PLAN-003)

> Nothing in this section is built. It walks one day through
> `../interface/bl-ed.bl.md` (cited as "ed §N"); every step is a consequence of a section there. The
> sequences in §2 above stay valid: bl-ed is one more surface on the same verb set (ed §8.2, "every intent is
> the same verb").

**Morning, bl-ed closed.** From a terminal:

```text
$ bin/omega "make read_number accept 0x hex"
```
- `bin/omega` is a `run` member: it calls `(world!)`, opens the task, and follows it (ed §8.2). If a world
  is already running it attaches. With `--cold` or no warm VM it opens the store itself as today (ed §8.2,
  "Cold fallback", C7).
- The task has no document, so it is *homeless*: a heading plus a `#+begin_task` cell is appended to today's
  `journal/YYYY-MM-DD.bl.org`, written by the actor that opened it. Every task has exactly one home cell
  (ed §3.7). `journal/` is committed (E7).

**Open bl-ed.** The journal shows the card, live, though the CLI opened the task (ed §8.2, coexistence):

```text
#+end_task
● running  t-41 · make read_number accept 0x hex        1m12s · ✎ reader.py:2 · 3 turns · $0.04
```
The default density is `:urgent`: a calm task is one line and grows only when it has something to say
(ed §4.1, E11). With the cursor on it the card expands; `↵` on it opens the sidebar, the task's own buffer
(ed §4.2).

**Write down a plan; drop a task under it.** In a notes file you type a heading with a paragraph of prose and
add a `#+begin_task` under it. `:context heading` is the default, so the prose around the cell *is* the
task's spec (ed §3.2, E8 lean). `space e` opens it and writes the reference result; editing the body later and
evaluating again sends a refinement to the same task (ed §3.3).

**Watch the agent edit.** The agent's edits arrive as a second, coloured cursor with its label, through the
file's buffer server (ed §5.1). Where an agent edit overlaps your fresh attention (you are typing or looking
there), it is parked as ghost text, a *suggestion*: `y` applies, `n` drops. The agent's call returns
`{:pending :suggestion}` before its eval deadline and the outcome reaches it as a message (ed §5.2, E1). Your
own typing is published to disk on pause, about 1.2 s, so a half-typed line never breaks the agent's test run
(ed §5.7, E5).

**Two agents collide.** t-41 and t-43 both want `read_number`. Disjoint regions interleave and both cursors
show (rung 0). On an overlap, the loser's exact replacement finds its `:old` text gone and is refused *with
the story*: who moved it, from which cell, where (rung 1, content CAS). If it happens twice in a window the
server leaves a `:contention` trace naming both tasks; it reaches both through their next `:context`, and by
convention the task with the older claim on the path keeps the region while the other `wait`s or `send`s a
note (rung 3). Rungs 0–1 were OBSERVED in spikes; rungs 2–4 (marks on `read`, contention traces,
escalation to you) are design only (ed §5.4).

**A gate fails.** Each model step that changed files becomes one change in omega's native history
(`omega.history`, ed §15.1). The step's written texts are snapshotted inline and committed by one
historian process, so the task barely notices (~5 ms, ed §15.8).
- The gate runs on the files that change carries (ed §15.2, E23), so t-43 is never failed for t-41's
  broken file.
- A failure still records the change, marked `[gate ✗]`, with a `:finding` trace on the task that
  wrote it. Its card goes red with the failing line (E18, decided).
- You see which step broke the build and steer from that change: a human eval in the sidebar, or
  reverting the step, which is a merge that appends a new change and keeps everyone else's later work
  (ed §15.1).
- The sidebar's evals as steers are wave W4 (ed §14).

**Effectful cells are shown, not re-run.** In t-41's sidebar, `space e` on the cell that edited `reader.py`
does not run it again. It shows its trace: the diff, who made it, when, and whether it is still present.
`d` diffs, `r` reverts with compensating ops (refused as data if the region has moved on), `c` copies it as a
new cell, which is the honest way to "run it again" (ed §7.1, decision 11). The cell's `#+RESULTS` is a
reference to the effect, the same mechanism as a task card (ed §7.2).

**Why does this line look like this?** Blame is stored with every file version, so asking costs one read
(1.8 ms for 400 lines, ed §15.1).
- It leads from the line to the change that wrote it, and from the change to the task and its home cell.
- bl-ed shows it as a margin decoration that links to the conversation that wrote the line. The margin
  decoration is a bl-ed growth item (ed §10).
- Blame survives merges, reverts and renames.
- "What did t-41 change?" is one query over the facts (ed §5.5, §15.1).

**Evening.** The tasks are done or idle; each finished task's result was rewritten once to a self-contained
summary in the journal (ed §3.4, E9 lean). With no running or waiting task and no console for the configured
idle time (`:omega {:idle 1800}`), the world stops itself so the VM can idle-expire. Tomorrow's first runner
starts it again and `recover!` re-reads the store, so nothing is lost (ed §8.5, E19 lean).

NB: the daily digest of §2.6 is unchanged: still a query. What bl-ed adds is that the work log (`journal/`)
and the facts agree by construction, since every task has a home cell and every home cell a task (ed §3.7).
