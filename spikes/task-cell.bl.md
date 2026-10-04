# Spike: the `:task` cell, end to end, on the shared livebook partition

> **Spike, 2026-10-03, PLAN-003.** Runnable: `bin/bl run spikes/task-cell.bl.md`. **Needs the
> beam-lisp that has `bl.doc.spans`** (the bl-js-actors branch, merged to beam-lisp main per E12;
> omega's pin `2360b32e` does not have it). Run it with:
>
> ```text
> OMEGA_BL=/home/user/code/undefine/beam-lisp--js-actors/bin/bl bin/bl run spikes/task-cell.bl.md
> ```
>
> **Question:** can the `:task` cell (bl-ed.bl.md §3) be built *as a package*, on top of the
> partition bl.doc and bl-ed already share, without changing `bl.doc.spans`? And does the whole
> lifecycle work against a real omega system: open from a document, write a reference result,
> refine on edit, a new task after a terminal status, `:after`, a home cell in the journal, a
> self-contained terminal rewrite, and coexistence with code cells?

```beam-lisp
(ns omega.spike.task-cell
  (:require [bl.doc :as doc] [bl.doc.spans :as sp]
            [omega.env :as env] [omega.task :as task] [omega.loop :as loop] [omega.codemode :as cm]
            [clojure.edn :as edn]))

;; ── the lift: an org :block whose lang is a registered kind becomes a task span ──
;; bl.doc.spans stays untouched: it already partitions `#+begin_task` as {:kind :block :lang "task"}.
;; The package re-reads those spans. It uses its OWN kind (:task), never :cell, because
;; bl.doc/cells-source concatenates every :cell into the document's PROGRAM.

(defn- tokens [s] (vec (filter (fn [t] (not (blank? t))) (split (trim s) " "))))

(defn header-attrs
  "`#+begin_task :id hex :scope a.py b.py :after x` → {:id \"hex\" :scope [\"a.py\" \"b.py\"] :after [\"x\"]}.
   Multi-valued: every token up to the next :key. Flags (:frozen :batch) are true. Unknown keys kept."
  [line]
  (loop [ts (rest (tokens line)) k nil m {}]
    (cond
      (empty? ts) m
      (starts-with? (first ts) ":") (let [kk (keyword (subs (first ts) 1))]
                                      (recur (rest ts) kk (assoc m kk true)))
      (nil? k) (recur (rest ts) k m)
      :else (recur (rest ts) k (update m k (fn [v] (if (= true v) [(first ts)] (conj v (first ts)))))))))

(def SINGLE #{:id :title :context :parent :profile :by :todo})

(defn- norm [m] (into {} (map (fn [[k v]] [k (if (and (contains? SINGLE k) (vector? v)) (first v) v)]) m)))

(defn- heading-above [lines row]
  (loop [r (dec row)] (cond (< r 0) nil
                            (some? (sp/heading-level (nth lines r))) [r (sp/parse-heading (nth lines r))]
                            :else (recur (dec r)))))

(defn task-spans
  "Every task block of an org document, lifted: header attrs, goal body, heading context,
   and the row range of its #+RESULTS span (if any)."
  [text]
  (let [lines (vec (split text "\n"))
        parts (sp/spans lines :org {})
        results (into {} (map (fn [s] [(:id s) s]) (filter (fn [s] (= :result (:kind s))) parts)))]
    (vec (keep-indexed
           (fn [i s]
             (when (and (= :block (:kind s)) (= "task" (:lang s)))
               (let [a (norm (header-attrs (nth lines (:from s))))
                     [hr h] (or (heading-above lines (:from s)) [nil nil])
                     id (or (:id a) (when h (lower-case (join "-" (take 4 (tokens (:title h)))))) (str "task-" i))
                     ctx (when (and hr (not= "none" (:context a)))
                           (trim (join "\n" (filter (fn [l] (and (not (starts-with? (trim l) "#+")) (nil? (sp/heading-level l))))
                                                    (subvec lines (inc hr) (:from s))))))]
                 {:kind :task :id id :attrs a :from (:from s) :to (:to s)
                  :goal (join "\n" (subvec lines (inc (:from s)) (dec (:to s))))
                  :heading (:title h) :todo (:todo h) :heading-row hr :context ctx
                  :result (get results id)})))
           parts))))
```

```beam-lisp
;; ── references: what a task cell's #+RESULTS holds ─────────────────────────

(defn digest [s] (subs (String/downcase (binary/encode_hex (crypto/hash :sha256 s))) 0 8))

(defn ref-line [m] (str "#omega/task " (pr-str m)))

(defn parse-ref
  "The map inside a result span's `: #omega/task {…}` lines, or nil."
  [text r]
  (when r
    (let [lines (vec (split text "\n"))
          body (join " " (map (fn [l] (let [t (trim l)] (if (starts-with? t ":") (trim (subs t 1)) t)))
                              (subvec lines (inc (:from r)) (:to r))))
          i (index-of body "#omega/task ")]
      ;; edn: data only, no evaluation. Real impl: a `#omega/task` data reader (:readers).
      (when i (edn/read-string (subs body (+ i 12)))))))

(defn- write-result
  "Put `value` as the #+RESULTS span of task `t`: rewrite the existing span in place, or insert
   one right after the block. (bl.doc/write-results only inserts after a :cell; this is the gap.)"
  [text t value]
  (let [lines (vec (split text "\n"))
        new (concat [(str "#+RESULTS: " (:id t))] (map (fn [l] (str ": " l)) (split value "\n")) [""])
        ;; a fresh insert takes the block's trailing blank line as its own terminator,
        ;; so insert → reparse → rewrite is a fixpoint (no blank line doubling)
        [a b] (cond (:result t) [(:from (:result t)) (:to (:result t))]
                    (and (< (:to t) (count lines)) (blank? (nth lines (:to t)))) [(:to t) (inc (:to t))]
                    :else [(:to t) (:to t)])]
    (join "\n" (concat (subvec lines 0 a) new (subvec lines b)))))

(defn- set-todo
  "Rewrite the heading's TODO keyword (the :todo sync mirror)."
  [text row kw]
  (let [lines (vec (split text "\n"))
        l (nth lines row)
        stars (first (split l " "))
        rest-words (rest (split (trim (subs l (count stars))) " "))
        words (if (contains? #{"TODO" "DOING" "WAIT" "REVIEW" "DONE" "BLOCKED" "CANCELLED"} (first (split (trim (subs l (count stars))) " ")))
                rest-words (split (trim (subs l (count stars))) " "))]
    (join "\n" (assoc lines row (str stars " " kw " " (join " " words))))))

(def KEYWORD {:open "DOING" :running "DOING" :waiting "WAIT" :idle "REVIEW" :done "DONE" :failed "BLOCKED" :cancelled "CANCELLED"})
(def TERMINAL #{:done :failed :cancelled})
```

```beam-lisp
;; ── evaluating a task cell (bl-ed.bl.md §3.3) ─────────────────────────────

(defn goal-of [t] (if (seq (:context t)) (str (:goal t) "\n\nContext (from the document):\n" (:context t)) (:goal t)))

(defn deps-done? [sys tasks t]
  (every? (fn [dep] (let [d (first (filter (fn [x] (= dep (:id x))) tasks))
                          r (when d (:ref d))]
                      (and r (= :done (:status (task/view sys (:id r)))))))
          (or (get-in t [:attrs :after]) [])))

(defn eval-task
  "Evaluate task cell `id` in document `text` against system `sys`. → {:text :did}."
  [sys text id]
  (let [tasks (map (fn [t] (assoc t :ref (parse-ref text (:result t)))) (task-spans text))
        t (first (filter (fn [x] (= id (:id x))) tasks))
        g (goal-of t) dg (digest g) r (:ref t)
        live (when r (task/view sys (:id r)))]
    (cond
      (get-in t [:attrs :frozen]) {:text text :did :frozen}
      (not (deps-done? sys tasks t)) {:text (write-result text t (ref-line {:pending-after (get-in t [:attrs :after])})) :did :waiting-after}
      (and live (not (contains? TERMINAL (:status live))) (= dg (:goal r))) {:text text :did :focus}
      (and live (not (contains? TERMINAL (:status live))))
        (do (task/say! sys (:id r) (str "The goal was refined:\n" g))
            {:text (write-result text t (ref-line (assoc r :goal dg))) :did :refined})
      :else
        (let [nid (task/open! sys (cond-> {:goal g :title (or (get-in t [:attrs :title]) (:heading t))}
                                    (get-in t [:attrs :scope]) (assoc :scope (get-in t [:attrs :scope]))))]
          {:text (write-result text t (ref-line (cond-> {:id nid :goal dg} r (assoc :prev (conj (or (:prev r) []) (:id r))))))
           :did (if r :reopened :opened)}))))

(defn sync!
  "What the package does when task facts change: mirror TODO keywords, and rewrite a
   terminal task's reference ONCE into a self-contained value."
  [sys text]
  (reduce (fn [txt t]
            (let [r (parse-ref txt (:result t))
                  v (when (and r (:id r)) (task/view sys (:id r)))]
              (if (nil? v) txt
                (let [txt (if (and (:heading-row t) (:todo t) (not= "off" (get-in t [:attrs :todo])))
                            (set-todo txt (:heading-row t) (get KEYWORD (:status v)))
                            txt)
                      t2 (first (filter (fn [x] (= (:id t) (:id x))) (task-spans txt)))]
                  (if (and (contains? TERMINAL (:status v)) (nil? (:status r)))
                    (write-result txt t2 (ref-line (assoc r :status (:status v) :summary (str (:result v)))))
                    txt)))))
          text (task-spans text)))
```

```beam-lisp
;; ── a real omega system and a real document ───────────────────────────────

(def root (str "/tmp/omega-task-cell-" (erlang/unique_integer (to-list [:positive]))))
(File/mkdir_p! root)
(def e (env/open))
(defn finish [s] [(loop/call-tool "done" {:result s})])
(def sys (task/start-system e {:step (fn [req]
                                       (let [txt (get-in (first (:messages req)) [:content 0 :text])]
                                         (cond (starts-with? txt "Make read_number") ((loop/scripted [(loop/say "working on it")]) req)
                                               (starts-with? txt "Document") ((loop/scripted (finish "docs written")) req)
                                               :else ((loop/scripted (finish "ok")) req))))
                               :tools cm/tools :root root}))

(def DOC (join "\n"
  ["#+TITLE: plan"
   ""
   "* TODO Hex literals in the reader"
   "Python's int() needs base 16 for 0x; keep the decimal path untouched."
   "#+begin_task :id hex :scope reader.py test_reader.py"
   "Make read_number accept 0x hex literals. Keep decimals working."
   "#+end_task"
   ""
   "* TODO Document it"
   "#+begin_task :after hex"
   "Document read_number in the README."
   "#+end_task"
   ""
   "#+begin_src beam-lisp :id sum"
   "(+ 1 2)"
   "#+end_src"
   ""]))

(println "lifted     :" (map (fn [t] [(:id t) (:attrs t) (:heading t)]) (task-spans DOC)))
(def d1 (eval-task sys DOC "hex"))
(println "eval hex   :" (:did d1))
(def d2 (eval-task sys (:text d1) "document-it"))
(println "eval docs  :" (:did d2) "(after hex)")
(println "--- document after two evaluations ---")
(println (:text d2))

;; the code cell is still a code cell, and the task blocks are NOT part of the program
(def sl (:ok (doc/slice-text (:text d2) :org)))
(println "bl.doc cells:" (map :id (doc/cells sl)) " program:" (pr-str (doc/cells-source sl)))
(println "kinds      :" (map :kind (:spans sl)))
```

```beam-lisp
;; ── lifecycle: same goal → focus; edited goal → refinement; terminal → new task ──
(Process/sleep 300)
(def hex-ref (parse-ref (:text d2) (:result (first (task-spans (:text d2))))))
(println "hex status :" (:status (task/view sys (:id hex-ref))))
(println "re-eval    :" (:did (eval-task sys (:text d2) "hex")))
(def edited (clojure.string/replace (:text d2) "Keep decimals working." "Keep decimals and 0o octal working."))
(def d3 (eval-task sys edited "hex"))
(println "edited     :" (:did d3))
(Process/sleep 300)
(println "hex turns  :" (map (fn [t] [(:role t) (get-in t [:content 0 :text])]) (let [ts (loop/turns sys (:id hex-ref))] (drop (- (count ts) 2) ts))))

;; finish hex, then sync: TODO mirror + one-shot terminal rewrite; docs cell can now open
(task/cancel! sys (:id hex-ref))
(Process/sleep 200)
(def d4 {:text (sync! sys (:text d3))})
(def d5 (eval-task sys (:text d4) "document-it"))
(println "docs again :" (:did d5) "(hex was cancelled, not done)")
(def d6 (eval-task sys (:text d5) "hex"))
(println "hex again  :" (:did d6) " ref:" (parse-ref (:text d6) (:result (first (task-spans (:text d6))))))
(println "--- document after cancel + sync + reopen ---")
(println (:text d6))
(println "sync idempotent:" (= (sync! sys (:text d4)) (sync! sys (sync! sys (:text d4)))))
```

## Findings

OBSERVED (beam-lisp--js-actors `69be296d`, via `OMEGA_BL=…`; omega's own pin lacks `bl.doc.spans`):

```text
lifted     : (["hex" {:id "hex", :scope ["reader.py" "test_reader.py"]} "Hex literals in the reader"]
              ["document-it" {:after ["hex"]} "Document it"])
eval hex   : :opened
eval docs  : :waiting-after (after hex)
bl.doc cells: ("sum")  program: "(+ 1 2)"
kinds      : (:prose :prose :result :prose :prose :result :prose :cell :prose)
re-eval    : :focus
edited     : :refined
hex turns  : ([:user "The goal was refined:\nMake read_number … 0o octal working.\n\nContext (from the document):\nPython's int() needs base 16 …"] …)
docs again : :waiting-after (hex was cancelled, not done)
hex again  : :reopened  ref: {:id "t-4", :prev ["t-1"], :goal "80a40a59"}
* CANCELLED Hex literals in the reader          ← TODO keyword mirrored by sync!
sync idempotent: true
```

1. **The `:task` cell works as a package with NO change to `bl.doc.spans`.** The shared partition
   already yields `{:kind :block :lang "task"}`, and the package lifts it. The full lifecycle of
   bl-ed.bl.md §3.3 behaved as designed against a real omega system:
   - open;
   - focus when the goal is unchanged;
   - refine on an edited body (the model receives "The goal was refined …" with the heading context);
   - `:after` waiting, with a cancelled dependency correctly NOT counting as done;
   - a new task after a terminal status, with `:prev` lineage;
   - TODO mirroring.
2. **The package must keep its own span kind (`:task`), never `:cell`.** `bl.doc/cells-source`
   concatenates every `:cell` into the document's *program*, which is the code `bl run` executes. This
   reverses §10.1's plan ("a registered `#+begin_<kind>` becomes `{:kind :cell :cell-kind …}`"). The
   registry should produce a distinct kind, or stay in the package as here.
3. **`write-results` cannot place a task result**, as predicted (§3.5 gap 1): it only inserts after a
   `:cell`. The spike writes the span itself. Two small upstream changes would remove that:
   - `write-results` takes an `:after-kinds` set;
   - `results-stop?` already treats `#+begin_` as a stop, so result spans after blocks round-trip.
4. **A blank-line subtlety:** inserting a result after `#+end_task` doubled the blank line until the
   insert consumed the block's trailing blank as its own terminator. The bl.doc writer relies on the
   same fixpoint rule ("a blank terminator BELONGS to the span"). The real implementation must reuse
   bl.doc's writer rule, not reimplement it.
5. **References read as EDN (`clojure.edn/read-string`), which is data only, never evaluated.**
   `clojure.edn` accepts `:readers` but does not consult them yet (its own docstring). So a real
   `#omega/task` tag needs either that gap closed or the tag stripped before reading, as here.
6. **The default slug for an id-less cell is the heading** ("Document it" → `document-it`), and `:after`
   resolves it. That is readable, but renaming the heading breaks `:after` references. Recommendation:
   when a task cell is first evaluated without `:id`, write the derived id into its header once (a
   one-time edit by actor `omega`), so later renames are safe.
7. Not covered: the one-shot terminal rewrite reached `sync!` but the scripted hex task was cancelled
   rather than finishing with `done`. `sync!` *did* run the rewrite branch on the second sync, and
   idempotence held. Journal home cells, `:parent`, `:see` and `:batch` were not exercised.
