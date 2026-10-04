# Spike: convergence of the §5.3 rebase (TP1)

Question: where does position-shifting rebase break for two concurrent actors, and what is the
smallest fix that makes two replicas converge (TP1: `apply(apply(s,a),T(b,a)) = apply(apply(s,b),T(a,b))`)?

```beam-lisp
(ns omega.spike.convergence)

;; ---- §5.3 primitives, VERBATIM (original) -------------------------------------------
(defn pos< [[r1 c1] [r2 c2]] (or (< r1 r2) (and (= r1 r2) (< c1 c2))))

(defn end-of
  "Where text `s` inserted at `p` ends."
  [[r c] s]
  (let [ls (clojure.string/split s "\n" -1)]
    (if (= 1 (count ls)) [r (+ c (count s))] [(+ r (dec (count ls))) (count (last ls))])))

(defn shift
  "Where position `p` lands after op [from to text] replaced [from,to)."
  [p [from to text]]
  (let [[er ec] (end-of from text) [tr tc] to [pr pc] p]
    (cond (pos< p from) p
          (pos< p to) [er ec]
          (= pr tr) [er (+ ec (- pc tc))]
          :else [(+ pr (- er tr)) pc])))

(defn transform
  "Op `b`, written against the text BEFORE `a`, rewritten to apply AFTER `a`."
  [b a]
  (let [[f t s] b] [(shift f a) (shift t a) s]))

(defn apply-op [lines [[r1 c1] [r2 c2] s]]
  (let [pre (subs (nth lines r1) 0 c1)
        post (subs (nth lines r2) c2)
        mid (clojure.string/split (str pre s post) "\n" -1)]
    (vec (concat (subvec lines 0 r1) mid (subvec lines (inc r2))))))
```

## The fix (written against the same shapes)

`transform2 b a b-after?` — `b-after?` is the tiebreak (true ⇒ b's insert goes after a's when both
insert at the same point). Rules, derived from "what must replica 2 do so that replica 1's result is
reproduced" (see Findings for the derivation):

* start of b: `< a.from` stays · pure-insert a at the point: after it (insert-vs-insert: tiebreak) ·
  b pure insert at the `from` of a *non-empty* a: stays before a's text · otherwise inside `[from,to]`
  of a: collapses to `end-of a`.
* end of b: `<= a.from` stays (incl. at an insert point) · in `(from,to]` of a: clips to `a.from`.
* b inside a's range entirely ⇒ collapses to an empty insert at `end-of a`.
* `:swallow` mode: an op wholly inside a non-empty range that the other side deleted/replaced is dropped.

```beam-lisp
(defn pure-ins? [[f t _]] (= f t))

(defn shift-start [p a b-ins? b-after?]
  (let [[from to text] a]
    (cond (pos< p from) p
          (pure-ins? a) (cond (not= p from) (shift p a)
                              b-ins? (if b-after? (end-of from text) p)
                              :else (end-of from text))
          (and (= p from) b-ins?) p
          (not (pos< to p)) (end-of from text)            ; p in [from,to]
          :else (shift p a))))

(defn shift-end [p a]
  (let [[from to text] a]
    (cond (not (pos< from p)) p                            ; p <= from
          (pure-ins? a) (shift p a)
          (not (pos< to p)) from                           ; p in (from,to]
          :else (shift p a))))

(defn within? [b a]    ; b lies inside non-empty a, not equal
  (let [[bf bt _] b [af at _] a]
    (and (not (pure-ins? a)) (not (pos< bf af)) (not (pos< at bt))
         (or (pos< af bf) (pos< bt at)))))

(defn transform2
  ([b a b-after?] (transform2 b a b-after? false))
  ([b a b-after? swallow?]
   (let [[f t s] b
         ins? (pure-ins? b)]
     (if (and swallow? (within? b a))
       [(shift-start f a ins? b-after?) (shift-start f a ins? b-after?) ""]
       (let [f' (shift-start f a ins? b-after?)
             t' (if ins? f' (shift-end t a))
             t'' (if (pos< t' f') f' t')]
         [f' t'' s])))))
```

## Harness: PRNG, generator, grid transform, property

```beam-lisp
;; deterministic LCG in the process dictionary
(defn seed! [n] (erlang/put :rng (mod (+ (* n 2654435761) 12345) 2147483648)) nil)
(defn rnd [n]
  (let [s (mod (+ (* (erlang/get :rng) 1103515245) 12345) 2147483648)]
    (erlang/put :rng s)
    (rem (quot s 65536) n)))

(defn gen-text []
  (let [n (+ 1 (rnd 3))
        cs (vec (for [i (range n)] (nth ["a" "b" "c" "d" "e" "f"] (rnd 6))))
        s (clojure.string/join "" cs)]
    (if (= 0 (rnd 4)) (str s "\n" (nth ["x" "y" "z"] (rnd 3))) s)))

(defn gen-lines []
  (vec (for [i (range (+ 3 (rnd 6)))]
         (clojure.string/join "" (for [j (range (rnd 6))] (nth ["p" "q" "r" "s" "t"] (rnd 5)))))))

(defn gen-pos [lines]
  (let [r (rnd (count lines))] [r (rnd (inc (count (nth lines r))))]))

(defn gen-op [lines actor]
  (let [p1 (gen-pos lines) p2 (gen-pos lines)
        [f t] (if (pos< p2 p1) [p2 p1] [p1 p2])
        txt (str (name actor) (gen-text))
        k (rnd 3)]
    (cond (= k 0) [f f txt]            ; insert
          (= k 1) [f t ""]             ; delete (may be empty)
          :else [f t txt])))           ; replace

(defn gen-ops [lines actor]
  (loop [n (+ 1 (rnd 3)) ls lines ops []]
    (if (= n 0) ops
        (let [op (gen-op ls actor)] (recur (dec n) (apply-op ls op) (conj ops op))))))

(defn apply-all [lines ops]
  (try (reduce apply-op lines ops)
       (catch e :invalid-op)))   ; transformed op addressed a position outside the text

;; generic grid: bs (sequential, based on base) over as (sequential, same base)
;; xf : (fn [op against after?]) ; returns [bs' as']
(defn grid [xf bs as b-first?]
  (loop [bs bs as as out []]
    (if (empty? bs)
      [out as]
      (let [[b' as'] (reduce (fn [[b acc] a]
                               [(xf b a (not b-first?)) (conj acc (xf a b b-first?))])
                             [(first bs) []] as)]
        (recur (rest bs) as' (conj out b'))))))

(defn run-case [xf lines A B]
  ;; A actor id < B actor id ; tiebreak: B's insert goes after A's
  (let [[B' A'] (grid xf B A true)
        r1 (apply-all (apply-all lines A) B')
        r2 (apply-all (apply-all lines B) A')]
    [r1 r2]))

(defn xf-orig [b a _] (transform b a))
(defn xf-fix [b a after?] (transform2 b a after? false))
(defn xf-swallow [b a after?] (transform2 b a after? true))
```

Classification (first matching cross pair of the *raw* ops; for multi-op actors later ops are
sequentially based so this is approximate — INFERRED; the single-op-per-actor subset is exact).

```beam-lisp
(defn kind [[f t s]] (cond (= f t) :ins (= s "") :del :else :rep))
(defn rng-has? [[f t _] p] (and (pos< f p) (pos< p t)))
(defn overlaps-ok? [[f1 t1 _] [f2 t2 _]] (and (pos< f1 t2) (pos< f2 t1)))
(defn classify-pair [a b]
  (let [[af at _] a [bf bt _] b ka (kind a) kb (kind b)]
    (cond (and (= ka :ins) (= kb :ins) (= af bf)) :same-pos-insert
          (and (= ka :ins) (not= kb :ins) (rng-has? b af)) :insert-in-range
          (and (= kb :ins) (not= ka :ins) (rng-has? a bf)) :insert-in-range
          (and (not= ka :ins) (not= kb :ins) (overlaps-ok? a b)) :overlapping-range
          :else nil)))

(defn classify [A B]
  (or (first (filter some? (for [a A b B] (classify-pair a b)))) :other))

(defn size [lines A B] (+ (count A) (count B) (/ (count (clojure.string/join "\n" lines)) 100)))

(defn property [xf n seed0]
  (seed! seed0)
  (loop [i 0 counts {} bad []]
    (if (= i n)
      {:counts counts :bad bad :total (reduce + 0 (vals counts))}
      (let [lines (gen-lines) A (gen-ops lines :A) B (gen-ops lines :B)
            [r1 r2] (run-case xf lines A B)]
        (if (= r1 r2)
          (recur (inc i) counts bad)
          (let [c (classify A B)]
            (recur (inc i) (update counts c (fnil inc 0))
                   (conj bad {:class c :lines lines :A A :B B :r1 r1 :r2 r2}))))))))

(defn single-subset [res] ; violations where both actors have exactly 1 op
  (count (filter (fn [b] (and (= 1 (count (:A b))) (= 1 (count (:B b))))) (:bad res))))

(defn show [label res]
  (println "OBSERVED" label "violations:" (:total res) "of 2000"
           "by class:" (into (sorted-map) (:counts res))
           "| single-op-each violations:" (single-subset res)))

(defn minimal [res k]
  (take k (sort-by (fn [b] (+ (* 10 (+ (count (:A b)) (count (:B b)))) (count (:lines b)))) (:bad res))))

(defn show-ce [label res]
  (doseq [b (minimal res 3)]
    (println "OBSERVED counterexample" label (:class b))
    (println "   base  " (:lines b))
    (println "   A     " (:A b))
    (println "   B     " (:B b))
    (println "   r1 A;B'" (:r1 b))
    (println "   r2 B;A'" (:r2 b))))
```

## Final fix: atomic ops, a transform that may SPLIT, list-vs-list transform

The contiguous-op fixes above (observed below) still diverge: a delete that spans the other side's
insert cannot be one `[from to text]` op (it must delete both sides of the insert and keep the insert),
and a replace overlapping a replace must keep both texts. So: normalise replace to
`delete` + `insert` (atomic ops, still `[from to text]`), and let `t1` return a VECTOR of ops.

```beam-lisp
(defn atomize [[f t s]]
  (cond (and (= f t) (= s "")) []
        (= f t) [[f f s]]
        (= s "") [[f t ""]]
        :else [[f t ""] [f f s]]))
(defn atomize-all [ops] (vec (mapcat atomize ops)))

(defn ins? [[f t s]] (= f t))

;; start moves with `shift`; a delete's END stays put when the other op inserts at it (shift-end)
(defn transform3 [[f t s] a]
  (let [f' (shift f a)
        t' (if (= f t) f' (shift-end t a))]
    [f' (if (pos< t' f') f' t') s]))

;; t1: b, a atomic, same base. Returns [b' a'] (vectors of ops):
;;   b' applies after a, a' applies after b.   b-after? = tiebreak for same-point inserts.
(defn t1 [b a b-after?]
  (let [[bf bt bs] b [af at as] a]
    (cond
      ;; insert / insert
      (and (ins? b) (ins? a))
      (if (= bf af)
        (if b-after?
          (let [p (end-of af as)] [[[p p bs]] [a]])
          (let [p (end-of bf bs)] [[b] [[p p as]]]))
        [[(transform3 b a)] [(transform3 a b)]])
      ;; delete b / insert a strictly inside b: split b around a's text
      (and (ins? a) (pos< bf af) (pos< af bt))
      (let [left [bf af ""]
            right0 [(end-of af as) (shift bt a) ""]
            right (transform right0 left)]
        [[left right] [[bf bf as]]])
      ;; everything else: plain shift is right (insert at/outside delete bounds, delete/delete clip,
      ;; insert b vs delete a handled by the symmetric case below)
      (and (ins? b) (not (ins? a)) (pos< af bf) (pos< bf at))
      (let [[a2 b2] (t1 a b (not b-after?))] [b2 a2])
      :else [[(transform3 b a)] [(transform3 a b)]])))

(declare tl)
(defn tl [bs as after?]
  (cond (or (empty? bs) (empty? as)) [bs as]
        (> (count bs) 1)
        (let [[b1 as1] (tl [(first bs)] as after?)
              [bt as2] (tl (vec (rest bs)) as1 after?)]
          [(vec (concat b1 bt)) as2])
        (> (count as) 1)
        (let [[bl al] (t1 (first bs) (first as) after?)
              [bl2 at2] (tl bl (vec (rest as)) after?)]
          [bl2 (vec (concat al at2))])
        :else (t1 (first bs) (first as) after?)))

(defn xf-atomic-case [lines A B]
  (let [A* (atomize-all A) B* (atomize-all B)
        [B' A'] (tl B* A* true)          ; tiebreak: A's insert goes first, B's after
        r1 (apply-all (apply-all lines A*) B')
        r2 (apply-all (apply-all lines B*) A')]
    [r1 r2]))
```

## Run

```beam-lisp
(def N 2000)
(def res-orig (property xf-orig N 7))
(show "ORIGINAL (verbatim §5.3, no tiebreak)" res-orig)
(show-ce "ORIGINAL" res-orig)

(def res-fix (property xf-fix N 7))
(show "FIX (tiebreak + clip + insert-in-range at deletion point)" res-fix)
(show-ce "FIX" res-fix)

(def res-sw (property xf-swallow N 7))
(show "FIX+SWALLOW (ops wholly inside a removed range are dropped)" res-sw)
(show-ce "FIX+SWALLOW" res-sw)

;; a second seed to check the numbers are not seed luck
(show "FIX seed 99" (property xf-fix N 99))
(show "FIX+SWALLOW seed 99" (property xf-swallow N 99))
```

```

```beam-lisp
(defn property-atomic [n seed0]
  (seed! seed0)
  (loop [i 0 counts {} bad []]
    (if (= i n)
      {:counts counts :bad bad :total (reduce + 0 (vals counts))}
      (let [lines (gen-lines) A (gen-ops lines :A) B (gen-ops lines :B)
            [r1 r2] (xf-atomic-case lines A B)]
        (if (= r1 r2)
          (recur (inc i) counts bad)
          (recur (inc i) (update counts (classify A B) (fnil inc 0))
                 (conj bad {:class (classify A B) :lines lines :A A :B B :r1 r1 :r2 r2})))))))

(def res-at (property-atomic N 7))
(show "ATOMIC (split-capable transform, replace = delete+insert)" res-at)
(show-ce "ATOMIC" res-at)
(show "ATOMIC seed 99" (property-atomic N 99))
(show "ATOMIC seed 12345" (property-atomic N 12345))
```

## Findings

All numbers OBSERVED (2000 random cases/run; base 3–8 lines; 1–3 ops per actor, insert/delete/replace,
~25% multi-line inserts; LCG-seeded; seeds 7 / 99 / 12345). "single-op" = both actors made exactly one op.

| transform | violations (seed 7) | by class | single-op |
|---|---|---|---|
| ORIGINAL §5.3 `transform` (verbatim), no tiebreak | **1259 / 2000** | insert-in-range 455, overlapping-range 577, same-pos-insert 74, other 153 | 72 |
| `transform2` (tiebreak + clip + insert→deletion point) | 843 (seed 99: 845) | 437 / 343 / 23 / 40 | 40 |
| `transform2` + swallow (drop ops wholly inside removed range) | 589 (seed 99: 546) | 122 / 318 / 21 / 128 | 30 |
| **ATOMIC: replace = delete+insert, `t1` may split, `tl` list transform** | **0** (seeds 99, 12345: 0, 0) | – | 0 |

Class labels use raw-op geometry and are approximate for multi-op actors (INFERRED); the totals are exact.
Multi-op sequences contribute most violations, because a sequential op must be transformed over the
*already-transformed* siblings (`tl`) — the original `rebase` folds a single op over the log, which does
that only for one op per client.

### Where §5.3 breaks (OBSERVED counterexamples above)
1. **Same-position inserts** diverge ("AeeBb" vs "BbAee"): no tiebreak ⇒ result depends on arrival order. Not even TP1-deterministic.
2. **Insert inside a range the other side replaced/deleted**: `shift` maps B's *whole* op to one side; the survivor text of one replica is dropped on the other (r1 `Baaeqr` vs r2 `BaaeAbqr`).
3. **Overlapping deletes/replaces**: end positions inside a removed range are mapped to `end-of a`, which re-inserts a's text into b's replaced span (r1 `["AfbcBfr"]` vs r2 `["BfAfbcr"]`).
4. **Delete spanning another's insert / insert at a delete's end** ("other"): one `[from to text]` cannot express "delete both sides of the insert and keep the insert". The end of a delete must NOT shift when the other side inserts exactly at it (`shift` moves it; `shift-end` does not).

### What the minimal fix turned out to need (not "tiebreak + clip" alone)
Tiebreak + clip + deletion-point-landing (`transform2`) cuts violations 33% only. It cannot reach 0
because the op shape is contiguous. The smallest set that reached 0/6000 in this harness:
* **atomic ops**: replace ⇒ `[f t ""]` then `[f f text]`; no-op deletes dropped;
* **`t1` returns a vector of ops** — a delete that strictly spans the other's insert splits into two deletes around it;
* **actor tiebreak** for equal-position inserts (lower actor id first: the later one is shifted by `end-of` of the earlier);
* **delete end uses `shift-end`** (stays at an insert-at-its-end, clips to `from` when inside the other's range), start uses `shift`;
* **list-vs-list transform `tl`** (grid), so a multi-op submission is transformed against the multi-op history.

Final code is in the "Final fix" block (`atomize`, `t1`, `transform3`, `tl`) plus `shift-end` in "The fix".
The server-side changes this implies for §8.4: log entries are lists of atomic ops; `rebase` calls
`tl` against `(filter newer-than-base and other-actor)`; ops carry an actor id for the tiebreak; the
`:op` reply returns a LIST of rebased ops; cursors/`commit` shift over each atom in turn.

### Not verified / limits
* This is **TP1 only** (two actors, one base). The server is a central sequencer, so TP2 is not needed
  for N≥3 actors **only if** every client's ops are transformed over the *log suffix in server order*
  (what `rebase` does). I did NOT test 3 actors or an interleaved log — INFERRED, untested.
* Positions are `[row col]` code-point columns on tiny alphabets; no unicode/CRLF/tab cases.
* The swallow variant (drop ops inside a removed range) was measurably *worse* here because it also
  swallows when the other side's op is an insert at the range edge; abandoned in favour of splitting.
* A rejected attempt: `transform` is not total — the transformed op can address a position past the end
  (the harness catches `subs` out-of-range as `:invalid-op`); the final fix never hit that.

### Intent preservation NOT provided (why FUP-003 / Eg-walker exists)
Convergence ≠ intention. Position transform converges but:
* **Interleaving** of two actors' multi-op typing at one point: with actor-tiebreak A's whole *op* goes before
  B's, but a sequence of per-keystroke inserts by both at the same cursor is transformed op-by-op, so
  A1,B1,A2,B2 character interleavings are possible (INFERRED from the tiebreak rule; not run).
* Delete-vs-insert: an insert inside a concurrently deleted range survives, orphaned (convergent, but
  an agent's replacement of a paragraph leaves a human's mid-paragraph fix as a stray fragment).
* Replace-vs-replace of the same span yields both texts concatenated (A then B), never a conflict.
* No undo/redo of one actor's ops in the presence of others (needs inverse transform/history).

### Verdict
Position-shifting **is enough for v1 (W1) only after** the changes above; §5.3 as written is NOT: it
diverges on 63% of random concurrent pairs, 3.6% even for single-op/single-op same-base cases (72/2000).
Cheap v1 mitigation already in the design — agent edits are exact-match `locate` replacements parked when a
human is attending — keeps real collisions rare, and the fixed `t1/tl` converges, so FUP-003 need NOT move
earlier for convergence. It SHOULD stay scheduled for intent (interleaving, undo, offline/branching
editing). Add this property test (seeded, 2000 cases) to `test/` when implementing §8.4.
