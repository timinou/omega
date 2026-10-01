# omega — playground

> Run it: `bin/bl run omega.bl.md` (offline, ~15 s). Copy any block into `bin/bl repl`
> to poke at it. Every block uses the public interface only:
> `omega.env · omega.actor · omega.trace · omega.task · omega.loop · omega.codemode · omega.ext`.

This is the toy loop from `research/domain/synthesis/omega-at-a-glance.bl.md`, made
real. It shows three tasks and one human sharing one environment, coordinating
through it. The model has exactly one tool, `eval` (codemode): a task writes a
small beam-lisp program and the harness runs it with `read`, `write`, `edit`, `sh`,
`spawn`, `wait`, `send`, `trace`, `traces` and `done` in scope. So a step is one
program composing those functions, not one tool call per action.

## 1. A world and a system

```beam-lisp
(ns playground
  (:require [omega.env :as env]
            [omega.actor :as actor]
            [omega.trace :as tr]
            [omega.task :as task]
            [omega.loop :as loop]
            [omega.codemode :as cm]
            [omega.ext :as ext]))

(def root (str "/tmp/omega-playground-" (erlang/unique_integer (to-list [:positive]))))
(File/mkdir_p! root)
(File/write! (str root "/reader.py") "def read_number(s):\n    return int(s)\n")

(def e (env/open))
```

The model is a `step` function. Here each task gets a scripted one, routed by its
goal. To make it live, swap in `(omega.llm/step (omega.llm/from-env "."))`; nothing
else changes.

```beam-lisp
(def verify-py
  "python3 -c \"from reader import read_number as r; print(r('0x1f'), r('7'))\"")

(def scripts
  {;; A: owns the reader, leaves a finding others can use, verifies, then finishes
   "make read_number accept 0x hex"
   [(loop/call-tool "eval"
      {:code (str "(edit \"reader.py\" [{:old \"    return int(s)\" :new \"    return int(s, 16) if s.startswith('0x') else int(s)\"}])"
                  "(trace :finding \"reader.py\" \"read_number(s) now accepts 0x… strings\")")})
    (loop/call-tool "eval"
      {:code (str "(let [r (sh " (pr-str verify-py) ")]"
                  "  (done (str \"read_number parses 0x hex; verified 0x1f and 7 → \" (str/trim (:out r)))))")})]

   ;; B: wants to touch the same file — senses A's claim, waits on A, then reads A's finding
   "document read_number in README"
   [(loop/call-tool "eval" {:code "(traces {:subject-prefix \"reader.py\"})"})
    ;; the task that left traces on reader.py is named in what B just read: wait
    ;; on it (a claim, while A works; A's finding or completion, once it is done)
    (fn [req]
      (let [seen (get-in (last (:messages req)) [:content 0 :content])
            holder (second (re-find #":task \"(t-[0-9]+)\"" seen))]
        (if holder
          (loop/call-tool "eval" {:code (str "(wait \"" holder "\")")})
          (loop/call-tool "eval" {:code "(traces {:subject-prefix \"reader.py\"})"}))))
    (loop/call-tool "eval" {:code "(traces {:kind :finding :subject-prefix \"reader.py\"})"})
    (loop/call-tool "eval"
      {:code (str "(write \"README.md\" \"read_number(s): decimal, or hex with a 0x prefix.\\n\")"
                  "(done \"README documents the hex support A added\")")})]

   ;; C: asks the human something, and answers with whatever the human said
   "ask whether to bump the version"
   [(loop/call-tool "eval" {:code "(send \"human:me\" :ask \"Bump version to 0.2?\")"})
    (fn [req] (loop/say "asked; I'll continue when you answer"))
    (fn [req] (loop/say (str "human said: " (get-in (last (:messages req)) [:content 0 :text]))))]})

(def sys (task/start-system e {:step (loop/by-goal scripts) :tools cm/tools :root root}))
```

## 2. Three prompts, three tasks

```beam-lisp
(def a (task/open! sys {:goal "make read_number accept 0x hex" :scope ["reader.py"]}))
;; let A claim reader.py (its first edit) before B looks around
(let [h (env/sense e '[?t :trace/kind :claim] :claimed)]
  (receive [:omega/sensed :claimed _] nil (after 3000 nil))
  (env/unsense h))
(def b (task/open! sys {:goal "document read_number in README" :scope ["README.md"]}))
(def c (task/open! sys {:goal "ask whether to bump the version"}))

(println "A:" (select-keys (task/await sys a 10000) [:status :result]))
(println "B:" (select-keys (task/await sys b 10000) [:status :result]))
(println "README:" (File/read! (str root "/README.md")))
```

B never addressed A and was never told A's id. It read the traces on `reader.py`,
found who held the claim there, waited on that task's status through the
environment, and then used A's finding. Each of those steps was one `eval` program. That is stigmergy: coordination by the medium,
not by messages.

## 3. The human is an actor

C asked the human. The question sits in the human's inbox as a fact. Answering is a
reply, and a follow-up turn starts because the task's inbox changed:

```beam-lisp
(task/await sys c 5000)
(def q (first (actor/inbox e "human:me")))
(println "the human sees:" (:from q) (:kind q) (pr-str (:text q)))
(actor/reply! e (:id q) "yes, 0.2")
(Process/sleep 300)
(println "C:" (select-keys (task/await sys c 5000) [:status :result]))
```

## 4. Peek at everything

All of this comes from the one fact log: no process introspection, no logs.

```beam-lisp
(println "\n── tasks ──")
(doseq [v (task/all sys)]
  (println (str "  " (:id v) "  " (name (:status v)) "  " (:title v))))

(println "\n── traces (strongest first) ──")
(doseq [t (tr/all e)]
  (println (str "  " (:task t) "  " (name (:kind t)) "  " (:subject t)
                (when (:text t) (str "  — " (:text t)))
                (when (pos? (or (:reads t) 0)) (str "  (read " (:reads t) "×)")))))

(println "\n── A's conversation ──")
(doseq [t (loop/turns sys a)]
  (println (str "  " (:n t) " " (name (:role t)) ": "
                (join " | " (map (fn [b] (or (:text b) (:name b) (subs (str (:content b)) 0 (min 60 (count (str (:content b))))))) (:content t))))))

(println "\n── A's status history ──")
(println " " (map :value (filter :added (env/history e (env/eid e :task/id a) :task/status))))

(task/stop-system! sys)
```

## Where to go from here

- `docs/domain-model.bl.md`: the datom model, entity by entity, with invariants.
- `src/omega/ext/notify.bl.md` and `src/omega/ext/jev_gate.bl.md`: two
  extensions, written literately, with their ergonomics reviews.
- `bin/omega "goal"`: the same loop against a live model, in any directory.
