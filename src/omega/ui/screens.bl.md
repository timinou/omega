# omega.ui.screens — the desktop screens, as pure functions

> Literate namespace. Each screen is `(fn [snapshot ui] → hiccup)` built from loom
> parts. The window (`omega.ui.desktop`) only folds events and re-projects the env.
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
(defn- mono [& body]
  [:span {:class (t/sx {:font-family (t/tok :font :mono) :font-size (t/text :sm)})} body])

(defn- muted [& body]
  [:span {:class (t/sx {:color (t/color :muted) :font-size (t/text :sm)
                        :font-variant-numeric "tabular-nums"})} body])

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
            :style {:border-bottom (str "1px solid " (t/color :border)) :background (t/color :surface)}}
      (b/row {:gap :3}
        [:strong {:class (t/sx {:font-size (t/text :lg)})} "omega"]
        (muted (str n " task" (if (= 1 n) "" "s")
                    (when (pos? need) (str " · " need " need" (if (= 1 need) "s" "") " you")))))
      (b/row {:gap :2}
        (when (:task ui) (ui/button {:variant :ghost :size :sm :on-click [:back]} "← Overview"))
        (ui/button {:variant :ghost :size :sm :on-click [:toggle-theme]}
                   (if (= :light (:theme ui)) "Dark" "Light"))))))

(defn composer
  "Drafts are mirrored into the reducer (`:on-input` → [:draft :goal text]) so
   that a re-render (the 1 s tick, an env change) puts the text back. But a
   draft keystroke must NOT itself re-render: loom's desktop swaps the whole
   body, and a swap racing the next keystroke drops characters (observed:
   \"hello world\" → \"helrld\"). The reducer stores drafts OUTSIDE the
   rendered state for that reason (see omega.ui.desktop)."
  [ui]
  (b/box {:pad [:4 :5] :style {:border-bottom (str "1px solid " (t/color :border))}}
    (ui/field {:name :goal :label "New task" :value (get-in ui [:drafts :goal] "")
               :hint "Describe the outcome you want. Enter starts a task."
               :on-input [:draft :goal]
               :on-keydown.enter [:new-task]})))
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
        (ui/button {:size :sm :variant :subtle :on-click [:answer (:id a) (name k)]} label)))))

(defn task-row [r]
  (b/col {:gap :0 :pad [:3 :5] :data-task (:id r)
          :on-click [:open (:id r)]
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
    (when (and (contains? #{:idle :done :failed} (:status r)) (seq (str (:result r))))
      [:div {:class (t/sx {:padding-left "108px" :color (t/color :muted) :font-size (t/text :sm)
                           :overflow "hidden" :text-overflow "ellipsis" :white-space "nowrap"})}
       (str (:result r))])
    (for [a (:asks r)] [:div {:class (t/sx {:padding-left "108px"})} (ask-inline a)])))

(defn group-section [title rows]
  (when (seq rows)
    (b/col {:gap :0}
      [:h2 {:class (t/sx {:font-size (t/text :sm) :font-weight (t/weight :semibold)
                          :color (t/color :muted) :padding (str (t/space :4) " " (t/space :5) " " (t/space :2))})}
       title " " (muted (str "· " (count rows)))]
      (for [r rows] (task-row r)))))

(defn overview [snap ui]
  (b/col {:gap :0}
    (composer ui)
    (if (empty? (:tasks snap))
      (b/box {:pad :7}
        (p/empty-state {:title "No tasks yet"
                        :body "Describe what you want done above. Each prompt becomes a task you can watch, steer and answer."}))
      (b/col {:gap :0}
        (for [[k title] model/GROUPS]
          (group-section title (sort-by :id (get-in snap [:by-group k]))))))))
```

## Task detail: the conversation, what it touched, and the next message

```beam-lisp
(defn- block-view [b]
  (case (:type b)
    :text [:p {:class (t/sx {:white-space "pre-wrap" :max-width "72ch" :line-height "1.55"})} (:text b)]
    :tool-use (p/disclosure {:summary (b/row {:gap :2} (mono "eval") (muted (let [c (str (get-in b [:input :code]))] (if (> (count c) 80) (str (subs c 0 80) "…") c))))}
                [:pre {:class (t/sx {:font-family (t/tok :font :mono) :font-size (t/text :sm) :white-space "pre-wrap"
                                     :background (t/color :surface-2) :padding (t/space :3) :border-radius (t/radius :md)})}
                 (str (get-in b [:input :code]))])
    :tool-result [:pre {:class (t/sx {:font-family (t/tok :font :mono) :font-size (t/text :sm) :white-space "pre-wrap"
                                      :color (if (:error? b) (t/color :danger) (t/color :muted))
                                      :max-height "240px" :overflow "auto"})}
                  (str (:content b))]
    [:pre (pr-str b)]))

(defn turn-view [t]
  (let [who (case (:role t) :user "You" :assistant "omega" :tool "result")]
    (b/col {:gap :2 :pad [:3 0]}
      [:div {:class (t/sx {:font-size (t/text :xs) :font-weight (t/weight :semibold) :color (t/color :muted)
                           :text-transform "none"})} who]
      (for [b (:content t)] (block-view b)))))

(defn task-screen [snap ui detail]
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
          (for [t (:turns detail)] (turn-view t))
          (when-not (contains? #{:done :failed :cancelled} (:status r))
            (b/box {:pad [:4 0]}
              (ui/field {:name :say :label "Message this task"
                         :value (get-in ui [:drafts [:say id]] "")
                         :on-input [:draft [:say id]]
                         :hint (if (= :running (:status r))
                                 "It is working; your message lands at its next step."
                                 "A follow-up continues this task.")
                         :on-keydown.enter [:say id]}))))
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
  [{:keys [snap ui detail]}]
  (th/install! (or (:theme ui) :dark))
  (b/col {:gap :0 :h :screen :style {:background (t/color :bg) :overflow "auto"}}
    (header snap ui)
    (if (:task ui) (task-screen snap ui detail) (overview snap ui))))
```
