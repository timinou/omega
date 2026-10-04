# spike: asynchronous exact step checkpoints (snapshot inline, commit via cast)

> Run: `bin/bl run spikes/async-checkpoint.bl.md`

**Question.** `step-checkpoint` found `:on` events inexact and a `:tool/after` hook exact but blocking
(~160-200 ms per step while the historian commits). Take an exact SNAPSHOT inline in the hook (just the texts of
the paths this step wrote), `cast` it to the historian which commits in order. Is ordering still exact across two
concurrent tasks, is the task-side cost < 5 ms, and is history identical to the blocking hook's?

Nothing under `src/` is touched. Section 1 is the native-history store inlined from `history.bl.md`
(helpers before users), section 2 the historian + the write recorder, section 3 the runs.

## 1. The store (inlined from spikes/step-checkpoint.bl.md, namespace renamed)

```beam-lisp
(ns omega.spike.async-checkpoint.history (:require [datom]))


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

## 2. Historian, write recorder, prelude wrapper

The historian is a `defserver` owning the store (its memos live in its process dictionary). `commit!` is the one
commit routine; `[:snap …]` as a *cast* is ASYNC, as a *call* is BLOCK. `[:flush]` is a call, so it returns only after
every earlier-delivered cast has been handled. It records, per commit, the peak mailbox depth and commit time.

**Attribution.** The hook must know which paths *this step* wrote. The wrapper around `omega.prelude/write`/`edit`
runs in the CELL process, a different process from the task's, so it `cast`s `[:w task path]` to a small **recorder
server** (`wbuf`); the hook `call`s `[:take task]` (returns the paths written since the last take, and the step
number = count of takes). I chose a server over ETS/process dictionary: cells are separate processes and the hook
runs in the task process; a server needs no table ownership and its message order is the order of arrival.

```beam-lisp
(ns omega.spike.async-checkpoint
  (:require [omega.env :as env]
            [omega.task :as task]
            [omega.loop :as loop]
            [omega.codemode :as cm]
            [omega.ext :as ext]
            [omega.spike.async-checkpoint.history :as hist]))

(defn now-us [] (erlang/monotonic_time :microsecond))

(defn gate-of
  "Per-path gate: :fail iff a carried file contains BROKEN."
  [texts]
  (if (some (fn [[_ t]] (clojure.string/includes? (or t "") "BROKEN")) texts) :fail :pass))

(defn commit!
  "Commit one snapshot {:by :why :texts :gate} on main → the ledger row."
  [h by why texts gate arr]
  (let [t0 (now-us)
        cid (hist/checkpoint! h "main" {:changed texts :by by :why why :gate gate})]
    {:by by :why why :files (vec (sort (keys texts))) :texts texts :gate gate :arr arr :change cid :us (- (now-us) t0)}))

(defn qlen [] (elem (erlang/process_info (erlang/self) :message_queue_len) 1))

(defserver historian
  (init [_] (ok {:h (hist/open) :rows [] :peak 0 :commit-us 0 :n 0}))

  (handle-cast [:snap by why texts gate arr] [st]
    (let [depth (qlen)
          r (commit! (:h st) by why texts gate arr)]
      (noreply (assoc st :rows (conj (:rows st) r) :peak (max (:peak st) depth)
                      :commit-us (+ (:commit-us st) (:us r)) :n (inc (:n st))))))

  (handle-call [:snap by why texts gate arr] [_from st]
    (let [r (commit! (:h st) by why texts gate arr)]
      (reply (:change r) (assoc st :rows (conj (:rows st) r) :commit-us (+ (:commit-us st) (:us r)) :n (inc (:n st))))))

  (handle-call [:flush] [_from st] (reply :flushed st))

  (handle-call [:log] [_from st]
    (reply {:rows (:rows st) :peak (:peak st) :commit-us (:commit-us st) :n (:n st)
            :head-log (count (hist/log (:h st) "main" {}))}
           st)))

(defserver wbuf
  (init [_] (ok {:w {} :steps {} :cost {} :arr 0}))
  (handle-cast [:w task path] [st] (noreply (update-in st [:w task] (fnil conj []) path)))
  (handle-cast [:cost label us] [st] (noreply (update-in st [:cost label] (fnil conj []) us)))
  (handle-call [:take task] [_from st]
    (let [n (inc (get-in st [:steps task] 0))]
      (reply {:paths (vec (distinct (get-in st [:w task] []))) :step n :arr (inc (:arr st))}
             (-> st (assoc-in [:w task] []) (assoc-in [:steps task] n) (assoc :arr (inc (:arr st)))))))
  (handle-call [:costs label] [_from st] (reply (get-in st [:cost label] []) st)))

;; ── the prelude wrapper (technique of spikes/file-port.bl.md) ──────────────
;; eval_string leaves the current ns switched, so every call re-enters ours.
(defn ev! [src] (BeamLisp.Compiler/eval_string (str src "\n(ns omega.spike.async-checkpoint)")))

(persistent_term/put :spike/aorig {:write omega.prelude/write :edit omega.prelude/edit})

;; The shadow re-implements the bodies (copied from prelude.bl) plus the record cast. Calling the saved
;; original from the wrapper would recurse forever: OBSERVED, a saved `omega.prelude/write` resolves its
;; var at call time (the first draft of this spike hung in `write`).
(def WRAP-SRC
  (str "(ns omega.prelude)\n"
       "(defn- -rec [p] (GenServer/cast (persistent_term/get :spike/wbuf) [:w (task) p]))\n"
       "(defn write [p s] (let [f (path p)] (File/mkdir_p! (Path/dirname f)) (File/write! f s) (tr/claim! (e) (task) p) (-rec p) (str \"wrote \" (count s) \" bytes to \" p)))\n"
       "(defn edit [p edits] (let [r (apply-edits (read p) edits)] (if (contains? r :error) (throw (ex-info (str \"edit \" p \": \" (:error r)) {:path p})) (do (File/write! (path p) (:ok r)) (tr/claim! (e) (task) p) (-rec p) (str \"applied \" (count edits) \" edit(s) to \" p)))))\n"))
(def RESTORE-SRC
  (str "(ns omega.prelude)\n"
       "(defn write [p s] (let [f (path p)] (File/mkdir_p! (Path/dirname f)) (File/write! f s) (tr/claim! (e) (task) p) (str \"wrote \" (count s) \" bytes to \" p)))\n"
       "(defn edit [p edits] (let [r (apply-edits (read p) edits)] (if (contains? r :error) (throw (ex-info (str \"edit \" p \": \" (:error r)) {:path p})) (do (File/write! (path p) (:ok r)) (tr/claim! (e) (task) p) (str \"applied \" (count edits) \" edit(s) to \" p)))))\n"))
(defn wrap! [] (ev! WRAP-SRC) :wrapped)
(defn unwrap! [] (ev! RESTORE-SRC) :restored)
```

## 3. The hook and the scripted system

Hook (`:tool/after`, runs inline in the task's process): `take` the step's written paths, read exactly those files
now (the tool has just returned, the task has not moved), compute the per-path gate, then `call` (BLOCK) or `cast`
(ASYNC) the snapshot. The whole hook is timed and the cost cast to `wbuf`. Task A: 3 eval steps on a.py (step 2
writes BROKEN, step 3 fixes); task B: 2 steps on b.py; the two run concurrently.

```beam-lisp
(def GOAL-A "edit a.py in three steps")
(def GOAL-B "edit b.py in two steps")
(def A-TEXT {1 "x = 1\n" 2 "BROKEN\n" 3 "x = 3\n"})
(def B-TEXT {1 "b = 1\n" 2 "b = 2\n"})

(defn make-ext [hist-pid wb root mode]
  {:name :history :doc "snapshot inline, commit block|async"
   :hooks {:tool/after
           (fn [r ctx]
             (let [t0 (now-us) sys (:sys ctx) id (:task ctx)
                   tk (call wb [:take id])
                   t1 (now-us)
                   paths (:paths tk)]
               (when (seq paths)
                 (let [why (str (:goal (task/view sys id)) " · step " (:step tk))
                       t2 (now-us)
                       texts (into {} (map (fn [p] [p (File/read! (str root "/" p))]) paths))
                       g (gate-of texts)
                       t3 (now-us)]
                   (if (= mode :block)
                     (call hist-pid [:snap id why texts g (:arr tk)] 60000)
                     (cast hist-pid [:snap id why texts g (:arr tk)]))
                   (let [t4 (now-us)]
                     (cast wb [:cost (keyword (str (name mode) "-take")) (- t1 t0)])
                     (cast wb [:cost (keyword (str (name mode) "-view")) (- t2 t1)])
                     (cast wb [:cost (keyword (str (name mode) "-read")) (- t3 t2)])
                     (cast wb [:cost (keyword (str (name mode) "-send")) (- t4 t3)]))))
               (cast wb [:cost mode (- (now-us) t0)])
               r))}})

(def SCRIPTS
  (let [sl (fn [ms] (str "(Process/sleep " ms ")"))]
    {GOAL-A [(loop/call-tool "eval" {:code (str "(write \"a.py\" \"x = 1\\n\") " (sl 25))})
             (loop/call-tool "eval" {:code (str "(write \"a.py\" \"BROKEN\\n\") " (sl 25))})
             (loop/call-tool "eval" {:code (str "(write \"a.py\" \"x = 3\\n\") " (sl 25) " (done \"a done\")")})]
     GOAL-B [(loop/call-tool "eval" {:code (str "(write \"b.py\" \"b = 1\\n\") " (sl 35))})
             (loop/call-tool "eval" {:code (str "(write \"b.py\" \"b = 2\\n\") " (sl 5) " (done \"b done\")")})]}))

(defn run-once
  "One fresh system + historian + recorder → {:log :costs :a :b :status}."
  [mode]
  (let [root (str "/tmp/omega-async-ckpt-" (erlang/unique_integer (to-list [:positive])))
        _ (File/mkdir_p! root)
        _ (File/write! (str root "/a.py") "x = 0\n")
        _ (File/write! (str root "/b.py") "b = 0\n")
        hp (start historian nil {})
        _ (call hp [:snap "human:me" "initial" {"a.py" "x = 0\n" "b.py" "b = 0\n"} :pass 0])
        e (env/open)
        wb (start wbuf nil {})
        _ (persistent_term/put :spike/wbuf wb)
        sys (ext/install (task/start-system e {:step (loop/by-goal SCRIPTS) :tools cm/tools :root root})
                         [(make-ext hp wb root mode)])
        a (task/open! sys {:goal GOAL-A :scope ["a.py"]})
        b (task/open! sys {:goal GOAL-B :scope ["b.py"]})
        ra (task/await sys a 15000)
        rb (task/await sys b 15000)
        _ (call hp [:flush])
        lg (call hp [:log])
        costs (call wb [:costs mode])
        parts (into {} (map (fn [k] [k (call wb [:costs (keyword (str (name mode) "-" k))])]) ["take" "view" "read" "send"]))]
    (Process/exit hp :kill) (Process/exit wb :kill)
    {:log lg :costs costs :parts parts :a a :b b :status [(:status ra) (:status rb)]}))

(defn pct [xs q] (let [v (vec (sort xs))] (if (empty? v) 0 (nth v (min (dec (count v)) (int (* q (count v))))))))
(defn owner-file [r id] (cond (= id (:a r)) "a.py" (= id (:b r)) "b.py"))
(defn label [r id] (cond (= id (:a r)) :A (= id (:b r)) :B :else :human))
(defn step-of [w] (let [m (re-find #"step (\d+)$" w)] (when m (erlang/binary_to_integer (second m)))))

(defn norm
  "The history as task-independent data: [(label why files texts gate)] in commit order."
  [r]
  (vec (map (fn [x] [(label r (:by x)) (:why x) (:files x) (:texts x) (:gate x)])
            (filter (fn [x] (:change x)) (:rows (:log r))))))

(defn analyse [r]
  (let [rows (filter (fn [x] (and (:change x) (not= "human:me" (:by x)))) (:rows (:log r)))
        skew (count (filter (fn [x]
                              (let [s (step-of (:why x)) lb (label r (:by x))
                                    exp (get (if (= lb :A) A-TEXT B-TEXT) s)
                                    got (get (:texts x) (owner-file r (:by x)))]
                                (not= got exp)))
                            rows))
        attrib-bad (count (filter (fn [x] (not= (:files x) [(owner-file r (:by x))])) rows))
        fails (vec (map (fn [x] [(label r (:by x)) (step-of (:why x))]) (filter (fn [x] (= :fail (:gate x))) rows)))
        ;; per-task order must be step 1,2,3…
        order-bad (count (filter (fn [lb] (let [ss (map (fn [x] (step-of (:why x))) (filter (fn [x] (= lb (label r (:by x)))) rows))]
                                           (not= ss (range 1 (inc (count ss))))))
                                 [:A :B]))]
    {:changes (count rows) :skew skew :attrib-bad attrib-bad :gate-fails fails :order-bad order-bad
     :log-count (:head-log (:log r))}))

(defn inversions
  "Commits (seed excluded) whose commit position disagrees with the hook's arrival order (take order)."
  [r]
  (let [as (map :arr (filter (fn [x] (and (:change x) (not= "human:me" (:by x)))) (:rows (:log r))))]
    (count (filter true? (map < (rest as) as)))))

(defn per-task [h lb] (vec (filter (fn [x] (= lb (first x))) h)))

(wrap!)
(def RUNS
  (try
    (vec (for [i (range 5)]
           [(run-once :block) (run-once :async)]))
    (catch err (do (unwrap!) (println "error during runs:" (ex-message err)) []))))
(println "runs:" (count RUNS) " statuses:" (vec (map (fn [[b a]] [(:status b) (:status a)]) RUNS)))

(doseq [[mode idx] [[:block 0] [:async 1]]]
  (let [rs (map (fn [p] (nth p idx)) RUNS)
        costs (mapcat :costs rs)
        costs-w (filter (fn [c] (> c 0)) costs)
        an (map analyse rs)]
    (println (str "\n── " (name mode) " ──"))
    (println "  hook calls:" (count costs) " cost µs p50/p95/max:" (pct costs 0.5) (pct costs 0.95) (apply max costs)
)
    (println "  parts µs p50 (take/view/read/send):" (vec (map (fn [k] (pct (mapcat (fn [r] (get (:parts r) k)) rs) 0.5)) ["take" "view" "read" "send"]))
             " p95:" (vec (map (fn [k] (pct (mapcat (fn [r] (get (:parts r) k)) rs) 0.95)) ["take" "view" "read" "send"])))
    (println "  commit-order vs hook-arrival-order inversions per run:" (vec (map inversions rs)))
    (println "  changes per run:" (vec (map :changes an)) " log-count:" (vec (map :log-count an)))
    (println "  skew:" (vec (map :skew an)) " attrib-bad:" (vec (map :attrib-bad an)) " per-task order-bad:" (vec (map :order-bad an)))
    (println "  gate fails (label step):" (vec (map :gate-fails an)))
    (println "  peak mailbox depth:" (vec (map (fn [r] (:peak (:log r))) rs))
             " commit µs total/run:" (vec (map (fn [r] (:commit-us (:log r))) rs)))))

(println "\n── equality of histories BLOCK vs ASYNC ──")
(doseq [[i [b a]] (map-indexed vector RUNS)]
  (let [nb (norm b) na (norm a)]
    (println (str "  run " i ": full-seq equal=" (= nb na)
                  " per-task seq equal(A,B)=" [(= (per-task nb :A) (per-task na :A)) (= (per-task nb :B) (per-task na :B))]
                  " n=" (count nb) "/" (count na)
                  " order(block)=" (vec (map first nb))
                  " order(async)=" (vec (map first na))))))
(let [[b a] (first RUNS)]
  (println "  sample async history:")
  (doseq [x (norm a)] (println "   " (pr-str (take 3 x)) (pr-str (nth x 3)) (nth x 4))))
```

## 4. Throughput and mailbox depth under burst

60 snapshots (2 paths, 20-line texts, one line edited per step) cast from the main process as fast as it can; then
`flush`. Commit throughput = n / wall time to drain; peak depth is the historian's own `message_queue_len` before each commit.

```beam-lisp
(let [hp (start historian nil {})
      body (fn [i] (clojure.string/join "\n" (map (fn [k] (if (= k (rem i 20)) (str "edit " i) (str "line " k))) (range 20))))
      n 60
      t0 (now-us)
      _ (doseq [i (range n)]
          (cast hp [:snap "bench" (str "step " i) {(if (even? i) "p.py" "q.py") (body i)} :pass i]))
      t1 (now-us)
      _ (call hp [:flush] 120000)
      t2 (now-us)
      lg (call hp [:log])]
  (Process/exit hp :kill)
  (println "burst: casts took" (quot (- t1 t0) 1000) "ms (" (quot (- t1 t0) n) "µs each); drain finished at" (quot (- t2 t0) 1000)
           "ms; commits" (:n lg) "changes in log" (:head-log lg)
           " throughput/s:" (quot (* n 1000000) (- t2 t0))
           " peak depth:" (:peak lg) " mean commit µs:" (quot (:commit-us lg) (:n lg))))
(unwrap!)
(println "prelude restored:" (unwrap!))
```

## Findings

Run: `bin/bl run spikes/async-checkpoint.bl.md` (exit 0, no `error:` lines). 5 runs per variant, 2 concurrent tasks, 25 hook calls per variant.

**OBSERVED**
1. **ASYNC is exact.** skew `[0 0 0 0 0]`, attrib-bad `[0 0 0 0 0]`, per-task order-bad `[0 0 0 0 0]`, 5 changes + seed per run in both variants; commit-order vs hook-arrival-order inversions `[0 0 0 0 0]` (the cast mailbox preserved the order in which hooks took their snapshot; nothing reordered across A and B).
2. **ASYNC is cheap, p50 near the 5 ms line.** Across 3 executions of the final file: ASYNC p50 3.6 / 3.8 / 5.1 ms, BLOCK p50 69 / 127 / 114 ms. (Last execution: BLOCK `114180 / 256843 / 270980` µs, ASYNC `5106 / 36249 / 38551`.) Task-side hook cost (µs) p50/p95/max: BLOCK `127478 / 562469 / 699644`, ASYNC `3781 / 7238 / 12737`. ASYNC p50 is under 5 ms; p95 is 7.2 ms and max 12.7 ms, so the "< 5 ms" holds for the median, not the tail. Parts p50 (take/view/read/send): ASYNC `257 / 3115 / 164 / 35` µs; BLOCK send alone is `121430` µs (the commit). The 3 ms "view" is `task/view` (a datom read, used only to build the `why` string), not the snapshot: take + read + cast is ~0.5 ms. (Costs vary 2x run to run on this machine: an earlier run had BLOCK p50 69 ms/92 ms, ASYNC p50 3.6/4.7 ms.)
3. **History identical modulo the race in 4.** Per-task sequences of (by, why, files, texts, gate) equal BLOCK vs ASYNC in 5/5 runs in every execution; the full interleaved sequence was equal 5/5 in one execution and 2/5 in the last (differences only A/B interleaving order). Per-task sequences equal. Gate verdicts identical: exactly `[:A 2]` (the BROKEN step) fails, in every run, per-path gate (b.py's changes pass while a.py is BROKEN).
4. The cross-task commit order is the *hook arrival* order, which is a race between two scripted tasks. In two earlier runs of this same spike the order flipped between `[A B A B A]` and `[A B B A A]` in BLOCK and in ASYNC alike (OBSERVED in the last execution: BLOCK `[B A B A A]`/`[A B B A A]` vs ASYNC `[A B A B A]`). So "equal across variants" is equal modulo that scheduling race; per-task order never flipped, and commit order == arrival order always (point 1).
5. Historian: peak mailbox depth during the scripted runs 1-2 (`[1 2 2 2 1]`); BLOCK 0 by construction. Burst benchmark (60 casts as fast as possible, 2 paths, 20-line texts): 184-690 µs per cast on the sender, drain 1.7-2.2 s, **throughput 27-36 commits/s** across executions (mean commit 27-38 ms), **peak depth 59** (unbounded, linear in burst). A real step is ~model-call latency (seconds) so the historian keeps up with ~100x margin; a burst of N pending steps waits N x ~30 ms.
6. Attribution by writer worked: a `[:w task path]` cast from the cell process to a `wbuf` server, `[:take task]` from the hook (cells are other processes, so a process dictionary can't carry it; I chose a server over ETS: no table-owner lifetime, ordered). The hook's snapshot is exactly the files the step wrote, so a path another task wrote at the same time is never carried (attrib-bad 0 with both tasks live).

**Surprises / blockers (OBSERVED)**
- A wrapper that calls the *saved original* `omega.prelude/write` inside the redefined `write` hangs (the saved value resolves back to the redefinition; the first draft deadlocked). The wrapper must re-implement the bodies (copied from prelude.bl, as file-port did), and drifts if prelude changes. In E22 the recording belongs in `write`/`edit` themselves (they already call `tr/claim!`; the claim IS the record), with no wrapper.
- The `historian` `defserver` had to be started and seeded before `env/open` in the run function; starting a second server after `env/open` in my first draft timed out (not diagnosed; ordering workaround kept).
- `(call srv msg timeout)` accepts a timeout arg (used 60 s / 120 s).
- Unrestored prelude `write` fails outside a task env with "transaction rejected by schema" (my probe misuse); `unwrap!` returns `:restored`.

**INFERRED**
- With the hook doing only snapshot+cast, nothing but the paths' texts is held per pending step, so memory is bounded by pending steps x written-file size; unbounded queue under a stuck historian needs a depth watermark (the gate could degrade to blocking when depth > N).
- Gate verdict is computed in the hook from the snapshot; a gate that must see the whole tree (tests) cannot be this cheap: it stays in the historian, and then a failing gate arrives after the task moved on (a `:finding` trace, not a block).

**Recommendation for E22:** hook = snapshot the step's written paths (claims/record) + `cast` to one historian server; keep the blocking variant only as a `:sync` option for gates that must stop the task. Add a pending-depth bound and `[:flush]` (used here) for tests and shutdown. Use the claim records (not a prelude wrapper) as the "what did this step write" source, and drop `task/view` from the hook (use the task's goal cached once).
