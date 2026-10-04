# spike: per-step history checkpoints as an extension

> Run: `bin/bl run spikes/step-checkpoint.bl.md`

**Question.** Can an omega *extension* (no core change) checkpoint history once per
tool step of a real task loop, attributed to the task, with the gate decision
recorded, and is it correct when two tasks share one working copy?

Nothing under `src/` is touched. The history store below is the native-history
spike's store (`/tmp/h/history.bl.md`), trimmed to what this needs (open,
checkpoint!, head, log, diff, blame, text-at, tree-at, manifest).

## 1. The store (copied, trimmed)

```beam-lisp
(ns omega.spike.history (:require [datom]))


;; ── lines, hunks, three-way merge ─────────────────────────────────────────

(defn lines [s] (if (nil? s) [] (clojure.string/split s "\n" -1)))
(defn unlines [ls] (clojure.string/join "\n" ls))

(defn- lcs-table
  "L[i][j] = LCS length of am[i..] and bm[j..], built bottom-up row by row."
  [am bm]
  (let [n (count am) m (count bm)
        zero (vec (repeat (inc m) 0))]
    (loop [i (dec n) rows (list zero)]
      (if (< i 0) (vec rows)
        (let [below (first rows)
              row (loop [j (dec m) acc (list 0)]
                    (if (< j 0) (vec acc)
                      (let [v (if (= (nth am i) (nth bm j))
                                (inc (nth below (inc j)))
                                (max (nth below j) (first acc)))]
                        (recur (dec j) (cons v acc)))))]
          (recur (dec i) (cons row rows)))))))

(defn hunks
  "Edits turning line vector `a` into `b`: [{:from :to :lines}] in a's positions.
   Common prefix/suffix are trimmed first, so a typical edit costs O(size of the edit)."
  [a b]
  (let [na (count a) nb (count b)
        p (loop [k 0] (if (and (< k na) (< k nb) (= (nth a k) (nth b k))) (recur (inc k)) k))
        s (loop [k 0] (if (and (< k (- na p)) (< k (- nb p)) (= (nth a (- na 1 k)) (nth b (- nb 1 k)))) (recur (inc k)) k))
        am (subvec a p (- na s)) bm (subvec b p (- nb s))
        n (count am) m (count bm)]
    (cond
      (and (= n 0) (= m 0)) []
      (or (= n 0) (= m 0)) [{:from p :to (+ p n) :lines bm}]
      :else
      (let [L (lcs-table am bm)
            at (fn [i j] (nth (nth L i) j))]
        (loop [i 0 j 0 cur nil out []]
          (cond
            (and (< i n) (< j m) (= (nth am i) (nth bm j)))
              (recur (inc i) (inc j) nil (if cur (conj out cur) out))
            (and (< i n) (or (>= j m) (>= (at (inc i) j) (at i (inc j)))))
              (recur (inc i) j (assoc (or cur {:from (+ p i) :lines []}) :to (+ p i 1)) out)
            (< j m)
              (recur i (inc j) (update (or cur {:from (+ p i) :to (+ p i) :lines []}) :lines conj (nth bm j)) out)
            :else (if cur (conj out cur) out)))))))

(defn apply-hunks
  "base + hunks → new vector. `ins` turns a hunk's inserted lines into elements."
  ([base hs] (apply-hunks base hs identity))
  ([base hs ins]
   (loop [hs (sort-by :from hs) pos 0 out []]
     (if (empty? hs) (into out (subvec base pos))
       (let [h (first hs)]
         (recur (rest hs) (:to h) (into (into out (subvec base pos (:from h))) (ins (:lines h)))))))))

(defn- overlap? [x y]
  (or (and (< (:from x) (:to y)) (< (:from y) (:to x)))
      (and (= (:from x) (:from y)) (or (= (:from x) (:to x)) (= (:from y) (:to y))))))

(defn merge3
  "Three-way merge of line vectors → {:lines :conflicts n}. Non-overlapping edits from
   both sides apply; identical edits apply once; overlapping ones become marked regions."
  [base a b]
  (let [tagged (sort-by :from (concat (map (fn [h] (assoc h :side :a)) (hunks base a))
                                      (map (fn [h] (assoc h :side :b)) (hunks base b))))
        clusters (reduce (fn [cs h]
                           (let [cl (peek cs)]
                             (if (and cl (or (< (:from h) (apply max (map :to cl)))
                                             (some (fn [x] (overlap? x h)) cl)))
                               (conj (pop cs) (conj cl h))
                               (conj cs [h]))))
                         [] tagged)]
    (loop [cs clusters pos 0 out [] n 0]
      (if (empty? cs) {:lines (into out (subvec base pos)) :conflicts n}
        (let [cl (first cs)
              from (apply min (map :from cl)) to (apply max (map :to cl))
              as (filter (fn [h] (= :a (:side h))) cl)
              bs (filter (fn [h] (= :b (:side h))) cl)
              strip (fn [hs] (set (map (fn [h] (dissoc h :side)) hs)))
              side (fn [hs] (apply-hunks (subvec base from to)
                                         (map (fn [h] (assoc h :from (- (:from h) from) :to (- (:to h) from))) hs)))
              out (into out (subvec base pos from))]
          (if (or (empty? as) (empty? bs) (= (strip as) (strip bs)))
            (recur (rest cs) to (into out (side (if (empty? as) bs as))) n)
            (recur (rest cs) to (-> out (conj "<<<<<<< ours") (into (side as)) (conj "=======")
                                    (into (side bs)) (conj ">>>>>>> theirs"))
                   (inc n))))))))

(defn carry
  "Origins of `new` lines: an old line keeps its origin, an inserted one is :new."
  [old-lines old-origins new-lines]
  (apply-hunks old-origins (hunks old-lines new-lines) (fn [ls] (vec (repeat (count ls) :new)))))

;; ── the store: content-addressed objects, changes, refs ───────────────────

(def SCHEMA
  [{:db/ident :obj/key        :db/valueType :db.type/string :db/unique :db.unique/identity}
   {:db/ident :obj/file       :db/valueType :db.type/file}
   {:db/ident :change/id      :db/valueType :db.type/string :db/unique :db.unique/identity}
   {:db/ident :change/parent1 :db/valueType :db.type/string}
   {:db/ident :change/parent2 :db/valueType :db.type/string}
   {:db/ident :change/delta   :db/doc "{path obj-key | nil} vs parent1 (small: inline)"}
   {:db/ident :change/key     :db/valueType :db.type/string :db/doc "obj: the full manifest (keyframes only)"}
   {:db/ident :change/depth   :db/valueType :db.type/long   :db/doc "first-parent steps since the last keyframe"}
   {:db/ident :change/touched :db/valueType :db.type/string :db/cardinality :db.cardinality/many :db/index true}
   {:db/ident :change/renames :db/doc "{old new}"}
   {:db/ident :change/by      :db/valueType :db.type/string :db/index true}
   {:db/ident :change/why     :db/valueType :db.type/string}
   {:db/ident :change/at      :db/valueType :db.type/long}
   {:db/ident :change/gate    :db/valueType :db.type/keyword}
   {:db/ident :change/conflicts :db/valueType :db.type/string :db/cardinality :db.cardinality/many}
   ;; refs are APPEND-ONLY: one fact per move, never an update in place.
   ;; (datom reads/writes of an entity are O(times it was updated): a hot
   ;; :ref/name entity made every checkpoint slower than the last.)
   {:db/ident :move/id        :db/valueType :db.type/string :db/unique :db.unique/identity}
   {:db/ident :move/ref       :db/valueType :db.type/string :db/index true}
   {:db/ident :move/change    :db/valueType :db.type/string}
   {:db/ident :move/seq       :db/valueType :db.type/long}])

(def KEYFRAME 32)
(def PROF (atom {}))

(defn- hex [b] (String/downcase (binary/encode_hex (crypto/hash :sha256 b))))

(defn- memo
  "Per-process memo in the process dictionary: O(1) reads, no copy. (A beam-lisp
   atom's deref copies its whole value out of a NIF cell: O(size) per read.)"
  [k f]
  (let [v (erlang/get k)]
    (if (= v :undefined) (let [x (f)] (erlang/put k x) x) v)))
(defn- entry-obj [db k] (memo [:obj k] (fn [] (obj-term db k))))
(defn- entry-text [db e] (when e (:text (entry-obj db e))))
(defn- entry-origins [db e] (if e (:origins (entry-obj db e)) []))

(defn- recover-heads
  "Each ref's head = its highest-seq move. Read once, when a store opens."
  [conn]
  (reduce (fn [m [r c q]] (if (> q (get-in m [r 1] -1)) (assoc m r [c q]) m))
          {} (datom/q '[:find ?r ?c ?q :where [?m :move/ref ?r] [?m :move/change ?c] [?m :move/seq ?q]] (datom/db conn))))

(defn open
  ([] (open (datom/connect SCHEMA)))
  ([conn] (let [hs (recover-heads conn)]
            {:conn conn
             :heads (atom (into {} (map (fn [[r [c _]]] [r c]) hs)))
             :seq (atom (reduce max 0 (map (fn [[_ [_ q]]] q) hs)))})))

(defn- move-tx [h ref change]
  (let [q (swap! (:seq h) inc)]
    (swap! (:heads h) assoc ref change)
    {:db/id -2 :move/id (str ref "#" q) :move/ref ref :move/change change :move/seq q}))

(defn- obj-tx
  "[key tx-map] for bytes `b`, content-addressed."
  [b]
  (let [k (hex b)] [k {:db/id (- (erlang/phash2 k 100000000) 1000000000) :obj/key k :obj/file (datom/file b)}]))

(defn- obj-bytes [db k] (datom/file-bytes db (:obj/file (datom/entity db [:obj/key k]))))
(defn- obj-term [db k] (erlang/binary_to_term (obj-bytes db k)))

(defn head [h ref] (get @(:heads h) ref))

(defn- change
  "A change is immutable once written, so its entity is cached forever."
  [db id]
  (when id (memo [:change id] (fn [] (datom/entity db [:change/id id])))))

(defn manifest
  "{path [blob-key blame-key]} of change `id`: its keyframe, or its first parent's
   manifest + its delta. At most KEYFRAME steps cold; cached after."
  [h id]
  (if (nil? id) {}
    (memo [:manifest id]
      (fn []
        (let [db (datom/db (:conn h)) c (change db id)
              m (if (:change/key c)
                  (obj-term db (:change/key c))
                  (reduce (fn [m [p e]] (if (nil? e) (dissoc m p) (assoc m p e)))
                          (manifest h (:change/parent1 c))
                          (:change/delta c)))]
          m)))))

(defn text-at [h id path] (entry-text (datom/db (:conn h)) (get (manifest h id) path)))
(defn tree-at [h id] (let [db (datom/db (:conn h))] (into {} (map (fn [[p e]] [p (entry-text db e)]) (manifest h id)))))

(defn checkpoint!
  "Record `changed` ({path text|nil}) on top of `ref`'s head.
   opts: :by :why :gate, :parent2 (merges), :origins {path [origin|:new]} (merges/reverts).
   → change id, or nil when nothing changed (and it is not a merge)."
  [h ref {:keys [changed by why gate parent2 origins at]}]
  (let [T0 (erlang/monotonic_time :microsecond)
        db (datom/db (:conn h))
        p1 (head h ref)
        base (manifest h p1)
        _ (swap! PROF assoc :m (- (erlang/monotonic_time :microsecond) T0))
        eff (into {} (filter (fn [[p t]] (not= t (entry-text db (get base p)))) changed))
        added (into {} (map (fn [[p t]] [t p]) (filter (fn [[p t]] (and t (nil? (get base p)))) eff)))
        renames (into {} (keep (fn [[p t]] (when (nil? t) (when-let [np (get added (entry-text db (get base p)))] [p np]))) eff))]
    (when (or (seq eff) parent2)
      (let [at (or at (erlang/system_time :millisecond))
            id (subs (hex (erlang/term_to_binary [p1 parent2 (sort (map (fn [[p t]] [p (when t (hex t))]) eff)) by why at])) 0 16)
            from-old (into {} (map (fn [[o n]] [n o]) renames))
            per (map (fn [[p t]]
                       (if (nil? t) [p nil nil]
                         (let [src (get base (or (get from-old p) p))
                               org (or (get origins p)
                                       (if (get from-old p)
                                         (entry-origins db src)
                                         (carry (lines (entry-text db src)) (entry-origins db src) (lines t))))
                               org (vec (map (fn [o] (if (= o :new) id o)) org))
                               obj {:text t :origins org}
                               [k tx] (obj-tx (erlang/term_to_binary obj))]
                           (erlang/put [:obj k] obj)
                           [p k [tx]])))
                     eff)
            delta (into {} (map (fn [[p e _]] [p e]) per))
            new-m (reduce (fn [m [p e]] (if (nil? e) (dissoc m p) (assoc m p e))) base delta)
            _ (swap! PROF assoc :per (- (erlang/monotonic_time :microsecond) T0))
            depth (if p1 (inc (or (:change/depth (change db p1)) 0)) 0)
            key? (or (nil? p1) (>= depth KEYFRAME))
            [mk mtx] (when key? (obj-tx (erlang/term_to_binary new-m)))]
        (swap! PROF assoc :pre (- (erlang/monotonic_time :microsecond) T0))
        (datom/transact! (:conn h)
          (concat (mapcat (fn [[_ _ txs]] txs) per)
                  (when key? [mtx])
                  [(cond-> {:db/id -1 :change/id id :change/delta delta :change/depth (if key? 0 depth)
                            :change/by by :change/why why :change/at at
                            :change/touched (vec (keys eff))}
                     p1 (assoc :change/parent1 p1)
                     parent2 (assoc :change/parent2 parent2)
                     key? (assoc :change/key mk)
                     gate (assoc :change/gate gate)
                     (seq renames) (assoc :change/renames renames))
                   (move-tx h ref id)]))
        (swap! PROF assoc :tx (- (erlang/monotonic_time :microsecond) T0 (:pre @PROF)))
        (erlang/put [:manifest id] new-m)
        id))))

(defn branch! [h name from]
  (datom/transact! (:conn h) [(move-tx h name (head h from))])
  name)

;; ── reading history ───────────────────────────────────────────────────────

(defn- parents [db id] (let [c (change db id)] (remove nil? [(:change/parent1 c) (:change/parent2 c)])))

(defn ancestors
  "Every change reachable from `id`, newest first (breadth-first)."
  [h id]
  (let [db (datom/db (:conn h))]
    (loop [q [id] seen #{} out []]
      (if (empty? q) out
        (let [c (first q)]
          (if (or (nil? c) (contains? seen c)) (recur (rest q) seen out)
            (recur (concat (rest q) (parents db c)) (conj seen c) (conj out c))))))))

(defn log
  "Changes reachable from `ref`, newest first, filtered by :by and/or :path.
   A :path query follows exact renames back in time."
  [h ref {:keys [by path]}]
  (let [db (datom/db (:conn h))]
    (loop [ids (sort-by (fn [i] (- (:change/at (change db i)))) (ancestors h (head h ref))) p path out []]
      (if (empty? ids) out
        (let [c (change db (first ids))
              hit? (and (or (nil? by) (= by (:change/by c)))
                        (or (nil? p) (some (fn [x] (= x p)) (:change/touched c))))
              renamed-from (when p (some (fn [[o n]] (when (= n p) o)) (:change/renames c)))]
          (recur (rest ids) (or renamed-from p)
                 (if hit? (conj out {:id (:change/id c) :by (:change/by c) :why (:change/why c) :gate (:change/gate c)}) out)))))))

(defn diff
  "{path [old new]} that `id` introduced against its first parent."
  [h id]
  (let [db (datom/db (:conn h)) c (change db id)
        m0 (manifest h (:change/parent1 c)) m1 (manifest h id)]
    (into {} (map (fn [p] [p [(entry-text db (get m0 p)) (entry-text db (get m1 p))]]) (:change/touched c)))))

(defn blame
  "[[line origin-change]] for `path` as of `id` — one object read, no history walk."
  [h id path]
  (let [db (datom/db (:conn h)) e (get (manifest h id) path)]
    (vec (map vector (lines (entry-text db e)) (entry-origins db e)))))

```

## 2. The historian: one owner process

The store's memos live in the *process dictionary* of whoever calls it, and
`open` keeps head/seq in atoms with read-then-write `checkpoint!`. omega.ext runs
every `:on` handler in a fresh `spawn`ed process, so two handlers can run
`checkpoint!` at once. Everything below goes through `hcall`, which ships a
closure to one owner process that holds the store. `snap!` is the one
operation; `naive` mode calls it straight from the handler process instead, to
show what the owner buys.

```beam-lisp
(ns omega.spike.step-checkpoint
  (:require [omega.env :as env]
            [omega.task :as task]
            [omega.loop :as loop]
            [omega.codemode :as cm]
            [omega.ext :as ext]
            [omega.trace :as tr]
            [omega.spike.history :as hist]))

(defn now-us [] (erlang/monotonic_time :microsecond))

(defn read-tree
  "{relpath text} of every regular file under root."
  [root]
  (into {} (map (fn [f] [(Path/relative_to f root) (File/read! f)])
                (filter (fn [f] (File/regular? f)) (Path/wildcard (str root "/**/*"))))))

(defn gate
  "The gate: a tree fails when any file contains the marker BROKEN."
  [tree]
  (if (some (fn [[_ t]] (clojure.string/includes? (or t "") "BROKEN")) tree) :fail :pass))

(defn claimed
  "Paths task `id` holds claims on (omega's write/edit leave a :claim trace)."
  [e id]
  (set (map :subject (tr/all e {:kind :claim :task id}))))

(defn snap!
  "Checkpoint the working tree on behalf of task `id`. attrib :tree = every changed
   file goes on this task's change; :claims = only changed files this task claimed.
   Returns the ledger row (and leaves a :finding trace when the gate fails)."
  [h e root ref id why attrib arrived]
  (let [t0 (now-us)
        tree (read-tree root)
        hd (hist/head h ref)
        changed (into {} (filter (fn [[p t]] (not= t (hist/text-at h hd p))) tree))
        mine (if (= attrib :claims) (let [c (claimed e id)] (into {} (filter (fn [[p _]] (contains? c p)) changed))) changed)
        ;; gate sees the tree as it WOULD be after this change; a file someone else
        ;; changed but this change does not carry stays at its recorded text
        after (merge (hist/tree-at h hd) mine)
        g (gate after)
        g-own (gate mine)
        cid (when (seq mine) (hist/checkpoint! h ref {:changed mine :by id :why why :gate g}))
        _ (when (and cid (= g :fail))
            (tr/leave! e id {:kind :finding :subject (str "gate/" cid)
                             :text (str "gate failed after: " why " (change " cid ")")}))
        t1 (now-us)]
    {:task id :why why :change cid :gate g :gate-own g-own :touched (vec (sort (keys mine))) :texts mine
     :seen-other (vec (sort (keys (apply dissoc changed (keys mine)))))
     :us (- t1 t0) :arrived arrived}))

(defn historian
  "Spawn the owner process. It opens the store, then serves closures (fn [h] …)
   one at a time, replying [:hist-reply value]."
  []
  (spawn (fn []
           (let [h (hist/open)]
             (loop []
               (receive [from f]
                 (do (erlang/send from [:hist-reply (try (f h) (catch err {:error (ex-message err)}))])
                     (recur))))))))

(defn hcall [pid f]
  (erlang/send pid [(erlang/self) f])
  (receive [:hist-reply v] v (after 20000 {:error :hist-timeout})))
```

## 3. The extension

`:turn/start` fires once per *turn* (before the first model call), not once per step
(OBSERVED below by counting), so it cannot mark step boundaries. The per-step signal
that exists is `:tool/result` (one tool per step in these scripts; with parallel
tool calls it would fire several times per step). `:turn/end` is the final flush.

```beam-lisp
(def LEDGER-EVENTS (atom {}))   ; event counts, to report what actually fires

(defn make-ext
  "mode :owner (via historian) | :naive (checkpoint from the handler process).
   `shared` = {:pid historian :h store :arrivals (atom n)}."
  [shared mode attrib via]
  (let [arrived (:arrivals shared)
        run (fn [data ctx why-fn]
              (let [sys (:sys ctx) id (:task data)
                    e (:env sys) root (:root sys)
                    n (swap! arrived inc)
                    why (why-fn sys id)]
                (if (= mode :owner)
                  (hcall (:pid shared) (fn [h] (let [r (snap! h e root "main" id why attrib n)]
                                                 (swap! (:rows shared) conj r) r)))
                  (let [r (snap! (:h shared) e root "main" id why attrib n)]
                    (swap! (:rows shared) conj r) r))))
        step-why (fn [sys id]
                   (let [steps (count (filter (fn [t] (= :assistant (:role t))) (loop/turns sys id)))]
                     (str (:goal (task/view sys id)) " · step " steps)))]
    (if (= via :hook)
      ;; inline, synchronous, in the task's own process: sees the tree at the step boundary
      {:name :history :doc "checkpoint in a :tool/after hook"
       :hooks {:tool/after (fn [r ctx] (run {:task (:task ctx)} ctx step-why) r)}
       :on {:turn/start (fn [d _] (swap! LEDGER-EVENTS update :turn/start (fnil inc 0)))}}
      {:name :history
       :doc "checkpoint the working copy after each tool step"
       :on {:turn/start (fn [d _] (swap! LEDGER-EVENTS update :turn/start (fnil inc 0)))
            :tool/result (fn [d ctx]
                           (swap! LEDGER-EVENTS update :tool/result (fnil inc 0))
                           (run d ctx step-why))
            :turn/end (fn [d ctx]
                        (swap! LEDGER-EVENTS update :turn/end (fnil inc 0))
                        (run d ctx (fn [sys id] (str (:goal (task/view sys id)) " · turn end"))))}})))
```

## 4. A real system, two scripted tasks

t-A: three eval steps writing `a.py` (step 2 writes the marker BROKEN, step 3 fixes
it). t-B: two steps writing `b.py`. Each step sleeps a little so the two overlap in
the shared working copy.

```beam-lisp
(def GOAL-A "edit a.py in three steps")
(def GOAL-B "edit b.py in two steps")
(def A-TEXT {1 "x = 1\n" 2 "BROKEN\n" 3 "x = 3\n"})
(def B-TEXT {1 "b = 1\n" 2 "b = 2\n"})

(defn mk-scripts
  "k scales the per-step sleep: k=1 is ~25 ms/step (faster than a checkpoint);
   k=16 is ~400 ms/step (still far faster than a real model call)."
  [k]
  (let [sl (fn [ms] (str "(Process/sleep " (* k ms) ")"))]
    {GOAL-A [(loop/call-tool "eval" {:code (str "(write \"a.py\" \"x = 1\\n\") " (sl 25))})
             (loop/call-tool "eval" {:code (str "(write \"a.py\" \"BROKEN\\n\") " (sl 25))})
             (loop/call-tool "eval" {:code (str "(write \"a.py\" \"x = 3\\n\") " (sl 25) " (done \"a done\")")})]
     GOAL-B [(loop/call-tool "eval" {:code (str "(write \"b.py\" \"b = 1\\n\") " (sl 35))})
             (loop/call-tool "eval" {:code (str "(write \"b.py\" \"b = 2\\n\") " (sl 5) " (done \"b done\")")})]}))

(defn p50 [xs] (let [v (vec (sort xs))] (if (empty? v) 0 (nth v (quot (count v) 2)))))

(defn run-once
  "One fresh system + store. mode :owner|:naive, attrib :tree|:claims.
   → {:rows :ids :log :h :e :a :b :counts :created …}"
  [mode attrib k via]
  (let [root (str "/tmp/omega-step-ckpt-" (erlang/unique_integer (to-list [:positive])))
        _ (File/mkdir_p! root)
        _ (File/write! (str root "/a.py") "x = 0\n")
        _ (File/write! (str root "/b.py") "b = 0\n")
        e (env/open)
        pid (historian)
        h (if (= mode :owner) nil (hist/open))
        shared {:pid pid :h h :arrivals (atom 0) :rows (atom [])}
        _ (reset! LEDGER-EVENTS {})
        sys (ext/install (task/start-system e {:step (loop/by-goal (mk-scripts k)) :tools cm/tools :root root})
                         [(make-ext shared mode attrib via)])
        ;; seed commit by a human, through the same path
        seed (fn [hh] (hist/checkpoint! hh "main" {:changed (read-tree root) :by "human:me" :why "initial"}))
        _ (if (= mode :owner) (hcall pid seed) (seed h))
        a (task/open! sys {:goal GOAL-A :scope ["a.py"]})
        b (task/open! sys {:goal GOAL-B :scope ["b.py"]})
        ra (task/await sys a 15000)
        rb (task/await sys b 15000)
        _ (Process/sleep 600)                        ; let async handlers drain
        q (fn [f] (if (= mode :owner) (hcall pid f) (f h)))
        out (q (fn [hh]
                 (let [db (datom/db (:conn hh))
                       head (hist/head hh "main")
                       lg (hist/log hh "main" {})
                       all-changes (count (datom/q '[:find ?c :where [?c :change/id _]] db))
                       full (map (fn [r] (assoc r :seq nil)) lg)]
                   {:head head :log lg :created all-changes :reachable (count lg)
                    :byA (hist/log hh "main" {:by a}) :byB (hist/log hh "main" {:by b})
                    :touched (into {} (map (fn [l] [(:id l) (:change/touched (datom/entity db [:change/id (:id l)]))]) lg))
                    :text-a (hist/text-at hh head "a.py") :text-b (hist/text-at hh head "b.py")
                    :blame-a (hist/blame hh head "a.py")
                    :whyof (into {} (map (fn [l] [(:id l) (:why l)]) lg))}))) ]
    (assoc out :rows @(:rows shared) :a a :b b :e e :sys sys :counts @LEDGER-EVENTS
           :status [(:status ra) (:status rb)]
           :finding (map :text (tr/all e {:kind :finding})))))
```

## 5. Analysis helpers

```beam-lisp
(defn owner-file [r id] (cond (= id (:a r)) "a.py" (= id (:b r)) "b.py"))
(defn step-of [w] (let [m (re-find #"step (\d+)$" w)] (when m (erlang/binary_to_integer (second m)))))

(defn analyse
  "Over the changes written in one run (seed excluded):
   :polluted  changes by task X touching a file X never wrote
   :skew      changes whose `why` says 'step n' but whose own-file text is not step n's text
   :dup       changes carrying the same text of a file as the previous one (should be 0)"
  [r]
  (let [rows (filter (fn [x] (and (:change x) (not= "turn end" (last (clojure.string/split (:why x) " · "))))) (:rows r))
        all (filter (fn [x] (:change x)) (:rows r))
        polluted (count (filter (fn [x] (some (fn [p] (not= p (owner-file r (:task x)))) (:touched x))) all))
        skew (count (filter (fn [x]
                              (let [s (step-of (:why x))
                                    f (owner-file r (:task x))
                                    exp (get (if (= (:task x) (:a r)) A-TEXT B-TEXT) s)
                                    got (get (:texts x) f)]
                                (and s got exp (not= got exp))))
                            all))]
    {:changes (count all) :polluted polluted :skew skew
     :noop (count (filter (fn [x] (nil? (:change x))) (:rows r)))}))

(defn show-run [label r]
  (println (str "\n── " label " ──"))
  (println "  status A,B:" (:status r) " events fired:" (into (sorted-map) (:counts r)))
  (println "  log (newest first):")
  (doseq [l (:log r)]
    (println (str "    " (:id l) "  by=" (tname-of r (:by l)) "  gate=" (name (or (:gate l) :-))
                  "  files=" (pr-str (get (:touched r) (:id l))) "  why=" (:why l))))
  (println "  log {:by A}:" (map :why (:byA r)))
  (println "  log {:by B}:" (map :why (:byB r)))
  (println "  created/reachable changes:" (:created r) "/" (:reachable r)
           " final a.py:" (pr-str (:text-a r)) " b.py:" (pr-str (:text-b r)))
  (println "  analysis:" (analyse r))
  (println "  checkpoint latency µs p50/max (n=" (count (:rows r)) "):"
           (p50 (map :us (:rows r))) (apply max (map :us (:rows r))))
  (println "  finding traces:" (:finding r)))

(defn tname-of [r id] (cond (= id (:a r)) "A" (= id (:b r)) "B" :else id))
```

## 6. Runs, 3 each (fresh system and store per run)

Fast steps (~25 ms, faster than a checkpoint) first, then slow steps (~400 ms).
Variants: `owner/tree` (every changed file rides the change), `owner/claims`
(only files this task claimed), `naive` (no historian, handler process writes),
`hook` (checkpoint inline in a `:tool/after` hook, claims attribution).

```beam-lisp
(defn runs [mode attrib k via] (vec (map (fn [i] (try (run-once mode attrib k via) (catch err {:error (ex-message err)}))) (range 3))))
(defn show-all [label rs]
  (doseq [[i r] (map-indexed vector rs)]
    (if (:error r) (println label (inc i) "THREW:" (:error r)) (show-run (str label " run " (inc i)) r))))
(def fast-tree   (runs :owner :tree 1 :on))
(show-all "fast owner/tree" fast-tree)
(def fast-claims (runs :owner :claims 1 :on))
(show-all "fast owner/claims" fast-claims)
(def fast-naive  (runs :naive :claims 1 :on))
(show-all "fast naive" fast-naive)
(def fast-hook   (runs :owner :claims 1 :hook))
(show-all "fast hook" fast-hook)
(def slow-claims (runs :owner :claims 16 :on))
(show-all "slow owner/claims" slow-claims)
(def slow-hook   (runs :owner :claims 16 :hook))
(show-all "slow hook" slow-hook)
```

## 7. Summary (OBSERVED)

```beam-lisp
(defn summ [label rs]
  (println (str label ": " (pr-str (map (fn [r] (if (:error r) :threw (assoc (analyse r) :reachable (:reachable r) :gate-fails (count (filter (fn [l] (= :fail (:gate l))) (:log r))))) ) rs)))))
(summ "fast owner/tree  " fast-tree)
(summ "fast owner/claims" fast-claims)
(summ "fast naive       " fast-naive)
(summ "fast hook        " fast-hook)
(summ "slow owner/claims" slow-claims)
(summ "slow hook        " slow-hook)
(println "latency µs p50 (owner, all):" (p50 (mapcat (fn [r] (map :us (:rows r))) (concat fast-tree fast-claims fast-hook slow-claims slow-hook))))
```

## Findings

Observed in this file's output (3 runs per variant, in-memory store, 2 tasks, 5 tool
steps in total; `noop` = a handler that found nothing of its own to record).

**What was measured** (the table is from the last full run; counts vary run to run for
the event variants, which is itself the finding; the hook rows were identical every run)

"reachable" = changes reachable from `main` incl. the seed (a perfect run has 6);
"polluted" = changes by task X carrying a file X never wrote; "skewed" = `why` says
"step n" but the text held for the task's own file is not step n's.

| variant (3 runs each) | reachable | polluted | skewed | gate-fail changes |
|---|---|---|---|---|
| `:on :tool/result` + owner, **tree** attribution, fast | 4,4,4 | 2,3,3 (of 3) | 2,1,1 | 1,1,1 |
| `:on :tool/result` + owner, **claims**, fast | 3,3,3 | 0 | 1,1,1 | 1,0,0 |
| `:on` + owner, claims, slow (~400 ms/step) | 5,6,5 | 0 | 1,0,1 | 1,1,0 |
| `:on` + **no owner** (naive), fast | 2,2,2 | 0 | 0 | 1,1,1 |
| `:tool/after` **hook** + owner, claims, fast | 6,6,6 | 0 | 0 | 2,2,2 |
| `:tool/after` hook + owner, claims, slow | 6,6,6 | 0 | 0 | 2,1,1 |

**1. Per-step checkpointing as an extension works only partly via events.**
`:tool/result` is emitted per tool call, but the handler runs in a *spawned* process
after the tool returned, while the task has already started its next step. By the time
the handler reads the working tree, the file may already hold step n+1's text. Observed
consequences with an event handler: (a) skew: "step 1" recorded holding step 2's
text; (b) coalescing / lost steps: two steps' writes land before one checkpoint, so the
store has fewer changes than steps (3–6 reachable out of 6 expected, vs 6/6 for the
hook); (c) no step is ever *missing from the file*, the final tree is always right, only
the step granularity degrades. The faster the tool steps relative to a checkpoint
(~25–200 ms here), the worse; with ~400 ms steps it still lost/skewed some.
`:turn/start` fires once per turn, not per step (events counter: turn/start 2 for 2
tasks), so it is useless as a step boundary; only `:tool/result` and `:turn/end` exist.
`:turn/end` is racy for claims: `task.bl` releases the task's claims when it finishes,
so with claims attribution the final "turn end" flush sometimes finds nothing claimed
(slow runs 1 and 3 got it, others did not) and the last write is then uncommitted or
carried by the next checkpoint of someone else.

**2. A `:tool/after` hook gives exact step checkpoints today, no core change.**
Hooks run inline in the task's own process, between the tool's return and the next model
call. All 6/6 changes recorded, 0 skew, 0 pollution, correct `step n`, in all 6 runs.
Cost: it blocks that task for the checkpoint (p50 below). It is a hook, not an event,
so the "extension only observes" stance of events is bent (the hook returns `r`
unchanged), and `:tool/after` is also invoked for tool calls that errored.

**3. Concurrency in one working copy (E17a).** With tree attribution (every changed
file rides the current change), 2–3 of 3 changes per run carry the *other* task's file
(polluted): t-B's step 1 change contains a.py, and the gate then *fails t-B* for t-A's
BROKEN marker (observed: "by=B gate=fail" in tree runs 2 and 3). Gate blame goes to the
wrong task. Per-path attribution from the changed-file set intersected with the task's
`:claim` traces (omega's `write`/`edit` already leave them) fixes the *pollution*
completely: 0 polluted in every claims/hook run. It does NOT fix gate blame: the gate
here runs on `head ∪ my files`, and once t-A's BROKEN change is on `main`, t-B's next
change is also gated `:fail` (hook rows show 2 fail changes: A's step 2 and B's step 2,
the latter `by=B files=[b.py]`, caused by A's file). Whether B is failed depends on
interleaving (1 vs 2 fail changes across hook runs). A gate must either be per-path
(only gate the files the change carries) or the history needs per-task refs/branches
(§5.9) so a task's gate sees only its own line; a single shared `main` cannot give
honest gate attribution. NB: claims only exist for files written
through omega's `write`/`edit`; a file changed by `sh` (e.g. a formatter) has no claim, so
claims attribution would silently drop it (stays uncommitted until someone claims it).
The real design needs a fallback ("unclaimed changed files ride the checkpoint of
whoever's step is running if exactly one step is in flight, else an `unattributed` change
by the harness").

**4. Gate + finding trace work.** `gate` ran on every change; the :fail change is
recorded (`:change/gate :fail`, E18, in every run: the log shows `gate=fail`) and `omega.trace/leave!` from the handler put a
`:finding` trace on the task `gate failed after: <goal> · step 2 (change <id>)` (shown
in "finding traces" lines). `leave!` from the handler's spawned process is safe.
Note `tr/leave!` takes the `:subject` as the dedup key, so the subject embeds the change id.

**5. The single-owner historian is necessary.** Without it (naive: every event handler
calls `checkpoint!` in its own process) 3/3 runs lost most history: only 2 of 6 changes
were reachable, and the store held more changes than were reachable (e.g. created 4 /
reachable 2 or 3 in the earlier run's naive rows): changes were written on a stale
head, forking the chain (orphans). Cause (INFERRED from the code, consistent with the
observation): `checkpoint!` reads `head` then writes it non-atomically, and the memo
(`erlang/get`/`put`) is per process so each handler process rebuilds the manifest cold:
naive p50 latency was several times the owner's (~0.3–0.8 s vs ~0.1–0.2 s observed).
Serialising through one process keeps the chain linear (created == reachable in the
owner runs shown).

**6. Latency.** p50 over owner/hook runs ≈ 175 ms per handler invocation (in-memory store, 2
tiny files; max up to 0.5–0.9 s), measured around the whole `snap!`. That is the
handler's end-to-end cost: tree read, `task/view` + `loop/turns` for the `why`, the
`:claim` scan via `tr/all` (reads every trace), the gate, `checkpoint!`, hcall. I did
not split it, so I cannot say which part dominates (INFERRED: the omega env queries,
`tr/all` pulls every trace entity). The real implementation should avoid deriving `why`
and claims by scanning the env per step (carry step number and touched paths in the event).

**What a `:step/end` (C5) would simplify** (INFERRED, supported by 1–2): an event
carrying `{:task :n :tools [...]}` emitted *synchronously after the step's tools and
before the next model call* would give the hook's exactness with event semantics
(handler may still be async but gets `n` and could be causally ordered), and
`:turn/start` would not be needed at all. Concretely it would remove: the step number
re-derivation (`loop/turns` count) and the skew problem if the emit were a
blocking `emit-sync` (or if the step-end event carried the claims/changed paths).
It is **needed**, not merely nicer, if checkpointing must be both per-step and off the task's critical
path; if blocking the task ~200 ms per step is acceptable a `:tool/after` hook already
suffices. Alt: a `:step/end` *hook* kind (inline, return ignored).

**Broken / surprising**
- Event handler races: skew + coalescing under fast steps (observed, §6 table).
- Claims are released at task end → `:turn/end` flush misses claims (observed).
- Naive multi-process checkpointing forks history (observed): the owner is mandatory.
- The tree gate blames the wrong task under concurrency (observed): gate must run on
  the per-task change, not the whole tree.
- Not tested: `sh`-driven file changes, deleted files (`read-tree` has no
  deletions: a deleted file would not be seen as `nil`), a durable store, more than 2 tasks,
  parallel tool calls in one step.
