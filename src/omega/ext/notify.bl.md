# omega.ext.notify — desktop notifications, built on the extension surface

> A literate namespace. omega loads it like any `.bl` file, and the runnable
> ```` ```beam-lisp ```` blocks below *are* the extension. It is also the first proof
> of decision D8: how ergonomic is it to implement a real feature as an extension?
> The answer is at the bottom.

## What it does

The human is an actor with a mailbox (decision a). A desktop notification is the
most direct way to put that mailbox in front of a person:

1. When a task **finishes or fails**, notify: "omega · fix-reader-hex · done".
2. When a task sends the human an **`:ask`**, notify with **action buttons**. The
   chosen button becomes the human's reply. That message is a real fact, so
   the task waiting on it wakes up as if the reply had been typed in a UI.

It uses `notify-send`, which is on this host (`/usr/bin/notify-send`, freedesktop
notifications over the session D-Bus). `notify-send -A NAME=Label` waits and
prints the chosen action's NAME on stdout, which gives us replies for free.

## The namespace

```beam-lisp
(ns omega.ext.notify
  (:require [omega.env :as env]
            [omega.actor :as actor]))
```

The side effect is a single function, passed in as an argument (default: the real
desktop). Tests pass their own. A notification is data; the function returns the
chosen action's name, or nil.

```beam-lisp
(defn notify-send
  "The real desktop: notify-send. With :actions it blocks until the person
   clicks one (or dismisses: nil)."
  [{:keys [title body urgency actions]}]
  (let [args (concat ["-a" "omega" "-u" (name (or urgency :normal))]
                     (mapcat (fn [[k label]] ["-A" (str (name k) "=" label)]) actions)
                     [title (or body "")])
        r (System/cmd "notify-send" (to-list args) (list (tuple :stderr_to_stdout true)))
        out (trim (elem r 0))]
    (when (and (seq actions) (= 0 (elem r 1)) (seq out)) out)))
```

## Turning omega events into notifications

These are pure functions from an event to a notification (or nil), so they are
testable without a desktop.

```beam-lisp
(defn status->notification [sys {:keys [task status]}]
  (when (contains? #{:done :failed :idle} status)
    (let [v (env/entity (:env sys) (env/eid (:env sys) :task/id task))
          title (or (:task/title v) task)]
      {:title (str "omega · " title " · " (name status))
       :body (let [r (str (:task/result v))] (if (> (count r) 200) (str (subs r 0 200) "…") r))
       :urgency (if (= :failed status) :critical :normal)})))

(defn ask->notification [m]
  {:title (str "omega · " (:from m) " asks")
   :body (:text m)
   :urgency :critical
   :actions (or (get-in m [:data :choices]) [[:yes "Yes"] [:no "No"]])})
```

`:idle` is included because a task that answered and stopped is waiting on *you*.

## The extension value

An extension is a map. `:on :task/status` observes status changes (each handler
already runs in its own process). The human's inbox is watched by a small sensing
loop started in `:start`. This is the same `sense` primitive a task uses to
wait, so the human really is just another actor.

```beam-lisp
(defn- watch-human! [sys human show!]
  (spawn
   (fn []
     (let [e (:env sys)]
       (actor/sense-inbox e human :human)
       (loop [seen #{}]
         (receive
           :stop :stopped
           [:omega/sensed :human _]
           (let [fresh (filter (fn [m] (and (= :ask (:kind m)) (not (contains? seen (:id m)))))
                               (actor/inbox e human))]
             (doseq [m fresh]
               ;; each ask gets its own process: a person may take minutes to click
               (spawn (fn []
                        (when-let [choice (show! (ask->notification m))]
                          (actor/reply! e (:id m) choice {:via :notify})))))
             (recur (into seen (map :id fresh))))))))))

(defn extension
  "The notify extension. opts: :human (default \"human:me\"), :send (the
   notification fn, default notify-send)."
  ([] (extension {}))
  ([opts]
   (let [human (or (:human opts) "human:me")
         show! (or (:send opts) notify-send)]
     {:name :notify
      :doc "Desktop notifications for task outcomes; answer asks from the notification."
      :on {:task/status (fn [data ctx]
                          (when-let [n (status->notification (:sys ctx) data)]
                            (show! n)))}
      :start (fn [sys]
               (when (nil? (env/eid (:env sys) :actor/id human))
                 (actor/ensure! (:env sys) human :human))
               (watch-human! sys human show!))
      :stop (fn [pid] (erlang/send pid :stop))})))
```

## Ergonomics review (D8 prototype result)

What it took: **one map plus four small functions**, and no changes to omega's core loop.

- ✓ **Events are enough for observation.** `:task/status` carried everything needed,
  and the handler running in its own process meant `notify-send` (which blocks
  until a click) could not stall a task.
- ✓ **Uniform actors paid off immediately.** Answering an `:ask` is
  `actor/reply!`. The task wakes through the same fact-sensing path it uses for
  a human typing in a UI.
- ✗→✓ **Lifecycle.** The first draft's sensing loop had no shutdown. Fixed in the
  surface: `ext/install` keeps each `:start` result and `ext/uninstall` hands it
  to `:stop`.
- ✗→✓ **Ambient test seam.** The first draft used a global `*send*` atom. Replaced
  with an argument (`(extension {:send f})`). Prefer parameters over ambient
  state.
- ✗ **Open gap: no event for "a message arrived for actor X".** We use
  `actor/sense-inbox` in `:start`. That works, but it's a second mechanism beside `:on`.
  Proposal: let `:on` take a datom pattern too (`:on {'[?m :msg/to ?h] f}`), since
  datom watch *is* the event system. Deferred until a second extension needs it.
