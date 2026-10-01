# beam-lisp's process tier, harness, and datom — the primitives omega is built from

> **Abstract.** omega's tasks are long-lived, named, supervised, mutually-messaging
> processes that leave traces in a shared environment. beam-lisp already ships most
> of that vocabulary: `defserver` plus an *open clause vocabulary* (`registry`,
> `bus`, `tick`, `sched`, `queue`, `pipeline`), `proc.flow` demand-driven streams,
> `proc.super` supervision trees as data, `proc.fence` bounded isolation, the
> `vm.owner` process-ownership relation, and — on the repl branch — a working
> *harness* (`priv/lib/harness.bl`): a keeper process that owns session documents,
> spawns monitored turn workers, and drives a model loop over an append-only
> `.bl.md` document. `datom` adds a totally-ordered fact log with push
> subscriptions (`datom.watch`) that is the natural *stigmergic medium*. This file
> maps each primitive (sigs, semantics, how an omega task would use it), runs the
> central ones offline, and lists the gaps. **OBSERVED** = read or run in this
> session; **INFER** = design inference.

Snapshot: `beam-lisp--repl` @ `195beb60`. The repl branch is 69 commits ahead of
`main`; those commits are the JS-actor / split-app / termination-analysis work
(PLAN-143..149), not process-tier changes (see §2.9).

## 1. Sources

Paths relative to `/home/user/code/undefine/beam-lisp--repl` unless absolute.

| what | where |
|---|---|
| the one door | `priv/std/proc.bl` (160 l; header 1–75 = vocabulary/spelling rules, 94–160 = `defserver` re-export) |
| expander + clause contract | `priv/std/proc/server.bl:1–98` (contract), `:99–160` (registry/`extend-clause!`), `:297–420` (`clause-plan`, `defserver`) |
| registry | `priv/std/proc/reg.bl:1–153` |
| bus | `priv/std/proc/bus.bl:1–214` (clause 158–185, `publish` 189, `start-broadcast` 208) |
| flow | `priv/std/proc/flow.bl:1–100` (protocol), `:487–510` (`subscribe`, `broadcast`), `:706,751` (`distribute`, `workers`) |
| supervision | `priv/std/proc/super.bl:1–60`, `:264–446`; `lib/beam_lisp/supervisor.ex:39–151` |
| fence | `priv/std/proc/fence.bl` (41 l) |
| tick / sched / queue / pipeline / table | `priv/std/proc/{tick,sched,queue,pipeline,table}.bl` headers (1–60) + `defn` lists |
| VM ownership | `priv/std/vm/owner.bl:1–35` |
| pattern language | `docs/the-process-pattern-language.md` §0 (55–110), §1.7 Parked Waiter (221–245), §2.7 Registry (375), §3 failure (399–578), §4 observation (578–665), §6 ledger (694) |
| five bundles / verb tiers | `docs/the-five-bundles.md:1–60` |
| fundamental form | `docs/the-fundamental-form.md` (headings, 1–213) |
| supervisor design | `docs/the-maximalist-supervisor.md:1–40`; `docs/staying-alive-the-whole-story.md:1–50` |
| live loop / daemon | `docs/bl/03-the-live-loop.md:12–58`; `docs/bl/06-the-warm-daemon.md:1–40`; `docs/warm-session/main.typ:20–60` |
| harness | `priv/lib/harness.bl` (434 l), `priv/lib/harness/{model,mcp,doc}.bl`, `test/bl/harness_test.bl:1–60` |
| playground / workspace | `docs/livebook-maximalist.md:1–60,159`; `docs/design/workspace-editor.md:1–30,61`; `!tasks/plans/PLAN-143-…`, `PLAN-146-…`; `git log --oneline main..repl` |
| datom as medium | `docs/datom-as-a-broadcast-substrate.md:1–70`; `docs/datom-files-a-file-is-a-fact.md:1–50`; `priv/lib/datom/broadcast.bl:1–60`; `priv/lib/datom/watch.bl:1–60,340–395`; `examples/datom/live/07-pattern-watch.bl` |
| `msg`, `live` | `priv/lib/msg.bl:1–99`, `priv/lib/live.bl:1–101` |
| examples | `examples/bus.bl`, `examples/registry.bl`, `examples/fence.bl`, `examples/pingpong.bl` |
| scratch programs I ran | `/tmp/o20/{a..e}.bl` (the demos below are distilled from them) |

NB: `priv/lib/model.bl` named in the brief does **not** exist; the model seam is
`priv/lib/harness/model.bl`. `msg.bl` is a *mail-domain datalog relation*
(`:msg/*` attrs over Gmail connectors), unrelated to inter-task messaging.

## 2. What exists, and how it works

### 2.0 The substrate (OBSERVED, docs §0)

A process is a *transition relation*: `state --[message / guard]--> state'` plus an
invariant. Everything else is a pattern over it. Verbs are layered the BEAM's way
(`docs/the-five-bundles.md` §0):

| tier | verbs | holds for |
|---|---|---|
| prelude | `start start-link stop call cast monitor link kill fence` | every process |
| `proc.*` | `proc.super/children` `proc.reg/whereis` `proc.bus/publish` `proc.flow/subscribe` | every process of that behaviour |
| your ns | `(defn withdraw [a n] (call a [:withdraw n]))` | your protocol |
| inside `def*` | `init handle-call handle-cast handle-info reply noreply ok stop invariant` | return vocabulary |

Raw Erlang is always reachable: `(erlang/send pid msg)`, `(erlang/self)`, `(spawn f)`,
`(spawn-monitor f)`, `(receive pat body … (after ms …))`, `(Process/sleep ms)`,
`(Process/whereis :name)`, `(GenServer/reply from v)`. **Names are values**: wherever a
pid goes, `:name` or `[:registry-name {attr map}]` is accepted; resolution happens once
inside `call/cast/stop` (`reg.bl:11–20`; demo 3.2 below).

### 2.1 `defserver` and the open clause vocabulary — `proc.server`

```clojure
;; sigs (priv/std/proc.bl:94–160; server.bl:402)
(proc/defserver NAME clause…)         ; QUALIFIED: bare `defserver` is the compiler special form
(start   srv init-arg {:name :kw})    ; → pid   (name registered as local name)
(start-link srv init-arg opts)
(call    pid-or-name msg [timeout])   ; sync; timeout may be :infinity
(cast    pid-or-name msg)
(stop    pid-or-name)
;; callbacks inside the form
(init [arg] (ok state))
(handle-call [:pat …] [from st] (reply v st') | (noreply st'))   ; noreply ⇒ parked waiter
(handle-cast [:pat …] [st] (noreply st'))
(handle-info [:pat …] [st] (noreply st'))
```

**The clause contract** (`server.bl:30–98`): a *clause* is
`(fn [clause ctx] → {:prelude [forms] :init <expr merged into state> :clauses [defserver clauses injected BEFORE the user's] :meta [...] :down [(fn [st ref pid reason] st)]})`,
registered with `(proc.server/extend-clause! :head transform)`. `:down` handlers of every
clause are threaded through ONE `[:DOWN …]` handler so two monitoring clauses compose.
`clause-plan` is pure and backend-agnostic (the JS actor compiler reuses it). *This is the
extension seam omega should use for its own task clause* (§4).

Shipped clause heads: `registry`, `bus`, `tick`, `sched`, `queue`+`perform`, `pipeline`, plus
the boot callbacks; `(proc.server/registered-clauses)` lists them.

### 2.2 `proc.reg` — find a process by what it is (OBSERVED + RUN)

```clojure
(proc/defserver task-index (registry (keys :task :role)))   ; declared attr keys; none ⇒ any
(start task-index nil {:name :task-index})
(proc.reg/register   r pid attrs) ; → :ok | [:error {:unknown-keys [...]}]
(proc.reg/unregister r pid)
(proc.reg/whereis    r query)     ; → pid | nil     (first match)
(proc.reg/where      r query)     ; → [pid …]       (all matches)
```

State `{:entries {pid attrs} :keys [...]}`. Every registration is `erlang:monitor`ed; the
clause's `:down` handler retracts the entry → **a dead task disappears from the index by
itself** (demo 3.1). Query = every k=v in the query ⊆ attrs (`matches?`, `reg.bl:38`):
conjunctive equality only — "not datalog" by the file's own admission. Single node. This is
the *pid ↔ attributes relation* "tasks are easy for other tasks to find" needs, at the
in-VM tier.

### 2.3 `proc.bus` + `proc.flow` — fan-out with backpressure (OBSERVED + RUN)

`flow` is GenStage-style **pull**: consumer→producer `[:subscribe C]`, `[:demand n]`;
producer→consumer `[:events (e…)]`, `[:done]` (`flow.bl:1–100`). A **bus** is a flow producer
that fans events to N subscribers, each with independent demand and a lag bound:

```clojure
(proc/defserver events (bus (demand 4)))            ; start opts: {:demand n :max-lag 1024}
(proc.bus/publish bus ev)                           ; call; BLOCKS publisher if a :block subscriber hits max-lag
(proc.flow/subscribe up id (fn [ev] …) {:demand 8 :on-lag :block|:drop :max-lag 1024})  ; → consumer pid
(proc.flow/broadcast up [opts])                     ; a bus fed by any flow producer
(proc.flow/distribute …) (proc.flow/workers …)      ; fan-out to N workers (competing consumers)
```

Contrast with datom's broadcast (§2.10): bus = *bounded, backpressured, in-memory*; datom
broadcast = *unbounded-mailbox push over a durable log*. A dead subscriber is dropped
(`down-handler`).

### 2.4 `proc.super` — supervision trees as data; `proc.fence`

```clojure
(proc.super/defsupervisor tree
  (strategy :one-for-one)            ; :one-for-all :rest-for-one
  (intensity 3 5000)                 ; ≤3 restarts / 5000 ms, else escalate (die)
  (child :w1 worker-srv init-arg {:restart :transient :shutdown 5000})
  (child :pool (pool worker-srv 4))) ; n workers + round-robin dispatcher
(start-link tree)                    ; → sup pid
(proc.super/children s)              ; → [{:id :pid :type}]
(proc.super/child-of s :w1)          ; → pid (dispatcher pid for a pool)
(proc.super/terminate s id) (proc.super/restart s id)
(proc.fence/fence ms body…)          ; → {:ok v} | {:crash reason} | {:timeout true}   (macro)
(proc.fence/fence-fn {:ms n :kill? true} f)
```

The tree is validated *as data* at expansion (`supervisor-plan`: unknown strategy, duplicate
id, bad option are named errors). **Dynamic children** have no `proc.super` wrapper; the
Elixir layer is reachable and works (RUN, demo 3.4):
`(Supervisor/start_child sup (BeamLisp.Supervisor/server :id srv arg))` → `{:ok pid}`, and
`children` then lists it. *INFER*: omega needs a thin `omega.task/spawn-child` over this
with `:temporary` restart (a finished/failed task should not be resurrected blindly).
`fence` is the *bounded-effect* primitive: a child computation becomes a value, killed on
timeout — the harness's `eval-cell` re-implements it by hand (`harness.bl:230–260`).

### 2.5 Time and durability: `tick`, `sched`, `queue`, `table`, `pipeline`

* `(tick N :unit [st] body)` — self-send heartbeat; cannot overlap itself; injectable
  `:clock`; `proc.tick/{tick-reset tick-cancel}`. (RUN: 20 ms tick fired ≥3× in 120 ms.)
* `(sched (every 15 :minutes :id f {:catch-up :skip|:coalesce}) (daily 7 0 …) (at ms …))` —
  one `send_after` at earliest due; occurrence ids `"<id>@<due-ms>"` are idempotency keys;
  `proc.sched/{next spec pause resume run-now}`; persists via a datom store.
* `(queue {:of :ns/entity :concurrency 4 :retry {…} :unique […] :lease 300})` +
  `(perform [job] …)` — durable at-least-once queue where **a job is a fact** (claim = CAS
  transaction); `proc.queue/{enqueue! stats cancel! prune!}`.
* `proc.table` — an ETS table that outlives its owner (heir pattern).
* `(pipeline (from …) (stage :n f {:concurrency 2}) (batch :b 8 {:timeout 150}) (on-lag :block))`
  with read model `proc.pipeline/{pipeline-rows pipeline-of pipeline-row worker-vitals}`.

### 2.6 `vm.owner` — an env owns its processes (OBSERVED)

`priv/std/vm/owner.bl`: the registry pattern keyed `{:vm :role}`:
`(owner/spawn vm role thunk)`, `(owner/spawn-in vm role env thunk)`, `(owner/procs vm)`,
`(owner/count vm)`, `(owner/halt vm)` → `{:halted n}`. Tearing a VM down kills exactly that
VM's members, not the node. The harness uses it so every turn worker is a member of the
project VM (`harness.bl:90–95`). This is the *task-scope teardown* primitive.

### 2.7 The warm daemon (OBSERVED, `docs/bl/03`, `bl/06`, `warm-session`)

`bl daemon start|status|stop` — one warm VM per checkout; each request runs as **a fresh
process in the project VM with the caller's environment bound process-locally**;
`restart_required` on compiler-key drift; idle self-stop (`BL_DAEMON_IDLE_SECONDS`). Laws
(`warm-session/main.typ:42–60`): one meaning cold/warm; errors are values; one implementation
per need. A resident omega process tree naturally lives in this VM.

### 2.8 The harness (`priv/lib/harness.bl`) — OBSERVED; closest thing to omega's core

Shape (header 1–35): `evaluate` (cells now) · `start-turn` (async model loop) · `steer-turn`
(inject while running). Input is `.bl`/`.bl.md`; **the session document
`.local/harness/<session>.bl.md` is the entire state** — transcript, model context, and a
`bl.doc` livebook slice.

```clojure
(harness/start-keeper root vm {:step model-fn})   ; model-fn: (fn [root ns document] → {:ok text}|{:error …})
(harness/evaluate   {:session "s" :code|:path … :timeout-ms n})   ; → {:session :doc :md :cells […]}
(harness/start-turn {:session "s" :code "task…"})                 ; → {:turn "t1" :status :running …} | {:error busy}
(harness/steer-turn …)                 ; running → :steered ; idle → starts a turn
(harness/status sid) (harness/await-turn sid [ms]) (harness/stop! sid) (harness/tail sid [n])
```

Mechanics worth copying:

* **`keeper` = ONE-writer `defserver`** (`:122`), state `{:sessions {sid {:path :ns :next :turn :last}}}`.
  All appends go through `[:post sid title blocks]` as one whole-section write ⇒ cell ids are
  assigned at append time, no interleaving.
* **Check-and-spawn is one step** (`[:begin sid thunk]`): refuses if `:turn` is set → exactly one
  live turn per session. Worker spawned via `owner/spawn-in` and `erlang/monitor`ed.
* **Crash is data**: keeper's `handle-info [:DOWN …]` finds the session by monitor ref and appends
  "turn tN crashed" with the reason, so a session never stays busy forever.
* **Steering = a counter, not a message**: `[:steer sid]` bumps `:steers`; the loop records `seen`
  before each step and `[:end sid outcome seen]` answers `:steered` (keep going) if `steers > seen`
  — check-and-close is atomic in the keeper, so a steer cannot be lost.
* **Eval cell = spawn-monitor + `receive … after`** with its own `group_leader` StringIO (stdout
  capture) and `exit :kill` on timeout (`EVAL-TIMEOUT-MS 20000`); failures are values.
* **Model seam**: `:step` fn in keeper state; default `harness.model/reply` = `gen.llm/chat` over
  DeepSeek with `:stop ["```bl-result"]` so the model cannot hallucinate results
  (`model.bl:17–35`). Tests inject a scripted `:step` (`harness_test.bl:18–35`) ⇒ deterministic, offline.
* `MAX-STEPS 24` per turn; `harness.mcp` serves `eval/start_turn/steer_turn` as an MCP server with a
  per-project bearer token (`mcp.bl:84–125`).

Limits (OBSERVED): turns are **sessions, one turn at a time, chat-shaped** (`:busy` error); no task
identity beyond `sid`; no inter-session messaging; the model's *only* tool is "write beam-lisp
cells"; no streaming (`llm/chat` returns whole replies); one flat document is the context, no
compaction.

### 2.9 What the repl branch adds, and the "Playground" (OBSERVED)

`git log --oneline main..repl` = 69 commits; by prefix: PLAN-149 ×6, JS split ×4, Termination ×3,
js-actors ×3, split ×2, JS target ×2, Analyzer ×2, …: **a BL→JS actor compiler, "split" apps (one
source → client bundle + server bundle + contract), and purity/termination/footprint analysis**
(soundness for client placement). None changes `proc.*`. Relevant to omega only as *front-end*
machinery: compiled-to-JS BL actors and the split-app shell are a candidate way to run UI logic in a
webview.

"**Playground**" = the BL Playground editor workspace: PLAN-143 (DONE) *editable quoted-view
playground* — the user edits a small BL data-form view in the browser and a compiled BL actor in a JS
Worker renders it, typed-event gate, no server round trip; PLAN-146 (DONE) *integrated form-first
workspace design* — `docs/design/workspace-editor.md`: **Source** and **Stream** perspectives,
selected-form inspector, command palette, CIDER-style form-targeted eval, an Activity lens, a
clickable mockup in `research/js-actors/apps/workspace.bl`. A **Stream** = a durable `.bl.md` with
cells/results/turn history that *adopts the harness's one-writer session mechanism*
(`stream-workspace.md`); `workspace-editor.md:61` insists on labelling three distinct execution
contexts (`bl repl`, playground image, Stream harness namespace). `docs/livebook-maximalist.md`
is the thesis: "a livebook is a namespace wearing prose", rendered as *serve / build / run*.
**INFER**: the harness *is* the Stream backend; omega's task document ≈ a Stream document.

### 2.10 datom as a stigmergic medium (OBSERVED + RUN)

Thesis (`datom-as-a-broadcast-substrate.md:19–31`): datom is "a communication system wearing a
database costume": a durable totally-ordered fact log; once "it changed" is expressible, every BEAM
broadcast primitive is a transport; **a dropped broadcast is never a lost event, only a slower read**.

```clojure
(datom/connect schema)                       ; → conn
(datom/transact! conn [{:db/id -1 :task/id 1 :task/state :running}])
(datom.broadcast/listen! conn opts)          ; L2: every commit as [:datom/tx basis tx-datoms] to self
(datom/watch conn '[?e :task/state :done] (fn [changes] …))   ; T1 pattern: fires on matching datoms
(datom/watch conn '[:find … :where …] inputs (fn [{:keys [added removed]}] …))   ; T2a query diff
(datom/unwatch w)
(live/register-live! conn query inputs ns cb-name)   ; gated: refuses non-monotone (:not) queries
```

The watch runs in its own process: a crashing callback kills only the watch; slow subscribers never
backpressure the writer (`watch.bl:352–374`). Files are facts too (`:db.type/file` = 50-byte
`{:sha :size :media-type}` descriptor + content-addressed blob; `datom-files…md`): a task's artifact
(diff, log, screenshot) can be a fact with a stable hash. `as-of`/bitemporal gives "what did the
environment look like when task T decided?". Auth `guard` injects `:where` clauses ⇒ per-principal feeds.

For stigmergy (INFER): the **environment is the db**; a trace is a datom; "sensing" is a `watch` on a
pattern; evaporation is retraction (history retained); `[:db/cas …]` gives atomic claim
(`queue.bl`'s Claim/Lease already does exactly this).

### 2.11 `msg.bl`, `live.bl`

`msg.bl` — **not** task messaging; the mail-domain `:msg/*` relation (provider-bound via
`connector`). Useful as a *pattern*: "a domain owns attributes; providers bind into a relation"
(omega's tool providers). Note its gotcha (`msg.bl:84–95`): registrations must be a *function*, not
a top-level effect, because AOT-compiled namespaces do not re-run top-level effects on load.
`live.bl` — `register-live!`: admits a watch only if its query is monotone (no `:not`/`:not-join`)
and reports the callback's declared effect (`:pure`/`:unknown`); rejection is data.

## 3. Runnable demos

All offline and deterministic (≤ ~1 s of sleeps). `defserver` must be qualified `proc/defserver`.
The blocks share one namespace and run in order.

### 3.1 Two procs messaging each other, and a registry lookup by name

```beam-lisp
(ns omega.research.proc
  (:require [proc :as proc] [proc.reg :as reg] [proc.bus :as bus]
            [proc.flow :as flow] [proc.super :as sup] [proc.fence :as fence] [datom]))

(def parent (erlang/self))

;; a "ponger" task: receives [:ping from n], answers [:pong n+1], loops
(def ponger
  (spawn (fn [] (loop []
                  (receive [:ping from n] (do (erlang/send from [:pong (inc n)]) (recur)))))))

;; a "pinger" task that talks to the ponger and reports to the parent
(def pinger
  (spawn (fn []
           (erlang/send ponger [:ping (erlang/self) 41])
           (receive [:pong n] (erlang/send parent [:pinger-got n])))))
(println "two procs:" (receive [:pinger-got n] n (after 1000 :timeout)))

;; registry: pid <-> attributes, retracts on death
(proc/defserver task-index (registry (keys :task :role)))
(start task-index nil {:name :task-index})
(println "register ponger:" (reg/register :task-index ponger {:task "t1" :role :worker}))
(println "register pinger:" (reg/register :task-index pinger {:task "t2" :role :planner}))
(println "whereis t1 is ponger:" (= ponger (reg/whereis :task-index {:task "t1"})))
(println "workers:" (count (reg/where :task-index {:role :worker})))
(println "unknown key refused:" (reg/register :task-index ponger {:nope 1}))
(erlang/exit ponger :kill)
(Process/sleep 50)
(println "after death, whereis t1:" (reg/whereis :task-index {:task "t1"}))
```

### 3.2 Name-as-value: call by attribute address

```beam-lisp
(proc/defserver account (init [n] (ok n)) (handle-call [:balance] [_f s] (reply s s)))
(def acct (start account 7))
(reg/register :task-index acct {:task "t9"})
;; [:registry-name {attrs}] is accepted wherever a pid is
(println "call via [:task-index {:task \"t9\"}]:" (call [:task-index {:task "t9"}] [:balance]))
```

### 3.3 A waiter blocking on another proc's result (parked-waiter pattern)

`call` with a *deferred* reply: `handle-call` returns `noreply`, parks `from` in state; a later
`cast` replies via `GenServer/reply`. A waiter arriving *after* the result is answered immediately —
a **promise keyed by task id**, built from stock parts.

```beam-lisp
(proc/defserver results
  (init [_] (ok {:vals {} :waiters {}}))
  (handle-call [:await k] [from st]
    (if (contains? (:vals st) k)
      (reply (get (:vals st) k) st)
      (noreply (update-in st [:waiters k] (fnil conj []) from))))
  (handle-cast [:put k v] [st]
    (do (doseq [w (get (:waiters st) k)] (GenServer/reply w v))
        (noreply (-> st (assoc-in [:vals k] v) (update :waiters dissoc k))))))
(start results nil {:name :results})

(spawn (fn [] (erlang/send parent [:woke (call :results [:await :t1/result] 5000)])))
(Process/sleep 50)                                   ; the waiter is parked now
(cast :results [:put :t1/result {:answer 42}])
(println "waiter woke with:" (receive [:woke v] v (after 1000 :timeout)))
(println "late waiter (already resolved):" (call :results [:await :t1/result] 1000))
```

### 3.4 Bus subscribe, supervision with restart, dynamic child, fence

```beam-lisp
;; bus: published events reach flow subscribers
(proc/defserver events (bus (demand 4)))
(def b (start events nil {:name :events}))
(flow/subscribe b :sub-a (fn [e] (erlang/send parent [:sub-a e])))
(bus/publish :events {:task "t1" :ev :started})
(println "bus delivered:" (receive [:sub-a e] e (after 1000 :timeout)))

;; supervisor: kill a child, OTP restarts it with the same init arg and a new pid
(proc/defserver wk (init [n] (ok n)) (handle-call [:id] [_f s] (reply s s)))
(proc.super/defsupervisor tree (strategy :one-for-one) (child :w1 wk 1) (child :w2 wk 2))
(def s (start-link tree))
(def old (sup/child-of s :w1))
(erlang/exit old :kill)
(Process/sleep 100)
(println "restarted w1:" (not= old (sup/child-of s :w1)) "id still" (call (sup/child-of s :w1) [:id]))

;; dynamic child through the Elixir layer (proc.super has no wrapper yet)
(Supervisor/start_child s (BeamLisp.Supervisor/server :w9 wk 9))
(println "children now:" (sort (map name (map :id (sup/children s)))))

;; fence: a child computation as a value
(println "fence ok:" (fence/fence 100 (+ 1 2)))
(println "fence timeout:" (fence/fence 50 (Process/sleep 500)))
```

### 3.5 datom as the shared environment: a pattern watch is "sensing a trace"

```beam-lisp
(def conn (datom/connect [{:db/ident :task/id    :db/valueType :db.type/long :db/unique :db.unique/identity}
                          {:db/ident :task/state :db/valueType :db.type/keyword}]))
(def w (datom/watch conn '[?e :task/state :done]
                    (fn [changes] (erlang/send parent [:saw-done (count changes)]))))
(Process/sleep 30)
(datom/transact! conn [{:db/id -1 :task/id 1 :task/state :running}])   ; not :done → silent
(datom/transact! conn [{:db/id -2 :task/id 2 :task/state :done}])      ; the trace a waiter senses
(println "watch fired:" (receive [:saw-done n] n (after 1000 :timeout)))
(datom/unwatch w)
```

### 3.6 What the scratch run printed (OBSERVED, `/tmp/o20/c.bl`, same code)

```
pong: 2 · whereis ok: true · where: 1 · after death: nil
waiter: {:answer 42} · late waiter: {:answer 42}
bus: {:task "t1", :ev :started} · children: (:w2 :w1) · restarted: 1 · watch: 1
```

## 4. What omega should take / adapt / drop

| primitive | verdict | reason |
|---|---|---|
| `proc/defserver` + `extend-clause!` | **take, and extend**: add an `(omega-task …)`/`(scope …)` clause | the seam exists *exactly* for slicing server behaviour; a task = defserver with a `:task` registry row, a scope, a mailbox protocol, composable with `tick`/`bus`/`sched` |
| `proc.reg` | **take** as the in-VM "who is where" index (`{:task :role :parent :scope}`) | auto-retract on death = no stale entries. Adapt: multi-valued attrs / prefix match, or mirror into datom for richer queries |
| `proc.bus` + `flow` | **take** for streaming model deltas/UI events (backpressure matters for a slow UI); **drop** as the stigmergic medium | bus is ephemeral; stigmergy needs durable, replayable traces → datom |
| parked-waiter `call` | **take** (3.3) as `await` on a task result; wrap with timeout & cancel | stock `call` timeout *exits the caller*; add the `[:cancel ref]` edge so a withdrawn waiter is removed (pattern §1.7 calls this out) |
| `proc.super` | **take** (+ write `spawn-child`) | per-scope subtrees; `:temporary` for one-shot tasks, `:transient` for resumable; intensity gives escalation to the parent scope |
| `proc.fence` | **take** for every tool call / cell eval | replaces harness's hand-rolled `eval-cell`; add `group_leader` stdout capture |
| `tick`/`sched` | **take** for autonomous tasks (polling, reminders) and heartbeats | injectable clock ⇒ testable |
| `queue` | **take** only if tasks must survive VM restarts, at-least-once | `perform` must be idempotent; a job is a datom |
| `vm.owner` | **take** for task-scope teardown (cancel a task ⇒ halt its members) | the missing primitive for cancel-as-a-unit |
| `harness` keeper | **adapt**: keep one-writer-per-document, atomic check-and-spawn, steer counter, crash→document, scripted `:step`; **drop**: session=task identity, one-turn chat model, single `eval` tool, flat document-as-context | omega tasks need ids, scopes, parents, multiple tools, sub-agents |
| `.bl.md` session document | **take** as the *human-readable projection* of a task's conversation | readable, diffable, runnable, Stream/livebook-compatible; but the **fact log, not the document, should be authoritative** (INFER) |
| `harness.model` seam | **take** the `:step` injection; **replace** the provider (relay/Jev) | tests stay deterministic/offline |
| `harness.mcp` | **take** as the editor/agent-facing driver | same capabilities for any MCP client |
| datom (`watch`, files, bitemporal, `cas`) | **take** as stigmergic medium + task memory | durable, ordered, queryable, time-travel, per-principal guard |
| `live/register-live!` | **take** the *gate* idea: refuse non-monotone coordination queries | a waiter on a negation cannot be woken soundly |
| `msg.bl` | **drop** (domain mail relation); copy only the "domain owns attrs, provider binds" pattern | |
| repl-branch JS actors / split apps / Playground | **defer**; candidate for loom-side UI logic | no coupling to the proc tier |

## 5. beam-lisp mapping — coverage and gaps

Covered (paths): spawn/send/receive (prelude; `examples/pingpong.bl`), name registry (`proc.reg`),
supervision (`proc.super`), isolation (`proc.fence`), pub/sub with backpressure (`proc.bus`/`flow`),
timers (`proc.tick`/`sched`), durable jobs (`proc.queue`), process ownership (`vm.owner`), fact
substrate + push subscription (`priv/lib/datom/{watch,broadcast}.bl`), harness
(`priv/lib/harness*.bl`), static verification of process graphs (`system/verify`, `system.model`;
pattern language §4.3).

**Gaps (observed or inferred):**

1. No first-class **task/scope** concept — nothing ties a process set + env + parent + goal together except `vm.owner`'s `{:vm :role}` rows.
2. **Cancel-able await**: parked waiter has no built-in `[:cancel ref]`; `(park …)`/`(drain …)` helpers are ○ unbuilt (`the-process-pattern-language.md:240`).
3. **Dynamic supervision** has no `proc.super` verb (works via `Supervisor/start_child`, RUN above).
4. `reg` is single-node, equality-only; no cluster (`:global`/`:pg` are "—" in `datom-as-a-broadcast-substrate.md` §1.1).
5. `datom.watch` is in-VM push over an unbounded mailbox; durable *subscriber progress* (resume from a basis) is by re-reading `as-of`, not built in (INFER from the §0 thesis).
6. `defserver` must be qualified (`proc/defserver`) until boot renames the special form to `defgen` (`proc.bl:15–45`).
7. Harness: no streaming, no tool-calling protocol beyond `eval`, no compaction, fixed `MAX-STEPS`, one turn per session.
8. Namespace hygiene: `proc.sched/next` shadows core `next`; the door uses explicit `:refer` lists on purpose (`proc.bl:61–70`).

## 6. Interactions & observability

* **Human at the REPL / warm daemon**: `bl eval`/`bl repl` against the warm VM; `(proc.super/children s)`,
  `(proc.reg/where :task-index {})` (empty query = all), `(owner/procs vm)`, `(harness/status sid)`,
  `(harness/tail sid 4000)`; `proc.sched/{next,spec}`, `proc.queue/stats`, `proc.pipeline/pipeline-rows`
  are *read models as data*. `bl ui` renders the same read model as the terminal.
* **Agent developing omega**: `harness/evaluate` (cells now) and the MCP tools
  `eval/start_turn/steer_turn` with a per-project bearer token; `bl test` isolates per file (ward);
  tests inject a scripted `:step`.
* **Verification**: `(system/verify 'ns/name)` proves invariants from source with no process;
  `system.model/graph` returns `{states, transitions}` for any `defserver`. An omega task protocol
  could be *verified* (every park edge reaches a drain edge ⇒ no leaked waiter).
* **Tracing the environment**: with datom as medium, "why did task B start?" = an `as-of` query over
  traces; `watch` for live; the `.bl.md` document is a projection.

## 7. Open questions for discussion

1. **Medium for stigmergy**: (a) datom only — durable, queryable, time-travel; cost: every trace is a transaction, watch is in-VM, T2a re-runs queries per relevant commit; (b) `proc.bus` only — cheap, backpressured; ephemeral, no replay; (c) hybrid — datom authoritative, bus/`watch` as the wake-up channel. *Lean (INFER): (c).*
2. **Task identity = process or fact?** (a) a registered process with a datom row mirroring it — simpler; (b) a datom entity with a disposable *executor* (resumable via queue-style claim/lease) — buys resumability, costs complexity.
3. **Where does the conversation live?** `.bl.md` document (harness today; human-first) vs. fact log with `.bl.md` as a projection (queryable, multi-writer) vs. both. Interacts with compaction and Stream compatibility.
4. **Waiting semantics**: plain `call` timeout (crashes caller), `fence`-wrapped await, or build the `[:cancel ref]` parked-waiter helper? Wait on a *result*, on a *predicate over datom* (monotone-gated), or on a *message*?
5. **Supervision granularity**: one tree per scope (subtrees under `vm.owner` VMs) vs. one flat dynamic pool with registry-driven scope. Restart policy: `:temporary` (finished) vs `:transient` (resumable).
6. **Tool execution**: keep "model writes beam-lisp cells" as the only tool (maximal, homoiconic; needs sandboxing via `fence` + env fork + `effects` purity gates) or add structured tool calls (portable across providers, easier to permission)?
7. **Extending `defserver`**: an `(omega-task …)` clause (declarative, verifiable, composes with `tick`/`bus`) vs plain defservers + library fns (fewer moving parts).
8. **Single node vs cluster**: `reg` and `datom.broadcast` are single-node; is distribution (`:pg`, `:global`, `erpc`) in scope for v1?
9. **Reuse the Playground/Stream design** (`workspace-editor.md`, `stream-workspace.md`) as omega's loom UI model, or treat the repl-branch JS-actor target as out of scope for the first cut?
10. **Provider seam**: `harness.model/reply` is DeepSeek via `gen.llm`; omega wants relay (`/home/user/code/ora/relay`) and Jev (env `TYPESAFE_API_KEY`) — which layer owns provider selection, and is a typed decision a *message*, a *fact*, or a *call*?

## 8. API cheat-sheet

| need | call | returns / notes |
|---|---|---|
| define a process | `(proc/defserver n clause…)` | qualified; clauses: `init handle-call handle-cast handle-info registry bus tick sched queue perform pipeline invariant` |
| start / stop | `(start n arg {:name :k})` `(start-link n arg)` `(stop p)` | pid; `:name` registers locally |
| ask / tell | `(call p msg [ms or :infinity])` `(cast p msg)` | `p` = pid, `:name`, or `[:reg {attrs}]` |
| defer a reply | `handle-call … (noreply st')` … `(GenServer/reply from v)` | parked waiter |
| raw spawn / msg | `(spawn f)` `(spawn-monitor f)` `(erlang/send p m)` `(erlang/self)` `(receive pat body (after ms …))` | `[:DOWN ref :process pid reason]` |
| local name | `(Process/whereis :k)` | pid or nil |
| registry | `(proc.reg/register r pid attrs)` `unregister` `whereis` `where` | `:ok` or `[:error {:unknown-keys …}]`; auto-retract on death |
| fan-out | `(proc.bus/publish b ev)` `(proc.flow/subscribe b id f opts)` `(proc.flow/broadcast up)` | pull/demand; `:on-lag :block` or `:drop` |
| compete | `(proc.flow/distribute …)` `(proc.flow/workers …)` | one event → one worker |
| supervise | `(proc.super/defsupervisor t (strategy …) (intensity n ms) (child id srv arg opts) (child id (pool srv n)))` `(start-link t)` | `children` `child-of` `terminate` `restart` |
| dynamic child | `(Supervisor/start_child s (BeamLisp.Supervisor/server id srv arg))` | `{:ok pid}` (Elixir layer) |
| bound a call | `(proc.fence/fence ms body…)` | `{:ok v}`, `{:crash r}`, or `{:timeout true}` |
| heartbeat | `(tick N :minutes [st] body)` `proc.tick/{tick-reset tick-cancel}` | self-send, no overlap |
| schedule | `(sched (every …) (daily h m …) (at ms …))` `proc.sched/{next spec pause resume run-now}` | idempotency-keyed |
| durable jobs | `(queue {…})` `(perform [job] …)` `proc.queue/{enqueue! stats cancel! prune!}` | at-least-once |
| VM members | `vm.owner/{spawn spawn-in procs count halt}` | scope teardown |
| facts | `(datom/connect schema)` `(datom/transact! c txs)` `(datom/watch c pat f)` `(datom/unwatch w)` | push, own process |
| gate live query | `(live/register-live! c q in ns cb)` | `{:ok …}` or `{:error {:non-monotone …}}` |
| harness | `harness/{start-keeper evaluate start-turn steer-turn status await-turn stop! tail}` | session doc `.local/harness/<sid>.bl.md` |
| verify | `(system/verify 'ns/name)` `system.model/graph` | from source, no process |
