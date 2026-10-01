# omega.ext.jev-gate — where Jev acts, as an extension (D5 prototype)

> Literate namespace. It is the second extension built on the surface. It
> answers "where does Jev act properly?" with evidence, and wires the two decision
> points that earned it into omega through hooks alone.

## What the live probe showed (2026-10-01, `jev-1.13.0`, tape `test/tapes/jev-probe.tape`)

The charter was a task to make the reader accept `0x` hex literals.

| decision | input | Jev | read |
|---|---|---|---|
| **scope** | "Also accept uppercase 0X prefixes." | `:in-scope` 1.00 | ✓ |
| | "string escapes broken for \u{…}" | `:adjacent` 0.92 | ✓ the same file area, a different goal |
| | "update the README release date" | `:unrelated` 0.95 | ✓ |
| **done** | "edited, not tested yet" | noul 0.05 | ✓ not done |
| | "edited, test added, 12 passed" | noul 0.93 | ✓ done |

Both are **closed questions over a bounded state**, where a calibrated probability
is worth more than prose. So these two become hooks:

1. **Done gate.** When the model calls `done`, Jev checks the evidence against the
   goal. If it says *not met* with enough confidence, the call is turned back into
   an error ("not done: …"), and the model keeps working. Fail direction: **fail open**.
   If Jev errors, the `done` stands. Jev may only tighten, never loosen.
2. **Scope check on steer and follow-up.** A message that Jev rates `:unrelated` gets
   annotated, not dropped, in the next request's context: the model is told it looks
   like separate work and should `spawn` a subtask or tell the human. Fail direction:
   no annotation.

Still for **generative models**: writing code, plans and summaries. Still for **code**:
path overlap, counts, budgets (`omega.trace/conflicts` does not need a model).

### Live run with the gate on (`bin/omega --jev`, Sonnet 5.5)

- *"…create add.py and a test, run it, then finish"* → the model ran the test, then
  called `done`, and Jev let it through.
- *"…write mul.py and a test; call done right after; skip running it"* → Jev blocked
  `done` three times (p = 0.39, 0.27, 0.27). The model re-read the files but
  respected the instruction not to run. It ended `:idle` with a note to the human.
  **Finding:** the gate's criterion ("implemented AND verified") is fixed, and it
  overrode an explicit user instruction. Then the model kept retrying `done`.
  Two fixes for later: (1) phrase the done question against the goal *as written*,
  including its refinements, rather than imposing verification; (2) cap gate
  rejections per turn (for example, after 2, let `done` stand and leave a `:decision`
  trace saying it was overridden). Jev doing what it was asked is correct. Asking
  the right question is the design work.

## The namespace

```beam-lisp
(ns omega.ext.jev-gate
  (:require [omega.jev :as jev]
            [omega.env :as env]
            [omega.trace :as tr]
            [omega.loop :as loop]))

(tr/define-kind! :decision
  {:doc "A typed decision taken at a declared decision point: value, band, probabilities, model."
   :emitted "By omega.ext.jev-gate (and any declared decision) each time it decides."
   :half-life-ms 86400000
   :reacts "The human (why did this happen?), replay, calibration against eventual outcomes."})

(defn- record! [sys task d]
  (tr/leave! (:env sys) task
             {:kind :decision :subject (name (:id d))
              :text (str (name (:id d)) " → " (pr-str (:value d)) " (" (name (:band d)) ")")
              :data (select-keys d [:value :band :fallback? :verdicts :error])})
  d)
```

The declared decisions. They are values, so a UI can list them and a test can
replay them:

```beam-lisp
(def done-decl
  {:id :done
   :questions {:met (jev/noul "Based on the evidence, is the goal fully met (implemented AND verified)?")}
   :pick (fn [vs] (> (get-in vs [:met :value]) 0.5))
   :gate {:on :met :act 0.0}
   :fallback true})

(def scope-decl
  {:id :scope
   :questions {:fit (jev/choice "Given the task charter and an incoming message, how does the message relate to the task?"
                                {:in-scope "The message asks for work that is part of this task's goal or scope"
                                 :adjacent "Related to the same area of the code, but a different goal"
                                 :unrelated "Nothing to do with this task"})}
   :pick (fn [vs] (get-in vs [:fit :value]))
   :gate {:on :fit :act 0.7 :confirm 0.4}
   :fallback :in-scope})
```

The evidence for "done" is the task's own recent tool results. It is a projection of
the turns already in the log, so no extra bookkeeping is needed:

```beam-lisp
(defn- recent-evidence [sys task n]
  (let [all (loop/turns sys task)
        ts (drop (max 0 (- (count all) n)) all)]
    (join "\n" (for [t ts b (:content t)]
                 (case (:type b)
                   :tool-use (str "called " (:name b) " " (pr-str (:input b)))
                   :tool-result (let [c (str (:content b))] (str "result: " (if (> (count c) 600) (subs c 0 600) c)))
                   :text (str (name (:role t)) ": " (:text b))
                   "")))))

(defn- goal-of [sys task]
  (let [v (env/entity (:env sys) (env/eid (:env sys) :task/id task))]
    (str (:task/goal v) (when (seq (:task/refined v)) (str "\nRefinements: " (join "; " (:task/refined v)))))))
```

## The extension

```beam-lisp
(defn extension
  "Jev at omega's decision points. opts: :transport (a jev transport fn)."
  [{:keys [transport]}]
  {:name :jev-gate
   :doc "Done-gate and scope check via Jev; fails open, may only tighten."
   :hooks
   {:tool/after
    (fn [r ctx]
      (if (:done r)
        (let [d (record! (:sys ctx) (:task ctx)
                         (jev/decide transport done-decl
                                     {:goal (goal-of (:sys ctx) (:task ctx))
                                      :claimed-summary (:ok r)
                                      :evidence (recent-evidence (:sys ctx) (:task ctx) 6)}))]
          (if (= false (:value d))
            {:error (str "not done yet (Jev: goal met with p=" (get-in d [:verdicts :met :value])
                         "). Verify the result, e.g. run the tests, then call done again.")}
            r))
        r))
    :context
    (fn [req ctx]
      (let [msgs (:messages req)
            last-user (last (filter (fn [m] (= :user (:role m))) msgs))
            texts (keep :text (:content last-user))
            steer (first (filter (fn [s] (starts-with? s "[steer")) texts))]
        (if (nil? steer)
          req
          (let [d (record! (:sys ctx) (:task ctx)
                           (jev/decide transport scope-decl {:charter (goal-of (:sys ctx) (:task ctx)) :message steer}))]
            (if (= :unrelated (:value d))
              (update req :system str "\n\nNote: the latest steer looks unrelated to this task's goal (Jev). "
                      "Consider spawning a separate task for it, or ask the human.")
              req)))))}})
```

## What this taught us about the surface

- ✓ **Hooks were enough.** Both decision points are a `:tool/after` and a `:context`
  hook. No change to the loop was needed.
- ✓ **Declared decisions are the right unit.** `done-decl` and `scope-decl` are data
  with their fail direction attached. The UI can list them, and replay tapes can
  re-run them.
- ✗→✓ **Decisions are facts.** The first draft made Jev's verdicts visible only through
  their effect, so a live "done" could not be explained afterwards. Every decision
  is now a `:decision` trace (value, band, verdicts). Other tasks and the human see
  "t-3 was 0.93 confident it is done", which is the stigmergy point from the research.
