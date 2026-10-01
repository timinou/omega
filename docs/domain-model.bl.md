# The omega domain model

> Literate and runnable: `bin/bl run docs/domain-model.bl.md`. Each block runs against
> the real `omega.*` namespaces, and the printed values are the evidence. This is the
> model future work builds on: read it before changing `src/omega/schema.bl`.

## 1. One sentence

**omega is a fact log that actors read and write. A task is an entity in that log,
plus a disposable process that works on it.**

Everything else follows from that sentence:
- Processes can crash, restart or be cancelled without losing anything, because
  nothing lives only in a process.
- Any observer sees everything by querying or sensing the log: a human UI, another
  task, a test, an extension.
- History is free. Every past value of every attribute is in the log.

## 2. The five entity kinds

| kind | identity | what it is | written by |
|---|---|---|---|
| **actor** | `:actor/id` | anyone addressable: a task, or a human (`human:<name>`) | `omega.actor/ensure!` |
| **task** | `:task/id` (= its actor id) | a unit of committed work: goal, status, owner, scope, waits, result, cost | `omega.task`, the executor |
| **msg** | `:msg/id` | a message from one actor to another; the fact *is* the delivery | `omega.actor/send!` |
| **trace** | `:trace/id` | a mark left in the environment for anyone to find by content | `omega.trace/leave!`, the loop, the harness |
| **turn** | `:turn/id` = `<task>/<n>` | one exchange in a task's conversation: a user, assistant or tool turn with content blocks | `omega.loop` |

```text
             ┌──────────── :task/owner ───────────┐
             ▼                                    │
 actor ◄── task ──────────────────────────────── task (subtask)
   ▲  ▲      ▲  ▲
   │  │      │  └── :turn/task ── turn (n = 1, 2, …; role; content blocks)
   │  │      └───── :trace/task ── trace (kind, subject, strength)
   │  └ :msg/to ── msg ── :msg/from ┘
   └──────────────────── :msg/re ── (a reply points at its question)
```

All refs point **from child to parent**, so "the children of X" is one indexed
pattern, and an entity is complete on its own.

## 3. Setting up a world

```beam-lisp
(ns domain-model
  (:require [omega.schema :as schema]
            [omega.env :as env]
            [omega.actor :as actor]
            [omega.trace :as tr]
            [omega.task :as task]
            [omega.loop :as loop]
            [omega.codemode :as cm]))

(println "attributes declared:" (count schema/all))
(println "by kind:" (frequencies (map (fn [a] (namespace (:db/ident a))) schema/all)))

(def clock (atom 1000))
(def e (env/open {:clock (fn [] @clock)}))
```

The clock and the id source are injected. That's what makes decay, ordering and
tests deterministic.

## 4. Actors and messages: the human is just another actor

```beam-lisp
(actor/ensure! e "human:me" :human "me")
(actor/ensure! e "t-x" :task "explorer")
(def ask (actor/send! e {:from "t-x" :to "human:me" :kind :ask :text "May I delete build/?"
                         :data {:choices [[:yes "Yes"] [:no "No"]]}}))
(println "human inbox:" (map (fn [m] [(:from m) (:kind m) (:text m)]) (actor/inbox e "human:me")))
(actor/reply! e ask "yes")
(println "reply seen by the task:" (:text (actor/reply-to e ask)))
(println "human inbox now:" (actor/inbox e "human:me"))
```

Delivery is one transaction. Durability, ordering and replay come from the log. A
process wake (`sense-inbox`) is only a hint that something new is there.

## 5. Traces: stigmergy with decay and reinforcement

```beam-lisp
(env/tx! e [{:db/id -1 :task/id "t-x" :task/status :running}
            {:db/id -2 :task/id "t-y" :task/status :running}])
(tr/leave! e "t-x" {:kind :finding :subject "src/reader" :text "hex literals parse in read-number"})
(tr/leave! e "t-x" {:kind :intent :subject "src/reader" :text "will add 0b binary next"})
(println "claim by t-x:" (keys (tr/claim! e "t-x" "src/reader")))
(println "t-y claims src/reader/bin.bl:" (map :task (:conflict (tr/claim! e "t-y" "src/reader/bin.bl"))))

(reset! clock (+ 1000 1800000))      ; 30 minutes later
(println "strengths after 30 min:"
         (map (fn [v] [(:kind v) (:strength v)]) (tr/all e {:task "t-x"})))
(tr/read! e "t-y" {:kind :intent})   ; t-y reads the intent → reinforced
(println "intent after t-y read it:" (:strength (first (tr/all e {:kind :intent}))))
```

The trace vocabulary is open. `omega.trace/GLOSSARY` documents the kinds omega
emits, and `define-kind!` adds new ones:

```beam-lisp
(doseq [[k v] (sort-by first @tr/GLOSSARY)]
  (println (str "  " k " · half-life " (or (:half-life-ms v) "∞") " ms · " (:doc v))))
```

## 6. Tasks: an entity plus a disposable executor

The executor is a `defserver` under a `DynamicSupervisor`. The model is a `step`
function. Here it's a scripted one, so this document runs offline.

```beam-lisp
(def sys (task/start-system e {:tools cm/tools :root "/tmp"
                               :step (loop/by-goal
                                      {"list files" [(loop/call-tool "eval" {:code "(sh \"echo a b\")"})
                                                     (loop/say "two files: a, b")]
                                       "parent" [(loop/call-tool "eval" {:code "(spawn \"child\")"})
                                                 (fn [_] (receive :never nil (after 60000 nil)))]
                                       "child" [(fn [_] (receive :never nil (after 60000 nil)))]})}))

(def t1 (task/open! sys {:goal "list files"}))
(println "t1 settles:" (select-keys (task/await sys t1 5000) [:status :result]))
(println "t1's conversation:" (map :role (loop/turns sys t1)))
```

A **follow-up is part of the same task** (decision D3). It refines the goal and
starts another turn:

```beam-lisp
(task/say! sys t1 "and the hidden ones?")
(Process/sleep 100)
(println "t1 refined:" (:refined (task/view sys t1)))
```

Subtasks are first-class. They have an owner edge, cancel cascades **top-down**,
and failure is reported **bottom-up** to the owner as a `:note`:

```beam-lisp
(def p (task/open! sys {:goal "parent"}))
(Process/sleep 300)
(println "tree before cancel:" (task/tree sys p))
(task/cancel! sys p)
(println "tree after cancel: " (task/tree sys p))
```

## 7. History is free

Every status a task has held, in order, comes from the log, not from a separate
audit table:

```beam-lisp
(println "t1 status history:"
         (map :value (filter :added (env/history e (env/eid e :task/id t1) :task/status))))
```

## 8. Queries the model makes cheap

These are the questions a UI, a supervisor or a compactor will ask. Each one is a
single Datalog query.

```beam-lisp
(println "who is running or waiting?"
         (env/q e '[:find ?id ?s :where [?t :task/id ?id] [?t :task/status ?s]
                    [(contains? #{:running :waiting} ?s)]]))

(println "open questions to the human:"
         (count (actor/inbox e "human:me")))

(println "every tool call, per task:"
         (frequencies (map :task (tr/all e {:kind :tool}))))

(println "tasks with children:"
         (env/q e '[:find ?pid (count ?c) :where [?c :task/owner ?p] [?p :task/id ?pid]]))

(task/stop-system! sys)
```

## 9. Invariants (enforced by code or tests)

1. **The log is the truth.** Executors hold a cache (`:turn` pid), never state that
   isn't also a fact. *Test:* `task-test` asserts on facts, never process state.
2. **Consequences land before status.** `finish!` writes the result, completion
   trace, released claims and failure note *before* flipping `:task/status`. A
   waiter that wakes on the status always finds them. *Test:*
   `tools-run-and-done-closes-the-task`.
3. **Terminal is final.** `say!`/`steer!` on a `:done|:failed|:cancelled` task throw.
   A new piece of work is a new task.
4. **Claims are advisory.** A conflict is returned as data. Nothing blocks a write.
   The task decides whether to wait, coordinate or use a worktree (D4).
5. **Effects never ride argument order.** beam-lisp main evaluates call arguments
   right to left (observed). Code sequences effects with `let`/`do`.
6. **Refs point child → parent**, and every kind has a string identity attribute, so
   a transaction can upsert by id.

## 10. Where it goes next (not built yet)

- **Compaction / handoff (D11).**
  - (b) Hand off to a successor task. Its goal is a summary, and a new
    `:task/continues` edge points at the predecessor, so lineage is one query.
  - (c) A compactor actor senses *trace pressure* (turn count × tool traces per
    task) and proposes a handoff.

  Both are queries over this model plus one new attribute.
- **Jev at decision points (D5).** "Is this message in my scope?", "should I wait on
  this claim?", "is the goal met?" — typed questions whose answers are traces of
  kind `:decision`.
- **Durable by default.** `env/open {:path dir}` already uses fjall. The CLI exposes
  it as `--db`. A warm VM per project makes tasks outlive a shell.
