# omega at a glance — the thesis, the layers, the smallest loop

> **Literate.** The one `beam-lisp` block below runs:
> `cd omega && bl run research/domain/synthesis/omega-at-a-glance.bl.md`.
> `clojure` fences are design sketches. Every claim cites the domain note it comes from;
> those notes carry the primary sources.

**Abstract.** omega is pi's architecture with chats replaced by tasks, rebuilt on beam-lisp primitives.
pi's architecture is a minimal agent loop plus an extension surface, a provider layer, sessions, and codemode.
A task is a supervised process with private conversation state. It also has a public, append-only trail of
facts in a shared store, the *environment*. Tasks find each other by content, sense each other's traces,
message only when they need an answer, and wait on fact patterns. That is stigmergy. Jev answers the typed
yes/no/which questions this coordination raises, and generative models do the work. One UI vocabulary
(loom hiccup) renders to both a desktop webview and a ratatui TUI. This note distils the 11 domain notes
into one picture and proves the core shape runs today on stock beam-lisp.

## 1. The thesis in five lines

1. **pi's core is small and right**: a loop of *model → tool calls → results → model*. Steering and follow-up
   queues and abort sit on top, then an event/hook surface, and everything else is an extension
   (`../loop/pi-architecture.bl.md` §2–3).
2. **A task replaces the chat**. Its identity is a durable entity with an id, goal, scope, status, parent and
   context. Its executor is a supervised process. Its conversation is private. Its trace is public
   (`../coordination/tasks-and-stigmergy.bl.md` §3).
3. **The environment is a fact store** (datom: ordered, queryable, time-travel, `watch` push). Live
   addressing uses `proc.reg`, and UI/stream fan-out uses `proc.bus`/`proc.flow` with backpressure
   (`../coordination/processes-and-harness.bl.md` §2, §4).
4. **Code is the tool**. Codemode in beam-lisp means the model writes a beam-lisp program over a generated
   tool namespace, run in a capability-stripped env fork with a deadline and heap kill. Effects are
   transactional, and every nested call becomes a fact (`../tools/codemode.bl.md` §5).
5. **One view language, two renderers**: `state → hiccup`, with events as data. loom lowers it to
   HTML/wry; omega's TUI lowers it to ratatui widgets after a beam-lisp layout pass
   (`../interface/loom-and-grammar.bl.md`, `../interface/tui-ratatui.bl.md` §5).

## 2. Layers (proposal, INFERRED from the notes)

```
 ┌───────────────────────────── surfaces ─────────────────────────────┐
 │ loom desktop (wry)   ·   TUI (ratatui NIF)   ·   CLI   ·   MCP face │  ← one driver contract: view / on-event / tick
 └──────────────▲─────────────────────────────────────────────▲───────┘
                │ hiccup (semantic tree)                       │ commands = task-registry ops
 ┌──────────────┴──────────── omega.ui ────────────────────────┴───────┐
 │ screens are pure fns of (env-db, ui-state): overview · task · graph │
 │ · inspector · diff · palette   (../interface/impeccable.bl.md §7)    │
 └──────────────▲──────────────────────────────────────────────────────┘
                │ datom watch + bus events
 ┌──────────────┴──────────── omega.task ──────────────────────────────┐
 │ task = defserver (keeper idea from harness.bl): one writer, atomic   │
 │ check-and-spawn turn worker, steer counter, crash→trace, :step seam  │
 │ waits = fact-pattern subscription + deadline + on-timeout policy     │
 │ claims/heartbeats/completions emitted by the harness, not the model  │
 └───────▲─────────────────────▲─────────────────────▲─────────────────┘
         │                     │                     │
 ┌───────┴──────┐   ┌──────────┴─────────┐   ┌───────┴────────────────┐
 │ omega.llm    │   │ omega.tools        │   │ omega.jev              │
 │ relay-derived│   │ read/write/edit/   │   │ questions-as-values,   │
 │ stream fold, │   │ bash + codemode    │   │ cassette, ledger,      │
 │ cassettes    │   │ sandbox, catalog   │   │ data policy, gates     │
 └──────────────┘   └────────────────────┘   └────────────────────────┘
         substrate: beam-lisp — proc.* · datom · env/caps · loom · vm.native
```

The layering follows rules carried over from the notes:
- **Nothing above `omega.task` holds authoritative state**. Screens are projections and can be rebuilt from
  the fact store, as `../lineage/spell.bl.md` §3–4 learned the hard way.
- **The model seam is a function** (`:step`), so every layer above it runs offline with scripted models and
  cassettes (`../coordination/processes-and-harness.bl.md` §2.8, `../loop/llm-relay.bl.md` §2.5).
- **Core stays at three primitives**: call-predicate, context-transform and turn-snapshot. Plan mode,
  permissions, checkpoints and compaction are configurations of these (`../tools/plugins.bl.md` §2, §9).

## 3. The smallest loop that shows the whole idea — runs today

This is a toy, but every primitive in it is real and was run. It has a shared fact store, two tasks as
processes, a scripted model, a tool call, traces, and a **wait sensed through the environment** (B waits on
A's `:done` fact via `datom/watch`, with no pid link and no polling). It ends with the human's view: a
query. What it leaves out maps to the decision register (`decisions.bl.md`): claims, decay, Jev,
streaming, codemode, UI.

```beam-lisp
(ns omega.research.synthesis
  (:require [datom]))

(def parent (erlang/self))

;; The shared environment: one fact store all tasks read and write.
(def env
  (datom/connect
    [{:db/ident :task/slug   :db/valueType :db.type/string :db/unique :db.unique/identity}
     {:db/ident :task/status :db/valueType :db.type/keyword}
     {:db/ident :task/scope  :db/valueType :db.type/string :db/cardinality :db.cardinality/many}
     {:db/ident :trace/task  :db/valueType :db.type/string}
     {:db/ident :trace/kind  :db/valueType :db.type/keyword}
     {:db/ident :trace/text  :db/valueType :db.type/string}]))

(defn trace! [slug kind text]
  (datom/transact! env [{:db/id -1 :trace/task slug :trace/kind kind :trace/text text}]))

(defn status! [slug st]
  (let [e (datom/lookup-ref (datom/db env) [:task/slug slug])]
    (datom/transact! env [[:db/add e :task/status st]])))

(defn status-of [slug]
  (first (first (datom/q '[:find ?s :in $ ?slug :where [?e :task/slug ?slug] [?e :task/status ?s]]
                   (datom/db env) slug))))

;; The smallest loop: a scripted model returns either a tool call or a final answer.
;; One turn = ask model → if tool, run tool, append result, repeat; else finish.
(defn run-loop [slug model tools]
  (loop [msgs [{:role :user :text slug}] steps 0]
    (let [reply (model msgs)]
      (cond
        (>= steps 8) (do (trace! slug :blocker "step cap") :capped)
        (= (:kind reply) :tool)
        (let [out ((get tools (:tool reply)) (:args reply))]
          (trace! slug :tool (str (name (:tool reply)) " → " out))
          (recur (-> msgs (conj reply) (conj {:role :tool :text out})) (inc steps)))
        :else (do (trace! slug :completion (:text reply)) (:text reply))))))

;; A task is a process. Before working it may wait on another task's completion,
;; sensed through the environment (a watch on facts), not via a direct link.
(defn start-task [slug {:keys [scope waits-on model tools]}]
  (datom/transact! env [{:db/id -1 :task/slug slug :task/status :draft :task/scope scope}])
  (spawn
    (fn []
      (when waits-on
        (status! slug :waiting)
        (let [me (erlang/self)
              w (datom/watch env '[?e :task/status :done]
                             (fn [_] (erlang/send me :env-changed)))]
          ;; a wait is a subscription + a deadline + an explicit on-timeout policy
          (let [woke (loop []
                       (if (= :done (status-of waits-on))
                         :ready
                         (receive :env-changed (recur) (after 2000 :timed-out))))]
            (datom/unwatch w)
            (when (= woke :timed-out)
              (trace! slug :blocker (str "gave up waiting on " waits-on))
              (status! slug :failed)
              (erlang/send parent [:finished slug :wait-timeout])
              (erlang/exit :normal)))))
      (status! slug :active)
      (let [answer (run-loop slug model tools)]
        (status! slug :done)
        (erlang/send parent [:finished slug answer])))))

(defn scripted
  "A deterministic model: a fixed list of replies, one per call."
  [replies]
  (let [i (atom 0)]
    (fn [_msgs] (let [r (nth replies @i)] (swap! i inc) r))))

(def tools {:read (fn [{:keys [path]}] (str "<" (count path) " bytes of " path ">"))})

;; Task B waits on task A; A reads a file then finishes.
(start-task "b-docs" {:scope ["docs/"] :waits-on "a-reader" :tools tools
                      :model (scripted [{:kind :final :text "docs updated"}])})
(Process/sleep 50)
(println "b while a not started:" (status-of "b-docs"))
(start-task "a-reader" {:scope ["src/reader.bl"] :tools tools
                        :model (scripted [{:kind :tool :tool :read :args {:path "src/reader.bl"}}
                                          {:kind :final :text "hex literals accepted"}])})

(def finished
  (loop [acc [] n 2]
    (if (zero? n) acc
        (receive [:finished s a] (recur (conj acc [s a]) (dec n))
                 (after 3000 (conj acc :timeout))))))
(println "finish order:" finished)

;; Everything that happened is queryable by anyone: the human, another task, a test.
(println "traces:"
         (sort (datom/q '[:find ?t ?k ?x :where [?e :trace/task ?t] [?e :trace/kind ?k] [?e :trace/text ?x]]
                        (datom/db env))))
(println "who claims something under src/?"
         (->> (datom/q '[:find ?slug ?p :where [?e :task/scope ?p] [?e :task/slug ?slug]] (datom/db env))
              (filter (fn [[_ p]] (clojure.string/starts-with? p "src/")))
              (map first)))
```

Observed output (2026-10-01, `bl` launcher → installed drop):

```
b while a not started: :waiting
finish order: [["a-reader" "hex literals accepted"] ["b-docs" "docs updated"]]
traces: (["a-reader" :completion …] ["a-reader" :tool "read → <13 bytes of src/reader.bl>"] ["b-docs" :completion …])
who claims something under src/? ("a-reader")
```

**Datom idioms learned while writing this (OBSERVED, they will matter):**
- A transaction map **must** carry `:db/id`, even when it holds a `:db.unique/identity` attribute.
- To update an existing entity, resolve it with `(datom/lookup-ref db [:attr v])` first. Lookup refs read
  fine but are not accepted as entity ids in writes (see `beam-lisp--repl/examples/datom/08-otp.bl:58`).
- Datalog has no `clojure.string/*` predicates. Filter after `q`.
- `ffirst` is not in core. `(conj v a b)` with three args fails in this build: use `->` with two `conj`s.

## 4. What the toy deliberately leaves out, and where each piece is designed

| missing piece | designed in | gating decision |
|---|---|---|
| claims + conflict check, leases, heartbeats, decay | `../coordination/tasks-and-stigmergy.bl.md` §3.3–3.4, §5.2 | D4 |
| supervision, registry, cancel-able await | `../coordination/processes-and-harness.bl.md` §3.1–3.4, §5 gaps 2–3 | D2 |
| real streaming model, tool-call blocks, cassettes | `../loop/llm-relay.bl.md` §2–3, §7 | D7 |
| steering / follow-up queues, events, compaction | `../loop/pi-architecture.bl.md` §3–5 | D8, D11 |
| codemode sandbox | `../tools/codemode.bl.md` §5 | D6 |
| typed decisions at gates (scope? wait? done?) | `../coordination/jev.bl.md` §6–7 | D5 |
| edits, checkpoints, diagnostics, permissions | `../tools/plugins.bl.md` §3–6, §9 | D9, D10 |
| screens | `../interface/impeccable.bl.md` §7, `day-to-day.bl.md` | D12 |
