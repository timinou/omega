# Spike: are claims advisory in practice?

> Runnable: `bin/bl run spikes/claims-advisory.bl.md`. Written to check a claim in
> `task-refs.bl.md` that the default claim policy refuses a second task's write. It does not.

```beam-lisp
(ns omega.spike.claims-advisory (:require [omega.env :as env] [omega.task :as task] [omega.loop :as loop] [omega.codemode :as cm] [omega.trace :as tr]))
(def root (str "/tmp/omega-claimcheck-" (erlang/unique_integer (to-list [:positive]))))
(File/mkdir_p! root)
(File/write! (str root "/a.py") "x = 1\ny = 2\n")
(defn script [code] [(loop/call-tool "eval" {:code code}) (loop/say "ok")])
(def e (env/open))
(def sys (task/start-system e {:step (loop/by-goal {"A" (script "(edit \"a.py\" [{:old \"x = 1\" :new \"x = 10\"}]) (Process/sleep 1500) :a")
                                                    "B" (script "(Process/sleep 300) (edit \"a.py\" [{:old \"y = 2\" :new \"y = 20\"}])")})
                               :tools cm/tools :root root}))
(def a (task/open! sys {:goal "A"}))
(def b (task/open! sys {:goal "B"}))
(task/await sys a 20000) (task/await sys b 20000)
(println "a.py on disk  :" (pr-str (File/read! (str root "/a.py"))))
(println "B's tool result:" (pr-str (get-in (second (filter (fn [t] (= :tool (:role t))) (loop/turns sys b))) [:content 0 :content])))
(println "B's claims    :" (count (tr/all e {:kind :claim :task b})) " A's claims:" (count (tr/all e {:kind :claim :task a})))
```

## Findings

OBSERVED: `a.py on disk : "x = 10\ny = 20\n"`, and each task holds 1 claim. Two tasks edited different
lines of one file under the default policy, and both edits landed.

- **Invariant 4 holds:** a claim never blocks a write.
- **The gap:** `prelude/edit` writes first, then calls `claim!`, and drops the `{:conflict …}` it gets
  back. The agent is never told that another live task holds the path.
- **Cheap fix:** surface the conflict in the tool result, e.g. "applied 1 edit to a.py (t-1 also
  holds a.py)". That is information for the task, still not a lock.
- This becomes rung 2 of the consensus ladder (bl-ed.bl.md §5.4) for free, before any buffer server
  exists.
