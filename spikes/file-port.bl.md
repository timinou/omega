# Spike: file-port — is C6 small, and does an agent's `edit` through a buffer server deliver?

> **Superseded by the real C6 (branch core-c1-c9, 2026-10-04).** This spike measured C6 by redefining
> the prelude at runtime before it existed; `src/omega/prelude.bl` now has the file port (`DISK`, `:files`)
> and `test/core_changes_test.bl` covers it. The spike is kept as the evidence the design used.

Run: `bin/bl run spikes/file-port.bl.md`. Question: PLAN-003 core change C6 (`prelude` read/write/edit
dispatch through a swappable port). Nothing under `src/` is edited: the swap is simulated at runtime.

## 1. Inventory of `src/omega/prelude.bl` (read in full)

| fn | touches the FS how | where |
|---|---|---|
| `read` | `File/regular?` + `File/read!` on `(path p)` | `read` |
| `write` | `File/mkdir_p!`, `File/write!`, then `tr/claim!` | `write` |
| `edit` | `(read p)` (→ File/read! via `read`), `File/write!` on `(path p)`, then `tr/claim!` | `edit` |
| `ls` | `File/ls!` | `ls` |
| `glob` | `Path/wildcard` | `glob` |
| `sh` | `System/cmd "sh"` with `:cd (root)` (arbitrary FS effects) | `sh` |
| `root`/`path` | `(File/cwd!)` fallback, `Path/expand` | helpers |

So `File/*` is called directly in exactly 3 fns (`read` 2×, `write` 2×, `edit` 1× + its `read`);
`ls`/`glob`/`sh` also touch the disk but are *not* in C6 (listing sees disk, shell edits bypass buffers = L0 adoption).
`apply-edits` is pure and stays the shared edit engine. `task/start-system` copies only
`[:step :tools :hooks :system-prompt :max-steps :root :eval-timeout-ms]` from opts, so `:files` needs adding there too.

The C6 diff I WOULD make (not applied):

```clojure
;; ── src/omega/prelude.bl ──────────────────────────────────────────────
+(def DISK
+  "The default file port: today's behaviour. Port fns take the cell ctx {:task :cell :root} first."
+  {:read  (fn [c p] (let [f (Path/expand p (:root c))] (when (File/regular? f) (File/read! f))))
+   :write (fn [c p s] (let [f (Path/expand p (:root c))] (File/mkdir_p! (Path/dirname f)) (File/write! f s)))
+   :edit  (fn [c p edits]
+            (let [r (apply-edits ((:read DISK) c p) edits)]
+              (when (contains? r :ok) ((:write DISK) c p (:ok r)))
+              r))})
+(defn- files [] (or (:files (sys)) DISK))
+(defn- ctx [] {:task (task) :cell (erlang/get :omega/cell) :root (root)})
 (defn read [p]
-  (let [f (path p)]
-    (if (File/regular? f) (File/read! f) (throw (ex-info (str "no such file: " p) {:path p})))))
+  (let [s ((:read (files)) (ctx) p)]
+    (if (nil? s) (throw (ex-info (str "no such file: " p) {:path p})) s)))
 (defn write [p s]
-  (let [f (path p)]
-    (File/mkdir_p! (Path/dirname f))
-    (File/write! f s)
-    (tr/claim! (e) (task) p)
-    (str "wrote " (count s) " bytes to " p)))
+  ((:write (files)) (ctx) p s)
+  (tr/claim! (e) (task) p)
+  (str "wrote " (count s) " bytes to " p))
 (defn edit [p edits]
-  (let [r (apply-edits (read p) edits)]
+  (let [r ((:edit (files)) (ctx) p edits)]
     (if (contains? r :error)
       (throw (ex-info (str "edit " p ": " (:error r)) {:path p}))
-      (do (File/write! (path p) (:ok r))
-          (tr/claim! (e) (task) p)
+      (do (tr/claim! (e) (task) p)
           (str "applied " (count edits) " edit(s) to " p)))))
;; ── src/omega/task.bl (start-system) ──────────────────────────────────
-(select-keys opts [:step :tools :hooks :system-prompt :max-steps :root :eval-timeout-ms])
+(select-keys opts [:step :tools :hooks :system-prompt :max-steps :root :eval-timeout-ms :files])
```

## 2. Simulation: buffer server, ports, runtime shadowing

```beam-lisp
(ns omega.spike.file-port
  (:require [proc] [datom]
            [omega.env :as env]
            [omega.task :as task]
            [omega.loop :as loop]
            [omega.codemode :as cm]))

(def root (str "/tmp/omega-spike-fp-" (erlang/unique_integer (to-list [:positive]))))
(File/mkdir_p! root)
(File/write! (str root "/r.py") "def f():\n    return 1\n")
(def e (env/open))

;; minimal buffer server (shape of bl-ed §5.5): one text per path, content CAS with the story.
;; (No datom op log here: the spike asks about the port seam, not storage; the log is in-state.)
(proc/defserver buffer
  (init [root] (ok {:root root :bufs {}}))

  (handle-call [:open path] [_from st]
    (if (contains? (:bufs st) path)
      (reply :ok st)
      (let [f (str (:root st) "/" path)]
        (if (File/regular? f)
          (reply :ok (assoc-in st [:bufs path] {:text (File/read! f) :rev 0 :log [] :reads {}}))
          (reply {:error (str "no such file: " path)} st)))))

  (handle-call [:read actor path] [_from st]
    (let [b (get-in st [:bufs path])]
      (if b
        (reply {:text (:text b) :rev (:rev b)} (assoc-in st [:bufs path :reads actor] (:rev b)))
        (reply {:error (str "no such file: " path)} st))))

  ;; the human's unsaved typing: a whole-text op, NOT published to disk
  (handle-call [:human actor path text] [_from st]
    (let [b (get-in st [:bufs path]) rev (inc (:rev b))]
      (reply {:ok rev}
             (update-in st [:bufs path] assoc :text text :rev rev
                        :log (conj (:log b) {:rev rev :actor actor :cell nil :kind :human})))))

  (handle-call [:edit actor cell path edits] [_from st]
    (let [b (get-in st [:bufs path])
          r (omega.prelude/apply-edits (:text b) edits)]
      (if (contains? r :error)
        (let [seen (get-in b [:reads actor] 0)
              who (filter (fn [x] (and (> (:rev x) seen) (not= actor (:actor x)))) (:log b))]
          (reply {:error (str (:error r)
                              (when (seq who)
                                (str "; changed since you read it (rev " seen "): "
                                     (clojure.string/join ", " (map (fn [x] (str (:actor x) (when (:cell x) (str " in cell " (:cell x)))
                                                                                 " at rev " (:rev x))) who)))))}
                 st))
        (let [rev (inc (:rev b)) text (:ok r)]
          ;; agent ops publish immediately (bl-ed §5.7): disk follows the buffer
          (File/write! (str (:root st) "/" path) text)
          (reply {:ok rev :published true}
                 (update-in (assoc-in st [:bufs path :reads actor] rev) [:bufs path] assoc :text text :rev rev
                            :log (conj (:log b) {:rev rev :actor actor :cell cell :kind :edit :edits edits})))))))

  (handle-call [:write actor cell path text] [_from st]
    (let [b (or (get-in st [:bufs path]) {:text "" :rev 0 :log [] :reads {}}) rev (inc (:rev b))]
      (File/mkdir_p! (Path/dirname (str (:root st) "/" path)))
      (File/write! (str (:root st) "/" path) text)
      (reply {:ok rev}
             (assoc-in st [:bufs path] (assoc b :text text :rev rev
                                              :log (conj (:log b) {:rev rev :actor actor :cell cell :kind :write})
                                              :reads (assoc (:reads b) actor rev))))))

  (handle-call [:state path] [_from st] (reply (get-in st [:bufs path]) st)))

;; ports: {:read :write :edit}, each (fn [ctx p …]) — ctx = {:task :cell :root}
(def disk-port
  {:read (fn [c p] (let [f (Path/expand p (:root c))] (when (File/regular? f) (File/read! f))))
   :write (fn [c p s] (let [f (Path/expand p (:root c))] (File/mkdir_p! (Path/dirname f)) (File/write! f s) :ok))
   :edit (fn [c p edits]
           (let [f (Path/expand p (:root c))
                 r (omega.prelude/apply-edits (File/read! f) edits)]
             (when (contains? r :ok) (File/write! f (:ok r)))
             r))})

(defn buffer-port [srv]
  {:read (fn [c p]
           (call srv [:open p])
           (let [r (call srv [:read (:task c) p])] (when-not (:error r) (:text r))))
   :write (fn [c p s] (call srv [:open p]) (call srv [:write (:task c) (:cell c) p s]) :ok)
   :edit (fn [c p edits]
           (call srv [:open p])
           (call srv [:edit (:task c) (:cell c) p edits]))})

(def srv (start buffer root {}))
(def PORT (buffer-port srv))
(erlang/put :spike/none nil)
```

The shadow: re-`defn` `read`/`write`/`edit` inside `omega.prelude` (so private `task`/`root`/`e` resolve),
dispatching through a port held in a known place. Cells are separate processes, so the port lives in
`persistent_term` (the process dictionary would not be shared). The originals are saved to restore them.

```beam-lisp
(def ORIG {:read omega.prelude/read :write omega.prelude/write :edit omega.prelude/edit})
(persistent_term/put :spike/orig ORIG)
(persistent_term/put :spike/port disk-port)

(def SHADOW-SRC
  (str "(ns omega.prelude)\n"
       "(defn- -ctx [] {:task (task) :cell (erlang/get :omega/cell) :root (root)})\n"
       "(defn- -port [] (persistent_term/get :spike/port))\n"
       "(defn read [p] (let [s ((:read (-port)) (-ctx) p)] (if (nil? s) (throw (ex-info (str \"no such file: \" p) {:path p})) s)))\n"
       "(defn write [p s] ((:write (-port)) (-ctx) p s) (omega.trace/claim! (e) (task) p) (str \"wrote \" (count s) \" bytes to \" p))\n"
       "(defn edit [p edits] (let [r ((:edit (-port)) (-ctx) p edits)] (if (contains? r :error) (throw (ex-info (str \"edit \" p \": \" (:error r)) {:path p})) (do (omega.trace/claim! (e) (task) p) (str \"applied \" (count edits) \" edit(s) to \" p)))))\n"))
(def RESTORE-SRC
  (str "(ns omega.prelude)\n"
       "(def read (:read (persistent_term/get :spike/orig)))\n"
       "(def write (:write (persistent_term/get :spike/orig)))\n"
       "(def edit (:edit (persistent_term/get :spike/orig)))\n"))

;; eval_string leaves the CURRENT namespace switched to the last `ns` it saw (OBSERVED: the next
;; spike form failed with "undefined var: omega.task.early/e"), so every call ends by re-entering ours.
(defn ev! [src] (BeamLisp.Compiler/eval_string (str src "\n(ns omega.spike.file-port)")))
(defn shadow! [] (ev! SHADOW-SRC) :shadowed)
(defn restore! [] (ev! RESTORE-SRC) :restored)

;; (a) does a caller COMPILED BEFORE the swap see it? Build a task-style ns first.
(ev!
  (str "(ns omega.task.early (:require [omega.prelude :refer :all]))\n"
       "(defn rd [p] (read p))\n"))
(def sys0 {:env e :root root})
(def w0 (omega.prelude/-register! "t-probe" sys0))
;; after C2 -bind! also takes the world; before it, -register! returned the task id
(if (= w0 "t-probe") (omega.prelude/-bind! "t-probe" "t-probe.0" nil) (omega.prelude/-bind! w0 "t-probe" "t-probe.0" nil))

(println "OBSERVED before swap: early-ns read     =" (pr-str (omega.task.early/rd "r.py")))
(call srv [:open "r.py"])
(call srv [:human "human:me" "r.py" "# WIP (unsaved)\ndef f():\n    return 1\n"])
(persistent_term/put :spike/port PORT)
(shadow!)
(println "OBSERVED after swap : fully-qualified   =" (pr-str (omega.prelude/read "r.py")))
(println "OBSERVED after swap : early-compiled ns =" (pr-str (omega.task.early/rd "r.py")))
(println "OBSERVED disk (unsaved human text must NOT be there) =" (pr-str (File/read! (str root "/r.py"))))
```

## 3. A real omega task through the buffer

Task B reads first (rev 1), is held at a gate while task A reads and edits, then B edits with a stale `:old`.

```beam-lisp
(restore!)
(def seen-result (fn [key] (fn [req] (persistent_term/put key (get-in (last (:messages req)) [:content 0 :content])) (loop/say "ok"))))
(def scripts
  {"A: bump to 2"
   [(loop/call-tool "eval"
      {:code (str "(let [t (read \"r.py\")"
                  "      r (edit \"r.py\" [{:old \"return 1\" :new \"return 2\"}])]"
                  "  {:saw t :edit r :task (erlang/get :omega/task) :cell (erlang/get :omega/cell)})")})
    (seen-result :spike/a-res)]
   "B: bump to 3"
   [(loop/call-tool "eval" {:code "(read \"r.py\")"})
    (fn [req]
      (loop [n 0]
        (when (and (not (persistent_term/get :spike/gate false)) (< n 200)) (Process/sleep 50) (recur (inc n))))
      (loop/call-tool "eval" {:code "(edit \"r.py\" [{:old \"return 1\" :new \"return 3\"}])"} "tu-b2"))
    (seen-result :spike/b-res)]})

(persistent_term/put :spike/gate false)
(shadow!)
(def sys (task/start-system e {:step (loop/by-goal scripts) :tools cm/tools :root root}))
(def b (task/open! sys {:goal "B: bump to 3"}))
;; wait until B has read (server saw B's read), then run A
(loop [n 0]
  (when (and (not (seq (:reads (call srv [:state "r.py"])))) (< n 100)) (Process/sleep 50) (recur (inc n))))
(def pre (call srv [:state "r.py"]))
(def a (task/open! sys {:goal "A: bump to 2"}))
(println "A:" (select-keys (task/await sys a 20000) [:status :result]))
(persistent_term/put :spike/gate true)
(println "B:" (select-keys (task/await sys b 20000) [:status :result]))
(task/stop-system! sys)
(restore!)

(println "\nOBSERVED A's tool result (its read + edit, cell id, task id):")
(println " " (persistent_term/get :spike/a-res))
(println "OBSERVED B's tool result (stale edit):")
(println " " (persistent_term/get :spike/b-res))
(def fin (call srv [:state "r.py"]))
(println "OBSERVED buffer text :" (pr-str (:text fin)) "rev" (:rev fin))
(println "OBSERVED disk text   :" (pr-str (File/read! (str root "/r.py"))))
(println "OBSERVED op log      :" (pr-str (map (fn [x] (select-keys x [:rev :actor :cell :kind])) (:log fin))))
(println "task ids: A =" a " B =" b)
(println "OBSERVED after restore, early ns reads disk =" (pr-str (omega.task.early/rd "r.py")))
```

## 4. Latency

p50 of 200 calls, µs. "port" = the port function called directly; "prelude" = `omega.prelude/read|edit` bound to
a probe task (real `-ctx`, and for edit the real `tr/claim!`), with the original, the disk-port shadow, and the buffer-port shadow.

```beam-lisp
(defn p50 [f]
  (let [ts (vec (for [_ (range 200)]
                  (let [t0 (erlang/monotonic_time :microsecond)] (f) (- (erlang/monotonic_time :microsecond) t0))))]
    (nth (sort ts) 100)))
(def ctx {:task "t-bench" :cell "c" :root root})
(File/write! (str root "/b.py") "x = 1\n")
(call srv [:open "b.py"])
(def flip (atom 0))
(defn edit-flip! [edit-fn]
  (let [n (swap! flip inc) [o w] (if (odd? n) ["x = 1" "x = 2"] ["x = 2" "x = 1"])]
    (edit-fn [{:old o :new w}])))
(defn flipper [] (let [n (atom 0)] (fn [f] (let [k (swap! n inc)] (if (odd? k) (f "x = 1" "x = 2") (f "x = 2" "x = 1"))))))

;; claim! needs a real task entity in the env: open an idle one for the bench
(def sysb (task/start-system e {:step (fn [req] (loop/say "idle")) :tools cm/tools :root root}))
(def tb (task/open! sysb {:goal "bench"}))
(task/await sysb tb 5000)
(def wb (omega.prelude/-register! tb sysb))
(if (= wb tb) (omega.prelude/-bind! tb (str tb ".0") nil) (omega.prelude/-bind! wb tb (str tb ".0") nil))
(restore!)
(println "bench start")
;; NB prelude `edit` ends in tr/claim!, a datom update to one hot trace entity: p50 106 ms at 200 calls
;; and growing (OBSERVED in a first run of this bench; the 200-call loop did not finish in 60 s under a shadow).
;; That cost is identical with or without a port, so edit is benched at the PORT level, claim! separately.
(def r-orig-read  (p50 (fn [] (omega.prelude/read "b.py"))))
(def raw-file-read  (p50 (fn [] (File/read! (str root "/b.py")))))
(def raw-file-write (p50 (fn [] (File/write! (str root "/b.py") "x = 1\n"))))
(def fo (flipper))
(def direct-edit (p50 (fn [] (fo (fn [o w] ((:edit disk-port) ctx "b.py" [{:old o :new w}]))))))
(File/write! (str root "/b.py") "x = 1\n")
(persistent_term/put :spike/port disk-port) (shadow!)
(def r-disk-read  (p50 (fn [] (omega.prelude/read "b.py"))))
(call srv [:human "human:me" "b.py" "x = 1\n"])
(persistent_term/put :spike/port PORT)
(def r-buf-read   (p50 (fn [] (omega.prelude/read "b.py"))))
(restore!)
(def fb (flipper))
(def port-edit (p50 (fn [] (fb (fn [o w] ((:edit PORT) ctx "b.py" [{:old o :new w}]))))))
(def raw-port-read  (p50 (fn [] ((:read PORT) ctx "b.py"))))
(def claim-p50 (p50 (fn [] (omega.trace/claim! e tb "b.py"))))

(println "OBSERVED p50 µs  raw File/read!" raw-file-read "| raw File/write!" raw-file-write "| buffer-port read (no prelude)" raw-port-read)
(println "OBSERVED p50 µs  prelude read : original" r-orig-read "| disk-port shadow" r-disk-read "| buffer-port shadow" r-buf-read)
(println "OBSERVED p50 µs  edit (port level, no claim!) : disk-port" direct-edit "| buffer-port (CAS + log + publish to disk)" port-edit)
(println "OBSERVED p50 µs  tr/claim! alone (200 calls):" claim-p50)
(println "restored:" (= (omega.prelude/read "b.py") (File/read! (str root "/b.py"))))
```

## Findings

**C6 size (counted from the diff above, INFERRED to be complete — not applied or tested as source).**
29 changed lines: prelude +17/−10, task.bl +1/−1. Net +8 lines. Design said "~15 lines": about right if you count additions only.
Touched fns: `read`, `write`, `edit` (+ new `DISK` map, `files`, `ctx`), and `start-system` must forward `:files`.
`apply-edits` unchanged. `ls`, `glob`, `sh` stay on disk (a buffer port can't see their effects: that is L0 adoption).

**Do eval cells see a runtime-swapped prelude? OBSERVED: yes.** `omega.task.early/rd`, compiled *before* the swap
and referring `read` via `:refer :all`, returned the buffer text after `eval_string "(ns omega.prelude) (defn read …)"`.
Real task cells (agent evals, scripts calling `(read …)`) also hit the buffer port, and `restore!` put disk behaviour back.
So the redefinition technique works; it does **not** make C6 unnecessary, only shows C6 isn't *required* for a prototype. C6 is still
cleaner, because the swap has these costs:
- `eval_string` needs `BeamLisp.Compiler/eval_string` with ONE arg (the two-arg form with a string env fails: `in_ns` FunctionClauseError);
- it leaves the caller's current ns switched to the last `ns` form seen (our next form failed with `undefined var omega.task.early/e`), so every swap must end with `(ns <mine>)`;
- the swap is global to the VM (all systems, all tasks) while C6's `(:files sys)` is per system; cells are separate processes so the port must sit in `persistent_term`, not the process dictionary;
- the shadow re-implements the bodies (copy of `edit`/`write`), so it silently drifts from the original; restore relies on saved fn values.

**Cell-id key. OBSERVED:** `(erlang/get :omega/cell)`, set by `prelude/-bind!` from the preamble codemode prepends. Its value is
`<task>.<unique-integer>`, e.g. `"t-3.123"` — NOT the `<task>/<step>/<tool-use-id>` form §5.6 expects (that is C4). Task id: `(erlang/get :omega/task)`.
The port gets both, because the shadow/`ctx` passes them: actor = task id, cell = that key.

**Agent through the buffer. OBSERVED:**
- the human's unsaved text was in the buffer and NOT on disk; the agent's `read` returned the buffer text (`# WIP (unsaved) …`);
- A's edit landed as an op with actor `t-3`, cell `t-3.123`; the buffer server wrote disk (publish) only then — disk then equalled the buffer including the human's unsaved line,
  so an agent edit publishes the human's half-typed text too (§5.7 says "publish on pause" for the human; the real server must decide whether an agent publish carries unpublished human ops. Design question surfaced, not answered here);
- B read at rev 1, stale `:old` after A's edit → error thrown by prelude `edit`: `edit r.py: :old not found: "return 1"; changed since you read it (rev 1): t-3 in cell t-3.123 at rev 2`. Story names the first task and its cell.
  (The `:old not found` line shows prelude's `apply-edits` message format differs from the §5.5 sample; the buffer server must reuse `apply-edits`, as the spike does.)

**Latency (p50, 200 calls, µs). OBSERVED:**
- raw `File/read!` ≈ 62, raw `File/write!` ≈ 119;
- prelude `read`: original 51, disk-port shadow 98, buffer-port shadow 38 (buffer is in-process: a call to a server is cheaper than a disk read);
- port-level `edit`: disk port 689, buffer port (CAS + log + disk publish) 298. The disk port is slower only because it reads and writes the file;
- the port indirection itself (shadow vs original) costs tens of µs: negligible.
- **Surprise (OBSERVED):** `tr/claim!` p50 = ~97 ms per call (106 ms in the first, whole-`edit` run), which dwarfs all of the above, ~300× the port edit. Consistent with the known "hot entity updated many times gets slower"; not caused by C6, but every agent `write`/`edit` pays it. The 200-call loop of the unmodified prelude `edit` took minutes. Worth fixing (append-only claims) before PLAN-003 leans on edit-rate.

**What the real implementation must do differently:** pass `ctx` (task, cell, root) to every port fn; forward `:files` in `start-system`; reuse `apply-edits` in the server; hold buffer state in a server (not an atom); define who publishes human text on an agent edit; port should also expose `ls/glob`-visibility (new unsaved files) if buffers can be unsaved-new.
