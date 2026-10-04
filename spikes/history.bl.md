# Spike: beam-lisp native history (what autovcs becomes)

> **Spike, 2026-10-03, PLAN-003.** Runnable: `bin/bl run spikes/history.bl.md` (omega's pinned
> beam-lisp). Question: *can history be beam-lisp native, built from first principles, with no jj
> anywhere, and is it fast enough to checkpoint every agent step?* The user's direction: the autovcs
> redesign starts almost from scratch, so this spike does not port autovcs; it asks what history must
> be for omega and builds exactly that. Findings at the end.

## The model in one paragraph

- **Objects.** An object is content-addressed bytes in datom's blob store (`:db.type/file`, keyed by
  sha256). A file version is ONE object `{:text :origins}`: its text, and for every line the change
  that wrote it. **Blame is written at checkpoint time, not computed by walking history.**
- **Changes.** A change is an immutable fact: parents (two for a merge), the paths it touched, a
  *delta* `{path object|nil}` against its first parent, who/why/when, the gate verdict, conflicts and
  renames. Every 32 first-parent steps a change also stores a *keyframe*, the full manifest
  `{path object}`, so rebuilding any tree costs at most 32 small reads.
- **Refs.** A ref is a name for a head, and every move is an **append-only** fact; the live heads sit
  in memory and are recovered on open.
- **Undo** (`revert!`) is a three-way merge that appends a new change. Lines it restores get their
  original origins back, so blame survives an undo. Nothing is ever rewritten.

```beam-lisp
(ns omega.spike.history (:require [datom] [datom.store-fjall]))

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
```

```beam-lisp
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

(defn- memo
  "Per-process memo in the process dictionary: O(1) reads, no copy. (A beam-lisp
   atom's deref copies its whole value out of a NIF cell: O(size) per read.)"
  [k f]
  (let [v (erlang/get k)]
    (if (= v :undefined) (let [x (f)] (erlang/put k x) x) v)))

(defn- hex [b] (String/downcase (binary/encode_hex (crypto/hash :sha256 b))))

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

(defn- entry-obj [db k] (memo [:obj k] (fn [] (obj-term db k))))
(defn- entry-text [db e] (when e (:text (entry-obj db e))))
(defn- entry-origins [db e] (if e (:origins (entry-obj db e)) []))

(defn text-at [h id path] (entry-text (datom/db (:conn h)) (get (manifest h id) path)))
(defn tree-at [h id] (let [db (datom/db (:conn h))] (into {} (map (fn [[p e]] [p (entry-text db e)]) (manifest h id)))))

(defn checkpoint!
  "Record `changed` ({path text|nil}) on top of `ref`'s head.
   opts: :by :why :gate, :parent2 (merges), :origins {path [origin|:new]} (merges/reverts).
   → change id, or nil when nothing changed (and it is not a merge)."
  [h ref {:keys [changed by why gate parent2 origins at]}]
  (let [db (datom/db (:conn h))
        p1 (head h ref)
        base (manifest h p1)
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
            depth (if p1 (inc (or (:change/depth (change db p1)) 0)) 0)
            key? (or (nil? p1) (>= depth KEYFRAME))
            [mk mtx] (when key? (obj-tx (erlang/term_to_binary new-m)))]
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
        (erlang/put [:manifest id] new-m)
        id))))

(defn branch! [h name from]
  (datom/transact! (:conn h) [(move-tx h name (head h from))])
  name)
```

```beam-lisp
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

;; ── merging and reverting ─────────────────────────────────────────────────

(defn merge-base [h a b]
  (let [as (set (ancestors h a))] (first (filter (fn [x] (contains? as x)) (ancestors h b)))))

(defn- three-way
  "Merge one path. → {:text :origins :conflict?} (origins may hold :new)."
  [db eo ea eb]
  (let [[so sa sb] (map (fn [e] (entry-text db e)) [eo ea eb])
        [so sa sb] [(when eo so) (when ea sa) (when eb sb)]]
    (cond
      (= sa sb) nil
      (= so sb) nil
      (= so sa) {:text (entry-text db eb) :origins (when eb (entry-origins db eb))}
      (or (nil? ea) (nil? eb)) {:text (entry-text db (or ea eb)) :origins (entry-origins db (or ea eb)) :conflict? true}
      :else (let [la (lines (entry-text db ea)) lb (lines (entry-text db eb))
                  r (merge3 (lines (entry-text db eo)) la lb)
                  ra (carry la (entry-origins db ea) (:lines r))
                  rb (carry lb (entry-origins db eb) (:lines r))]
              {:text (unlines (:lines r))
               :origins (vec (map (fn [x y] (if (= x :new) y x)) ra rb))
               :conflict? (pos? (:conflicts r))}))))

(defn merge!
  "Merge `from` into `into`. → {:change id :conflicts [paths] :fast-forward? bool}.
   Conflicted files are committed with markers and listed on the change."
  [h into from {:keys [by why]}]
  (let [a (head h into) b (head h from) o (merge-base h a b)]
    (cond
      (= o b) {:change a :conflicts []}
      (= o a) (do (datom/transact! (:conn h) [(move-tx h into b)])
                  {:change b :conflicts [] :fast-forward? true})
      :else
      (let [db (datom/db (:conn h))
            [mo ma mb] (map (fn [x] (manifest h x)) [o a b])
            res (into {} (keep (fn [p] (when-let [r (three-way db (get mo p) (get ma p) (get mb p))] [p r]))
                               (distinct (concat (keys ma) (keys mb)))))
            conflicts (vec (sort (keep (fn [[p r]] (when (:conflict? r) p)) res)))
            id (checkpoint! h into {:changed (into {} (map (fn [[p r]] [p (:text r)]) res))
                                    :origins (into {} (keep (fn [[p r]] (when (:text r) [p (:origins r)])) res))
                                    :parent2 b :by by :why why})]
        (when (seq conflicts)
          (datom/transact! (:conn h) [{:db/id -1 :change/id id :change/conflicts conflicts}])
          (erlang/erase [:change id]))
        {:change id :conflicts conflicts}))))

(defn revert!
  "Undo change `id` on top of `ref` as a NEW change: a three-way merge per touched path
   (base = id's text, ours = head, theirs = id's parent). Restored lines get their
   original origins back. Refused as data when any path conflicts."
  [h ref id {:keys [by why]}]
  (let [db (datom/db (:conn h)) c (change db id)
        mo (manifest h id) ma (manifest h (head h ref)) mb (manifest h (:change/parent1 c))
        res (into {} (keep (fn [p] (when-let [r (three-way db (get mo p) (get ma p) (get mb p))] [p r]))
                           (:change/touched c)))
        conflicts (vec (sort (keep (fn [[p r]] (when (:conflict? r) p)) res)))]
    (cond
      (seq conflicts) {:conflict conflicts}
      (empty? res) {:noop "already undone: every touched path matches its pre-change text"}
      :else
      (let [id (checkpoint! h ref {:changed (into {} (map (fn [[p r]] [p (:text r)]) res))
                                   :origins (into {} (keep (fn [[p r]] (when (:text r) [p (:origins r)])) res))
                                   :by by :why why})]
        (if id {:change id} {:noop "already undone: the text is what it was before the change"})))))
```

```beam-lisp
;; ── behaviour ─────────────────────────────────────────────────────────────

(def h (open))
(def t0 1000)
(def c1 (checkpoint! h "main" {:changed {"reader.py" "def read_number(s):\n    return int(s)\n\ndef other():\n    pass\n"} :by "human:me" :why "initial" :at t0}))
(branch! h "t-41" "main")
(branch! h "t-43" "main")
(def a1 (checkpoint! h "t-41" {:changed {"reader.py" "def read_number(s):\n    return int(s, 0)\n\ndef other():\n    pass\n"} :by "t-41" :why "hex · step 1" :at 1001}))
(def b1 (checkpoint! h "t-43" {:changed {"reader.py" "def read_number(s):\n    return int(s)\n\ndef other():\n    return 0\n"} :by "t-43" :why "other · step 1" :at 1002}))
(println "merge t-41 → main :" (merge! h "main" "t-41" {:by "omega" :why "merge t-41"}))
(def m2 (merge! h "main" "t-43" {:by "omega" :why "merge t-43"}))
(println "merge t-43 → main :" m2)
(println "merged text       :" (pr-str (text-at h (head h "main") "reader.py")))
(println "blame             :" (map (fn [[l o]] [l (:change/why (datom/entity (datom/db (:conn h)) [:change/id o]))]) (blame h (head h "main") "reader.py")))

;; a real conflict: both rewrite the same line
(branch! h "t-50" "main")
(checkpoint! h "main" {:changed {"reader.py" "def read_number(s):\n    return int(s, 16)\n\ndef other():\n    return 0\n"} :by "human:me" :why "base 16" :at 1003})
(checkpoint! h "t-50" {:changed {"reader.py" "def read_number(s):\n    return float(s)\n\ndef other():\n    return 0\n"} :by "t-50" :why "floats" :at 1004})
(def m3 (merge! h "main" "t-50" {:by "omega" :why "merge t-50"}))
(println "conflict merge    :" m3)
(println (text-at h (:change m3) "reader.py"))

;; resolve, then revert t-43's change line-precisely on top of later work
(checkpoint! h "main" {:changed {"reader.py" "def read_number(s):\n    return int(s, 16)\n\ndef other():\n    return 0\n"} :by "human:me" :why "resolve: keep base 16" :at 1005})
(println "revert t-43 step  :" (revert! h "main" b1 {:by "human:me" :why "undo other"}))
(println "after revert      :" (pr-str (text-at h (head h "main") "reader.py")))
(def why-of (fn [id] (:change/why (datom/entity (datom/db (:conn h)) [:change/id id]))))
(println "blame after       :" (map (fn [[l o]] [l (why-of o)]) (blame h (head h "main") "reader.py")))
(println "revert again      :" (revert! h "main" b1 {:by "human:me" :why "again"}))

;; exact rename: history and blame follow the file
(checkpoint! h "main" {:changed {"reader.py" nil "src/reader.py" (text-at h (head h "main") "reader.py")} :by "human:me" :why "move" :at 1006})
(println "renamed blame     :" (map (fn [[_ o]] (why-of o)) (blame h (head h "main") "src/reader.py")))
(println "log src/reader.py :" (map :why (log h "main" {:path "src/reader.py"})))
(println "log by t-41       :" (map :why (log h "main" {:by "t-41"})))
```

```beam-lisp
;; ── cost, on a DURABLE store (fjall): 201 files, a 400-line file edited 300 times by 3 actors
(def dir (str "/tmp/omega-hist-bench-" (erlang/unique_integer (to-list [:positive]))))
(def hb (open (datom/connect-with (datom.store-fjall/open dir) SCHEMA)))
(def base-lines (vec (map (fn [i] (str "line " i " " (apply str (repeat 40 "x")))) (range 400))))
(def others (into {} (map (fn [i] [(str "pkg/f" i ".py") (str "# file " i "\n")]) (range 200))))
(checkpoint! hb "main" {:changed (assoc others "big.py" (unlines base-lines)) :by "human:me" :why "import" :at 1})
(defn ms [f] (let [t0 (erlang/monotonic_time :microsecond) r (f)] [(/ (- (erlang/monotonic_time :microsecond) t0) 1000.0) r]))
(defn pct [xs p] (nth (vec (sort xs)) (min (dec (count xs)) (int (* p (count xs))))))
(defn means [xs] (map (fn [ch] (/ (Float/round (* 10.0 (/ (reduce + ch) (count ch)))) 10.0)) (partition 50 xs)))
(def times
  (loop [i 0 ls base-lines acc []]
    (if (= i 300) acc
      (let [k (mod (* i 37) 400)
            ls (assoc ls k (str "line " k " edited at step " i))
            [t _] (ms (fn [] (checkpoint! hb "main" {:changed {"big.py" (unlines ls)} :by (str "t-" (mod i 3)) :why (str "step " i) :at (+ 2 i)})))]
        (recur (inc i) ls (conj acc t))))))
(println "checkpoint ms p50/p95/max   :" (pct times 0.5) (pct times 0.95) (apply max times))
(println "mean ms per 50-step bucket  :" (means times))
(def tip (head hb "main"))
(doseq [k (erlang/get_keys)] (when (and (vector? k) (= :manifest (first k))) (erlang/erase k)))
(println "cold manifest (201 files) ms:" (first (ms (fn [] (manifest hb tip)))))
(println "blame 400 lines ms          :" (first (ms (fn [] (count (blame hb tip "big.py"))))))
(println "log by t-1 (100 hits) ms    :" (first (ms (fn [] (count (log hb "main" {:by "t-1"}))))))
(println "distinct origins in big.py  :" (count (distinct (map second (blame hb tip "big.py")))))
(def hb2 (open (:conn hb)))
(println "reopen: heads recovered     :" (= (head hb2 "main") tip))
```

## Findings

OBSERVED (this file, then `/tmp/h/*.bl.md` probes for the datom numbers; pin `2360b32e`, this laptop):

```text
merge t-41 → main : {:conflicts [], :change "…", :fast-forward? true}
merge t-43 → main : {:conflicts [], :change "…"}
blame             : (["def read_number(s):" "initial"] ["    return int(s, 0)" "hex · step 1"] … ["    return 0" "other · step 1"] …)
conflict merge    : {:conflicts ["reader.py"], :change "…"}         (markers committed, path listed on the change)
revert t-43 step  : {:change "…"}
blame after       : (… ["    return int(s, 16)" "base 16"] … ["    pass" "initial"] …)   ← the restored line is blamed on its ORIGINAL change
revert again      : {:noop "already undone: …"}
renamed blame     : ("initial" "base 16" …)                         ← blame survives an exact rename
log src/reader.py : ("move" "resolve: keep base 16" "floats" "base 16" "other · step 1" "hex · step 1" "initial")
checkpoint ms p50/p95/max   : 53 196 270        (durable fjall, 201 files, 400-line file)
mean ms per 50-step bucket  : (72 52 69 74 83 84);  1200 steps, per 200: (77 61 79 71 87 80)  ← flat
cold manifest (201 files) ms: 1.9      blame 400 lines ms: 1.8      log by actor (100 hits): 46 ms
reopen: heads recovered     : true
```

**1. Native history works, and needs no jj.** Every operation omega asks for is here, in ~300
lines of Beam Lisp over datom:
- a checkpoint per step;
- the log by actor and by path, following renames;
- diff;
- line blame;
- branches;
- a three-way merge that commits conflicts as data;
- undo by merge, with blame preserved.

The five-verb protocol of bl-ed.bl.md §5.10 is a subset of this.

**2. Blame at write time is the design decision that pays.** Each file version carries its line
origins, and `carry` maps old origins through the diff. So blame is one object read (1.8 ms for 400
lines), never a history walk, and it composes:
- merges take origins from whichever side kept the line;
- reverts restore the original origins;
- renames keep them.

git and jj compute blame by walking history; we never have to.

**3. Cost: ~55 ms p50 per step on the durable store, flat over 1200 steps.** That is ~3–5× faster
than the autovcs checkpoint measured with jj (1.4–1.8 s, mostly the mirror), and cheap enough for E6's
"one change per step". The p95 (~200 ms) comes from the fjall transaction tail.
- OBSERVED: an empty fjall transaction alone is ~19 ms p50 / 86 ms p95.
- So the floor is datom's write path, not this design.

**4. Two beam-lisp/datom performance traps found. Both hit any long-lived omega state, not just
history.**
- **A datom entity gets slower with every update.** OBSERVED (`/tmp/h/hot.bl.md`): one entity updated
  N times takes O(N) to read and to write.
  - 100 updates: lookup 9 ms, tx 46 ms. 400: 51 / 130 ms. 1600: 161 / 514 ms.
  - Same in the memory and fjall stores, and on beam-lisp main `766fcb93`. `lookup-ref` stays O(1);
    `entity` and `transact!` degrade.
  - The first version of this spike kept refs as one entity per name and got slower every step
    (225 → 300+ ms by step 300).
  - **Design rule: append-only facts for anything that moves (refs, heads, cursors, task status?),
    never one hot entity.**
  - **omega's own `:task/status` and `:task/cost` are updated in place on every turn** (loop.bl
    transacts `:task/cost` per step), so long tasks will degrade the same way. Needs a beam-lisp bug,
    and an omega check.
- **A beam-lisp `atom` deref copies the whole value.** OBSERVED (`/tmp/h/atom2.bl.md`), 100 reads of
  `(get @a 5)`:
  - 10 entries: 0.9 ms; 1000: 27 ms; 10000: 109 ms.
  - The process dictionary: 0.3 ms flat.
  - The cell lives in a NIF (`BeamLisp.LazyMemo`); every read copies the term out.
  - **Design rule: caches and large state live in a process (process dictionary or GenServer
    state), never in an atom.** omega's `prelude/SYSTEMS` is an atom read on every eval; it is small
    today.

**5. A store has one owner process.** The memos live in the process dictionary, so the history store
belongs to ONE process (a "historian"), and everyone else calls it. That matches omega's world shape
(§8.2: one owner of the store). It is also what makes the memo safe: a change is immutable, so its
manifest and objects can be cached forever.

**6. What this spike did NOT do** (each is a known next step, none looks hard):
- **Git export/import.** git stays the exchange format at the human-decision tier, per §5.10.6.
- **Binary files.** The blob tier handles bytes; line origins don't apply, so a binary version is
  `{:bytes}` with no origins.
- **Fuzzy renames.** Only exact renames are detected.
- **Merge-base on criss-cross histories.** It picks the first common ancestor found breadth-first,
  which is fine for omega's "task branch merges into main" shape.
- **The `log` cost on long histories.** It is a full ancestor walk (46 ms for 300 changes); an
  attribute index on `:change/by` and `:change/touched` makes it a query.
- **Line diff performance on very large files.** The LCS is O(n·m) on the changed middle only,
  after trimming the common prefix and suffix.

**7. What it teaches the autovcs redesign** (refines bl-ed.bl.md §5.10):
- Start here, not from jj.
- Keep the change as the unit of meaning: who, why, gate and conflicts are written WITH it.
- Keep blame in the object.
- Keep refs append-only.
- Give the store one owner process.
- Treat jj and git as import/export backends, not the source of truth.
