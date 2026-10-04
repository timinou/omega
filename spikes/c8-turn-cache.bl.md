# Spike: C8 — the executor caches a task's turns (prototype patch, measured)

> **Spike, 2026-10-03, PLAN-003 improvement round.** Runnable: `bin/bl run spikes/c8-turn-cache.bl.md`.
> Question: `spikes/hot-task.bl.md` found long tasks slowing down (1.2 s → 2.7 s per trivial step by
> step 160), and `spikes/turn-read-cost.bl.md` blamed `loop/turns` being re-read from datom several
> times per step. Does caching the turn list in the executor process actually flatten the per-step
> cost, and how small is the patch?
>
> Method: the patch is applied by redefining `omega.loop/turns` and `record!` at runtime (the technique
> `spikes/file-port.bl.md` validated) — omega's source is NOT changed. Two identical 160-step scripted
> runs, before and after, same VM.

## Where the reads are (from src/omega/loop.bl)

Per tool step, `turns` (a 4-clause datalog query over ALL of the task's turns) runs:
- once in `request` (the messages);
- once in `turn!` for `turn-n`;
- once per tool in `run-tool` (the trace subject `(count (turns sys id))`).

`turn-count` (another full query) runs once per `record!`, which happens twice per step. That is
**5 full scans of the task's history per step**.

## The patch (what C8 is)

The process that runs a task's turns owns its turn list. `record!` appends to it. `turns` and
`turn-count` read it, and the store is read only on a cache miss (first use, recovery). The cache
lives in the **process dictionary** of the executor process, keyed by task id. Every reader on the hot
path is that same process: `turn!`, `request` and `run-tool` all run inside it. Other processes (the
UI, other tasks) miss the cache and fall back to the store, which stays the truth.

```beam-lisp
(ns omega.spike.c8
  (:require [omega.env :as env] [omega.task :as task] [omega.loop :as loop] [omega.codemode :as cm]))

(def PATCH "
(ns omega.loop)

(defn- cache-key [id] [:omega/turns id])

(defn read-turns
  \"The store's view, for any process. The cache in `turns` is exact ONLY in the executor.\"
  [sys id]
  (let [e (:env sys)
        t (env/eid e :task/id id)
        rows (env/q e '[:find ?n ?r ?c :in $ ?t
                        :where [?u :turn/task ?t] [?u :turn/n ?n] [?u :turn/role ?r] [?u :turn/content ?c]] t)]
    (vec (map (fn [[n r c]] {:n n :role r :content c}) (sort-by first rows)))))

(defn turns
  \"All turns of task `id`, in order. C8: the executor process caches them; others read the store.\"
  [sys id]
  (let [v (erlang/get (cache-key id))]
    (if (= v :undefined)
      (let [ts (read-turns sys id)] (erlang/put (cache-key id) ts) ts)
      v)))

(defn record!
  ([sys id role content] (record! sys id role content nil))
  ([sys id role content usage]
   (let [e (:env sys)
         t (env/eid e :task/id id)
         ts (turns sys id)
         n (inc (count ts))]
     (env/tx! e [(cond-> {:db/id -1 :turn/id (str id \"/\" n) :turn/task t :turn/n n
                          :turn/role role :turn/content content :turn/at (env/now e)}
                   (some? usage) (assoc :turn/usage usage))])
     (erlang/put (cache-key id) (conj ts {:n n :role role :content content}))
     n)))
")

(def ORIG-TURNS loop/turns)
(def ORIG-RECORD loop/record!)

(defn run-long [label n]
  (let [root (str "/tmp/omega-c8-" label "-" (erlang/unique_integer (to-list [:positive])))
        _ (File/mkdir_p! root)
        steps (concat (map (fn [i] (assoc (loop/call-tool "eval" {:code "(+ 1 1)"} (str "tu-" i))
                                          :usage {:input_tokens 100 :output_tokens 20}))
                           (range n))
                      [(loop/say "done")])
        e (env/open)
        sys (task/start-system e {:step (loop/by-goal {"long" steps}) :tools cm/tools :root root :max-steps (+ n 10)})
        t0 (erlang/monotonic_time :millisecond)
        tid (task/open! sys {:goal "long"})
        ;; the POLLER is another process: it must read the store, never `turns`
        ;; (with C8 a non-executor caller of `turns` would see a stale per-process cache)
        store-turns (fn [] (let [t (env/eid e :task/id tid)]
                             (env/q e '[:find ?u ?r :in $ ?t :where [?u :turn/task ?t] [?u :turn/role ?r]] t)))
        marks (loop [acc [] last 0]
                (let [k (count (filter (fn [[_ r]] (= :assistant r)) (store-turns)))
                      st (:status (task/view sys tid))
                      acc (if (>= k (+ last 20)) (conj acc [k (- (erlang/monotonic_time :millisecond) t0)]) acc)
                      last (if (>= k (+ last 20)) k last)]
                  (if (contains? #{:idle :done :failed} st) acc
                    (do (Process/sleep 50) (recur acc last)))))
        total (- (erlang/monotonic_time :millisecond) t0)]
    {:label label :total-ms total
     :ms-per-20 (map (fn [[a b]] (- (second b) (second a))) (partition 2 1 (cons [0 0] marks)))
     :turns (count (store-turns))
     :result (:result (task/view sys tid))}))

(def N 120)
(def before (run-long "before" N))
(println "before:" before)
(BeamLisp.Compiler/eval_string PATCH)
(ns omega.spike.c8)
(def after (run-long "after" N))
(println "after :" after)
(println "speedup total:" (/ (Float/round (* 10.0 (/ (:total-ms before) (max 1 (:total-ms after))))) 10.0) "x")
```

## Findings

OBSERVED (120 scripted eval steps with usage, in-memory env, pin `2360b32e`, same VM):

```text
before: {:result "done", :turns 242, :total-ms 138061, :ms-per-20 (8777 21415 21082 29057 29531 27174)}
after : {:result "done", :turns 242, :total-ms 31310, :ms-per-20 (2976 4259 6735 6188 5459 5529)}
speedup total: 4.4 x
```

1. **C8 works.**
   - The same 120-step task runs **4.4× faster** overall.
   - Late steps cost ~275 ms instead of ~1.45 s.
   - The step-to-step growth that made long tasks quadratic is mostly gone.
   - Same result (`done`) and same 242 turns in the store.
   - The patch is ~25 lines in `omega.loop`: a cached `turns`, plus a `record!` that appends to the
     cache.
2. **The hazard the first run exposed (OBSERVED): a cache keyed in the process dictionary is exact only
   in the executor process.**
   - In the first version of this spike, the *poller*, a different process, called the patched
     `loop/turns`. It cached the store's view on its first call, never saw new turns, and reported
     `:turns 0`.
   - Anything outside the executor that calls `loop/turns` would silently go stale: the UI, `omega.cli`
     follow, tests, codemode cells.
   - **So the real C8 must NOT change `turns`'s meaning.** Keep `turns` as the store read for everyone.
     Add an executor-only path: `turn!` builds the list once at the start of a run and threads it
     through `request`, `record!` and `run-tool` as a value. A loop-local value, not a process
     dictionary entry.
   - That is also cleaner: the cache's owner is explicit in the code, not implied by which process
     happens to call.
3. **Residual growth (~3.0 s → ~5.5 s per 20 steps).** INFERRED, not decomposed: the remaining
   per-step writes to hot entities.
   - `:task/cost` is rewritten each step;
   - `tr/leave! :tool` runs per call, plus the `trace/claim!` path for writes;
   - BUG-002's O(updates) entity cost.

   Making usage append-only (sum on read) is the other half of C8. This spike did not do it.
4. **Not tested:** recovery (a task resumed after a VM restart rebuilds its list from the store once,
   which is cheap); steers arriving mid-run (`drain!` goes through `record!`, so they append like any
   turn).
