# Spike: buffer-overlay — two layers (published / pending) over the convergent op model

Run: `bin/bl run spikes/buffer-overlay.bl.md`. Question (E24, bl-ed §15.3): a disk publish must write only
PUBLISHED ops; the human's unpublished ops are an overlay agents' reads see but disk does not.
`spikes/file-port.bl.md` observed an agent publish leaking the human's half-typed line.

Model: `pub` (text = disk) · `pend` (ordered atomic ops, always based on `pub`) · `vlog` (every view-changing
event as view-coordinate ops, indexed by rev, so a human op typed against an older view can be rebased).
view = pub ⊕ pend. Primitives below are copied VERBATIM from `spikes/convergence.bl.md`.

```beam-lisp
(ns omega.spike.buffer-overlay)

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

(defn pure-ins? [[f t _]] (= f t))

(defn shift-end [p a]
  (let [[from to text] a]
    (cond (not (pos< from p)) p                            ; p <= from
          (pure-ins? a) (shift p a)
          (not (pos< to p)) from                           ; p in (from,to]
          :else (shift p a))))


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

(defn seed! [n] (erlang/put :rng (mod (+ (* n 2654435761) 12345) 2147483648)) nil)
(defn rnd [n]
  (let [s (mod (+ (* (erlang/get :rng) 1103515245) 12345) 2147483648)]
    (erlang/put :rng s)
    (rem (quot s 65536) n)))

(defn apply-all [lines ops]
  (try (reduce apply-op lines ops) (catch e :invalid-op)))
```

## 1. The two-layer buffer server

State: `pub` (published text = disk), `pend` = `{actor ops}` where **each actor's pending branch is a
sequence of atomic ops based on `pub`** (parallel branches, same base), `ovlog` = per actor, the ops that
landed in `pub` since, expressed in that actor's *own view* (`pub ⊕ own pending`) coordinates. A human client
sends ops in its own-view coordinates with `base` = number of `ovlog` entries it has seen; the server
transforms them over the entries since (`tl`) and appends them to the branch. view = `pub ⊕` all branches,
merged in sorted-actor order with `tl`.

**Agent edit rule (decision):** the exact replacement is *applied to the published text* (so the disk gets
only the agent's change) and every pending branch is transformed over it (`tl`), so view' = pub' ⊕ pend'.
Then a safety check: view' must equal the view with `old`→`new` applied directly at the view's match;
otherwise the edit is refused (`:conflict`). `old` must occur exactly once in the view (what the agent saw)
and exactly once in pub; text that exists only in the overlay → `:overlay` refusal.

**Publish** = the same landing step: the actor's branch is applied to `pub`, the other branches and their
`ovlog` are transformed over it, disk written.

```beam-lisp
(defn apply-all [lines ops]
  (try (reduce apply-op lines ops) (catch e :invalid-op)))
(defn run-ops [lines ops] (reduce apply-op lines ops))
(defn lines-of [t] (clojure.string/split t "\n" -1))
(defn text-of [ls] (clojure.string/join "\n" ls))

(defn off->pos [text off]
  (let [ls (lines-of (subs text 0 off))] [(dec (count ls)) (count (last ls))]))
(defn occ [s sub]
  (loop [i 0 n 0]
    (let [k (clojure.string/index-of s sub i)]
      (if (nil? k) n (recur (+ k 1) (inc n))))))

(defn view-of [pub pend]
  (let [merged (reduce (fn [acc a]
                         (let [[b' _] (tl (get pend a) acc true)] (vec (concat acc b'))))
                       [] (sort (keys pend)))]
    (run-ops pub merged)))

;; ops landing in pub: transform every branch over them; log them in each actor's own-view coords
(defn land [pend ovlog ops ops-after?]
  (reduce (fn [[p o] a]
            (let [[ops' pend'] (tl ops (get pend a) (ops-after? a))]
              [(assoc p a pend') (assoc o a (conj (get ovlog a []) ops'))]))
          [pend ovlog] (keys pend)))

(defn st-view [st] (text-of (view-of (:pub st) (:pend st))))

(defn do-human-op [st actor base ops]
  (let [lg (get (:ovlog st) actor [])]
    (if (> base (count lg))
      [{:error :bad-base :msg (str "base " base " > rev " (count lg))} st]
      (let [flat (vec (apply concat (drop base lg)))
            [ops' _] (tl (atomize-all ops) flat true)
            pend' (assoc (:pend st) actor (vec (concat (get (:pend st) actor []) ops')))
            ovlog' (if (contains? (:ovlog st) actor) (:ovlog st) (assoc (:ovlog st) actor []))
            st' (assoc st :pend pend' :ovlog ovlog')]
        (run-ops (:pub st') (get pend' actor))        ; throws on an invalid rebased op
        [{:ok (count (get ovlog' actor))} st']))))

(defn do-publish [st actor]
  (let [ops (get (:pend st) actor [])
        pub' (run-ops (:pub st) ops)
        [pend' ovlog'] (land (dissoc (:pend st) actor) (:ovlog st) ops (fn [a] (< (compare a actor) 0)))
        st' (assoc st :pub pub' :pend (assoc pend' actor []) :ovlog ovlog')]
    (File/write! (:path st) (text-of pub'))
    [{:ok (count ops)} st']))

(defn do-agent-edit [st actor cell old new]
  (let [pubt (text-of (:pub st)) vt (st-view st)
        nv (occ vt old) np (occ pubt old)]
    (cond
      (= old "") [{:error :empty-old :msg "old is empty"} st]
      (= nv 0) [{:error :not-found :msg "old not found in the current view"} st]
      (> nv 1) [{:error :ambiguous :msg (str "old occurs " nv " times in the view")} st]
      (= np 0) [{:error :overlay :msg "old text exists only in the human's unpublished overlay"} st]
      (> np 1) [{:error :published-ambiguous :msg "old occurs more than once in the published text"} st]
      :else
      (let [pi (clojure.string/index-of pubt old)
            pf (off->pos pubt pi) pt (off->pos pubt (+ pi (count old)))
            ;; replace = insert `new` at the END of old, then delete old: a pending insert at old's start stays
            ;; before the new text, one at old's end lands after it (what a replace on the view would do)
            ops (vec (concat (atomize [pt pt new]) (atomize [pf pt ""])))
            pub' (run-ops (:pub st) ops)
            [pend' ovlog'] (land (:pend st) (:ovlog st) ops (fn [a] false))
            nview (text-of (view-of pub' pend'))
            vi (clojure.string/index-of vt old)
            expected (str (subs vt 0 vi) new (subs vt (+ vi (count old))))]
        (if (= nview expected)
          (do (File/write! (:path st) (text-of pub'))
              [{:ok true} (assoc st :pub pub' :pend pend' :ovlog ovlog')])
          [{:error :conflict :msg "overlay and published text disagree about where old is"} st])))))

(defn guarded [f st]
  (try (f) (catch e [{:error :invalid-op :msg (str e)} st])))

(proc/defserver overlay
  (init [path] (ok {:path path :pub [""] :pend {} :ovlog {}}))
  (handle-call [:reset text] [_from st]
    (File/write! (:path st) text)
    (reply :ok {:path (:path st) :pub (lines-of text) :pend {} :ovlog {}}))
  (handle-call [:human-op actor base ops] [_from st]
    (let [[r st'] (guarded (fn [] (do-human-op st actor base ops)) st)] (reply r st')))
  (handle-call [:publish actor] [_from st]
    (let [[r st'] (guarded (fn [] (do-publish st actor)) st)] (reply r st')))
  (handle-call [:agent-edit actor cell old new] [_from st]
    (let [[r st'] (guarded (fn [] (do-agent-edit st actor cell old new)) st)] (reply r st')))
  (handle-call [:read actor] [_from st] (reply (st-view st) st))
  (handle-call [:own actor] [_from st]
    (reply {:text (text-of (run-ops (:pub st) (get (:pend st) actor [])))
            :rev (count (get (:ovlog st) actor []))} st))
  (handle-call [:disk] [_from st] (reply (text-of (:pub st)) st))
  (handle-call [:state] [_from st]
    (reply {:view (st-view st) :disk (text-of (:pub st)) :pend (:pend st)
            :file (File/read! (:path st))} st)))

(def path (str "/tmp/omega-spike-bo-" (erlang/unique_integer (to-list [:positive])) ".txt"))
(def srv (start overlay path {}))
```

## 2. Scenarios

Base file `alpha one / beta two / gamma three`. Positions are `[line col]`. `show` prints the view, the
disk text, the pending ops, and whether the actual file equals the published text.

```beam-lisp
(def base "alpha one\nbeta two\ngamma three")
(defn show [label]
  (let [s (call srv [:state])]
    (println label)
    (println "   view :" (pr-str (:view s)))
    (println "   disk :" (pr-str (:disk s)) "| file==disk:" (= (:disk s) (:file s)))
    (println "   pend :" (pr-str (:pend s)))))
(defn reset! [] (call srv [:reset base]))

(println "== (a) human types a half line (pending); agent edits another line")
(reset!)
(println "human-op" (call srv [:human-op "human:me" 0 [[[2 11] [2 11] " and a half-typ"]]]))
(show "after human typing:")
(println "agent-edit" (call srv [:agent-edit "agent:1" "c1" "beta two" "beta 2"]))
(show "after agent edit:")
(println "agent read sees the half line:" (clojure.string/includes? (call srv [:read "agent:1"]) "half-typ"))
(println "OBSERVED disk leaks the half line:" (clojure.string/includes? (call srv [:disk]) "half-typ"))

(println "\n== (b) human types NEAR/INSIDE the text the agent then edits")
(println "-- b1: human inserts X at the START of 'two' (a boundary), agent edits 'two' -> '2'")
(reset!)
(call srv [:human-op "human:me" 0 [[[1 5] [1 5] "X"]]])
(println "agent-edit" (call srv [:agent-edit "agent:1" "c1" "two" "2"]))
(show "b1:")
(println "-- b2: human inserts X at the END of 'two'")
(reset!)
(call srv [:human-op "human:me" 0 [[[1 8] [1 8] "X"]]])
(println "agent-edit" (call srv [:agent-edit "agent:1" "c1" "two" "2"]))
(show "b2:")
(println "-- b3: human inserts X INSIDE 'two' (tXwo): agent's old no longer matches the view")
(reset!)
(call srv [:human-op "human:me" 0 [[[1 6] [1 6] "X"]]])
(println "agent-edit" (call srv [:agent-edit "agent:1" "c1" "two" "2"]))
(println "retry with the fresh view token:" (call srv [:agent-edit "agent:1" "c1" "tXwo" "2"]))
(show "b3:")
(println "-- b4: human deletes the whole 'two' (pending) and retypes 'two' on line 0: view has ONE 'two', pub's copy is elsewhere")
(reset!)
(call srv [:human-op "human:me" 0 [[[1 5] [1 8] ""] [[0 9] [0 9] " two"]]])
(show "b4 before:")
(println "agent-edit" (call srv [:agent-edit "agent:1" "c1" "two" "2"]))
(show "b4 after:")
(println "-- b5: human replaces 'alpha' with 'ALPHA' (pending); agent edits 'one' on the same line")
(reset!)
(call srv [:human-op "human:me" 0 [[[0 0] [0 5] "ALPHA"]]])
(println "agent-edit" (call srv [:agent-edit "agent:1" "c1" "one" "1"]))
(show "b5:")

(println "\n== (c) human publishes after agent edits -> disk == view")
(reset!)
(call srv [:human-op "human:me" 0 [[[2 11] [2 11] "!!"]]])
(call srv [:agent-edit "agent:1" "c1" "beta two" "beta 2"])
(call srv [:agent-edit "agent:1" "c1" "alpha" "ALPHA"])
(show "before publish:")
(println "publish" (call srv [:publish "human:me"]))
(show "after publish:")
(println "OBSERVED disk == view:" (= (call srv [:disk]) (call srv [:read "x"])))
(println "stale human op after the agent edits (base 0 though 2 landed), types at end of 'beta 2':")
(println (call srv [:human-op "human:me" 0 [[[1 8] [1 8] "?"]]]))
(show "stale-base op:")

(println "\n== (d) agent's old matches only text in the human's pending overlay")
(reset!)
(call srv [:human-op "human:me" 0 [[[2 11] [2 11] "\ndelta four"]]])
(println "agent-edit" (call srv [:agent-edit "agent:1" "c1" "delta four" "DELTA 4"]))
(show "d after refusal:")

(println "\n== (e) two humans: only the publisher's text reaches disk")
(reset!)
(call srv [:human-op "human:a" 0 [[[0 0] [0 0] "A>"]]])
(call srv [:human-op "human:b" 0 [[[2 11] [2 11] "<B"]]])
(show "e both pending:")
(println "publish a" (call srv [:publish "human:a"]))
(show "e after a publishes:")
(println "agent view == human b's own view + a's text?" (call srv [:own "human:b"]))
```

## 3. Property test

Events (12 per case): human op (45%; the client sometimes works from a stale snapshot, so the server rebases),
agent edit (35%; `old` is a view token, a disk token, or a token containing a human marker), publish (20%).
Every human insert/replace carries a unique marker `{hN}`; agent edits carry `{aN}`.
Invariants checked after EVERY event: (I1) no still-unpublished human marker is in the disk text; (I2) the
actual file equals the server's published text; (I3, 1 human) the human's own view equals the agent view;
(I4, 1 human) publish does not change the view; (I5) an accepted agent edit's marker is on disk at once.
At the end: every human publishes, then disk == view == file. Then the event list is replayed on a reset
server: replies and final texts must be identical (determinism).

```beam-lisp
(defn tokens [text]
  (vec (filter seq (mapcat (fn [l] (clojure.string/split l " " -1)) (lines-of text)))))
(defn gen-base []
  (clojure.string/join "\n" (for [i (range 5)] (clojure.string/join " " (for [j (range 4)] (str "w" i j))))))
(defn gen-pos [lines]
  (let [r (rnd (count lines))] [r (rnd (inc (count (nth lines r))))]))
(def ctr (atom 0))
(defn marker [kind] (str "{" kind (swap! ctr inc) "}"))

;; -> [ops local-text' markers]  ops sequential in local coords
(defn gen-human-ops [text]
  (loop [n (+ 1 (rnd 2)) ls (lines-of text) ops [] ms []]
    (if (= n 0)
      [ops (text-of ls) ms]
      (let [p1 (gen-pos ls) p2 (gen-pos ls)
            [f t] (if (pos< p2 p1) [p2 p1] [p1 p2])
            f (if (= 0 (rnd 2)) f p1)
            [f t] (if (= 0 (rnd 3)) [f f] [f (if (> (rnd 3) 0) t f)])
            k (rnd 3)
            m (marker "h")
            txt (if (= 0 (rnd 5)) (str m "\n" m) m)
            op (cond (= k 0) [f f txt] (= k 1) [f t ""] :else [f t txt])
            mk (if (= k 1) [] [m])]
        (recur (dec n) (apply-op ls op) (conj ops op) (concat ms mk))))))

(defn gen-agent-edit [vt dt]
  (let [k (rnd 10)
        vtoks (let [x (tokens vt)] (if (seq x) x ["zz"])) dtoks (let [x (tokens dt)] (if (seq x) x ["zz"]))
        mk (filter (fn [t] (clojure.string/includes? t "{h")) vtoks)
        old (cond (< k 5) (nth vtoks (rnd (count vtoks)))
                  (< k 7) (nth dtoks (rnd (count dtoks)))
                  (and (< k 9) (seq mk)) (nth (vec mk) (rnd (count mk)))
                  :else (let [i (rnd (count vtoks))]
                          (if (< (inc i) (count vtoks)) (str (nth vtoks i) " " (nth vtoks (inc i))) (nth vtoks i))))]
    [old (marker "a")]))

(defn has? [s m] (clojure.string/includes? s m))

(defn run-case [humans]
  (let [base (gen-base)]
    (call srv [:reset base])
    (loop [i 0 clients {} unpub {} events [] replies [] viol []]
      (if (= i 12)
        ;; final: everybody publishes
        (let [ps (vec (for [h humans] (call srv [:publish h])))
              st (call srv [:state])
              viol (if (and (= (:disk st) (:view st)) (= (:disk st) (:file st))) viol (conj viol :final-disk-neq-view))]
          {:base base :events events :replies replies :viol viol :view (:view st) :disk (:disk st)})
        (let [r (rnd 100)]
          (cond
            (< r 45)
            (let [h (nth humans (rnd (count humans)))
                  prev (get clients h)
                  ;; the client types against `prev`, its snapshot taken right after its previous send (stale if
                  ;; publishes / agent edits / other humans' ops landed since), or re-reads (1 in 3). A snapshot
                  ;; is used for ONE send: a second send in the same old coordinates needs a per-op base
                  ;; (Jupiter-style), see Findings.
                  c (if (or (nil? prev) (= 0 (rnd 3))) (call srv [:own h]) prev)
                  [ops txt' ms] (gen-human-ops (:text c))
                  rep (call srv [:human-op h (:rev c) ops])
                  unpub' (reduce (fn [u m] (assoc u m h)) unpub ms)
                  disk (call srv [:disk])
                  v (concat viol (for [[m a] unpub' :when (has? disk m)] [:I1-leak i m]))]
              (recur (inc i) (assoc clients h (call srv [:own h])) unpub'
                     (conj events [:h h (:rev c) ops]) (conj replies rep) (vec v)))
            (< r 80)
            (let [vt (call srv [:read "a"]) dt (call srv [:disk])
                  [old new] (gen-agent-edit vt dt)
                  rep (call srv [:agent-edit "agent:1" "c" old new])
                  disk (call srv [:disk])
                  v (concat viol
                            (for [[m a] unpub :when (has? disk m)] [:I1-leak i m])
                            (if (and (:ok rep) (not (has? disk new))) [[:I5 i]] []))]
              (recur (inc i) clients unpub (conj events [:a old new]) (conj replies rep) (vec v)))
            :else
            (let [h (nth humans (rnd (count humans)))
                  before (call srv [:read "a"])
                  rep (call srv [:publish h])
                  after (call srv [:read "a"])
                  unpub' (into {} (filter (fn [[m a]] (not= a h)) unpub))
                  disk (call srv [:disk])
                  v (concat viol
                            (for [[m a] unpub' :when (has? disk m)] [:I1-leak i m])
                            (if (and (= 1 (count humans)) (not= before after)) [[:I4 i]] [])
                            (if (not= disk (:file (call srv [:state]))) [[:I2 i]] []))]
              (recur (inc i) clients unpub' (conj events [:p h]) (conj replies rep) (vec v)))))))))

(defn replay [base events]
  (call srv [:reset base])
  (let [reps (vec (for [e events]
                    (cond (= (first e) :h) (call srv [:human-op (nth e 1) (nth e 2) (nth e 3)])
                          (= (first e) :a) (call srv [:agent-edit "agent:1" "c" (nth e 1) (nth e 2)])
                          :else (call srv [:publish (nth e 1)]))))]
    (doseq [h ["human:a" "human:b"]] (call srv [:publish h]))
    {:replies reps :view (call srv [:read "a"]) :disk (call srv [:disk])}))

(defn own-eq-view? [h] (= (:text (call srv [:own h])) (call srv [:read "a"])))

(defn property [label humans n seed0]
  (seed! seed0)
  (loop [i 0 viol [] nondet 0 kinds {} accepted 0 humans-ok 0 herr-ex []]
    (if (= i n)
      (do (println "OBSERVED" label "cases:" n "violations:" (count viol) "nondeterministic replays:" nondet)
          (println "   agent edits accepted:" accepted "refused by kind:" (into (sorted-map) kinds)
                   "| human-op errors:" humans-ok)
          (doseq [v (take 3 viol)] (println "   VIOLATION" v))
          (when (seq herr-ex) (println "   first human-op error:" (first herr-ex)))
          {:viol viol :nondet nondet})
      (let [r (run-case humans)
            rp (replay (:base r) (:events r))
            same (and (= (:replies r) (:replies rp)) (= (:view r) (:view rp)) (= (:disk r) (:disk rp)))
            agent-reps (for [[e rep] (map vector (:events r) (:replies r)) :when (= :a (first e))] rep)
            herrs (count (for [[e rep] (map vector (:events r) (:replies r)) :when (and (= :h (first e)) (:error rep))] rep))
            kinds' (reduce (fn [k rep] (if (:error rep) (update k (:error rep) (fnil inc 0)) k)) kinds agent-reps)]
        (recur (inc i)
               (vec (concat viol (for [v (:viol r)] [i v])))
               (if same nondet (inc nondet))
               kinds'
               (+ accepted (count (filter :ok agent-reps)))
               (+ humans-ok herrs)
               (if (and (> herrs 0) (empty? herr-ex))
                 [(first (for [[e rep] (map vector (:events r) (:replies r)) :when (and (= :h (first e)) (:error rep))] [e rep]))]
                 herr-ex))))))

(def p1 (property "1 human " ["human:a"] 500 11))
(def p2 (property "2 humans" ["human:a" "human:b"] 500 23))
(def p3 (property "1 human, seed 99" ["human:a"] 500 99))
```

## 4. Latency

p50 of 200 server round-trips, µs (call → reply), with 0 and with ~6 pending human ops, plus a publish.

```beam-lisp
(defn p50 [f]
  (let [ts (vec (for [_ (range 200)]
                  (let [t0 (erlang/monotonic_time :microsecond)] (f) (- (erlang/monotonic_time :microsecond) t0))))]
    (nth (sort ts) 100)))
(def lbase (clojure.string/join "\n" (for [i (range 5)] (clojure.string/join " " (for [j (range 4)] (str "w" i j))))))
(call srv [:reset lbase])
(def fl (atom 0))
(defn flip-edit []
  (let [n (swap! fl inc)]
    (if (odd? n) (call srv [:agent-edit "agent:1" "c" "w10" "w10x"]) (call srv [:agent-edit "agent:1" "c" "w10x" "w10"]))))
(def lat-read (p50 (fn [] (call srv [:read "a"]))))
(def lat-edit0 (p50 flip-edit))
(def lat-human (p50 (fn [] (let [o (call srv [:own "human:a"])] (call srv [:human-op "human:a" (:rev o) [[[4 11] [4 11] "z"]]])
                                (call srv [:publish "human:a"])))))
(call srv [:reset lbase])
(doseq [k (range 6)] (call srv [:human-op "human:b" (:rev (call srv [:own "human:b"])) [[[k 0] [k 0] "h"]]]))
(def lat-read6 (p50 (fn [] (call srv [:read "a"]))))
(def lat-edit6 (p50 flip-edit))
(println "OBSERVED p50 us: read(0 pending)" lat-read "| agent-edit(0 pending)" lat-edit0
         "| human-op+publish" lat-human)
(println "OBSERVED p50 us with 6 pending human ops: read" lat-read6 "| agent-edit" lat-edit6)
```

## Findings

All numbers OBSERVED in the run above (whole run ≈ 2.5 min, dominated by the property test; the file runs, exit 0).

**Verdict: the two-layer model holds the invariants.** 3 property runs × 500 seeded cases × 12 events (1 human seeds
11 and 99, 2 humans seed 23): **0 violations, 0 nondeterministic replays**, 0 human-op errors. Checked after every event:
no unpublished human marker on disk (I1), file == server's published text (I2), publish does not change the view with one human (I4),
an accepted agent edit's text is on disk at once (I5); at the end, after all humans publish: disk == view == file.
Agent edits accepted: 1633 / 1465 / 1645; refused: `:overlay` 367 / 416 / 322, `:not-found` ~131–166, `:ambiguous` 23–43,
`:published-ambiguous` 2–3, `:conflict` 1 / 1 / 0.

**Scenarios (OBSERVED):**
- (a) human typed ` and a half-typ` (pending); agent edited `beta two`→`beta 2`: disk `"alpha one\nbeta 2\ngamma three"` (no half line, `file==disk: true`),
  view `"…beta 2\ngamma three and a half-typ"`, the agent's `read` sees the half line. The file-port leak is gone.
- (b) overlap, the agent's `old` = `two`: human X at the start of `two` → view `beta X2`, disk `beta 2` (ok); human X at the end → view `beta 2X`, disk `beta 2` (ok);
  human X inside → view `tXwo`, the agent's `two` is `:not-found` in the view, and the retry with the view token `tXwo` is refused `:overlay`;
  human replaced `alpha`→`ALPHA` and the agent edited `one` on the same line → view `ALPHA 1`, disk `alpha 1` (converged);
  b4 (human deleted `two` on line 1 and retyped ` two` on line 0, so the view's only `two` is a different one from pub's) → `:conflict`, nothing changed.
- (c) human publishes after agent edits: disk == view (`"ALPHA one\nbeta 2\ngamma three!!"`); a human op with a stale base (2 landed) rebased correctly (`beta 2?`).
- (d) `old` matching only overlay text (`delta four`): **refused `:overlay`** (`old text exists only in the human's unpublished overlay`), state unchanged.
- (e) two humans: after human:a publishes, disk has `A>` only; human:b's `<B` stays pending; b's own view = agent view.

**Rule chosen for (d) — refuse.** Applying an agent edit to overlay-only text would have to be a pending (unpublished) agent op, which
breaks "agent ops publish immediately" (§5.7) and would make the agent's edit vanish from disk while the agent believes it landed. The error
tells the agent to wait for the human to publish (or to edit different text). INFERRED: the agent can recover by re-reading, since read = view.

**Agent-edit semantics (decision): apply to the PUBLISHED text, then transform every pending branch over it.** Replace is
encoded as insert `new` at the END of `old`, then delete `old` (so a pending human insert at `old`'s start stays before the new text and one at its end lands after it, same as an edit
on the view). A self-check (`view' == view with old→new applied at the view's match`) turns the rare disagreement into `:conflict` (b4, 1–2 cases in 1500)
rather than silently differing; a bug in this check would show up as I1/I5/disk-vs-view failures, none seen.

**What FEAT-004 must implement (exact):**
1. State: `pub` (== disk after every landing), per-actor `pend` = atomic ops based on `pub`, per-actor `ovlog` = ops that landed in `pub` since, in THAT actor's own-view coordinates.
2. `human-op actor base ops`: atomize; `tl` over the flattened `ovlog[actor][base..]`; append to that actor's branch; reject `base > rev`. Validate by applying to `pub` (an invalid rebased op must reply an error, not crash the server).
3. Landing (publish or agent edit): apply ops to `pub`, then `tl` the landed ops over EACH other branch (landed ops are the `b` side, with the actor-id tiebreak; for an agent edit the agent's insert goes first), store the transformed branch, and append the transformed landed ops to each actor's `ovlog`. Only then write the disk.
4. `read` = `pub` ⊕ the branches merged with `tl` in sorted-actor order (deterministic). `own actor` returns `{text, rev}` the client must use as its base.
5. Agent `edit`: `old` exactly once in the view (else `:not-found` / `:ambiguous`), exactly once in `pub` (else `:overlay` / `:published-ambiguous`), self-check, then land. These are plain error strings for the model.
6. All of this in one server process (state serial); everything is deterministic given the event order.

**Limits / caveats (INFERRED unless noted):**
- A human client can only send ONE op batch per snapshot in this model (property test re-reads or reuses a snapshot once, then refreshes). Pipelined sends in the same old coordinates need a per-op base, or the client must wait for the ack/rev (the editor can serialise sends). Not tested.
- Rebasing is only as correct as `tl`: ops that touch the same span as a pending delete are merged by the convergence rules (insert survives, deleted text is gone); a pending delete of text the agent then replaced keeps the agent's new text (not tested beyond the random cases).
- `merge in sorted-actor order` makes the view for ≥3 humans depend on the actor ids; with 2 humans it was deterministic across replays.
- Disk write is a full rewrite per landing; no partial-failure handling (File/write! errors are not simulated).
- Unicode/column units: columns are char offsets (`subs`), same as the other spikes.

**Latency (OBSERVED p50, µs, server round-trip incl. `File/write!` for edits/publish):** read, no pending 127 (42 in an earlier run); agent-edit, no pending 1004;
human-op + publish 1176; with 6 pending human ops: read 492, agent-edit 5486. Edit cost grows with pending ops (every read recomputes `view-of`, every edit does it twice+): **cache the view per rev in FEAT-004** (server state, not a beam-lisp atom).
Still ≪ the ~97 ms `tr/claim!`.

**Surprises:** (1) the first run (all landing ops on the "a" side of the tiebreak, replace as delete-then-insert) failed b2 (`:conflict`: pending insert at the END of `old` ended up before the agent's text) — the replace order matters, fixed by insert-at-end-then-delete. (2) The first generator reused a snapshot for several sends and produced invalid rebased ops (`subs` out of range) — that is the per-op-base limit above, not a convergence bug; the server now answers `:invalid-op` instead of crashing (via `guarded`).
