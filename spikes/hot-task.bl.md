# Spike: does a long omega task slow itself down?

> **Spike, 2026-10-03, PLAN-003.** Runnable: `bin/bl run spikes/hot-task.bl.md`. Question: the
> history spike found that a datom entity updated N times costs O(N) to read and write. omega's loop
> rewrites `:task/cost` on the task entity every model step (`omega.loop`, after each response). Does
> a long task therefore get slower per step, in omega as it is today?

```beam-lisp
(ns omega.spike.hot-task
  (:require [omega.env :as env] [omega.task :as task] [omega.loop :as loop] [omega.codemode :as cm] [datom]))

(defn ms [f] (let [t0 (erlang/monotonic_time :microsecond) r (f)] [(/ (- (erlang/monotonic_time :microsecond) t0) 1000.0) r]))
(defn mean [xs] (/ (Float/round (* 10.0 (/ (reduce + xs) (count xs)))) 10.0))

;; a scripted model that takes N cheap eval steps, then finishes
(def N 160)
(def root (str "/tmp/omega-hot-task-" (erlang/unique_integer (to-list [:positive]))))
(File/mkdir_p! root)
;; real models report usage every response; that is what makes the loop rewrite :task/cost
(def steps (concat (map (fn [i] (assoc (loop/call-tool "eval" {:code "(+ 1 1)"} (str "tu-" i))
                                       :usage {:input_tokens 100 :output_tokens 20}))
                        (range N))
                   [(loop/say "done")]))
(def e (env/open))
(def sys (task/start-system e {:step (loop/by-goal {"long" steps}) :tools cm/tools :root root :max-steps (+ N 10)}))

;; sample the cost of reading the task entity and of a 1-attr write to it, every 50 steps
(def samples (atom []))
(def tid (task/open! sys {:goal "long"}))
(loop [last -1]
  (let [n (count (filter (fn [t] (= :assistant (:role t))) (loop/turns sys tid)))
        st (:task/status (env/entity e (env/eid e :task/id tid)))]
    (when (and (>= n (+ last 20)) (< n N))
      (let [r (vec (for [_ (range 10)] (first (ms (fn [] (env/entity e (env/eid e :task/id tid)))))))]
        (swap! samples conj [n (mean r) (erlang/system_time :millisecond)])
        (println "  step" n "entity read ms" (mean r))))
    (if (contains? #{:idle :done :failed} st) :ok
      (do (Process/sleep 20) (recur (if (>= n (+ last 20)) n last))))))

(println "steps run          :" (count (filter (fn [t] (= :assistant (:role t))) (loop/turns sys tid))))
(println "task entity read ms by step:" (map (fn [[n r _]] [n r]) @samples))
(println "wall ms per 20 steps        :" (map (fn [[a b]] (- (nth b 2) (nth a 2))) (partition 2 1 @samples)))
(println "datoms ever on task:" (count (filter (fn [d] (= (env/eid e :task/id tid) (nth d 0))) (datom/datoms (datom/history (env/db e)) :eavt))))
```

## Findings

OBSERVED (scripted task, 160 eval steps, each response carrying usage like a real model; in-memory
env; pin `2360b32e`):

```text
  step 19 entity read ms 30.9   …   step 159 entity read ms 64.7
steps run          : 161
wall ms per 20 steps        : (23327 27494 35157 39523 42747 53972 53051)
datoms ever on task: 330
```

- **Yes, a long omega task slows itself down, today, with no bl-ed involved.** Twenty trivial
  `(+ 1 1)` steps took 23 s at the start and 54 s by step 160: 1.2 s per step growing to 2.7 s, with a
  model that answers instantly.
- A 400-step run did not finish within a 20-minute timeout.
- The task entity's read cost rises with it (noisy: 11–65 ms).
- `spikes/turn-read-cost.bl.md` decomposes it. The dominant term is re-reading every turn from datom
  on every step (`loop/turns`, O(turns), 0.84 s at 300 turns). The rewritten `:task/cost` entity and
  `trace/claim!` add to it.
- The first version of this spike used responses without usage. `:task/cost` then never changed and
  datom stored nothing new: 40 steps (the default `MAX-STEPS`) and 12 datoms. A spike must replay
  realistic responses.
