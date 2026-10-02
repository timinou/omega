# omega.ui.screens — the desktop screens, as pure functions

> Literate namespace. Each screen is `(fn [snapshot ui] → hiccup)` built from loom
> parts. `omega.ui.web` serves them as a beam-lisp `live.app`: rendering, keyed
> patching and stylesheet shipping are live's job, not omega's.
> This file is where the look is decided, so the design reasoning sits next to the code.

## Design decisions (impeccable, register: Operate)

- **One question per screen.** The overview answers *what needs me, what is
  running, what is stuck*. The task screen answers *what did this task do, and
  what do I say next*.
- **A table of rows, not a grid of cards.** Tasks are grouped by urgency. Only
  "Needs you" may use the accent colour.
- **Status is glyph + word + tone**, from one table (`omega.ui.theme/STATUS`).
- **Liveness is information, not animation.** Each row shows the age of its
  newest trace ("12s"). There is no spinner and no pulsing dot. A running task
  with no trace for 5 minutes moves to *Stale*.
- **The human answers in place.** A task's question shows on its row with its
  choices as buttons. There is no modal.
- **Events are live's closed vocabulary.** `[:assign k v]` changes this viewer's
  locals (open task, theme). `[:intent op payload]` is the only kind of write,
  and each one is a public task verb (`omega.ui.web/intents`).
- **Mono only for ids, paths and code.** Prose stays in the system sans.
- **Empty states teach.** "No tasks yet. Describe what you want done above."

## The namespace

```beam-lisp
(ns omega.ui.screens
  (:require [loom.ui :as ui]
            [loom.box :as b]
            [loom.parts :as p]
            [loom.token :as t]
            [omega.ui.theme :as th]
            [omega.ui.model :as model]))
```

## Small parts

```beam-lisp
;; `& body` spliced with into, never passed as one list child: live/client.js
;; reads a nested array whose head is a string as a TAG ("· 1" → createElement
;; throws), so text children must stay flat.
(defn- mono [& body]
  (into [:span {:class (t/sx {:font-family (t/tok :font :mono) :font-size (t/text :sm)})}] body))

(defn- muted [& body]
  (into [:span {:class (t/sx {:color (t/color :muted) :font-size (t/text :sm)
                              :font-variant-numeric "tabular-nums"})}] body))

(defn age
  "12s · 4m · 2h · 3d: coarse and tabular, updated by the window's tick."
  [ms]
  (let [s (quot (max 0 (or ms 0)) 1000)]
    (cond (< s 60) (str s "s")
          (< s 3600) (str (quot s 60) "m")
          (< s 86400) (str (quot s 3600) "h")
          :else (str (quot s 86400) "d"))))

(defn status-chip [st]
  (let [{:keys [glyph word tone]} (th/status st)]
    [:span {:class (t/sx {:color (th/tone-color tone) :font-size (t/text :sm)
                          :white-space "nowrap" :min-width "92px" :display "inline-block"})
            :data-status (name st)}
     glyph " " word]))

(defn cost-text
  "Tokens spent, or nil when none were (a scripted model, a task not yet run)."
  [c]
  (let [n (when (map? c) (+ (or (:input c) 0) (or (:output c) 0)))]
    (when (and n (pos? n)) (str n " tok"))))
```

## The header and composer

The composer is the primary action: a new prompt is a new task. Enter submits.
loom's desktop hook clears the field and sends `[:new-task value]`.

```beam-lisp
(defn header [snap ui]
  (let [n (count (:tasks snap))
        need (count (get-in snap [:by-group :needs-you]))]
    (b/row {:justify :between :pad [:3 :5]
            :style {:border-bottom (str "1px solid " (t/color :border)) :background (t/color :surface)
                    :position "sticky" :top "0" :z-index "1"}}
      (b/row {:gap :3}
        [:strong {:class (t/sx {:font-size (t/text :lg)})} "omega"]
        (muted (str n " task" (if (= 1 n) "" "s")
                    (when (pos? need) (str " · " need " need" (if (= 1 need) "s" "") " you")))))
      (b/row {:gap :2}
        (when (:task ui) (ui/button {:variant :ghost :size :sm :on-click [:assign :task nil]} "← Overview"))
        (ui/button {:variant :ghost :size :sm :on-click [:assign :theme (if (= :light (:theme ui)) "dark" "light")]}
                   (if (= :light (:theme ui)) "Dark" "Light"))))))

(defn composer
  "Enter fires the :new-task intent with the field's value (live/client.js
   sends it and clears the field). The DOM is patched, never replaced, so
   half-typed text survives every re-render without any draft bookkeeping."
  [ui]
  (b/box {:pad [:4 :5] :style {:border-bottom (str "1px solid " (t/color :border))}}
    (ui/field {:name :goal :label "New task"
               :hint "Describe the outcome you want. Enter starts a task."
               :on-keydown.enter [:intent :new-task {}]})))
```

## Live output: the turn being written

While a model call streams, the task's in-progress turn shows below the
conversation as plain text that grows. It is not a fact yet: when the turn
completes, it disappears and the recorded turn takes its place. The only
liveness cue is a word, *writing*. There is no cursor, no shimmer and no pulse.

```beam-lisp
(defn live-turn [lt]
  (when lt
    (b/col {:gap :2 :pad [:3 0] :key "live"}
      [:div {:class (t/sx {:font-size (t/text :xs) :font-weight (t/weight :semibold) :color (t/color :muted)})}
       "omega · writing"]
      (for [[i blk] (sort-by first (:blocks lt))]
        (if (= :text (:kind blk))
          [:p {:key (str "live-" i) :class (t/sx {:white-space "pre-wrap" :max-width "72ch" :line-height "1.55"})} (:text blk)]
          [:pre {:key (str "live-" i)
                 :class (t/sx {:font-family (t/tok :font :mono) :font-size (t/text :sm) :white-space "pre-wrap"
                               :color (t/color :muted) :background (t/color :surface-2) :padding (t/space :3)
                               :border-radius (t/radius :md)})}
           (:text blk)])))))

(defn live-line
  "A one-line preview of a task's streaming text, for its overview row."
  [lt]
  (when lt
    (let [txt (apply str (map :text (vals (:blocks lt))))
          n (count txt)]
      (if (> n 120) (str "…" (subs txt (- n 120) n)) txt))))
```

## Overview: every task at once, grouped by urgency

```beam-lisp
(defn ask-inline
  "A task's question to the human, answerable in place."
  [a]
  (let [choices (or (get-in a [:data :choices]) [[:yes "Yes"] [:no "No"]])]
    (b/row {:gap :2 :wrap true :pad [:2 0 0 0]}
      [:span {:class (t/sx {:font-size (t/text :sm)})} (:text a)]
      (for [[k label] choices]
        (ui/button {:size :sm :variant :subtle :on-click [:intent :answer {:msg (:id a) :choice (name k)}]} label)))))

(defn task-row [r lt]
  (b/col {:gap :0 :pad [:3 :5] :data-task (:id r) :key (:id r)
          :on-click [:assign :task (:id r)]
          :style {:cursor "pointer" :border-bottom (str "1px solid " (t/color :border))}
          :on {:hover {:background (t/color :surface-2)}}}
    (b/row {:gap :4}
      (status-chip (:status r))
      [:span {:class (t/sx {:flex "1" :min-width "0" :overflow "hidden" :text-overflow "ellipsis"
                            :white-space "nowrap"})}
       (:goal r)]
      (when (seq (:claims r)) (mono (first (:claims r))))
      (muted (or (cost-text (:cost r)) ""))
      (muted (age (:age-ms r))))
    (when-let [line (live-line lt)]
      [:div {:class (t/sx {:padding-left "108px" :color (t/color :muted) :font-size (t/text :sm)
                           :overflow "hidden" :text-overflow "ellipsis" :white-space "nowrap"})}
       line])
    (when (and (nil? lt) (contains? #{:idle :done :failed} (:status r)) (seq (str (:result r))))
      [:div {:class (t/sx {:padding-left "108px" :color (t/color :muted) :font-size (t/text :sm)
                           :overflow "hidden" :text-overflow "ellipsis" :white-space "nowrap"})}
       (str (:result r))])
    (for [a (:asks r)] [:div {:class (t/sx {:padding-left "108px"})} (ask-inline a)])))

(defn group-section
  "One urgency group. An EMPTY group still renders (an empty keyed node), so
   the group list is always fully keyed: live.diff falls back to positional
   matching when any sibling lacks a key (BUG-110), and a task moving between
   groups would then morph one group into another and duplicate its row."
  [k title rows live]
  (if (empty? rows)
    [:div {:key (name k)}]
    (b/col {:gap :0 :key (name k)}
      [:h2 {:key (str (name k) "-title")
            :class (t/sx {:font-size (t/text :sm) :font-weight (t/weight :semibold)
                          :color (t/color :muted) :padding (str (t/space :4) " " (t/space :5) " " (t/space :2))})}
       title " " (muted (str "· " (count rows)))]
      (for [r rows] (task-row r (get live (:id r)))))))

(defn overview [snap ui live]
  (b/col {:gap :0}
    (composer ui)
    (if (empty? (:tasks snap))
      (b/box {:pad :7}
        (p/empty-state {:title "No tasks yet"
                        :body "Describe what you want done above. Each prompt becomes a task you can watch, steer and answer."}))
      (b/col {:gap :0}
        (for [[k title] model/GROUPS]
          (group-section k title (sort-by :id (get-in snap [:by-group k])) live))))))
```

## Task detail: the conversation, what it touched, and the next message

```beam-lisp
(defn- first-line
  "The first non-blank line of `s`, trimmed and capped: what a one-line summary of code should show."
  [s]
  (let [l (or (first (remove clojure.string/blank? (clojure.string/split-lines (str s)))) "")
        l (clojure.string/trim l)]
    (if (> (count l) 90) (str (subs l 0 90) "…") l)))

(defn- n-lines [s] (count (clojure.string/split-lines (str s))))

(defn- call-code
  "What a tool call ran, as text: the eval's code, or the input map for any other tool."
  [b]
  (let [c (get-in b [:input :code])]
    (if (string? c) c (pr-str (:input b)))))

(defn- outcome
  "The one-word fate of a call, from its result block (nil result = still running)."
  [r]
  (cond
    (nil? r) {:text "running" :tone :muted}
    (:error? r) {:text "✕ error" :tone :danger}
    :else (let [n (n-lines (:content r))]
            {:text (str "← " (if (= n 1) "1 line" (str n " lines"))) :tone :muted})))

(def ^:private pre-class
  {:font-family (t/tok :font :mono) :font-size (t/text :sm) :white-space "pre-wrap"})

(defn- result-view [r]
  [:pre {:class (t/sx (assoc pre-class :color (if (:error? r) (t/color :danger) (t/color :muted))
                                       :max-height "240px" :overflow "auto"))}
   (str (:content r))])

(defn- call-view
  "One tool call as ONE fold: summary = tool, first line of its code, outcome; body = the
   code, then what it returned. Short results and errors open by default."
  [b r]
  (let [o (outcome r)
        short? (and r (<= (n-lines (:content r)) 6))]
    (p/disclosure {:open (boolean (and r (or (:error? r) short?)))
                   :summary (b/row {:gap :2 :grow 1 :style {:min-width "0"}}
                              (mono (or (:name b) "tool"))
                              [:span {:class (t/sx {:color (t/color :muted) :font-size (t/text :sm)
                                                    :overflow "hidden" :text-overflow "ellipsis" :white-space "nowrap"
                                                    :flex "1" :min-width "0"})}
                               (first-line (call-code b))]
                              [:span {:class (t/sx {:color (th/tone-color (:tone o)) :font-size (t/text :sm) :white-space "nowrap"})}
                               (:text o)])}
      (b/col {:gap :2 :pad [:2 0 0 0]}
        [:pre {:class (t/sx (assoc pre-class :background (t/color :surface-2) :padding (t/space :3)
                                             :border-radius (t/radius :md)))}
         (call-code b)]
        (when r (result-view r))))))

(defn- block-view
  "`results`: tool-use id → its tool-result block, so a call and its answer show together."
  [b results]
  (case (:type b)
    :text [:p {:class (t/sx {:white-space "pre-wrap" :max-width "72ch" :line-height "1.55"})} (:text b)]
    :tool-use (call-view b (get results (:id b)))
    :tool-result (result-view b)
    [:pre (pr-str b)]))

(defn results-by-id
  "Every tool-result block in `turns`, keyed by the tool-use id it answers."
  [turns]
  (into {} (for [t turns b (:content t) :when (= :tool-result (:type b))] [(:id b) b])))

(defn visible-turns
  "The turns worth their own header. A turn that only carries results already shown inside
   their calls is dropped; an orphan result (its call is not in `turns`) still shows."
  [turns]
  (let [call-ids (set (for [t turns b (:content t) :when (= :tool-use (:type b))] (:id b)))]
    (remove (fn [t] (and (seq (:content t))
                         (every? (fn [b] (and (= :tool-result (:type b)) (contains? call-ids (:id b)))) (:content t))))
            turns)))

(defn turn-view [t results]
  (let [who (case (:role t) :user "You" :assistant "omega" :tool "result")]
    (b/col {:gap :2 :pad [:3 0] :key (str "turn-" (:n t))}
      [:div {:class (t/sx {:font-size (t/text :xs) :font-weight (t/weight :semibold) :color (t/color :muted)
                           :text-transform "none"})} who]
      (for [b (:content t)] (block-view b results)))))

(defn task-screen [snap ui detail live]
  (let [id (:task ui)
        r (first (filter (fn [x] (= id (:id x))) (:tasks snap)))]
    (if (nil? r)
      (b/box {:pad :6} (p/error-state {:title "Task not found" :body (str id " is not in this environment.")}))
      (b/row {:align :start :gap :0}
        (b/col {:gap :0 :grow 1 :pad [:4 :5] :style {:min-width "0"}}
          (b/row {:gap :3 :pad [0 0 :3 0]}
            (status-chip (:status r))
            [:h1 {:class (t/sx {:font-size (t/text :xl) :font-weight (t/weight :semibold)})} (:goal r)])
          (for [a (:asks r)] (ask-inline a))
          (let [results (results-by-id (:turns detail))]
            (for [t (visible-turns (:turns detail))] (turn-view t results)))
          (live-turn (get live id))
          (when-not (contains? #{:done :failed :cancelled} (:status r))
            (b/box {:pad [:4 0]}
              (ui/field {:name :say :label "Message this task"
                         :hint (if (= :running (:status r))
                                 "It is working; your message lands at its next step."
                                 "A follow-up continues this task.")
                         :on-keydown.enter [:intent :say {:task id}]}))))
        (b/col {:gap :3 :pad [:4 :5] :w "320px"
                :style {:border-left (str "1px solid " (t/color :border)) :min-height "100%"}}
          (p/facts {:cols 1} [["Task" (mono id)]
                              ["Owner" (when (:owner r) (mono (:owner r)))]
                              ["Cost" (or (cost-text (:cost r)) "none")]
                              ["Last activity" (str (age (:age-ms r)) " ago")]])
          [:h2 {:class (t/sx {:font-size (t/text :sm) :color (t/color :muted) :font-weight (t/weight :semibold)})} "Traces"]
          ;; per-call :tool traces are already the conversation; the sidebar shows
          ;; what this task left for OTHERS: claims, findings, blockers, decisions
          (let [marks (remove (fn [tr] (= :tool (:kind tr))) (:traces detail))]
           (if (empty? marks)
            (muted "None yet.")
            (b/col {:gap :2}
              (for [tr marks]
                (b/col {:gap :0}
                  (b/row {:gap :2} (muted (name (:kind tr))) (mono (:subject tr)))
                  (when (:text tr) [:div {:class (t/sx {:font-size (t/text :sm)})} (:text tr)])))))))))))
```

## The whole view

```beam-lisp
(defn view
  "The window's one view: (state) → hiccup. state = {:snap :ui :detail}."
  [{:keys [snap ui detail live]}]
  (th/install! (or (:theme ui) :dark))
  ;; the DOCUMENT scrolls, not an inner box: its position survives any patch,
  ;; and the header stays put with position:sticky
  (b/col {:gap :0 :style {:background (t/color :bg) :min-height "100vh"}}
    (header snap ui)
    ;; the screen is the ONLY child of its own wrapper, and keyed: switching
    ;; screens then removes one subtree and inserts the other. live.diff only
    ;; honours keys when EVERY sibling is keyed (beam-lisp BUG-110): beside the
    ;; unkeyed header it would graft the new screen onto the old node.
    [:div {:class (t/sx {:display "contents"})}
     (if (:task ui)
       [:div {:key (str "task:" (:task ui))} (task-screen snap ui detail live)]
       [:div {:key "overview"} (overview snap ui live)])]))
```
