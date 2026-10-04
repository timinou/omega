# Spike: C9 — `edit`/`write` tell the agent who else holds the path

> **Spike, 2026-10-03, PLAN-003 improvement round.** Runnable: `bin/bl run spikes/c9-claim-conflict.bl.md`.
> Question: `spikes/claims-advisory.bl.md` found that `prelude/edit` writes, then calls `trace/claim!`, and
> drops the `{:conflict …}` it returns, so an agent never learns another live task holds the path. Is
> surfacing it in the tool result a small patch, and does the second task's model actually receive it?
> The patch is applied by runtime redefinition (omega's source is not changed) and restored at the end.

```beam-lisp
(ns omega.spike.c9
  (:require [omega.env :as env] [omega.task :as task] [omega.loop :as loop] [omega.codemode :as cm] [omega.trace :as tr]))

(def PATCH "
(ns omega.prelude)

(defn- held-by
  \"Claim conflicts → a short suffix for the tool result, or \\\"\\\".\"
  [r]
  (if-let [cs (seq (:conflict r))]
    (str \" (\" (clojure.string/join \", \" (map (fn [c] (str (:task c) \" also holds \" (:subject c))) cs))
         \"; claims are advisory: coordinate with send/wait if you overlap)\")
    \"\"))

(defn write
  \"Write `s` to `p`, creating directories. Claims the path (advisory) and says who else holds it.\"
  [p s]
  (let [f (path p)]
    (File/mkdir_p! (Path/dirname f))
    (File/write! f s)
    (str \"wrote \" (count s) \" bytes to \" p (held-by (tr/claim! (e) (task) p)))))

(defn edit
  \"Edit `p` by exact replacement: edits = [{:old \\\"…\\\" :new \\\"…\\\"} …]. All or nothing.\"
  [p edits]
  (let [r (apply-edits (read p) edits)]
    (if (contains? r :error)
      (throw (ex-info (str \"edit \" p \": \" (:error r)) {:path p}))
      (do (File/write! (path p) (:ok r))
          (str \"applied \" (count edits) \" edit(s) to \" p (held-by (tr/claim! (e) (task) p)))))))
(ns omega.spike.c9)
")

(defn run [label]
  (let [root (str "/tmp/omega-c9-" label "-" (erlang/unique_integer (to-list [:positive])))
        _ (File/mkdir_p! root)
        _ (File/write! (str root "/a.py") "x = 1\ny = 2\n")
        script (fn [code] [(loop/call-tool "eval" {:code code}) (loop/say "ok")])
        e (env/open)
        sys (task/start-system e {:step (loop/by-goal {"A" (script "(edit \"a.py\" [{:old \"x = 1\" :new \"x = 10\"}]) (Process/sleep 1500) :a")
                                                       "B" (script "(Process/sleep 300) (edit \"a.py\" [{:old \"y = 2\" :new \"y = 20\"}])")})
                                  :tools cm/tools :root root})
        a (task/open! sys {:goal "A"})
        b (task/open! sys {:goal "B"})]
    (task/await sys a 20000) (task/await sys b 20000)
    (let [tool-text (fn [id] (get-in (first (filter (fn [t] (= :tool (:role t))) (loop/turns sys id))) [:content 0 :content]))]
      {:label label :disk (File/read! (str root "/a.py")) :A-saw (tool-text a) :B-saw (tool-text b)})))

(println "before:" (run "before"))
(BeamLisp.Compiler/eval_string PATCH)
(println "after :" (run "after"))
;; restore: re-evaluate the ORIGINAL definitions from omega's source text
(let [src (File/read! "src/omega/prelude.bl")
      grab (fn [head] (let [i (index-of src head)
                            rest-src (subs src (inc i))
                            j (index-of rest-src "\n(defn")]
                        (subs src i (if j (+ i 1 j) (count src)))))]
  (BeamLisp.Compiler/eval_string (str "(ns omega.prelude)\n" (grab "(defn write") "\n" (grab "(defn edit") "\n(ns omega.spike.c9)")))
(println "restored:" (:B-saw (run "restored")))
```

## Findings

OBSERVED:

```text
before: {:disk "x = 10\ny = 20\n", :A-saw "=> :a", :B-saw "=> applied 1 edit(s) to a.py"}
after : {:disk "x = 10\ny = 20\n", :A-saw "=> :a",
         :B-saw "=> applied 1 edit(s) to a.py (t-1 also holds a.py; claims are advisory: coordinate with send/wait if you overlap)"}
restored: => applied 1 edit(s) to a.py
```

1. **C9 works and is small.** About 12 changed lines in `omega.prelude`: one helper, `held-by`, and
   `write`/`edit` append its suffix.
   - Both edits still land, so it is still advisory.
   - The second task's model now receives, in the very tool result it reads next, who else holds the
     file and what to do about it.
   - That is rung 2 of the consensus ladder (bl-ed.bl.md §5.4) with no buffer server.
2. **Only the second claimer learns.** A wrote first and saw nothing, because claims are checked at
   claim time. A learns of B only if B `send`s, or through traces in its context.
   - Symmetric awareness needs the other half of rung 2: `read` reporting fresh claims on the path it
     reads.
   - That is the same `held-by` call on `read`, but cheap only after BUG-002 / append-only claims,
     since `claim!` costs 11–100 ms today.
3. **Restoring a runtime-redefined fn:** `alter-var-root` does not exist on this pin. Re-evaluating the
   original `defn` text from the source file works, as shown, and is what a reversible `advise` would
   do internally.
