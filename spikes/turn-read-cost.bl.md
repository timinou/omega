# Spike: where a long task's step time goes

> **Spike, 2026-10-03, PLAN-003.** Runnable: `bin/bl run spikes/turn-read-cost.bl.md`. Follows
> `spikes/hot-task.bl.md`, which observed a real scripted omega task getting slower per step (23 s per
> 20 steps at the start, 54 s per 20 steps by step 160). Question: which read or write grows? Turns
> are synthesized with `loop/record!` (the same fn the loop uses), then each candidate is timed
> (median of 5).

```beam-lisp
(ns omega.spike.turn-read-cost
  (:require [omega.env :as env] [omega.task :as task] [omega.loop :as loop] [omega.codemode :as cm] [omega.trace :as tr] [datom]))
(defn ms [f] (let [t0 (erlang/monotonic_time :microsecond) r (f)] [(/ (- (erlang/monotonic_time :microsecond) t0) 1000.0) r]))
(defn med [f] (let [xs (sort (for [_ (range 5)] (first (ms f))))] (nth (vec xs) 2)))

(def root (str "/tmp/omega-steprof-" (erlang/unique_integer (to-list [:positive]))))
(File/mkdir_p! root)
(def e (env/open))
(def sys (task/start-system e {:step (loop/by-goal {"g" [(loop/say "hi")]}) :tools cm/tools :root root}))
(def tid (task/open! sys {:goal "g"}))
(task/await sys tid 10000)

;; synthesize history directly: N assistant+tool turn pairs with usage, and N cost rewrites
(defn grow! [n]
  (doseq [i (range n)]
    (loop/record! sys tid :assistant [{:type :tool-use :id (str "tu" i) :name "eval" :input {:code "(+ 1 1)"}}] {:input_tokens 100})
    (loop/record! sys tid :tool [{:type :tool-result :id (str "tu" i) :content "2"}])
    (env/tx! e [[:db/add (env/eid e :task/id tid) :task/cost {:input_tokens (* 100 i)}]])))

(doseq [target [0 50 150 300]]
  (grow! (- target (or (get (erlang/get :grown) 0) 0)))
  (erlang/put :grown {0 target})
  (println "turns" target
           "| turns ms" (med (fn [] (loop/turns sys tid)))
           "| request ms" (med (fn [] (loop/request sys tid)))
           "| record! ms" (med (fn [] (env/tx! e [[:db/add (env/eid e :task/id tid) :task/title "x"]])))
           "| task entity ms" (med (fn [] (env/entity e (env/eid e :task/id tid))))
           "| claim! ms" (med (fn [] (tr/claim! e tid "a.py")))
           "| eid ms" (med (fn [] (env/eid e :task/id tid)))))
```

```beam-lisp
;; alternatives for reading 600 turns of one task
(def t (env/eid e :task/id tid))
(def db (env/db e))
(println "q 3 attrs        ms" (med (fn [] (datom/q '[:find ?n ?r ?c :in $ ?t :where [?u :turn/task ?t] [?u :turn/n ?n] [?u :turn/role ?r] [?u :turn/content ?c]] db t))))
(println "q eids only      ms" (med (fn [] (datom/q '[:find ?u :in $ ?t :where [?u :turn/task ?t]] db t))))
(println "datoms avet      ms" (med (fn [] (count (datom/datoms db :avet :turn/task t)))))
(println "pull via entity  ms" (med (fn [] (count (map (fn [d] (datom/entity db (nth d 0))) (datom/datoms db :avet :turn/task t))))))
(println "datoms vaet      ms" (med (fn [] (count (datom/datoms db :vaet t :turn/task)))))
(println "count turns      :" (count (datom/datoms db :avet :turn/task t)))

```

```beam-lisp
(defn turns-fast [db t]
  (->> (datom/datoms db :avet :turn/task t)
       (map (fn [d] (let [u (nth d 0)
                          m (reduce (fn [m x] (assoc m (nth x 1) (nth x 2))) {} (datom/datoms db :eavt u))]
                      {:n (:turn/n m) :role (:turn/role m) :content (:turn/content m)})))
       (sort-by :n) vec))
(println "turns-fast       ms" (med (fn [] (turns-fast db t))))
(println "same result      :" (= (turns-fast db t) (loop/turns sys tid)))
(println "first datom shape:" (pr-str (first (datom/datoms db :eavt t))))

```

```beam-lisp
(defn col [db a ids] (into {} (keep (fn [d] (when (contains? ids (nth d 0)) [(nth d 0) (nth d 2)])) (datom/datoms db :aevt a))))
(defn turns-cols [db t]
  (let [ids (set (map (fn [d] (nth d 0)) (datom/datoms db :avet :turn/task t)))
        n (col db :turn/n ids) r (col db :turn/role ids) c (col db :turn/content ids)]
    (vec (sort-by :n (map (fn [u] {:n (get n u) :role (get r u) :content (get c u)}) ids)))))
(println "turns-cols       ms" (med (fn [] (turns-cols db t))))
(println "same result      :" (= (turns-cols db t) (loop/turns sys tid)))
(println "aevt :turn/n all ms" (med (fn [] (count (datom/datoms db :aevt :turn/n)))))

```

```beam-lisp
(println "aevt :turn/content ms" (med (fn [] (count (datom/datoms db :aevt :turn/content)))))
(println "aevt :turn/role    ms" (med (fn [] (count (datom/datoms db :aevt :turn/role)))))
(println "set of 602 ids     ms" (med (fn [] (set (map (fn [d] (nth d 0)) (datom/datoms db :avet :turn/task t))))))
(println "content bytes total  :" (reduce + (map (fn [d] (erlang/external_size (nth d 2))) (datom/datoms db :aevt :turn/content))))

```

## Findings

OBSERVED (this laptop, in-memory env, pin `2360b32e`):

```text
turns 0   | turns ms   6.6 | request ms   5.5 | record! ms  2.3 | task entity ms  0.9 | claim! ms 11.1
turns 50  | turns ms 168.2 | request ms 169.7 | record! ms  4.2 | task entity ms 11.5 | claim! ms 23.9
turns 150 | turns ms 345.8 | request ms 407.0 | record! ms  3.5 | task entity ms 18.3 | claim! ms 37.4
turns 300 | turns ms 841.6 | request ms 834.6 | record! ms 13.2 | task entity ms 33.7 | claim! ms 63.2
602 turns: q 3 attrs 1398 ms · q eids only 206 ms · datoms :avet 20 ms · entity per turn 478 ms
           · per-column :aevt scans 30-40 ms each · column join 365 ms
```

1. **`omega.loop/turns` is the dominant cost of a long task, and it is O(turns) at ~2.8 ms per turn.**
   - It runs on every model step (`request` reads all turns to build the messages), and
     `record!` → `turn-count` runs another query over the same turns.
   - So a step's own overhead grows linearly, and a task's total overhead quadratically. At 300 turns
     (150 tool steps), building one request costs 0.83 s before the model is even called.
   - `hot-task.bl.md` observed this end to end: wall time per 20 scripted steps went from 23 s to 54 s.
2. **Both culprits are datom read paths, not omega logic.**
   - A 4-clause datalog query over 602 turns: 1.4 s.
   - Fetching just the turn ids by query: 206 ms; the same ids from the raw `:avet` index: 20 ms
     (10×).
   - Assembling the three attributes per turn costs 365–478 ms whichever way it is done. Per-entity
     `:eavt` reads are ~0.6 ms each.
   - That is a datom performance bug: a 600-row join should be single-digit ms.
3. **The task entity itself degrades too** (0.9 → 33.7 ms by 300 turns): `:task/cost` is rewritten
   each step. That is the hot-entity effect found in `spikes/history.bl.md` (an entity updated N times
   reads in O(N)).
4. **`trace/claim!` costs 11 → 63 ms** and runs on every `write`/`edit`. `spikes/file-port.bl.md` saw
   ~100 ms per call in its setup.

**What omega should do (independent of bl-ed, before W1):**
- **Cache the turn list in the task's executor process.** The process that runs `turn!` appends to it
  on `record!`. One task's turns have exactly one writer, so the cache is exact.
- `turn-count` becomes the cached count.
- `request` no longer re-reads history from datom; the store stays the durable truth for recovery and
  for other readers.
- Make cost append-only (a `:usage` fact per turn, summed on read), or keep the running cost in
  the executor too and write it at the end of a run.
- This is a new core change, **C8**, raised ahead of time per E15.

**What beam-lisp should fix** (file upstream): datalog joins and `entity` scale far worse than the
raw index (10–70×), and entities slow down with every update.
