# spike: the live image as part of a checkpoint (omega working on a beam-lisp project)

> Run: `bin/bl run spikes/live-image.bl.md`

**Question (from the user).** "When you talk about checkpoints, you seem to be talking about files. What if we use
this as a coding agent for a beam-lisp project? Then the checkpoints also become the `reload` and `ward` kind of
checkpoints. What is the experience that we want to support there?"

When omega works on a beam-lisp project, an eval cell runs in the live VM. `(defn f …)` in a cell, or a file
write followed by a reload, changes the running system: hot code, live processes, datom stores. So a step
changes the files *and* the live image. This spike (1) records what beam-lisp offers for that, (2) writes down the
user stories, and (3) measures what an `:image` part of a history change could hold and what restoring it costs.
Everything below runs on omega's pinned beam-lisp (2360b32e); nothing under `src/` is touched.

## 1. What beam-lisp offers (research; sources read, not guessed)

Read: `priv/std/reload.bl`, `priv/std/reload/{ward,ward_diag,migrate,monitor,upgrade}.bl`,
`priv/host/reload_watcher.bl`, `docs/dev/ward-contamination.bl.md`, `docs/the-environment-and-process-conveyance.md`,
`docs/building-an-app.md` §5. `git diff --stat 2360b32e HEAD -- priv/std/reload.bl priv/std/reload priv/host/reload_watcher.bl`
is empty: the whole reload and ward subsystem on beam-lisp main is byte-identical to the pin, so nothing here needs
the main checkout. (`beam-lisp--realm` and `beam-lisp--autovcs` hold no reload checkpoint design: the realm tree has
PLAN-136 change sets for a different layer, autovcs has none.)

| need | what exists | granularity | effect on running processes |
|---|---|---|---|
| reload code | `reload/stage` + `reload/commit` (a bundle of whole-namespace sources). Static coherence check first (dangling refs, unfulfilled `declare`, type conflicts, require cycles, removals another ns still calls); an incoherent bundle is HELD and the old code keeps serving. Plain `BeamLisp.Compiler/eval_string` or `env/eval` also works and is what a cell does. | namespace (a staged source is the whole ns; names it drops are really undefined) | `defn` is an atomic per-var relink. A call in flight finishes on its captured body module; the next call resolves the new one. |
| gate policy | `reload/set-enabled!`, env `BEAM_LISP_RELOAD=1`; mutating reload is OFF in a release image, ON in a dev image. | image | commit while disabled yields `:held` with a `:policy` reason |
| observe what changed | `reload/journal` (`{:event :applied/:held :nses :errors :at}`, newest last, bounded at 200), `reload/subscribe` (`[:reload/event ev]` messages), `reload/inspect`, `reload/namespaces`, `reload/drift` (files newer than the image), `BeamLisp.Env/own_names`, `BeamLisp.Env/ns_defs`. The journal is per NAMESPACE, not per var. | ns in the journal, var in `own_names` | none |
| fork the var registry | `env/fork`, `env/isolated`, `env/destroy`; `reload.ward/run`, `run-sandboxed` run test sources in a fork inside a worker process. | whole registry | processes started in a fork need `env/capture`/`env/bind` (conveyance) or they stand in `:global` |
| undo a reload | NOT a feature. BEAM keeps current+old module versions, but beam-lisp gives each `defn` its own body module that is never purged, and relinks the shim; there is no "previous version" API. Undo = evaluate the previous source again. | var | same as any reload |
| stateful processes | `defserver` is a gen_server. Its `code_change/3` is the default. `reload/attach` + `reload.migrate` verify an in-flight MESSAGE migration (`:quiesce`/`:reroute`), `reload.upgrade/verify-upgrade` uses z3 to prove an upgraded `defserver` keeps its invariant. Both need z3 and only model simple `defserver` shapes. | process | state is kept as is; no snapshot API |

Two facts that decide the design, both found by running (section 3, observations 5 and 6):

1. **`env/fork` does NOT isolate a namespace that already exists.** A fork isolates the var registry but the compiled
   body module `BeamLisp.Ns.<Ns>` is derived from the ns string, so `(ns sc1) (defn f …)` in a fork rewrites the real
   `sc1/f`. `reload.ward/run` has the same hazard (its own comment says "harmless run one after another"). Only
   `reload.ward/run-sandboxed`, which prefixes the namespace per run, leaves the live image alone.
2. **A reload is per-var visible to callers in three different ways** (qualified call, var value, closure), see
   observation 3.

## 2. The experience (user stories)

Setting: an agent edits a beam-lisp app, a human watches in bl-ed, the app is running in the same VM (a `defserver`
holding state, a datom conn).

| story | what is checkpointed | cheap | impossible or unsafe |
|---|---|---|---|
| **(a) edit then reload.** The agent edits `foo.bl`; the file checkpoint lands AND the ns is reloaded; the human sees "reloaded foo: changed `parse`, added `parse2`"; the running app picks it up. | files (as today) + the `:image` part: per-var `{:hash :prev}` and the reloaded ns list. The diff comes from source form hashes, not from the journal. | var diff: hashing a cell's forms is cheap (obs 1). Evaluating ONE var is 15-200 ms, but a whole-ns eval is superlinear: 10 vars 0.12 s, 50 vars 2 s, 100 vars 4.2 s (obs 4). Reload only the changed vars. | Fully-qualified calls and var values pick the new code up; **closures made by old code keep the old body** (obs 3). Nothing tells the human which live closures are stale. |
| **(b) the change broke the running app; "back to the image at step 12".** | revert the files (history already does it) AND re-evaluate the step-12 source of every var that differs now. | restore replays only the vars that differ (obs 4: 15-31 ms for 3 vars) | **Process state is not restored**: a `defserver` whose state was corrupted by the bad code keeps the bad state (obs 3: the state survives every redefinition), and `code_change` is not run on a plain re-eval. Datom stores are not rewound either (a held `db` value is, but the conn's head is not). Added vars must be `undefine_var`ed, removed vars re-evaluated. |
| **(c) try the risky change in a ward fork first.** | not the image: the gate verdict `{:ward :passed/:failed :ms …}` is recorded on the change, the fork is thrown away. | `run-sandboxed` ~80-110 ms warm for a small ns (obs 5); first call in a VM ~7-8 s (loads the test library). | `env/fork`/`ward/run` on the SAME ns name leak into the real image (obs 6). A test that needs live processes or the real datom conn does not see them in the fork. A test that spawns a process must convey the env. |
| **(d) two tasks reload the same ns.** | the `:image` part of each task records its own var hashes; the second reloading task's `prev` is not the first task's `hash`, which is detectable. | detecting it: compare the new change's `:prev` with the image's current hash per var | the image is one global registry: there is no per-task image, so task B's reload silently replaces task A's var. Only a claim on the ns (like path claims) can warn; it cannot isolate. |
| **(e) the gate is `bl check`/tests in a ward, not `sh`.** | the gate result on the change (`:gate {:ward …}`) and the files the test touched | warm ward is ~80-110 ms vs ~seconds for `sh bl test` (a fresh VM) | the ward tests the SOURCE you hand it, not the live image; a green ward says nothing about live process state. Ward needs the test library, which is a cold 7-8 s once per VM. |

## 3. The spike

### 3.1 helpers: strip reader meta, hash a form, split a source into named forms

```beam-lisp
(ns omega.spike.live-image (:require [reload] [reload.ward :as ward] [env] [datom]))

(defn sha [s]
  (clojure.string/lower-case
    (erlang/apply :binary :encode_hex (list (erlang/apply :crypto :hash (list :sha256 s))))))

(defn strip
  "A reader node without its positions: {:meta form pos} unwrapped all the way down.
   Hashing this makes a hash that survives whitespace and line shifts."
  [x]
  (cond
    (and (erlang/is_tuple x) (= 3 (erlang/tuple_size x)) (= :meta (erlang/element 1 x))) (strip (erlang/element 2 x))
    (erlang/is_tuple x) (apply tuple (map strip (erlang/tuple_to_list x)))
    (erlang/is_list x) (map strip x)
    :else x))

(def def-heads #{"defn" "defn-" "def" "defmacro" "defserver"})

(defn named-forms
  "Top-level definitions of `src`: [{:name :hash :text}] in order, for def-like forms only."
  [src]
  (vec (keep (fn [node]
               (let [form (typed/node-form node)]
                 (when (= :list (typed/node-tag form))
                   (let [items (typed/node-items form)
                         head (typed/node-name (typed/node-form (first items)))]
                     (when (and (contains? def-heads head) (> (count items) 1))
                       (let [pos (erlang/element 3 node)]
                         {:name (typed/node-name (typed/node-form (second items)))
                          :hash (sha (pr-str (strip node)))
                          :text (subs src (:offset pos) (:end-offset pos))}))))))
             (BeamLisp.Reader/read_string src))))

(defn declared-ns [src] (reload/declared-ns src))

(defn now-us [] (erlang/monotonic_time :microsecond))
(defn ms-since [t0] (/ (- (now-us) t0) 1000.0))
```

### 3.2 the image recorder: a cell eval that records a code checkpoint

An `eval-cell!` here is what omega's `harness/eval-cell` does, plus the recording. State is
`{:cur {ns {name {:hash h :text t}}} :cas {hash text} :steps [change …]}`. The var diff is computed against `:cur`,
and the image's own names (`BeamLisp.Env/own_names`) are the truth for "what is defined now".

```beam-lisp
(def img (atom {:cur {} :cas {} :steps []}))

(defn ev!
  "Evaluate source text into :global and return to this spike's ns (eval_string leaves the ns switched)."
  [src]
  (BeamLisp.Compiler/eval_string (str src "\n(ns omega.spike.live-image)")))

(defn diff-vars
  "Var-level diff between two {name {:hash :text}} maps → {name {:hash h :prev p}} for added, changed, removed."
  [old new]
  (merge
    (into {} (for [[k v] new :let [o (get old k)] :when (not= (:hash v) (:hash o))]
               [k {:hash (:hash v) :prev (:hash o)}]))
    (into {} (for [[k o] old :when (not (contains? new k))]
               [k {:hash nil :prev (:hash o)}]))))

(defn kind-of [d] (cond (nil? (:prev d)) :added (nil? (:hash d)) :removed :else :changed))

(defn eval-cell!
  "Eval `src` (declaring its ns) as an agent cell would; record an :image change.
   Returns {:change … :ms eval-ms}."
  [src]
  (let [ns (declared-ns src)
        forms (named-forms src)
        t0 (now-us)
        _ (ev! src)
        dt (ms-since t0)
        new (into {} (map (fn [f] [(:name f) (select-keys f [:hash :text])]) forms))
        old (get (:cur @img) ns {})
        d (diff-vars old new)
        change {:image {:vars (into {} (for [[k v] d] [(str ns "/" k) v]))
                        :reloaded [ns]}}]
    (swap! img (fn [s]
                 (-> s
                     (assoc-in [:cur ns] new)
                     (update :cas merge (into {} (map (fn [f] [(:hash f) (:text f)]) forms)))
                     (update :steps conj change))))
    {:change change :ms dt}))

(defn h8 [h] (if (nil? h) "-" (subs h 0 8)))

(defn show-diff [change]
  (doseq [[k d] (sort (:vars (:image change)))]
    (println "   " (name (kind-of d)) k (h8 (:hash d)) "<-" (h8 (:prev d)))))
```

### 3.3 observation 1 and 2: record, redefine as an agent cell would, diff

```beam-lisp
(def v1 "(ns scratch.app)\n(defn price [x] (* x 2))\n(defn label [x] (str \"p=\" (price x)))\n(def tax 3)")
(def v2 "(ns scratch.app)\n(defn price [x]  (* x 10))\n(defn label [x] (str \"p=\" (price x)))\n(defn extra [] :new)")
(def v2b "(ns scratch.app)\n(defn price [x] (* x 10))\n\n(defn label [x] (str \"p=\" (price x)))\n(defn extra [] :new)")

(println "== 1. record then redefine")
(def r1 (eval-cell! v1))
(println "step 1: eval v1, ms" (:ms r1))
(show-diff (:change r1))
(println "live:" (scratch.app/label 1) "own_names:" (sort (BeamLisp.Env/own_names "scratch.app")))
(def r2 (eval-cell! v2))
(println "step 2: eval v2 (price changed, extra added, tax gone from SOURCE), ms" (:ms r2))
(show-diff (:change r2))
(println "live:" (scratch.app/label 1) "own_names:" (sort (BeamLisp.Env/own_names "scratch.app")))
(println "NB `tax` is gone from the SOURCE, still in the image:" (contains? (set (BeamLisp.Env/own_names "scratch.app")) "tax")
         "-> a stale var survives plain eval; reload/commit would drop it")
(def r3 (eval-cell! v2b))
(println "step 3: same code, different whitespace (hash ignores positions):" (count (:vars (:image (:change r3)))) "vars changed")
```

### 3.4 observation 3: what a running process sees after a reload

Three callers: (A) a process calling `scratch.app/price` fully qualified in its loop, (B) a process holding the
var VALUE `scratch.app/price` taken before the reload, (C) a process holding a closure that an old `defn` returned.
Plus a `defserver` calling a helper, and a redefinition of the `defserver` itself.

```beam-lisp
(ev! "(ns scratch.proc)\n(defn price [x] (* x 2))\n(defn make-closure [] (fn [x] (* x 2)))")

(defn probe-loop
  "A process that answers [:ask from] with (f 5) for the f it was given."
  [f]
  (erlang/spawn (fn [] (loop [] (receive [:ask from] (do (erlang/send from [:ans (f 5)]) (recur)))))))

(defn ask [pid]
  (let [me (erlang/self)]
    (erlang/send pid [:ask me])
    (receive [:ans v] v (after 2000 :timeout))))

(def pa (erlang/spawn (fn [] (loop [] (receive [:ask from] (do (erlang/send from [:ans (scratch.proc/price 5)]) (recur)))))))
(def pb (probe-loop scratch.proc/price))
(def pc (probe-loop (scratch.proc/make-closure)))

(let [a (ask pa) b (ask pb) c (ask pc)]
  (println "== 3. before reload: qualified" a "var-value" b "old closure" c))
(ev! "(ns scratch.proc)\n(defn price [x] (* x 1000))\n(defn make-closure [] (fn [x] (* x 1000)))")
(let [a (ask pa) b (ask pb) c (ask pc) n ((scratch.proc/make-closure) 5)]
  (println "   after reload:  qualified" a "var-value" b "old closure" c "(new closure from new code:" n ")"))

(ev! "(ns scratch.srv)\n(defn helper [x] (+ x 1))\n(defserver ctr (init [n] (ok n))\n  (handle-call :bump [_from s] (reply (helper s) (helper s)))\n  (handle-call :get [_from s] (reply s s)))")
(def srv (start-link scratch.srv/ctr 10))
(let [a (call srv :bump) b (call srv :bump) st (call srv :get)]
  (println "   defserver: bump" a "bump" b "state" st))
(ev! "(ns scratch.srv)\n(defn helper [x] (+ x 100))")
(let [a (call srv :bump) st (call srv :get)]
  (println "   helper redefined only: bump" a "state" st "(state survived; the callee changed)"))
(ev! "(ns scratch.srv)\n(defserver ctr (init [n] (ok n))\n  (handle-call :bump [_from s] (reply :v2 (+ s 1000)))\n  (handle-call :get [_from s] (reply s s)))")
(let [a (call srv :bump) st (call srv :get) f (call (start-link scratch.srv/ctr 0) :bump)]
  (println "   defserver itself redefined: running server bump" a "state" st "; fresh server bump" f))
```

### 3.5 observation 4: revert by re-evaluating the previous source, and the cost

`restore-plan` turns a target version of a namespace into the actions that make the live image match it:
re-evaluate changed and removed vars from the stored text (the CAS), undefine added ones. The unit is the var,
so the cost is proportional to what differs.

```beam-lisp
(defn restore-plan
  "Actions to take the image of `ns` from the CURRENT recorded vars to `target` ({name {:hash :text}})."
  [ns target]
  (let [cur (get (:cur @img) ns {})]
    (vec (concat
           (for [[k v] target :when (not= (:hash v) (:hash (get cur k)))] [:eval k (:text v)])
           (for [[k _] cur :when (not (contains? target k))] [:undefine k])))))

(defn restore!
  "Apply the plan: evals one batch under the ns, undefines the rest, updates :cur. Returns ms."
  [ns target]
  (let [plan (restore-plan ns target)
        evals (filter #(= :eval (first %)) plan)
        t0 (now-us)
        _ (when (seq evals)
            (ev! (str "(ns " ns ")\n" (clojure.string/join "\n" (map #(nth % 2) evals)))))
        _ (doseq [[_ k] (filter #(= :undefine (first %)) plan)] (BeamLisp.Env/undefine_var ns k))
        dt (ms-since t0)]
    (swap! img assoc-in [:cur ns] target)
    {:ms dt :plan (mapv (fn [[a k]] [a k]) plan)}))

(println "== 4. revert to step 1 (v1)")
(def target1 (get (:cur (let [a (atom {:cur {} :cas {} :steps []})] (swap! a assoc-in [:cur "scratch.app"] (into {} (map (fn [f] [(:name f) (select-keys f [:hash :text])]) (named-forms v1)))) @a)) "scratch.app"))
(let [l (scratch.app/label 1) x (scratch.app/extra)] (println "before: label" l "extra" x))
(def rr (restore! "scratch.app" target1))
(println "plan" (:plan rr) "ms" (:ms rr))
(let [l (scratch.app/label 1) x (try (scratch.app/extra) (catch e :undefined))] (println "after: label" l "extra" x))
(println "process A (calls scratch.proc, another ns) after revert:" (ask pa) "(unaffected)")

(println "== cost of a revert vs ns size")
(defn big-src [n tag]
  (str "(ns scratch.big)\n" (clojure.string/join "\n" (for [i (range n)] (str "(defn f" i " [x] (+ x " tag " " i "))")))))
(doseq [n [10 50 100]]
  (let [t0 (now-us) _ (ev! (big-src n 1)) full-ms (ms-since t0)
        one (str "(ns scratch.big)\n(defn f3 [x] (+ x 9999 3))")
        t1 (now-us) _ (ev! one) one-ms (ms-since t1)]
    (println "   ns of" n "vars: whole-ns reload" full-ms "ms; one-var reload" one-ms "ms")))
```

### 3.6 observation 5 and 6: ward (on the pin) and the fork leak

`reload.ward/run-sandboxed` runs a source in a fork under a per-run namespace prefix. We hand it the MODIFIED
source of the namespace plus a test; the real registry is untouched. `env/isolated` and `ward/run` on the same
namespace name are shown for contrast.

```beam-lisp
(println "== 5. ward on the pin")
(ev! "(ns scratch.w)\n(defn f [x] (+ x 1))")
(def ward-src "(ns scratch.w)\n(defn f [x] (+ x 5000))\n(deftest changed-f (is (= 5001 (f 1))))")
(def wc0 (now-us))
(def wr (try (ward/run-sandboxed (list ward-src)) (catch e {:err (str e)})))
(println "cold ward (first run in this VM):" (ms-since wc0) "ms" (select-keys wr [:ok? :passed :failed :err]))
(def wt (now-us))
(def wr2 (ward/run-sandboxed (list ward-src)))
(println "warm ward, passing test:" (ms-since wt) "ms ok?" (:ok? wr2) " real scratch.w/f 1 =" (scratch.w/f 1) "(untouched)")
(def wt2 (now-us))
(def wr3 (ward/run-sandboxed (list "(ns scratch.w)\n(defn f [x] (+ x 5000))\n(deftest broken (is (= 1 (f 1))))")))
(println "warm ward, FAILING test:" (ms-since wt2) "ms ok?" (:ok? wr3) "failed" (:failed wr3) " real f 1 =" (scratch.w/f 1))
(def ft (now-us)) (def fk (env/fork)) (println "env/fork cost:" (ms-since ft) "ms")

(println "== 6. the leak: env/isolated and ward/run on an EXISTING ns name")
(env/isolated fk (fn [] (env/eval "(ns scratch.w)\n(defn f [x] (+ x 900))") nil))
(ev! "(ns omega.spike.live-image)")
(println "   after env/isolated redefining scratch.w/f in a fork, REAL scratch.w/f 1 =" (scratch.w/f 1) "(901 = leaked)")
(ev! "(ns scratch.w)\n(defn f [x] (+ x 1))")
(ward/run (list ward-src))
(println "   after ward/run (not -sandboxed) of the same ns, REAL scratch.w/f 1 =" (scratch.w/f 1) "(5001 = leaked)")
(ev! "(ns scratch.w)\n(defn f [x] (+ x 1))")
(println "   restored:" (scratch.w/f 1))
```

### 3.7 observation 7: unbounded old code, datoms, and the reload journal

`dotimes` is not on this pin, so a small helper stands in.

```beam-lisp
(defn dotimes* [n f] (loop [i 0] (when (< i n) (f i) (recur (inc i)))))
(defn loaded-count [] (count (erlang/apply :code :all_loaded (list))))

(let [m0 (loaded-count) t0 (now-us)]
  (dotimes* 60 (fn [i] (ev! (str "(ns scratch.churn)\n(defn g [x] (+ x " i "))"))))
  (println "== 7a. loaded modules +" (- (loaded-count) m0) "after 60 redefinitions of ONE var;" (ms-since t0) "ms total"))

(println "== 7b. datom: a held db value is a free snapshot of the store, the conn head is not rewound")
(def conn (datom/connect [{:db/ident :item/name :db/valueType :db.type/string}]))
(datom/transact! conn [{:db/id -1 :item/name "a"}])
(def snap (datom/db conn))
(datom/transact! conn [{:db/id -1 :item/name "b"}])
(println "   live names:" (sort (map first (datom/q '[:find ?n :where [_ :item/name ?n]] (datom/db conn))))
         " snapshot names:" (sort (map first (datom/q '[:find ?n :where [_ :item/name ?n]] snap))))

(println "== 7c. reload journal after the reloads above is per NAMESPACE")
(reload/set-enabled! true)
(reload/stage "(ns scratch.j)\n(defn a [] 1)\n(defn b [] (a))")
(println "   commit:" (select-keys (reload/commit) [:status :applied]))
(reload/stage "(ns scratch.j)\n(defn a [] 2)\n(defn b [] (c))")
(println "   incoherent bundle:" (:status (reload/commit)) (map :msg (:errors (reload/status))))
(reload/abort)
(println "   journal tail:" (map #(select-keys % [:event :nses]) (reload/journal 3)) " live a =" (scratch.j/a))
```

### 3.8 the `:image` part and restore-step-N

The run above recorded exactly this shape for each step (printed here from the recorder, for step 2):

```beam-lisp
(println "== 8. :image part of step 2 as recorded:")
(println "  " (pr-str (:image (second (:steps @img)))))
(println "   CAS entries (hash -> var text):" (count (:cas @img)))
(println "   restore-step-N = for each ns in the :image parts of steps N+1..head, take the NAMED var versions of step N"
         "(walk :prev back to the first step that has the var), re-eval those, undefine vars that did not exist at N.")
```

## Findings

Run: `bin/bl run spikes/live-image.bl.md`. Everything below was measured on the pin 2360b32e. Timings vary run to run.

**OBSERVED** (printed by the run)
1. A cell's source can be turned into a **var-level code checkpoint** without touching the image: hash the
   position-stripped reader form of every top-level `def`/`defn`/`defserver`. Re-evaluating the same code with
   different whitespace changes 0 vars; a changed body shows as `changed price`, a new fn as `added extra`. Eval
   plus recording stays in the ms range. Hashing the compiled AST does NOT work (gensym counters like `x_1`/`x_4`
   and the body module name `Fn.M###` change on every eval), so the checkpoint must be source-level.
2. **Plain eval of a whole new source never removes a var**: `tax` survives after the second source dropped it.
   `reload/commit` does drop it (and checks that no live caller dangles), plain `eval_string` does not. A cell-based
   image diff therefore needs `own_names` as the truth for "removed", or it reports the wrong set.
3. **What a live process sees** after a reload: (A) a process calling `ns/f` fully qualified picks up the new code
   at its next call; (B) a process holding the var value `ns/f` also picks it up (it is an external fun to the
   relinked shim); (C) a process holding a **closure created by the old `defn`** keeps the OLD behaviour, and only new
   closures made after the reload are new. A `defserver` keeps its state across a redefinition of a helper it calls
   (the next call uses the new helper), and **redefining the `defserver` itself also reaches the RUNNING server**:
   its next call ran the new `handle-call` (`:v2`) against the old state (112 -> 1112), without a restart and
   without `code_change` migrating that state. So a reload can silently run new handlers on state the old code
   shaped.
4. **Revert** is an eval of the stored previous text of just the vars that differ, plus `undefine_var` for vars that
   did not exist then: the plan and its ms are printed. Reverting 3 vars took 15-31 ms. Cost follows what is evaluated, and eval is SUPERLINEAR in
   the source size: whole-ns eval of 10/50/100 one-line fns took 0.12 / 2.0 / 4.2 s, one var in the same ns
   25 / 28 / 200 ms. So reload and restore must evaluate only the vars that differ, never the whole namespace
   (reload/commit evaluates the whole staged ns: expect seconds on a 100-fn namespace).
5. **`reload.ward/run-sandboxed` is on the pin**, leaves the real registry untouched (real `f 1` unchanged after a
   modified-source test, passing and failing), and costs ~80-110 ms warm; the first call in a VM is several seconds
   (it loads the test library). `env/fork` itself is ~7 ms. Both numbers printed.
6. **The fork leak**: `env/isolated` with a redefined `scratch.w/f`, and plain `reload.ward/run` of a source with the
   same ns name, both CHANGED the real `scratch.w/f` (901 and 5001 were printed). A ward gate for a beam-lisp step
   must use `run-sandboxed` (unique ns prefix per run).
7. Every redefinition leaves body modules loaded (+241 loaded modules for 60 redefinitions of ONE var,
   ~4 each, 2.1 s total i.e. ~35 ms per redefinition): "BEAM keeps two versions" does not apply, beam-lisp keeps all of them. A held `datom/db` value stays a correct
   snapshot after later transactions (7b), but the conn's head is not rewound by anything. `reload/journal` records
   per ns only (7c); a held bundle leaves the old code serving.

**INFERRED** (reasoned from source, not printed)
- `reload/commit` is the right reload for omega's policy mode because of its static coherence gate (dangling refs,
  removals another ns calls) and per-ns `:applied`/`:held` journal events; plain eval is what a cell does today.
  The coherence gate refuses mutating reload in a release image (`BEAM_LISP_RELOAD` unset): omega working on a
  beam-lisp project must run in a dev image, and the policy must say so.
- Process state (gen_server state, mailbox, ETS, atoms) has no snapshot or restore API in beam-lisp. A `defserver`
  whose state was written by buggy code stays corrupted after a code revert; the honest options are restart it
  (supervisor) or run a migration, both of which need the project's cooperation.
- Two tasks reloading the same ns cannot be isolated (one global registry per VM, or one env fork each, with the
  leak of finding 6); only detection (`:prev` mismatch) and claims are possible.
- Per-var hashing at the file-edit level (not only at cell level) is the same function applied to the new text of
  the file at checkpoint time, so the `:image` part can be filled from the file checkpoint too.

### Recommendation

| in PLAN-003 scope | FUP | do not build |
|---|---|---|
| `:image` part per change: `{:vars {ns/name {:hash :prev}} :reloaded [ns]}` from position-stripped form hashes (cheap, exact, cell and file edits both), shown to the human as "changed / added / removed vars". | restore-step-N for the image (replay the stored var texts, `undefine_var` the added ones); needs the CAS of var texts that history already has. | per-task images: the registry is global; use claims and `:prev` mismatch to warn. |
| reload-on-checkpoint as an OPT-IN policy: `reload/commit` of the touched namespaces, never when the gate failed; recorded as `:reloaded`. A dev image only. | process-state and datom-head checkpoints; migration via `reload.migrate`/`reload.upgrade` (z3). | closing over "BEAM keeps old code": there is no undo API, do not promise one. |
| ward gate for beam-lisp projects: `run-sandboxed` (NEVER `ward/run` or a same-ns `env/fork`) over the modified sources + the project's tests, verdict in `:gate {:ward …}`; warm the test library at task start (7-8 s cold). | stale-closure detection (list live closures from old code) and a per-var journal in the monitor. | a promise that "restore step N" returns the running app to its old behaviour (it returns the CODE; state stays). |

Risks: (1) the fork leak in finding 6 is the easiest way to corrupt the live app silently; a lint around `ward` calls
should refuse a non-sandboxed run. (2) A cell that evals source with no `ns` or in `user` has no ns to diff:
`declared-ns` is nil, so the recorder needs a policy for that. (3) Source-level hashing misses macros: a changed
macro changes every caller without changing any caller's hash. (4) The old body modules are never purged, so a long
agent session leaks ~4 modules per redefinition (finding 7). (5) A redefined `defserver` runs new handlers on old state with no migration (finding 3).
