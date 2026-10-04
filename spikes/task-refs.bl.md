# spike: per-task history refs, per-path gate, merge at task end

> Run: `bin/bl run spikes/task-refs.bl.md`

**Question.** spikes/step-checkpoint.bl.md showed that on ONE shared `main`, once task A
records a failing change, task B's next change is also gated `:fail`: blame lands on the
wrong task. Does giving each task its OWN history ref, checkpointed per step by a
`:tool/after` hook (per-path attribution via claims, per-path gate), merged into `main`
when the task ends, fix gate attribution while keeping ONE shared working directory?

Nothing outside this file is touched. §1 is the native history store of
spikes/history.bl.md, copied verbatim (ns renamed).

## 1. The store (copied from spikes/history.bl.md)

```beam-lisp
(ns omega.spike.task-refs.hist (:require [datom] [datom.store-fjall]))

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


## 2. The historian and the hook

One owner process holds the store (memos live in its process dictionary). The hook
runs inline in the task's own process (`:tool/after`) and ships a closure to the
historian. `mode :refs` = per-task refs (branch from `main` on first use, per-path
gate); `mode :main` = the step-checkpoint variant (everything on `main`, gate on
`head ∪ my files`).

```beam-lisp
(ns omega.spike.task-refs
  (:require [omega.env :as env]
            [omega.task :as task]
            [omega.loop :as loop]
            [omega.codemode :as cm]
            [omega.ext :as ext]
            [omega.trace :as tr]
            [omega.spike.task-refs.hist :as hist]))

(defn now-us [] (erlang/monotonic_time :microsecond))

;; claims: omega's default policy REFUSES task B's write to a path A holds (observed in the
;; first version of this spike: B's a.py edit never happened). Open the policy so both
;; tasks may write a.py; claims then act as attribution only, which is what we measure.
(tr/set-claim-policy! (fn [mine theirs] false))

(defn read-tree [root]
  (into {} (map (fn [f] [(Path/relative_to f root) (File/read! f)])
                (filter (fn [f] (File/regular? f)) (Path/wildcard (str root "/**/*"))))))

(defn broken? [t] (clojure.string/includes? (or t "") "BROKEN"))
(defn gate [tree] (if (some (fn [[_ t]] (broken? t)) tree) :fail :pass))

(defn claimed [e id] (set (map :subject (tr/all e {:kind :claim :task id}))))

(defn snap!
  "Checkpoint the files task `id` claimed and changed. → ledger row."
  [h e root mode id why]
  (let [t0 (now-us)
        ref (if (= mode :refs) id "main")
        _ (when (nil? (hist/head h ref)) (hist/branch! h ref "main"))
        tree (read-tree root)
        hd (hist/head h ref)
        c (claimed e id)
        mine (into {} (filter (fn [[p t]] (and (contains? c p) (not= t (hist/text-at h hd p)))) tree))
        g-path (gate mine)
        g-after (gate (merge (hist/tree-at h hd) mine))
        g (if (= mode :refs) g-path g-after)
        foreign (vec (sort (keep (fn [[p t]] (when (and (not (contains? mine p)) (broken? t)) p)) tree)))
        cid (when (seq mine) (hist/checkpoint! h ref {:changed mine :by id :why why :gate g}))
        _ (when (and cid (= g :fail))
            (tr/leave! e id {:kind :finding :subject (str "gate/" cid)
                             :text (str "gate failed after: " why " (change " cid ")")}))]
    {:task id :ref ref :why why :change cid :gate g :g-path g-path :g-after g-after
     :touched (vec (sort (keys mine))) :foreign-broken foreign :us (- (now-us) t0)}))

(defn historian []
  (spawn (fn []
           (let [h (hist/open)]
             (loop []
               (receive [from f]
                 (do (erlang/send from [:hist-reply (try (f h) (catch err {:error (ex-message err)}))])
                     (recur))))))))

(defn hcall [pid f]
  (erlang/send pid [(erlang/self) f])
  (receive [:hist-reply v] v (after 20000 {:error :hist-timeout})))

(defn make-ext [shared mode]
  {:name :history :doc "per-step checkpoint in a :tool/after hook"
   :hooks {:tool/after
           (fn [r ctx]
             (let [t0 (now-us)
                   sys (:sys ctx) id (:task ctx)
                   steps (count (filter (fn [t] (= :assistant (:role t))) (loop/turns sys id)))
                   why (str (:goal (task/view sys id)) " · step " steps)
                   row (hcall (:pid shared) (fn [h] (snap! h (:env sys) (:root sys) mode id why)))]
               (swap! (:rows shared) conj (assoc row :hook-us (- (now-us) t0)))
               r))}})
```

## 3. Two scripted tasks on one working copy

`a.py` is five lines (`l1`…`l5`). Task A rewrites line 1 three times (step 2 writes the
marker `BROKEN`, step 3 fixes it). Task B writes `b.py` (step 1) and then touches `a.py`
line 5 plus records in `b.py` whether *its own* working copy shows A's marker
(`saw=true` = B's own tests would see A's broken file). `:blind` B writes the whole
`a.py` from the seed text with only line 5 changed (it clobbers A's line 1 *on disk*);
`:rmw` B does read-modify-write of the live file (carries whatever A's line 1 is at that moment).

```beam-lisp
(def GOAL-A "edit a.py in three steps")
(def GOAL-B "edit b.py then a.py")
(def SEED-A "l1\nl2\nl3\nl4\nl5\n")
(defn a-text [first-line] (str first-line "\nl2\nl3\nl4\nl5\n"))
(defn wr [p s] (str "(write " (pr-str p) " " (pr-str s) ")"))

(defn mk-scripts [k bmode]
  (let [sl (fn [ms] (str "(Process/sleep " (* k ms) ")"))
        b-a (if (= bmode :blind)
              (wr "a.py" "l1\nl2\nl3\nl4\nB5\n")
              "(write \"a.py\" (clojure.string/replace (read \"a.py\") \"l5\" \"B5\"))")]
    {GOAL-A [(loop/call-tool "eval" {:code (str (wr "a.py" (a-text "A1")) " " (sl 25))})
             (loop/call-tool "eval" {:code (str (wr "a.py" (a-text "BROKEN")) " " (sl 25))})
             (loop/call-tool "eval" {:code (str (wr "a.py" (a-text "A3")) " " (sl 25) " (done \"a done\")")})]
     GOAL-B [(loop/call-tool "eval" {:code (str (wr "b.py" "b = 1\n") " " (sl 35))})
             (loop/call-tool "eval" {:code (str "(let [s (read \"a.py\")] (write \"b.py\" (str \"b = 2 # saw=\" (clojure.string/includes? s \"BROKEN\") \"\\n\")) "
                                                b-a " (done \"b done\"))")})]}))

(defn p50 [xs] (let [v (vec (sort xs))] (if (empty? v) 0 (nth v (quot (count v) 2)))))

(defn run-once
  "mode :refs|:main, bmode :blind|:rmw. Merges refs into main when both tasks are done."
  [mode bmode k]
  (let [root (str "/tmp/omega-task-refs-" (erlang/unique_integer (to-list [:positive])))
        _ (File/mkdir_p! root)
        _ (File/write! (str root "/a.py") SEED-A)
        _ (File/write! (str root "/b.py") "b = 0\n")
        e (env/open)
        pid (historian)
        shared {:pid pid :rows (atom [])}
        sys (ext/install (task/start-system e {:step (loop/by-goal (mk-scripts k bmode)) :tools cm/tools :root root})
                         [(make-ext shared mode)])
        _ (hcall pid (fn [h] (hist/checkpoint! h "main" {:changed (read-tree root) :by "human:me" :why "initial" :at 1})))
        a (task/open! sys {:goal GOAL-A :scope ["a.py"]})
        b (task/open! sys {:goal GOAL-B :scope ["a.py" "b.py"]})
        ra (task/await sys a 20000)
        rb (task/await sys b 20000)
        merges (when (= mode :refs)
                 (hcall pid (fn [h] [(hist/merge! h "main" a {:by "omega" :why "merge A"})
                                     (hist/merge! h "main" b {:by "omega" :why "merge B"})])))
        name-of (fn [id] (cond (= id a) "A" (= id b) "B" :else id))
        out (hcall pid
              (fn [h]
                (let [db (datom/db (:conn h))
                      ref-of (fn [id] (if (= mode :refs) id "main"))
                      fails (fn [id] (count (filter (fn [l] (= :fail (:gate l))) (hist/log h (ref-of id) {:by id}))))
                      hd (hist/head h "main")
                      who (fn [o] (let [en (datom/entity db [:change/id o])] (str (name-of (:change/by en)) ":" (:change/why en))))]
                  {:fails-a (fails a) :fails-b (fails b)
                   :main-log (map (fn [l] [(name-of (:by l)) (:why l) (:gate l)]) (hist/log h "main" {}))
                   :a-main (hist/text-at h hd "a.py") :b-main (hist/text-at h hd "b.py")
                   :blame (map (fn [[l o]] [l (who o)]) (hist/blame h hd "a.py"))
                   :refs-a (when (= mode :refs) (map :why (hist/log h a {})))
                   :refs-b (when (= mode :refs) (map :why (hist/log h b {})))})))]
    (assoc out :rows @(:rows shared) :a a :b b :merges merges :status [(:status ra) (:status rb)]
           :disk-a (File/read! (str root "/a.py")) :disk-b (File/read! (str root "/b.py")) :name-of name-of
           :finding (map :text (tr/all e {:kind :finding})))))
```

## 4. One run, shown in full (`:refs`, blind B)

```beam-lisp
(defn show-run [label r]
  (println (str "\n── " label " ──"))
  (println "  status A,B:" (:status r) " disk a.py:" (pr-str (:disk-a r)) " b.py:" (pr-str (:disk-b r)))
  (println "  hook rows (task step change gate g-path g-after files foreign-broken hook-us):")
  (doseq [x (:rows r)]
    (println "   " ((:name-of r) (:task x)) (:why x) (if (:change x) "change" "noop") (:gate x) (:g-path x) (:g-after x)
             (pr-str (:touched x)) (pr-str (:foreign-broken x)) (:hook-us x)))
  (when (:refs-a r) (println "  ref A:" (:refs-a r)) (println "  ref B:" (:refs-b r)))
  (println "  merges:" (:merges r))
  (println "  main log:" (:main-log r))
  (println "  gate-fail changes by A / B:" (:fails-a r) "/" (:fails-b r))
  (println "  main a.py:" (pr-str (:a-main r)) " b.py:" (pr-str (:b-main r)))
  (println "  blame a.py on main:") (doseq [x (:blame r)] (println "   " x))
  (println "  finding traces:" (:finding r)))

(def first-run (run-once :refs :blind 8))
(show-run "refs / blind B" first-run)
```

## 5. Five runs per variant

```beam-lisp
(defn runs [mode bmode] (vec (map (fn [_] (try (run-once mode bmode 8) (catch err {:error (ex-message err)}))) (range 5))))
(def refs-blind (runs :refs :blind))
(def main-blind (runs :main :blind))
(def refs-rmw   (runs :refs :rmw))
(def main-rmw   (runs :main :rmw))
(defn saw [r] (some (fn [x] (when (and (= (:task x) (:b r)) (= 2 (count (:touched x))) ) (:foreign-broken x))) (:rows r)))
(defn summ [label rs]
  (println (str label ":"))
  (println "  gate-fail changes by B per run:" (map (fn [r] (if (:error r) :threw (:fails-b r))) rs)
           " by A:" (map (fn [r] (if (:error r) :threw (:fails-a r))) rs))
  (println "  conflicts after merges:" (map (fn [r] (if (:error r) :threw (when (:merges r) (map :conflicts (:merges r))))) rs))
  (println "  B's b.py on disk (did B's own working copy show A's BROKEN?):" (map (fn [r] (if (:error r) :threw (clojure.string/trim (:disk-b r)))) rs))
  (println "  B rows with foreign BROKEN in tree:" (map (fn [r] (if (:error r) :threw (count (filter (fn [x] (and (= (:task x) (:b r)) (seq (:foreign-broken x)))) (:rows r))))) rs))
  (println "  hook µs p50 (in-historian / whole hook):"
           (p50 (mapcat (fn [r] (map :us (:rows r))) (remove :error rs)))
           (p50 (mapcat (fn [r] (map :hook-us (:rows r))) (remove :error rs)))))
(doseq [x [["refs/blind" refs-blind] ["main/blind" main-blind] ["refs/rmw" refs-rmw] ["main/rmw" main-rmw]]] (apply summ x))
(println "\nrmw refs run 1 in full:")
(show-run "refs / rmw B" (first refs-rmw))
(println "\nblind refs: main a.py + blame per run:")
(doseq [r refs-blind] (println (pr-str (:a-main r)) (map (fn [[l w]] w) (:blame r))))
```

## Findings

Observed in this file's output (5 runs per variant; 2 tasks; real omega system; hook =
`:tool/after`; historian = one owner process; whole file takes ~2 min). Numbers quoted
are from the last full run; per-run values are listed in the summary lines.

**0. Setup surprise (OBSERVED).** omega's default claim policy refuses a second task's
write to a path another live task holds. My first run had B's `a.py` edit silently fail
(B's `a.py` write never happened), so the "both tasks touch a.py" scenario needs
`(tr/set-claim-policy! (fn [mine theirs] false))`. With a shared working copy and
per-task refs the claim guard must either stay (then tasks cannot co-edit one file) or
become advisory.

**1. Per-task refs + per-path gate fix gate blame for DISJOINT files (OBSERVED).**
```text
refs/blind: gate-fail changes by B per run: (0 0 0 0 0)  by A: (0 0 1 1 1)
main/blind: gate-fail changes by B per run: (0 0 0 0 0)  by A: (1 1 1 1 0)
```
In the disjoint part of the scenario (B's step 1 writes only b.py) B was never failed in
either variant here. The step-checkpoint failure ("B failed for A's file") needed B's
change to be gated against `head ∪ B's files` while `main` held A's BROKEN. In `:main`
mode I reimplemented that gate (`g-after`): B's step 2 rows show gate=:fail only when B's
OWN change carries a broken file. So with *claims attribution* the step-checkpoint
failure mode appeared only in some interleavings (earlier spike: 1 of 3 runs for B); in
5+5 runs of this spike B was failed 0 times in the blind variants. INFERRED: refs
guarantee it structurally (a ref's gate can only see that task's own line plus the fork
point); a per-path gate on `mine` guarantees it too, with or without refs. The refs
change nothing for the gate that a per-path gate does not already do.

**2. What actually breaks is attribution of a SHARED FILE, not the gate (OBSERVED).**
Attribution is per path, not per hunk. When both tasks write `a.py`:
- `refs/blind` runs 1–2 show `by A: 0` fails: B's blind rewrite of a.py landed on disk
  before A's step-2 hook read the file, so A's change recorded B's text (A *claimed*
  a.py) and A's BROKEN step was never recorded at all (lost evidence).
- `refs/rmw` (B read-modify-writes the live file): in every run B's step-2 change is
  `:fail` (`gate-fail changes by B: (1 1 1 1 1)`) because B's read picked up A's
  BROKEN line and B's change carries it: B is honestly failed for a file it wrote, but
  the BROKEN line is A's. Merge result (all 5 runs):
  `merges: [{:conflicts [], :fast-forward? true} {:conflicts ["a.py"] ...}]` and main a.py =
  `"<<<<<<< ours\nA3\n=======\nBROKEN\n>>>>>>> theirs\nl2\nl3\nl4\nB5\n"`, i.e. B's ref
  carried A's stale line, so the 3-way merge conflicts on line 1 even though B never
  meant to edit it. Honest conflict by the algorithm, wrong by intent.
- Per-path claims cannot tell whose hunk is whose when both write one file between two
  hooks. Per-line blame only stays right if each task's file text only differs from the
  fork by that task's edits, which a shared working copy does not give.

**3. Merge-at-end keeps blame per task when edits do not overlap (OBSERVED).**
`refs/blind`, all 5 runs: main a.py `"A3\nl2\nl3\nl4\nB5\n"`, 3-way merge, 0 conflicts, blame
```text
["A3" "A:edit a.py in three steps · step 3"]
["l2" "human:me:initial"] … ["B5" "B:edit b.py then a.py · step 2"]
```
i.e. every line is blamed to the task that wrote it, via the merge's `carry`. Main's log is
`merge B`, A's steps, B's steps (the merge of A is a fast-forward, B's a true merge change).
Caveat: main's history is *interleaved by merge*, and A's FAILED step 2 sits on main
after merge although its content (BROKEN) was later fixed by A's step 3: the gate record
is kept, the file is clean. That is desirable (E18: record, not hide).

**4. Working copy vs history (OBSERVED + INFERRED).** The working copy is one directory;
refs are history only. Observed: `B's b.py on disk: "b = 2 # saw=true"` in all runs: B's
own code, reading the shared directory, saw A's BROKEN marker (`saw=true`) even though
the history ref for B was clean and the B gate passed. So:
- B's *gate* (computed on its own claimed paths) is clean: honest.
- B's *own `sh` tests* (running against the directory) see A's BROKEN file and fail:
  not fixed by history at all. Isolation of what a task *runs* needs per-task
  directories (E17 b) or a gate that runs on a materialised tree of the task's ref
  (not tested here; INFERRED to cost a checkout per step). E17a + refs gives honest
  *records*, not honest *test runs*.

**5. Latency (OBSERVED).** Hook p50 (in-historian / whole hook, µs):
```text
refs/blind 200791 / 286953   main/blind 334959 / 380831
refs/rmw   347681 / 402647   main/rmw   323827 / 381229
```
~0.2–0.35 s in the historian, ~0.3–0.4 s end to end (the whole hook adds `loop/turns`,
`task/view`, hcall and queueing: B's and A's hooks serialise on the one historian). Refs do not change
it measurably (the first checkpoint of a ref adds one `branch!` transaction; noise
between variants exceeds the difference); single hooks went up to 1.6 s when both tasks'
hooks contended on the historian. `loop/turns` makes the step number O(turns).

**Answer.** Per-task refs are NOT what fixes gate attribution; a per-path gate (gate
only the paths this change carries, `g-path`) does, and works on one shared `main`.
Per-task refs do add: (a) a real 3-way merge with line blame when tasks edit different
hunks of one file (OBSERVED, works, 0 conflicts), and (b) conflicts surfaced as data at
the merge instead of silent last-writer-wins on one head (OBSERVED in `refs/rmw`).
Neither fixes hook-time attribution of a file two tasks write concurrently, nor the
test-run contamination of the shared directory.

**Recommendation for W1b** (INFERRED from the above):
1. Gate per path (the files the change carries); drop head-union gating.
2. Keep a single `main` per-step history unless two tasks must co-edit files; if refs are
   wanted, create the ref at `task/open!`, merge at idle/done (the merge call above), and
   treat conflicts as a finding trace + `needs-input`.
3. Attribute a shared file by the writing task, not by claim: have `write`/`edit` (which
   know the task and the exact text they wrote) emit the content to the historian, or
   have the hook diff the file against that task's own last-seen text. Per-path claims
   alone misattribute (finding 2).
4. Keep the claim guard on; a co-edited file with refs should be an explicit choice.
5. If tests must see only the task's own work, plan per-task directories (E17 b) or
   a materialised checkout of the task's ref for gate tests; do not claim honesty of `sh`
   tests under E17a.
6. Not tested: durable store, >2 tasks, merge of a task that is still running, deletes,
   binary files, `sh`-driven writes (no claims).
