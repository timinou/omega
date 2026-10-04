# omega in bl-ed — a Lisp machine for working with agents

> **Literate design note.** `beam-lisp` blocks RAN (`bin/bl run research/domain/interface/bl-ed.bl.md`,
> omega's pinned beam-lisp `2360b32e`); `clojure` blocks are design sketches of code that does not exist
> yet; `org`/`text` fences are illustrations. OBSERVED / INFERRED marked as elsewhere in
> `research/domain`. **Status: design for discussion.** Nothing here is built. omega's core changes
> are *named ahead of time* in §8.4 (round 3 allowed them, decision 12); everything else is projection
> + package. §13 is the decision register; §14 the build order. **Assumed merged before
> implementation** (decision 16): beam-lisp `prototype/bl-js-actors` (bl-ed, `bl.doc.spans`), `realm`
> (PLAN-158) and `autovcs` (PLAN-109).

## 1. Decisions taken by the user

**Round 1 (2026-10-03)**

1. Remove `ed.lisp`. The command line evaluates real Beam Lisp only.
2. Agent edits land in the buffer as a second, coloured cursor, through BEAM processes written
   directly in literate files.
3. Human attention is a transient signal, part of the domain model, tied to (2).
4. Agents may write editor config, landing as proposals the human evaluates.
5. Don't touch omega's core: bring omega and bl-ed together and test a smart interface.
6. A `:task` cell kind whose result is a reference, transcluded as a card; entering it opens the task
   in a sidebar; org TODOs stay independent of omega.

**Round 2 (2026-10-03)**

7. A parked agent edit near its eval deadline returns `{:pending …}`, like `wait`.
8. Two agents on one file interleave as far as possible; OT is a follow-up. Agents should reach
   consensus with each other, e.g. by making the edit servers **stigmergic and bitemporal** (§5.4).
9. Task cells can be opened **headlessly**, and must be just as smooth to see from the interface:
   first-party coexistence of runners (§8).
10. Card density: whatever is coolest, as a simple config (§4.1).
11. **Cells that had side effects on files are not re-runnable.** `space e` on one warns and shows the
    trace of what it did, because the edit servers keep that trace (§7).

**Round 3 (2026-10-03)**

12. **E4 (b): the package's facts live in omega's store.** Improving the core is fine as long as it
    is known ahead of time; §8.4 lists every core change.
13. **E5 (a): the human's text is published on pause.**
14. **E6 (a): jj per turn, opt-in.** Prioritise merging autovcs, and use this design to make it really
    good (§5.9).
15. **E7 (a): `journal/`, committed.** The `!*` directory system (`!sessions/`, `!tasks/`) is
    deprecated; nothing here is designed on it.
16. **E12: everything needed from the worktrees is merged by the start of implementation**, and the
    `realm` branch in particular is assumed for the runner design (§8).

**Round 4 (2026-10-03)**

17. **E17 (a)**, one shared working copy. jj is temporary: history will eventually be **beam-lisp
    native**. So the VCS layer is a modular, Beam-Lispy namespace whose shape teaches the autovcs
    redesign (§5.10).
18. **E18 (a)**: checkpoint even when the gate fails, marked and traced, so the human can steer.
19. **C3: apps declare their own `env.bl` keys**, so `:omega` is valid for omega and for any app. The
    user asked whether this belongs in an omega config instead; answered in §8.4.1.
20. The `!*` system is deprecated *for future design*; this iteration still files its work in
    `!tasks/` as it stands.

## 2. The shape in one picture

```text
            THE WORLD — omega, a member of the project's realm               CONSOLES & RUNNERS
 ┌──────────────────────────────────────────────────────────────────┐   ┌─────────────────────────┐
 │ omega: env (.omega/db, one schema incl. ed attrs) · tasks · loop  │   │ bl-ed tab / window      │
 │                                                                  │◀──┤  socket: ops · attend · │
 │ omega.ed package (new, literate):                                │   │  intents · eval         │
 │   buffer servers   one defserver per open file, op log in datom  │   ├─────────────────────────┤
 │   attention        ephemeral, per actor, decays                  │◀──┤ bin/omega (CLI)          │
 │   task cells       #+begin_task → open!/say!, home cells         │   │ bl doc run --tasks      │
 │   effects          cell → ops/tasks/msgs it caused (references)  │◀──┤ omega-ui (live.app)     │
 │   views            cards, transcripts, overview                  │   │ MCP                     │
 │ ──────────────────────────────────────────────────────────────── │   └─────────────────────────┘
 │ disk (published buffer text) ── per turn ──▶ jj (vcs) ──▶ git     │
 └──────────────────────────────────────────────────────────────────┘
```

**The machine/console split is the CADR's.** The world holds code, data and work. A console holds only
what makes typing instant: a text replica, selections and view state. **Consoles receive views, not
facts** (§9), so no browser datom replica (FUP-138/143) is needed. **Runners are not consoles:** a CLI
or `bl doc run` calls the same verbs inside the same world (§8).

## 3. The `:task` cell

### 3.1 What the user writes

```org
* TODO Hex literals in the reader
Python's int() needs base 16 for 0x; keep the decimal path untouched.
#+begin_task :id hex :scope reader.py test/test_reader.py :see README.md
Make read_number accept 0x hex literals. Keep decimals working.
#+end_task
```

### 3.2 Header parameters — the full set

Tokens follow bl.doc's `src-attrs` rules: `:key value…`, flags are bare, and unknown keys are ignored so
the format grows without migrations. Multi-valued keys take every token up to the next `:key`.

| param | value | default | meaning | lands in omega as |
|---|---|---|---|---|
| `:id` | name | slug of the enclosing heading, else `task-N` | **document-local** handle: names the `#+RESULTS`, target of `:after`/`:parent` | — (never an omega id) |
| `:scope` | path/glob … | none | declared footprint | `:task/scope` |
| `:title` | "string" | enclosing heading title, else body line 1 | short handle shown on the card | `:task/title` |
| `:context` | `heading` / `doc` / `none` | `heading` | the prose around the cell becomes the task's spec: the enclosing heading's body (`heading`), the whole document (`doc`), or nothing | goal text |
| `:see` | path/link … | none | each target's *current buffer text* (unsaved included) is attached | goal text |
| `:after` | id … | none | open only once those cells' tasks are `:done`; the card says "after hex" | (package waits, then `open!`) |
| `:parent` | id | nearest task cell in an ancestor heading | owner edge: cancel cascades, failure reports up | `:owner` |
| `:profile` | name | `default` | which configured system: model, extensions, max-steps, eval timeout | which `sys` opens it |
| `:by` | actor id | the console's human, or the runner's | who opened it | `:by` |
| `:todo` | `sync` / `off` | `sync` if the heading has a TODO keyword | the heading keyword mirrors the task status (§3.6) | — |
| `:frozen` | flag | off | never (re)start; the card still shows the referenced task | (bl.doc `:frozen?`) |
| `:batch` | flag | off | `bl doc run --tasks` starts it headlessly (§8.3) | — |

The **body** is the goal, verbatim, org markup kept. Org links in it (`[[file:reader.py::read_number]]`)
become presentations: clickable objects on the card and in the sidebar, resolved to path + line for
the model.

`:context heading` is the quiet big idea: **the document is the task's context.** You write the plan in
prose and drop the cell under it. The same text is the human's notes and the agent's spec, and editing
one edits the other.

### 3.3 Evaluating it

`space e` / `C-Enter` on the block — the same key as a code cell, because it is a cell:

| block state | evaluation does |
|---|---|
| no result yet | `task/open!` → writes the reference result |
| result → live task, goal digest unchanged | nothing; focuses the card |
| result → live task, body or context edited | `task/say!` with the new goal as a refinement (D3 "same task") |
| result → terminal task | a NEW task (D3: terminal is final); the old id goes to `:prev` |
| `:after` unmet | result written with `:pending-after`; the package opens it when the deps finish |

The goal digest in the result is how "edited" is detected, so there is no hidden state.

### 3.4 The result is a reference — and becomes self-contained when the task ends

While live:

```org
#+RESULTS: hex
: #omega/task {:id "t-41" :goal "b3f1c0"}
```

When the task reaches a terminal status, the package rewrites the result **once** (terminal is final,
so it never churns again):

```org
#+RESULTS: hex
: #omega/task {:id "t-41" :goal "b3f1c0" :status :done :at 1791043200000
:              :summary "read_number parses 0x hex; verified 0x1f and 7 → 31 7"
:              :touched ["reader.py"] :prev ["t-38"]}
```

- **Live = identity only.** Status, cost, traces and asks change every second; none of it touches the
  file, so git diffs stay quiet. The card is a view and is never stale.
- **Finished = self-contained.** A teammate who clones the repo without your `.omega/db` still sees
  what happened, and the card renders from the result alone ("t-41 · not in this world · done").
- **Independence.** The cell's `:id` is the document's. Re-evaluating in another project opens a new
  task. Without the package the result is a tagged literal in a plain org file. TODO headings are never
  tasks, only optionally mirrored.
- **A real value.** `#omega/task` is a data reader (`data-reader!`, `priv/boot/reader.bl:894`).

### 3.5 OBSERVED: what today's tools make of a task block

Run on the bl-ed worktree (`beam-lisp--js-actors`) against a heading, the block, a `#+RESULTS: t-3`
and two `beam-lisp` cells:

```text
bl.doc.spans/spans:  {:kind :block, :lang "task", :from 3, :to 6}
                     {:id "t-3", :kind :result, :from 6, :to 9}
bl.doc/slice-text:   (:prose :prose :result :cell :prose :cell :prose)   cells: ("cell0" "cell1")
```

The partition is already right. Two gaps remain:
- `write-results` only *inserts* after a `:cell` (`priv/std/bl/doc.bl:396 insert-new?`);
- nothing dispatches evaluation by block kind.

The loader extracts only lowercase `#+begin_src`, so a task body is never compiled.

### 3.6 TODO mirroring (`:todo sync`)

| omega status | keyword | | omega status | keyword |
|---|---|---|---|---|
| `:open` `:running` | DOING | | `:done` | DONE |
| `:waiting` | WAIT | | `:failed` | BLOCKED |
| `:idle` | REVIEW (needs you) | | `:cancelled` | CANCELLED |

All six are already bl-ed TODO words (`ed/org.bl todo-words`). The keyword is rewritten as an **op by
the actor `omega`** through the buffer server: a brief coloured edit, undoable, subject to attention.
For a file no console has open, the package writes through the same server (it starts one on demand).
The heading is part of the document, so it gets the same single-writer treatment as everything else.

### 3.7 Where task documents live

The rule that matters is **anywhere**: a task cell is a cell, so it can sit in a research note, a
`!tasks/` PLAN item, a README or a scratch file. Beyond that, three places carry conventions:

| place | what goes there | why it is Beam-Lispy |
|---|---|---|
| **the document you are thinking in** | the cell under the prose that motivates it (`:context heading`) | literate: prose and program in one file, the livebook idea applied to work |
| **`journal/YYYY-MM-DD.bl.org`** — the *home* of homeless tasks | `space a n` outside any document, `bin/omega "goal"`, MCP `task_new`, a task spawned by a task: each appends a heading + task cell to today's journal, written by the actor that opened it | the Lisp machine's `*scratch*` made durable, and org-journal's shape. **Every task has exactly one home cell**, which is what makes runners coexist (§8) |
| **`omega:overview`** — a fact buffer, not a file | every task in the world, grouped by urgency, each row linking to its home cell | D1: the overview is a projection; `RET` on a row jumps to the home cell, `space RET` opens the sidebar |

Spawned subtasks get their home cell *under the parent's home cell*, written by the parent task's
actor: the document tree mirrors the owner tree.

`journal/` is **committed** (E7, decided). Finished results are self-contained (§3.4), so the journal
reads as the project's work log, and every finished task's jj change links back to its home cell
(§5.9). The path is configurable (`:omega {:journal "journal"}` in `env.bl`, §8.4) and is a plain
directory: nothing here depends on the deprecated `!*` system.

## 4. The card and the sidebar

### 4.1 The card — its height is its urgency

The package renders the `#+RESULTS` span as virtual rows (§10 decorations). The default density is
`:urgent`: **a calm task is one line; it grows only when it has something to say.**

```text
#+end_task
● running  t-41 · make read_number accept 0x hex        1m12s · ✎ reader.py:2 · 3 turns · $0.04

#+end_task
╭ ⚑ needs you  t-41 · make read_number accept 0x hex ─────────────────── 1m12s ╮
│ asks  Bump version to 0.2?                                    y yes · n no    │
╰──────────────────────────────────────────────────────────────────────────────╯
```

- With the cursor on it, the card expands to the full form (activity / newest finding / ask / keys).
- When it finishes, it collapses to its summary line: `✓ done · read_number parses 0x hex … · 4m03s`.
- This follows impeccable's rule that liveness is information, not animation: no spinner or pulse,
  just elapsed time and last-trace age.
- It is a **presentation** of type `:omega/task`. Motion steps over it as one row, and `M-x` on it
  lists task commands. `y`/`n`/`a` answer an ask in place; `f` follows the agent's cursor.

```clojure
;; design sketch — the whole configuration surface
(ed/set! :omega.card {:density :urgent        ; :line | :urgent | :full
                      :show [:activity :finding :ask :cost]
                      :expand-on-cursor true})
```

### 4.2 The sidebar: the task's buffer

`↵` on the card opens a side window on the fact buffer `task:t-41`: a projection of the task's turns as
a livebook.

```text
#+TITLE: t-41 · make read_number accept 0x hex           ● running · 1m12s
** model · 2
I'll edit the reader, then verify.
#+begin_src beam-lisp :id t-41/2 :ns omega.task.t-41
(edit "reader.py" [{:old "    return int(s)" :new "    return int(s, 16) if …"}])
#+end_src
#+RESULTS: t-41/2
: #omega/effect {:cell "t-41/2" :ops ["reader.py@1"]}      ← drawn as a trace card (§7)
** model · 3   ▍streaming…
* say ▸ |
```

- **The agent's REPL is your REPL.** `space e` on a cell runs it in `omega.task.t-41` as `human:me`,
  delivered to the model as a `:steer` carrying the cell and its result. Cells that changed the world
  are the exception (§7).
- `* say ▸` is the composer: `RET` → `task/say!`, `C-RET` → `task/steer!`.
- Tabs: **Transcript · Traces · Diff · Files**, all projections of the same task.
- Streaming deltas (`omega.stream`) fill a marked region, which is replaced by the recorded turn at
  `:omega/turn-done`.

## 5. Buffers: second cursors, consensus, bitemporal history

### 5.1 The mechanism: one buffer server per file in use

When any console opens a file, or any actor edits one, the world starts a `buffer` defserver for that
path. It owns the authoritative text and a revision log. Consoles hold replicas and send ops written
against the revision they last saw; the server **rebases** each op over what that actor hasn't seen,
commits it, and broadcasts it. Agents are actors like any other, so their ops arrive with their own
cursor, colour and label.

### 5.2 Attention makes it polite

An agent edit overlapping a *fresh human* attention region is parked as a **suggestion**: ghost text,
`y`/`n`. The agent's call waits; per E1 it returns `{:pending :suggestion}` before its eval deadline,
and the outcome arrives as a message. Everywhere else, agent edits apply immediately and stay visible.

### 5.3 Spike 1 (RAN): rebase, cursors, attention, parked suggestion

> **Caveat from §15.4:** this `transform` diverges on 63% of random concurrent pairs. It shows the
> shape (cursors, attention, parking), not the op model. The convergent op model is in
> `spikes/convergence.bl.md`.

Positions are `[row col]`; an op is `[from to text]`.

```beam-lisp
(ns omega.ed.spike (:require [proc]))

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

(defn offset->pos [text i]
  (let [ls (clojure.string/split (subs text 0 i) "\n" -1)]
    [(dec (count ls)) (count (last ls))]))

(defn locate
  "The unique span of `old` in `lines`: {:ok [from to]} | {:error why}."
  [lines old]
  (let [text (clojure.string/join "\n" lines)
        i (index-of text old)]
    (cond (nil? i) {:error "not found"}
          (some? (index-of (subs text (inc i)) old)) {:error "not unique"}
          :else {:ok [(offset->pos text i) (offset->pos text (+ i (count old)))]})))

(defn overlaps? [[f1 t1] [f2 t2]] (and (pos< f1 t2) (pos< f2 t1)))
```

```beam-lisp
(def ATTENTION-MS 10000)

(defn- rebase
  "An op from `actor` based on revision `base`, rewritten over every op
   committed since by someone else."
  [st actor base op]
  (reduce (fn [o e] (if (= actor (:actor e)) o (transform o (:op e))))
          op
          (filter (fn [e] (> (:rev e) base)) (:log st))))

(defn- commit [st actor op]
  (let [rev (inc (:rev st))
        cursors (into {} (map (fn [[a [f t]]] [a [(shift f op) (shift t op)]]) (:cursors st)))]
    (-> st
        (assoc :lines (apply-op (:lines st) op) :rev rev :cursors cursors)
        (update :log conj {:rev rev :actor actor :op op}))))

(defn- attended-by-other
  "A fresh human attention region (not `actor`'s) that `span` overlaps."
  [st actor span now]
  (some (fn [[who {:keys [region at]}]]
          (when (and (not= who actor) (< (- now at) ATTENTION-MS) (overlaps? span region)) who))
        (:attention st)))

(proc/defserver buffer
  (init [lines] (ok {:lines lines :rev 0 :log [] :cursors {} :attention {} :suggestions {}}))

  ;; a console's op: written against `base`, rebased over what it has not seen
  (handle-call [:op actor base op] [_from st]
    (let [op' (rebase st actor base op)
          st (commit st actor op')
          [f _ s] op'
          end (end-of f s)]
      (reply {:rev (:rev st) :op op'} (assoc-in st [:cursors actor] [end end]))))

  ;; an agent's exact-replacement edit; parked as a suggestion where a human looks
  (handle-call [:agent-edit actor old new now] [from st]
    (let [r (locate (:lines st) old)]
      (if (:error r)
        (reply r st)
        (let [[f t] (:ok r)
              who (attended-by-other st actor [f t] now)]
          (if who
            (noreply (assoc-in st [:suggestions actor] {:from from :span [f t] :new new :to who}))
            (let [st (commit st actor [f t new])]
              (reply {:ok (:rev st)} (assoc-in st [:cursors actor] [f (end-of f new)]))))))))

  (handle-call [:resolve agent accept?] [_from st]
    (let [{:keys [from span new]} (get-in st [:suggestions agent])
          st (update st :suggestions dissoc agent)]
      (if (not accept?)
        (do (GenServer/reply from {:rejected true}) (reply :rejected st))
        (let [[f t] span
              st (commit st agent [f t new])]
          (GenServer/reply from {:ok (:rev st) :accepted-by "human"})
          (reply :accepted (assoc-in st [:cursors agent] [f (end-of f new)]))))))

  (handle-call [:suggestions] [_from st]
    (reply (into {} (map (fn [[a s]] [a (select-keys s [:span :new :to])]) (:suggestions st))) st))

  (handle-call [:attend actor region now] [_from st]
    (reply :ok (assoc-in st [:attention actor] {:region region :at now})))

  (handle-call [:state] [_from st] (reply (select-keys st [:lines :rev :cursors]) st)))
```

```beam-lisp
(def buf (start buffer ["def read_number(s):"
                        "    return int(s)"
                        ""
                        "def other():"
                        "    pass"] {}))

;; the human's console types at rev 0 while the agent edits the same text
(println "agent :" (call buf [:agent-edit "t-17" "    return int(s)"
                              "    return int(s, 16) if s.startswith('0x') else int(s)" 0]))
(println "human :" (call buf [:op "human:me" 0 [[0 0] [0 0] "# hex ok\n"]]))
(let [st (call buf [:state])]
  (doseq [l (:lines st)] (println "  |" l))
  (println "cursors" (:cursors st)))

;; the human looks at `other`; the agent's edit there parks until the human decides
(call buf [:attend "human:me" [[4 0] [6 0]] 1000])
(def me (erlang/self))
(spawn (fn [] (erlang/send me [:agent-got (call buf [:agent-edit "t-17" "    pass" "    return 1" 2000] 5000)])))
(Process/sleep 50)
(println "pending:" (call buf [:suggestions]))
(println "human :" (call buf [:resolve "t-17" true]))
(println "agent :" (receive [:agent-got r] r (after 1000 :timeout)))
```

OBSERVED:

```text
agent : {:ok 1}
human : {:rev 2, :op [[0 0] [0 0] "# hex ok\n"]}
  | # hex ok
  | def read_number(s):
  |     return int(s, 16) if s.startswith('0x') else int(s)
  |
  | def other():
  |     pass
cursors {"human:me" [[1 0] [1 0]], "t-17" [[2 0] [2 55]]}
pending: {"t-17" {:new "    return 1", :span [[5 0] [5 8]], :to "human:me"}}
human : :accepted
agent : {:ok 3, :accepted-by "human"}
```

### 5.4 Consensus between agents: stigmergic, bitemporal buffers

There is no coordinator. Agents reach consensus the way omega's tasks already do, through marks left
in a shared medium. The buffer *is* that medium for one file. It is a ladder, and each rung only fires
when the one below it can't settle things:

| rung | situation | what happens | status |
|---|---|---|---|
| **0 · interleave** | ops don't overlap | rebased and merged; both cursors visible | OBSERVED (spike 1) |
| **1 · content CAS** | an exact-replacement's `:old` is gone | refused **with the story**: who moved it, from which cell, where. The agent re-reads and decides | OBSERVED (spike 2) |
| **2 · marks** | before editing, an agent reads | `read` returns text **plus fresh edit marks**: "t-17 edited rows 2–3 12 s ago in cell t-17/2". Edit marks decay like attention (agent half-life ≈ 60 s). An agent perceives the other before colliding | design |
| **3 · contention trace** | two actors CAS-fail on overlapping regions ≥ 2× within a window | the server leaves a `:contention` trace naming both tasks, the region and the cells. omega's existing context path (traces read through the `:context` hook) brings it into both tasks' next request. Convention (one system-prompt line): **the task with the older claim on the path keeps the region; the other `wait`s on it or `send`s a note** | design |
| **4 · human** | contention persists (≥ N traces) | the region shows both cursors in red with a merge prompt; `task/answer`-style | design |

This is consensus by deterministic tiebreak over shared state. The claims stay advisory (invariant 4)
and the tiebreak is a convention the medium makes visible, not a lock. omega already has every piece
this needs: traces, decay, `:context`, `send`, `wait`.

**Bitemporal, concretely.** Each op is one datom transaction, so both time axes come for free:
- **transaction time** — when the op landed: `as-of`, `history`, `changes`. "What did the file say when
  t-17 committed?" is one call (OBSERVED, spike 2).
- **valid time** — when the actor *meant* it: the op's tx carries `:db.valid/from` = the time of the
  revision the actor based it on. A rebased op has valid < tx, and that gap is exactly "landed after
  someone else's edit".
  - "What did t-23 believe the file was when it wrote this?" is `as-of` at its base.
  - "Which edits were written blind to each other?" is overlapping valid windows. That is the input to
    rung 3, and it makes conflict attribution a query rather than a log scrape.
  - OBSERVED: the pin supports `:db.valid/from` on the tx and `datom/valid-at`.
  - INFERRED, not tested: how `valid-at` resolves a card-one attribute across late-arriving facts. The
    design keeps the *op entities* as the bitemporal record and `:buf/text` as a tx-time convenience.

Same-position concurrent inserts and long-divergence merges are where position-shifting stops being
enough. That is the OT follow-up (FUP-003): Eg-walker (Gentle & Kleppmann 2024,
[arXiv:2409.14252](https://arxiv.org/abs/2409.14252)) fits a server that already keeps the op log.

### 5.5 Spike 2 (RAN): the op log as datom facts

Every committed op is one transaction. On the tx entity it carries the actor, the **cell** that caused
it, and `:db.valid/from`. Content CAS refuses with the story. Undoing a cell means compensating ops,
recorded as the new actor's, with the original kept.

```beam-lisp
(ns omega.ed.oplog (:require [proc] [datom]))

(defn pos< [[r1 c1] [r2 c2]] (or (< r1 r2) (and (= r1 r2) (< c1 c2))))
(defn end-of [[r c] s]
  (let [ls (clojure.string/split s "\n" -1)]
    (if (= 1 (count ls)) [r (+ c (count s))] [(+ r (dec (count ls))) (count (last ls))])))
(defn shift [p [from to text]]
  (let [[er ec] (end-of from text) [tr tc] to [pr pc] p]
    (cond (pos< p from) p
          (pos< p to) [er ec]
          (= pr tr) [er (+ ec (- pc tc))]
          :else [(+ pr (- er tr)) pc])))
(defn offset->pos [text i]
  (let [ls (clojure.string/split (subs text 0 i) "\n" -1)] [(dec (count ls)) (count (last ls))]))
(defn pos->offset [text [r c]]
  (+ c (reduce + 0 (map (fn [l] (inc (count l))) (take r (clojure.string/split text "\n" -1))))))
(defn slice [text [f t]] (subs text (pos->offset text f) (pos->offset text t)))
(defn apply-op [text [f t s]]
  (str (subs text 0 (pos->offset text f)) s (subs text (pos->offset text t))))

(def SCHEMA
  [{:db/ident :buf/path :db/valueType :db.type/string :db/unique :db.unique/identity}
   {:db/ident :buf/text :db/doc "Current text; its history IS the file's history (as-of)."}
   {:db/ident :buf/rev  :db/valueType :db.type/long}
   {:db/ident :op/id    :db/valueType :db.type/string :db/unique :db.unique/identity}
   {:db/ident :op/buf   :db/valueType :db.type/ref :db/index true}
   {:db/ident :op/rev   :db/valueType :db.type/long}
   {:db/ident :op/span  :db/doc "[from to] in the text it applied to"}
   {:db/ident :op/new   :db/valueType :db.type/string}
   {:db/ident :op/old   :db/valueType :db.type/string :db/doc "What it replaced: the inverse needs it."}
   ;; on the TRANSACTION: who, from which cell
   {:db/ident :tx/actor :db/valueType :db.type/string :db/index true}
   {:db/ident :tx/cell  :db/valueType :db.type/string :db/index true}])
```

```beam-lisp
(defn- commit
  "One op = one transaction: the op entity, the new text, and on the tx itself
   the actor and cell. :db.valid/from = when the actor INTENDED it."
  [st actor cell span new intended]
  (let [old (slice (:text st) span)
        rev (inc (:rev st))
        text (apply-op (:text st) [(first span) (second span) new])
        r (datom/transact! (:conn st)
            [{:db/id -1 :buf/path (:path st) :buf/text text :buf/rev rev}
             {:db/id -2 :op/id (str (:path st) "@" rev) :op/buf -1 :op/rev rev :op/span span :op/new new :op/old old}
             (cond-> {:db/id :db/current-tx :tx/actor actor :db.valid/from intended}
               cell (assoc :tx/cell cell))])]
    (assoc st :text text :rev rev
              :log (conj (:log st) {:rev rev :actor actor :cell cell :op [(first span) (second span) new] :old old :tx (:tx r)}))))

(proc/defserver buffer
  (init [[conn path text]]
    (ok {:conn conn :path path :text text :rev 0 :log [] :reads {}}))

  (handle-call [:read actor] [_from st]
    (reply {:text (:text st) :rev (:rev st)} (assoc-in st [:reads actor] (:rev st))))

  ;; exact replacement = compare-and-set on CONTENT. When it fails, say who moved it.
  (handle-call [:edit actor cell old new now] [_from st]
    (let [i (index-of (:text st) old)]
      (if (nil? i)
        (let [seen (get-in st [:reads actor] 0)
              who (filter (fn [e] (and (> (:rev e) seen) (not= actor (:actor e)))) (:log st))]
          (reply {:error (str ":old not found"
                              (when (seq who)
                                (str "; changed since you read it (rev " seen "): "
                                     (clojure.string/join ", " (map (fn [e] (str (:actor e) " in cell " (:cell e) " at row " (first (first (:op e))))) who)))))}
                 st))
        (let [span [(offset->pos (:text st) i) (offset->pos (:text st) (+ i (count old)))]
              st (commit st actor cell span new now)]
          (reply {:ok (:rev st)} (assoc-in st [:reads actor] (:rev st)))))))

  ;; compensating ops for everything `cell` did, newest first, each shifted
  ;; through what came after; refused (as data) if that region moved on since
  (handle-call [:revert-cell actor cell now] [_from st]
    (let [mine (reverse (filter (fn [e] (= cell (:cell e))) (:log st)))
          step (fn [st e]
                 (if (:error st) st
                   (let [[f _ s] (:op e)
                         later (filter (fn [x] (> (:rev x) (:rev e))) (:log st))
                         span (reduce (fn [[a b] x] [(shift a (:op x)) (shift b (:op x))])
                                      [f (end-of f s)] later)]
                     (if (= s (slice (:text st) span))
                       (commit st actor (str "revert:" cell) span (:old e) now)
                       (assoc st :error (str "rev " (:rev e) " was edited since; not reverting"))))))
          st2 (reduce step st mine)]
      (if (:error st2) (reply {:error (:error st2)} st) (reply {:ok (:rev st2)} st2))))

  (handle-call [:state] [_from st] (reply (select-keys st [:text :rev]) st)))
```

```beam-lisp
(def conn (datom/connect SCHEMA))
(def buf2 (start buffer [conn "reader.py" "def read_number(s):\n    return int(s)\n\ndef other():\n    pass\n"] {}))

;; two agents read, then race for the same line
(call buf2 [:read "t-17"])
(call buf2 [:read "t-23"])
(println "t-17:" (call buf2 [:edit "t-17" "t-17/2" "    return int(s)" "    return int(s, 16) if s.startswith('0x') else int(s)" 1000]))
(println "t-23:" (call buf2 [:edit "t-23" "t-23/1" "    return int(s)" "    return int(s.strip())" 1005]))
(println "t-23:" (call buf2 [:edit "t-23" "t-23/2" "    pass" "    return 0" 1010]))

;; what did cell t-17/2 do? — the trace `space e` shows instead of re-running (§7)
(def db (datom/db conn))
(println "t-17/2 did:" (datom/q '[:find ?rev ?new :in $ ?c :where [?tx :tx/cell ?c] [?o :op/rev ?rev ?tx] [?o :op/new ?new]] db "t-17/2"))

;; transaction time: the file as it was when t-17 committed
(def t17-tx (first (first (datom/q '[:find ?tx :where [?tx :tx/cell "t-17/2"]] db))))
(println "as-of t-17:" (pr-str (:buf/text (datom/entity (datom/as-of db t17-tx) [:buf/path "reader.py"]))))
(println "history   :" (count (datom/changes db (datom/lookup-ref db [:buf/path "reader.py"]) :buf/text)) "changes")

;; undo a cell = compensating ops, recorded as the human's; the original stays in history
(println "revert t-17/2:" (call buf2 [:revert-cell "human:me" "t-17/2" 2000]))
(println "now:" (pr-str (:text (call buf2 [:state]))))
(println "ops in log:" (count (datom/q '[:find ?o :where [?o :op/id _]] (datom/db conn))))
```

OBSERVED:

```text
t-17: {:ok 1}
t-23: {:error ":old not found; changed since you read it (rev 0): t-17 in cell t-17/2 at row 1"}
t-23: {:ok 2}
t-17/2 did: #{[1 "    return int(s, 16) if s.startswith('0x') else int(s)"]}
as-of t-17: "def read_number(s):\n    return int(s, 16) if s.startswith('0x') else int(s)\n\ndef other():\n    pass\n"
history   : 3 changes
revert t-17/2: {:ok 3}
now: "def read_number(s):\n    return int(s)\n\ndef other():\n    return 0\n"
ops in log: 3
```

What this shows:
- t-23's failed edit names t-17 and its cell (rung 1).
- t-23's edit to `other` still lands (rung 0).
- The cell's effects are one query.
- `as-of` reconstructs the file at the moment t-17 committed.
- Reverting t-17/2 undid only t-17's change and kept t-23's.

**Not covered by either spike:**
- broadcast to consoles;
- log truncation and compaction;
- selections, not just points;
- same-position insert tiebreak (FUP-003);
- grapheme vs codepoint columns (bl-ed is grapheme-indexed);
- marks and contention traces (rungs 2–3).

### 5.6 Routing omega's edits through buffers

- **A file port (C6, decided by round 3's "core changes are fine if known").** `prelude/read`, `write`
  and `edit` call `(:files sys)` instead of `File/*` directly. The default port is today's disk
  functions; the package installs a buffer-backed port:
  - `read` returns buffer text, so the agent sees what you see, plus edit marks (rung 2);
  - `edit` becomes `[:edit actor cell …]` (rungs 1–3 and parking for free).

  The cell id is `<task>/<step>/<tool-use-id>` (C4), read from the process dictionary that
  `prelude/-bind!` already sets (`:omega/task`, `:omega/cell`).
- *Superseded: advice.* Wrapping the prelude functions at runtime works (OBSERVED: redefining a function
  in another namespace took effect for existing callers in the same VM). But a seam omega owns is
  cleaner, and it needs no `advise` in beam-lisp.
- **L0, adoption (fallback).** File changes no buffer saw — `sh "sed -i …"`, an external editor — are
  diffed against the server's text when its file watcher fires. They are attributed to the cell whose
  OS processes were running at the time; reap tags already name them (`OMEGA_CELL_TAG`, `omega.reap`).
  Otherwise they go to the actor `disk`.

### 5.7 Disk is a projection; the human publishes on pause

Agents run tests against **disk**, so disk must follow the shared buffer. But half-typed human text
must not break an agent's test run.
- **Publish on pause (E5, decided).** The console batches the human's ops and sends them when typing
  pauses (≈ 1.2 s), on a motion, or on `C-s`.
- The server writes disk after each committed batch (debounced).
- Agent ops publish immediately.
- There is no "save" in the Lisp-machine sense. `C-s` only means "publish now".
- Cost: remote cursors see the human's text up to ~1 s late.

### 5.8 Four granularities of history, one stack

| tier | grain | store | cost | who reads it |
|---|---|---|---|---|
| op | one edit | buffer op log (datom) | one transact (ms) | cursors, CAS, marks, cell traces, revert |
| cell | one eval | the ops/tasks/msgs tagged `:tx/cell` | a query | `space e` on an effectful cell (§7) |
| turn | one model turn that changed files | jj change, described by the turn (§5.9) | jj describe + new ≈ 0.2–0.6 s; no mirror (§5.9) | review, "undo this turn" |
| commit | human decision | git (jj colocated) | — | the team |

### 5.9 jj per turn — autovcs, made good (E6)

> **Superseded by §15.1–15.2.** The spikes built native history (no jj) and showed checkpoints
> must be a `:tool/after` hook with per-path gating. This section is kept for the reasoning; its
> jj specifics are out of the plan.

The autovcs branch (PLAN-109) proved the split *jj in front, datom behind*. It records one jj change per
daemon command, mirrors jj's op log into its own datom store under `.autovcs/`, and spills the request
intent (`:req/by :req/why`) to JSONL first, because a second process could not write the store.
OBSERVED in its notes:
- checkpoint 1.4–1.8 s, of which the mirror (re-reading the op log) is 0.7–1.0 s;
- jj invocations 88–302 ms;
- the daemon hook it added lived in `lib/beam_lisp/daemon/executor.ex`. **That file is gone on main**
  (fa1a830f: "the whole daemon is beam-lisp"), and realm replaced the daemon again. So the autovcs
  merge has to re-seat its hook anyway. That is the opportunity.

With omega's world in the realm, three of autovcs' hard problems disappear, and the design gets
simpler, not bigger.

| autovcs problem | why it existed | in the omega world |
|---|---|---|
| intent is the one fact jj can't know; spilled to `requests.jsonl` before transacting | the mirror store had no single owner by construction | **the intent is already a fact**: the turn, its task, its cells and its ops are in `.omega/db`, written by the store's one owner. Nothing to spill |
| the mirror re-reads the op log (0.7–1.0 s) | facts had to be derived from jj | **no mirror for our own changes**: the world records `{:jj/change :jj/commit :jj/op}` on the turn entity as it checkpoints. A mirror is only needed for changes made *outside* omega (by hand, by another tool) and runs lazily, off the turn path |
| granularity = one daemon command (argv as `why`) | the daemon only knew argv | **one model turn that changed files** = one jj change. `by` = task id, `why` = the task's title + turn number, plus a trailer linking the home cell (`Omega-Task: t-41`, `Omega-Cell: journal/2026-10-03.bl.org::hex`) |

**"Turn" here = one model step that ran tools.**
- OBSERVED: `omega.loop` emits `:turn/start` per step (`loop.bl:158`), `:tool/result` per tool
  (`:132`), and `:turn/end` only when the *run* ends, idle or done (`:183`, `:194`). There is no
  per-step end event.
- The checkpoint therefore fires on the *next* `:turn/start` and on `:turn/end`. Each covers the step
  that just finished. No core change is needed, though a `:step/end` emit would be one line and name
  it honestly (§8.4, C5).

The hook is an omega extension (`:on` handlers) in the package, not the daemon's command hook. So it
fires per step whoever ran the task: bl-ed, CLI, MCP or headless. Checkpointing per step:

1. the turn ends;
2. the buffers flush to disk (agent ops are already published, §5.7);
3. if `jj/dirty?`: `jj describe -m "<title> · turn n\n\nOmega-Task: …"` → read change/commit/op →
   `jj new`;
4. transact `{:turn/id … :jj/change … :jj/commit … :jj/op …}`.

What this buys, each one query or one jj command:

| ask | answer |
|---|---|
| what did task t-41 change? | the jj changes on its turns → `jj diff -r <changes>`; the sidebar's **Diff** tab |
| undo this turn | `jj abandon <change>` (jj rebases what came after; a conflict becomes a jj conflict, shown in the buffer as both cursors' text — §5.4 rung 4) |
| undo this cell | compensating ops (§7, spike 2): finer than jj, and it works before the turn has even ended |
| why does line 42 look like this? | `jj file annotate` → change → trailer → task + home cell; bl-ed shows it as a margin decoration (blame that links to the conversation that wrote the line) |
| what did the human change between turns? | the human's ops since the last checkpoint become their own change, `by` = `human:me`, described by the ops' cells |

**Concurrency, the part autovcs left open (E17: (a), decided).** Several tasks in one working copy
produce one change per step, even though their edits interleave in time. Options:
- (a) **One shared working copy** (decided). Each checkpoint snapshots the whole tree and attributes the
  change to the turn that triggered it. Edits other tasks made since the last checkpoint go into that
  change too; their ops say who made them. A post-pass can `jj split` by the op log's per-actor paths
  when two tasks touched disjoint files.
- (b) **One jj workspace per task** (`jj workspace add`). Exact attribution, but agents no longer share
  a buffer. That breaks the second-cursor design, so it is only for tasks that ask for isolation
  (`:isolate` on the task cell, future).

The gate (autovcs's `bl check --changed`) runs *before* a checkpoint is described. **A failing gate
still checkpoints (E18: (a), decided)**, described as failing (`[gate ✗]`). The failure becomes a
`:finding` trace on the task and a red line on its card, so the human sees exactly which step broke
the build and can steer from that change. A refused checkpoint would hide the step instead.

What goes upstream into beam-lisp's `vcs` (useful beyond omega):
- `checkpoint!` takes `:trailers` and returns change/commit/op;
- `mirror!` becomes optional, lazy and paged (`--at-op`);
- the daemon hook is re-seated on realm (`vm.session/dispatch-command`'s `finally`, next to
  `idle/end!`).

Valid time can mark a checkpoint too: `:db.valid/from` = the turn's first op, so "the tree as the agent
believed it" and "the tree as recorded" both stay queryable.

### 5.10 `omega.vcs` — one protocol, jj today, beam-lisp native tomorrow (E17)

> **Superseded by §15.1:** native is today, and there is one implementation (`omega.history`). The
> protocol below survives as the contract suite; the "lessons" survive and are confirmed by
> `spikes/history.bl.md`.

jj is a backend, not the design. Everything above (§5.9) is written against a five-verb protocol. jj
is one implementation. A **native** implementation, history as datom facts with content-addressed
blobs (`:db.type/file`), is the other, and it is what the autovcs redesign should grow into.

**What the protocol is.** The smallest set of verbs omega actually calls, each a question omega asks
(§5.9's table):

| verb | omega asks | jj backend | native backend |
|---|---|---|---|
| `checkpoint!` tree meta | record this step | `jj describe` + `jj new` (snapshot is implicit) | one transaction: a `:change` entity, one blob per touched path, `:head` moved |
| `changes` q | what did t-41 change? / what touched this path? | `jj log -r 'description("Omega-Task: t-41")'` | a datalog query on `:change/by`, `:change/touch` |
| `tree-at` change | the tree as of this step | `jj file show -r` | walk parents, first blob per path wins |
| `diff` change | what this step did | `jj diff -r` | before/after trees of the touched paths |
| `abandon!` change meta | undo this step | `jj abandon` (rebases descendants) | a *compensating* change on head; refused with `{:conflict paths}` when a touched path moved on |

**What it teaches the autovcs redesign** (each one OBSERVED in the native spike below, or a
consequence of the protocol's shape):

1. **A change is a fact, not a derived view.** Its author and intent are attributes *written with it*
   (`:change/by`, `:change/why`). The mirror and the JSONL spill exist only because jj is the source of
   truth; with a native backend there is nothing to mirror.
2. **Content addressing is the blob store datom already has.** `:db.type/file` dedupes by sha, keeps
   bytes out of the index, and `as-of` resolves old bytes (`docs/datom-files-a-file-is-a-fact.md`).
   A blob per touched path per change is the whole storage model.
3. **Undo is compensation, not rewriting.** jj's `abandon` rewrites descendants. A fact log appends a
   change that restores the old text, and refuses as data when the path moved on. That is the same rule
   as cell revert (§7, spike 2), at a coarser grain. History is never lost, so steering (E18) always has
   the failing step to point at.
4. **Attribution is per path, so `split` is a query.** Each change lists the paths it touched; which
   actor touched which path comes from the op log (`:tx/actor`). E17's "split by per-actor paths" is a
   join, not a jj command.
5. **The working copy is the buffers.** In the native backend, `checkpoint!` receives `tree` from the
   buffer servers ({path text}), not from a disk scan. The snapshot cost jj pays (88–302 ms per call)
   turns into one transaction, because the world already knows exactly what changed.
6. **Git stays the exchange format.** A native history exports to git (and imports from it) at the
   human-decision tier (§5.8 "commit"). That is the one job jj does that the native backend should not
   reimplement on day one.

**Gaps a native backend must still close before it replaces jj:** merges (two heads), renames, binary
files over the blob tier, git export/import, `annotate` (blame) as an index rather than a walk, and
large-tree performance (the spike walks parents linearly).

**Spike 3 (RAN): the protocol and a native backend.** Names are illustrative; the shipped namespace is
`omega.vcs` (protocol) + `omega.vcs.jj` and `omega.vcs.native` (backends).

```beam-lisp
(ns omega.ed.spike.vcs (:require [datom]))

(defprotocol History
  (checkpoint! [h tree meta] "Record `tree` ({path text}) as a new change on head. meta = {:by :why}. → change id, or nil when nothing changed")
  (changes [h q] "Changes matching q ({:by actor} | {:path p} | {}), newest first")
  (tree-at [h change] "{path text} as of `change`")
  (diff [h change] "{path [old new]} that `change` introduced")
  (abandon! [h change meta] "A compensating change on head. → change id | {:conflict paths}"))

(def SCHEMA
  [{:db/ident :change/id     :db/valueType :db.type/string :db/unique :db.unique/identity}
   {:db/ident :change/parent :db/valueType :db.type/ref}
   {:db/ident :change/by     :db/valueType :db.type/string :db/index true}
   {:db/ident :change/why    :db/valueType :db.type/string}
   {:db/ident :change/touch  :db/valueType :db.type/ref :db/cardinality :db.cardinality/many}
   {:db/ident :blob/key      :db/valueType :db.type/string :db/unique :db.unique/identity :db/doc "change-id|path"}
   {:db/ident :blob/path     :db/valueType :db.type/string :db/index true}
   {:db/ident :blob/file     :db/valueType :db.type/file :db/doc "content-addressed bytes"}
   {:db/ident :blob/gone     :db/valueType :db.type/boolean :db/doc "the path was deleted in this change"}
   {:db/ident :head/of       :db/valueType :db.type/string :db/unique :db.unique/identity}
   {:db/ident :head/change   :db/valueType :db.type/ref}])

;; refs come back as entity ids: navigate them explicitly
(defn- ent [db eid] (when eid (datom/entity db eid)))
(defn- head [db] (ent db (:head/change (datom/entity db [:head/of "main"]))))
(defn- text-of [db blob] (when-not (:blob/gone blob) (datom/file-bytes db (:blob/file blob))))

(defn- tree-of [db change]
  (loop [c change acc {}]
    (if (nil? c) (into {} (remove (fn [[_ v]] (nil? v)) acc))
      (recur (ent db (:change/parent c))
             (reduce (fn [a b] (if (contains? a (:blob/path b)) a (assoc a (:blob/path b) (text-of db b))))
                     acc (map (fn [x] (ent db x)) (:change/touch c)))))))

(defn- commit! [conn tree {:keys [by why]}]
  (let [db (datom/db conn)
        h (head db)
        before (tree-of db h)
        touched (filter (fn [p] (not= (get before p) (get tree p))) (distinct (concat (keys before) (keys tree))))]
    (when (seq touched)
      (let [id (str "c" (inc (count (datom/q '[:find ?c :where [?c :change/id _]] db))))
            blobs (map-indexed (fn [i p] (let [t (get tree p)]
                                          (cond-> {:db/id (- -10 i) :blob/key (str id "|" p) :blob/path p}
                                            (nil? t) (assoc :blob/gone true)
                                            (some? t) (assoc :blob/file (datom/file t {:media-type "text/plain"})))))
                               touched)]
        (datom/transact! conn
          (concat blobs
                  [(cond-> {:db/id -1 :change/id id :change/by by :change/why why
                            :change/touch (vec (map :db/id blobs))}
                     h (assoc :change/parent (:db/id h)))
                   {:db/id -2 :head/of "main" :head/change -1}]))
        id))))

(defrecord NativeHistory [conn]
  History
  (checkpoint! [this tree meta] (commit! (:conn this) tree meta))
  (changes [this q]
    (let [db (datom/db (:conn this))]
      (->> (datom/q '[:find ?id ?by ?why :where [?c :change/id ?id] [?c :change/by ?by] [?c :change/why ?why]] db)
           (filter (fn [[_ by _]] (or (nil? (:by q)) (= by (:by q)))))
           (filter (fn [[id _ _]] (or (nil? (:path q))
                                      (some (fn [b] (= (:path q) (:blob/path (ent db b)))) (:change/touch (datom/entity db [:change/id id]))))))
           (sort-by (fn [[id _ _]] (- (erlang/binary_to_integer (subs id 1)))))
           (map (fn [[id by why]] {:id id :by by :why why})))))
  (tree-at [this change] (let [db (datom/db (:conn this))] (tree-of db (datom/entity db [:change/id change]))))
  (diff [this change]
    (let [db (datom/db (:conn this)) c (datom/entity db [:change/id change])
          before (tree-of db (ent db (:change/parent c))) after (tree-of db c)]
      (into {} (map (fn [b] (let [p (:blob/path (ent db b))] [p [(get before p) (get after p)]])) (:change/touch c)))))
  (abandon! [h change meta]
    (let [conn (:conn h) db (datom/db conn)
          d (diff h change)
          now (tree-of db (head db))
          stale (filter (fn [[p [_ new]]] (not= new (get now p))) d)]
      (if (seq stale)
        {:conflict (vec (map first stale))}
        (commit! conn (reduce (fn [t [p [old _]]] (if (nil? old) (dissoc t p) (assoc t p old))) now d) meta)))))

(defn native [] (->NativeHistory (datom/connect SCHEMA)))
```

```beam-lisp
(def hist (native))
(def c1 (checkpoint! hist {"reader.py" "def read_number(s):\n    return int(s)\n"} {:by "human:me" :why "initial"}))
(def c2 (checkpoint! hist {"reader.py" "def read_number(s):\n    return int(s, 0)\n"} {:by "t-41" :why "hex literals · step 2"}))
(def c3 (checkpoint! hist {"reader.py" "def read_number(s):\n    return int(s, 0)\n" "test_reader.py" "assert read_number('0x1f') == 31\n"} {:by "t-42" :why "tests · step 1"}))
(println "same tree  :" (checkpoint! hist (tree-at hist c3) {:by "t-41" :why "noop"}))
(println "log        :" (map :id (changes hist {})))
(println "by t-41    :" (changes hist {:by "t-41"}))
(println "touch test :" (map :id (changes hist {:path "test_reader.py"})))
(println "diff c2    :" (diff hist c2))
(println "abandon c2 :" (abandon! hist c2 {:by "human:me" :why "undo t-41 step 2"}))
(println "head tree  :" (tree-at hist (:id (first (changes hist {})))))
(println "again c2   :" (abandon! hist c2 {:by "human:me" :why "undo twice"}))
```

OBSERVED:

```text
same tree  : nil
log        : (c3 c2 c1)
by t-41    : ({:id "c2", :why "hex literals · step 2", :by "t-41"})
touch test : (c3)
diff c2    : {"reader.py" ["def read_number(s):\n    return int(s)\n" "def read_number(s):\n    return int(s, 0)\n"]}
abandon c2 : c4
head tree  : {"reader.py" "def read_number(s):\n    return int(s)\n", "test_reader.py" "assert read_number('0x1f') == 31\n"}
again c2   : {:conflict ["reader.py"]}
```

What this shows:
- Nothing changed means no change.
- Querying by actor and by path works.
- Undoing t-41's step kept t-42's test file.
- Undoing it twice is refused, naming the path.

Two datom facts found writing it:
- a ref attribute returns the raw entity id, not a navigable entity, so the spike walks with `ent`;
- a ref attribute does not accept a lookup-ref vector in transaction data.

The `omega.vcs` namespace layout:

```text
omega/vcs.bl.md          the History protocol + the checkpoint policy (when, meta, trailers, gate) — backend-free
omega/vcs/jj.bl.md       JjHistory: shells out through beam-lisp's `vcs.jj`; trailers carry Omega-Task / Omega-Cell
omega/vcs/native.bl.md   NativeHistory: datom + :db.type/file; the shape the autovcs redesign starts from
omega/vcs/test.bl.md     ONE contract suite, run against every backend: the spike's assertions, plus
                         merges/renames/conflicts as they land. A backend is done when the suite is green.
```

The **contract suite** is the teaching artifact. The autovcs redesign starts by making a beam-lisp
`vcs` backend pass it, so "native replaces jj" becomes a test result, not a migration plan.

## 6. Attention — a transient part of the domain model

A sixth kind beside actor, task, msg, trace and turn. It is **transient**: kept in an ephemeral conn the
package owns (the same pattern as `omega.ui.web`'s second conn), never in the durable log.

```clojure
;; design sketch — the package's ephemeral schema
[{:db/ident :attn/actor  :db/valueType :db.type/string :db/unique :db.unique/identity}
 {:db/ident :attn/path   :db/valueType :db.type/string :db/index true}   ; file or task buffer
 {:db/ident :attn/region}                                                ; [[r c] [r c]]
 {:db/ident :attn/mode   :db/valueType :db.type/keyword}                 ; :looking :selecting :typing :editing
 {:db/ident :attn/at     :db/valueType :db.type/long}]                   ; strength decays from here
```

- **Symmetric** (the human is just an actor). A human's attention is their viewport and selection,
  reported by the console (≤ 4 Hz, on change). A task's attention is its cursor, which is the same
  thing as rung 2's edit mark: **edit marks are agent attention.** One mechanism, two readers.
- **Decay:** strength = 2^-(age/half-life). Half-lives: `:typing` 3 s, `:looking` 10 s, agent
  `:editing` 60 s. Silence is absence.

| reader | how |
|---|---|
| buffer server | parks agent edits overlapping fresh human attention (§5.2); returns agent marks on `read` (§5.4 rung 2) |
| a task's next request | a `:context` hook adds one line *when scope or claims overlap*: "the human is looking at reader.py:5–6 (typing)" |
| the card | "you're looking at this" / "t-41 is reading reader.py:40" |
| durable record | only consequences: an accepted/rejected suggestion becomes a `:reply` msg or a `:decision` trace |

Privacy: attention is shared only with tasks whose scope overlaps the attended path; `space a .`
toggles sharing per console.

## 7. Cells that changed the world are not re-runnable

### 7.1 The rule

A cell's last run is recorded as the set of **world effects** it caused:
- buffer ops with `:tx/cell` = that cell (§5.5);
- tasks it opened;
- messages it sent;
- disk changes attributed to it (§5.6 L0).

If that set is non-empty, `space e` **does not run the cell**. It shows the trace instead:

```text
#+RESULTS: t-41/2
╭ ✎ this cell changed the world — not re-running ─────────────────────────────────────────╮
│ reader.py @1   −    return int(s)                                                        │
│                +    return int(s, 16) if s.startswith('0x') else int(s)                  │
│ by t-41 · 14:02:11 · landed after nothing · still present                                │
╰ d diff · r revert (compensating ops) · c copy as a new cell · ↵ jump to rev ───────────────╯
```

- **Why not re-run:** the effect already happened and is still there, so re-applying it is a different
  act with a different meaning. The trace is the true answer to "what does this cell do".
- **`r` revert** writes compensating ops (spike 2). It is refused, as data, if the region has moved on.
- **`c` copy as a new cell** is the honest way to "run it again": a fresh act with its own effects and
  its own trace.
- **Re-runnable cells stay re-runnable:** pure ones, reads, `sh` that touched nothing (a test run),
  `def`s.

### 7.2 Effects as references — the same mechanism as task cells

The `#+RESULTS` of an effectful cell is a reference, like a task cell's:

```org
#+RESULTS: c3
: #omega/effect {:cell "c3" :ops ["reader.py@1"] :tasks [] :msgs []}
```

So there is one rule for every livebook: **a result that is a value is shown; a result that is a
reference to the world is transcluded.** `:task` cells and effectful code cells are the same thing seen
from two sides. This holds for the human's own `.bl.org` notes too, once bl-ed's eval goes through the
world (§8.2): a note cell that called `(spit …)` or `(edit …)` gets the same treatment.

### 7.3 Knowing beforehand: the footprint warning

Before a *first* run, `system.footprint` (`priv/lib/system/footprint.bl`, `{resource → mode}`) can
predict whether a cell writes. An optional badge on the cell header (`✎ writes`) and a confirm on
`space e` handle cells you didn't write.
- OBSERVED gap: the op table classifies `:Elixir.File :write` but not `File/write!` / `File/rm`. Those
  fall to the opaque `:W`, which is still "effectful", just not per file.
- Inter-procedural truth (seeing through `omega.prelude/edit`) needs `system.analyze`, which the survey
  reports red after a merge (PLAN-157 W0; not re-verified).
- **The record (§7.1) is the authority; the footprint is a hint.**

## 8. One world, many runners

### 8.1 The constraint (OBSERVED)

- A durable datom store has **one OS-process owner**. `fjall-open` takes an exclusive flock
  (`priv/lib/datom/store-fjall.bl:19-45`). A second process gets `:store-already-open`, which omega
  rethrows as "another omega already has … open" (`src/omega/env.bl:82-95`).
- A second open *inside the same process* is allowed and shares the lock, which means two views that
  disagree until one writes (autovcs finding).
- Today's `bin/omega` and `bin/omega-ui` each open the store and close it on exit, so they alternate.
  They cannot coexist.

### 8.2 The shape on realm (PLAN-158, assumed merged)

Realm's vocabulary (`docs/design/realm/vocabulary.md`), and where omega sits in it:

| realm noun | what it is | omega's place |
|---|---|---|
| **vm** | one `beam.smp`, one build; `warm` role = one per user per build when shared | the OS process the world lives in |
| **realm** | a project alive in a vm: `<name>@<instance>`, a capped env fork, its members | **the omega world is per realm**: one project, one realm, one world |
| **member** | a process the realm owns, with a role: `run`, `app`, `repl`, `schedule`, `index` | **the world is an `app` member, role `:omega`**. Every runner's command is a `run` member that *talks to* it |
| **route** | a name that reaches a port (`omega.<project>.test`) | the console socket's address |
| **build** | the code a vm runs | omega's pinned `:bl` |

What realm gives the world for free (OBSERVED in the branch):
- **Lifetime.** `bl realm stop` drains exactly the realm's members (`vm.owner/halt`). The world shuts
  down with its project, and nothing else does.
- **Liveness.** The idle clock counts "a realm process alive" and "a project route held" as busy
  (`vm.session/busy?`). A running world keeps its VM warm; a world with no running tasks and no console
  can let it expire (§8.5).
- **Visibility.** `bl realm` and `/machine` list members and routes, so `omega` shows up as a member
  beside `index` and the schedules, and `bl realm stop` is the one-liner to stop it.
- **Concurrency.** Every attached command is its own process under the realm's env
  (`vm.core/run`). A CLI command, a `bl doc run` and the world's own tasks run side by side.

The world:

```clojure
;; design sketch — omega.world: idempotent per realm
(defn world!
  "The realm's omega world, starting it on first use. Every runner calls this."
  []
  (or (proc.reg/whereis [:omega-world (realm-id)])
      (vm.manager/serve (realm-id) :omega                         ; an `app` member: drained with the realm
        (fn []
          (let [root (realm-root)
                e    (env/open-durable! (env/db-path root nil)     ; THE one owner of .omega/db
                                        {:schema (extensions-schema)}) ; C1: ed + jj attrs, one store
                sys  (-> (task/start-system e (profile :default))
                         (ext/install (extensions)))]              ; ed, vcs, notify, jev-gate …
            (task/recover! sys)
            (serve-socket! sys)                                    ; §9; claims route `omega`
            (proc.reg/register! [:omega-world (realm-id)] {:sys sys})
            (park-forever))))))
```

| runner | becomes |
|---|---|
| `bin/omega "goal"` | a `run` member: `(world!)` → `task/open!` with a home cell in today's journal (§3.7) → follows the task by `env/sense` → exits. The task keeps running in the world |
| `bl doc run --tasks plan.bl.org` | a `run` member: evaluates `:batch` task cells through the world. Results are written **through the buffer server for that file** (single writer), so an open console sees the reference land as an `omega` op |
| bl-ed console | socket to the world's route; every intent is the same verb |
| `omega-ui` | another `app` member (live.app) reading the same `sys` in-process |
| MCP | the realm's MCP tools gain `task_new` / `task_say` / `task_answer`, over the same verbs |
| `bl realm` | shows `omega` as a member: tasks running, cost today, the console route |

Coexistence then follows from two facts:
1. **There is one world per realm, so there is one truth.**
2. **Every task has a home cell, so every task is visible in documents** however it was opened. A task
   opened by the CLI at 9:00 shows up as a card in `journal/2026-10-03.bl.org`, live, when you open
   bl-ed at 9:05.

**Cold fallback.** With `--cold` or no warm VM, `bin/omega` opens the store itself, as today, and the
flock keeps that honest. If a world is running in a VM, the cold open fails with `:store-already-open`;
the CLI then says "a world is running; attach with `--warm`" instead of today's generic message.

### 8.3 One VM, many omega projects — what breaks (OBSERVED)

Realm's shared mode (`:vm "shared"`, `--share-vm`) puts several projects' realms in **one** VM. The realm
caveats name the general rule: "an env fork isolates *names and capabilities*, not *code*"
(`caveats.md` §3). For omega that rule bites concretely. Two probes, two omega worlds in one VM with two
roots and two in-memory envs:

```text
sequential:  A's t-1 defines `secret`; B's t-1 then reads it        →  "b sees secret=from-a"
concurrent:  A's t-1 sleeps then writes a.txt; B's t-1 writes b.txt
             A root: []    B root: ["a.txt" "b.txt"]    A claims: 0    B claims: 2
```

The concurrent probe, runnable (it prints the cross-write; C2's regression test asserts the opposite):

```beam-lisp
(ns omega.ed.probe.shared-vm
  (:require [omega.env :as env] [omega.task :as task] [omega.loop :as loop] [omega.codemode :as cm]))

(defn- project [nm]
  (let [root (str "/tmp/omega-shared-" nm "-" (erlang/unique_integer (to-list [:positive])))]
    (File/mkdir_p! root) root))
(def ra (project "a"))
(def rb (project "b"))
(defn- script [code] [(loop/call-tool "eval" {:code code}) (loop/say "ok")])

;; A's cell sleeps, then writes; B's task registers in between
(def sa (task/start-system (env/open) {:step (loop/by-goal {"a" (script "(Process/sleep 1500) (write \"a.txt\" \"by A\")")})
                                       :tools cm/tools :root ra}))
(def sb (task/start-system (env/open) {:step (loop/by-goal {"b" (script "(write \"b.txt\" \"by B\")")})
                                       :tools cm/tools :root rb}))
(def ta (task/open! sa {:goal "a"}))
(Process/sleep 300)
(def tb (task/open! sb {:goal "b"}))
(task/await sa ta 20000)
(task/await sb tb 20000)
(println "ids      :" ta tb)
(println "A root   :" (vec (sort (File/ls! ra))))
(println "B root   :" (vec (sort (File/ls! rb))))
```

Three globals cause it:

| global | where | effect in a shared VM |
|---|---|---|
| `omega.prelude/SYSTEMS` | an atom keyed by **task id** (`prelude.bl:21-24`) | task ids are per-env counters, so both projects' first task is `t-1`. The second registration wins, and **A's eval ran with B's system: B's root, B's env, B's claims**. A wrote into B's project |
| task namespaces | `omega.task.<id>` (`codemode.bl:48`) | both `t-1`s share one namespace: definitions leak across projects |
| `omega.stream` pg group | one `:omega/stream` group per node (`stream.bl`) | every console receives every project's deltas |

This is a real cross-project write in a supported configuration, not a cosmetic issue. It is the first
core change (§8.4, C2), and it is needed whatever happens to bl-ed.

### 8.4 Core changes, named ahead of time

The user allowed core changes provided they are known in advance. These are all of them; each is
additive, and the current tests and playground keep their meaning.

| # | change | where | why | size |
|---|---|---|---|---|
| **C1** | `env/open` takes `:schema` (extra attribute defs, concatenated after `schema/all`) | `omega.env/open`, `open-durable!` | E4(b): ed ops, effects, jj changes and attention-derived facts live beside tasks and join in one query. OBSERVED: a store created without the extra attrs, reopened with them, reopened without, then with again: old facts readable, writes accepted, the package's facts survive the package-less session, and the one-query join (op → task goal → cell) works | ~5 lines |
| **C2** | **task ids are qualified by world**; registries and namespaces are keyed by `[world-id task-id]` | `prelude` (SYSTEMS, DONE), `codemode/task-ns`, `stream` group | the §8.3 cross-project write. `world-id` = the realm id, or a fresh token for an in-memory env. `task-ns` becomes `omega.w.<world>.<task>`; the stream group becomes `[:omega/stream world]` | ~20 lines |
| **C3** | project policy in an `:omega` section of the *project's* `env.bl`, made valid by **apps declaring their own keys** in beam-lisp, and validated by omega's own reader (§8.4.1) | `bl.env` (beam-lisp: app-declared keys) + `omega.config` (new) | one declared place for project policy, readable by the world and by `bl realm show` | beam-lisp ~30 + reader |
| **C4** | the cell id carries the tool-use id: `<task>/<step>/<tool-use-id>` instead of `<task>.<unique>` | `codemode/run-eval` | the effect record (§7) and jj trailers name a cell the transcript can show; today's id is opaque | ~3 lines |
| **C5** | `:step/end` emit after each tool step (`{:task :step :tools}`) | `omega.loop`, beside `:turn/start` | names the jj checkpoint point honestly (§5.9); today it would be inferred from the next `:turn/start` | 1 line |
| **C6** | `prelude/read`, `write`, `edit` dispatch through a **file port** (`(:files sys)`, default = today's disk functions) | `omega.prelude` | replaces §5.6's advice: the package installs a buffer-backed port instead of redefining core functions. `advise` is then not needed in beam-lisp | ~15 lines |
| **C7** | `omega.cli` attaches to the realm's world when one is running (`--warm`), cold otherwise | `omega.cli` + `bin/omega` | §8.2 runner coexistence | ~30 lines |

**C8, C9: added by the spikes, see §15.5 and §15.3.** C8 = the executor caches a task's turns and
cost (usage append-only), fixing the O(turns) re-read per step. C9 = `edit`/`write` report a claim
conflict in their result instead of dropping it.

C6 retires §5.6 L1 (advice). The cleaner design is a seam omega owns, and L0 adoption stays for writes
that bypass it (`sh`).

#### 8.4.1 C3 — whose config is it? Three layers, each with one owner

The user's question was whether this belongs in an omega config rather than `env.bl`. **Both**, because
there are three different things here, with three owners:

| layer | file | owner | holds | example |
|---|---|---|---|---|
| **project policy** | the project's `env.bl` → `:omega {…}` | the project (committed, shared by the team) | how *this project* is worked on by agents | journal dir, which profiles exist, jj per step on/off, the gate command, idle timeout, scope defaults |
| **personal taste** | `~/.config/omega/config.bl` (and `.env.local.bl`'s `:omega` for per-checkout overrides) | one developer | how *I* like omega anywhere | default model, card density, notification channel, attention sharing, keybindings |
| **omega's own build** | omega's repo `env.bl` | omega the program | omega's own name, paths, `:bl` pin | `{:name "omega" :paths ["src"] :bl "commit:…"}` |

The omega repo's own `env.bl` is the third row, not the first. omega *working on a project* reads that
project's `:omega`, merged under the user's config, over omega's defaults. Precedence follows realm's
overlay rule (`vm.spec/overlay`: deep merge, local wins):

```text
omega defaults  <  ~/.config/omega/config.bl  <  project env.bl :omega  <  project .env.local.bl :omega
```

The project wins over the user for policy (the team's gate is not a personal choice). The user's
`.env.local.bl` is the escape hatch, as it already is for ports and caps. Secrets never go in either:
API keys stay in `.env` / the process environment, as `omega.llm` reads them today.

**Why the project file, not only an omega config.** The policy travels with the repo. A teammate who
clones it and runs omega gets the same journal dir, gate and profiles, and `bl realm show` can display
them next to the project's ports and schedules. A hidden omega config would make the team's agent policy
invisible to the team.

**Apps declaring their keys (the beam-lisp half).** OBSERVED: `bl.env/normalize` refuses any key not in
its fixed `known-keys`. `{:omega {…}}` → `("unknown key omega")`. So does `{:apps {…}}`, a key realm's
own `vm.spec` reads (`spec.bl:122`); that existing inconsistency is a small beam-lisp bug in its own
right. The fix generalises both:

- An app declares the top-level key it owns *and its validator*, as data, in a namespace beam-lisp can
  find without running the app: `{:key :omega :ns "omega.config" :validate "omega.config/validate"
  :doc "…"}` under an `:extends` entry (or discovered on the project's `:paths`).
- `bl.env` keeps refusing unknown keys, which stays right: a typo'd `:omgea` is still an error. But a
  declared app key is passed to its validator, whose errors merge into `:errors` with the key's name, the
  same "report all problems as data" contract.
- An app key whose validator cannot be loaded is a warning, not an error. The project still runs without
  that app.
- `:apps` (realm's side-apps) becomes a built-in declared key, which fixes the inconsistency above.

The omega half is `omega.config`: `validate` (shape errors as strings), `read` (the merged layers above
→ one map), and the defaults. The world and every runner read the same map.

### 8.5 Lifetime: when the world sleeps

The world is an `app` member, and realm counts a live member as busy. An idle world must therefore *leave*
for the VM to be able to idle-expire. The rule: the world stops itself after `:omega {:idle 1800}`
seconds with no running or waiting task and no attached console. The next runner's `(world!)` starts it
again: `recover!` re-reads the store, `:waiting` tasks re-park, and nothing is lost, because the store is
the truth. A task that is `:running` or `:waiting` keeps the VM warm, which is what a scheduled or
long-running agent needs.

### 8.6 Headless task cells

`bl doc run --tasks FILE`:
- starts every `:batch` task cell whose `:after` deps are met;
- writes the references;
- with `--follow`, prints each task's turns (the CLI formatter, `omega.cli/follow!`) and exits when
  they all reach `:idle|:done`; without it, returns immediately.

`--check` (bl.doc's drift mode) reports which task cells would start. A plain `bl doc run` never spends
tokens.

## 9. The wire: one socket per console

Up:
- `[:op path base ops]`
- `[:attend path region mode]`
- `[:intent op payload]` (`:task/open :task/say :task/steer :task/answer :task/cancel :suggestion/resolve :cell/revert`)
- `[:eval ns form-text ed-value]`

Down:
- `[:buf/op path rev actor op]`
- `[:buf/cursor path actor sel]`
- `[:buf/marks path marks]`
- `[:view key value]` (cards: `omega.ui.model/task-row`; effect traces)
- `[:stream task delta]`
- `[:suggest path actor span new]`

**Views, not facts.** The world runs `env/sense` per referenced task and pushes rows. The console never
queries datom. The vocabulary follows live.socket's (`[:assign] [:intent] [:navigate]`,
`priv/lib/live/socket.bl:47-58`), but its downstream is line ops, not hiccup patches. bl-ed's
`host.mjs` gains one WebSocket beside its `fetch` calls.

## 10. What bl-ed grows (ranked by what this design needs)

1. **A cell-kind registry.** *(Revised by §15.6: a task cell keeps its own `:task` kind and is lifted
   in the package, never `:cell`; upstream only `write-results` changes.)*
   - `bl.doc.spans` takes `:cell-kinds` in opts, as data, keeping the shared portable scanner pure.
   - `bl.doc`'s runner dispatches evaluation by kind, and `write-results` inserts after any cell.
   - With no package, the block stays prose. That *is* the independence property.
2. **`:` on the BEAM; `ed.lisp` deleted.** `:` sends the form text and the editor value to the world.
   It evaluates in the console's session namespace with `(ed)` bound; a returned `ed` replaces the
   console's state.
   - `ed.*` running on BEAM is INFERRED from the README (`ed.selftest` identical on BEAM and JS).
   - Needs a BL value reader/printer in `rt.mjs`.
   - Latency unmeasured.
   - bl-ed's own `/api/eval` goes through the world too, which gives every livebook §7.
3. **Extension points are tables.** Commands already resolve by name through
   `(merge table (:user-commands ed))`. Packages `merge` commands, keys, cell kinds, presentation types,
   decorations and effect handlers; uninstall is exact. Hot-loading console code means compiling with
   `priv/lib/js/emit.bl` on the warm VM, `import()`, and merging. Live redefinition of internal `ed.*`
   functions is later (namespace slots instead of consts; PLAN-161 D6).
4. **Decorations.** Virtual rows (cards, effect traces), gutter/margin marks, remote cursors and
   selections, ghost text — all data computed by package functions of `(ed, views)`.
5. **Windows.** `ed` becomes `{:buffers :windows :focus}`; the 72 commands lift to the focused window;
   a sidebar is a window.
6. **Presentations.** Segments carry `:present {:type :key}`; the palette filters by the selected
   object's type; commands take presentations as arguments.
7. **Marks** that move with edits (`t/shift-pos` exists): streaming regions, suggestion anchors.
8. **"Modes" → "states"** for normal/insert/select, freeing *mode* for major/minor modes.
9. *(dropped: a first-class `advise` in beam-lisp. C6's file port makes it unnecessary for this design;
   it is still a good Lisp-machine primitive on its own merits.)*

## 11. The package, as files

```text
<project>/env.bl              {:omega {:journal "journal" :profiles {...} :vcs {:backend :jj :per :step :gate [...]} :idle 1800}}  (project policy, §8.4.1)
~/.config/omega/config.bl     {:model "..." :card {:density :urgent} :attention {:share true}}   (personal taste)
~/.bl-ed/init.bl.org          (ed/use omega)                                                       (editor wiring only)
omega/ed/omega.bl.org         the package: prose + cells, one namespace per heading
  * World                     :on world   — an `app` member of the project's realm
    ** World                  world!, store ownership, recover, idle exit, schema contribution
    ** Buffers                buffer defserver, op log, marks, contention traces, file port (C6)
    ** Attention              ephemeral conn, decay, the :context hook
    ** Cells                  :task evaluator, home cells & journal, :after, TODO sync, effect records
    ** VCS                    per-step jj checkpoint, trailers, gate, annotate (§5.9)
    ** Adoption               disk changes no buffer saw (L0)
    ** Socket                 the §9 vocabulary, route `omega`
  * Console                   :on console — compiled to JS, hot-loaded
    ** Card                   #omega/task decoration, density config
    ** Effect trace           #omega/effect decoration, revert/copy
    ** Sidebar                task:<id> fact buffer, tabs, composer
    ** Cursors & suggestions  remote cursors, marks, ghost text
    ** Keys                   space a … · card keys · ]t [t
```

```clojure
;; design sketch — one value shape for omega extensions and bl-ed packages
(ed/defpackage omega
  {:cell-kinds    {:task {:eval omega.ed.cells/eval-task}}
   :data-readers  {'omega/task omega.ed.cells/task-ref 'omega/effect omega.ed.cells/effect-ref}
   :presentations {:omega/task   {:commands [:omega/open :omega/steer :omega/cancel :omega/answer :omega/follow]}
                   :omega/effect {:commands [:omega/diff :omega/revert :omega/copy-as-new]}
                   :ed/region    {:commands [:omega/new-task-here]}}
   :decorations   {:card omega.ed.card/rows :effect omega.ed.effect/rows
                   :cursors omega.ed.remote/cursors :ghost omega.ed.remote/ghost}
   :keys          {:normal {"space a n" :omega/new-task-here "] t" :omega/next-card "[ t" :omega/prev-card}}
   :omega-ext     {:name :ed
                   :schema omega.ed.schema/all                         ; C1: joins omega's store
                   :hooks {:context omega.ed.attention/context-hook}
                   :on    {:turn/start omega.ed.vcs/checkpoint-prev    ; until C5's :step/end
                           :turn/end   omega.ed.vcs/checkpoint-prev}}})
```

## 12. Facts found on the way

- OBSERVED:
  - `bl.doc.spans` exists only on `prototype/bl-js-actors`, not on beam-lisp main (`f4906fd4`), so it is
    absent from omega's pin. Building §3/§10.1 needs that branch merged to main, then a re-pin; FUP-001
    already needs a re-pin.
  - omega's pin supports tx metadata (`{:db/id :db/current-tx …}`) and `datom/valid-at` (probe +
    spike 2).
  - A schema attribute transacted at runtime into omega's env **does not take effect**: the connection's
    schema map is fixed at `connect` (`datom/schema.bl` header, "the map is an index of them"). Hence
    C1: schema is passed at open.
  - C1 is safe across sessions: open without the extra attrs, with them, without, with again. Old facts
    stay readable, writes are accepted, the package's facts survive the package-less session, and the
    op → task → cell join is one query.
  - Multi-source datalog (`:in $ed $om`) is refused ("invalid query"), which is another reason for one
    store.
  - **Two omega worlds in one VM cross-write** (§8.3): `prelude/SYSTEMS` is keyed by bare task id.
    That is C2, and it matters as soon as realm's shared mode is used.
  - `proc/defserver` with `noreply` + `GenServer/reply` runs inside a literate file under `bl run`.
  - realm: the world fits as an `app` member (`vm.core/serve` → `owner/spawn-in`); a live member keeps
    the VM busy (`vm.session/busy?`); sharing a VM is the project's declaration (`:vm "shared"`), never
    the build's default.
  - autovcs predates main's deletion of the Elixir daemon (fa1a830f), so its `executor.ex` hook cannot
    merge as is. The re-seat point on realm is `vm.session/dispatch-command`.
  - `omega.loop` emits `:turn/start` per step but `:turn/end` only per run (`loop.bl:158,183,194`).
- INFERRED:
  - `omega.ui.model/task-row` is already the card's data.
  - The jj describe + new cost of 0.2–0.6 s per step is extrapolated from autovcs's measured
    per-invocation 88–302 ms; not measured on omega.

## 13. Decision register

Status: **user** = decided by the user · **lean** = proposed, awaiting confirmation · **open** = needs the user.

| # | decision | status | resolution / lean |
|---|---|---|---|
| E1 | parked edit vs eval deadline | user | `{:pending :suggestion}` before the deadline; outcome as a message |
| E2 | two agents, one file | user | interleave; consensus ladder §5.4 (marks, contention traces, older-claim tiebreak); OT/Eg-walker = FUP-003 |
| E3 | where the world lives | lean | an `app` member (role `:omega`) of the project's realm, sole owner of `.omega/db`; runners are `run` members that attach; cold fallback = today's direct open (§8.2) |
| E4 | where package facts live | user | (b) omega's store, via C1 `:schema` at open (§8.4) |
| E5 | when human text reaches disk/agents | user | (a) publish on pause ≈1.2 s |
| E6 | jj tier | user | (a) opt-in, one jj change per tool step, intent as omega facts (no spill, no mirror on the hot path), trailers to the home cell (§5.9) |
| E7 | journal location | user | (a) `journal/YYYY-MM-DD.bl.org`, committed; `!*` deprecated |
| E8 | task cell implicit context | lean | `:context heading` default |
| E9 | finished task result | lean | rewritten once at terminal with summary/touched (self-contained docs) |
| E10 | effect authority | lean | the record decides re-runnability; footprint only warns before a first run |
| E11 | card | user→lean | `:urgent` density default (height = urgency), config `:omega.card` |
| E12 | merge order | user | bl-js-actors, realm and autovcs all merged to beam-lisp main before implementation; omega re-pins once (W0) |
| E13 | routing agent edits | lean | C6 file port (supersedes advice); L0 adoption for writes that bypass it |
| E14 | attention privacy | lean | shared only with scope-overlapping tasks; per-console toggle |
| E15 | core changes | lean | exactly C1–C7 (§8.4); anything else found during implementation is raised before it lands |
| E16 | one VM, many omega projects | lean | C2 is a prerequisite for realm's shared mode; until C2 lands, an omega project declares `:vm "own"` |
| E17 | concurrent tasks vs history changes | user | (a) one shared working copy, a change per step attributed to the stepping task, split by per-actor paths when disjoint; behind the `omega.vcs` History protocol with jj and native backends and one contract suite (§5.10) |
| E18 | gate failure at checkpoint | user | (a) checkpoint anyway, described `[gate ✗]`, plus a `:finding` trace and a red card line, so the human steers from the failing step |
| E19 | world idle exit | lean | stop after `:omega {:idle 1800}` with no running/waiting task and no console; restart on the next runner (§8.5) |
| E20 | where config lives | lean | three layers with one owner each: project policy = project `env.bl :omega`; personal taste = `~/.config/omega/config.bl`; omega's build = omega's repo `env.bl`. Precedence defaults < user < project < `.env.local.bl` (§8.4.1) |
| E21 | app-declared `env.bl` keys | lean | apps declare key + validator as data; `bl.env` dispatches, keeps refusing undeclared keys; `:apps` becomes built-in (§8.4.1) |
| E22–E26, E6′, E17′ | spike-driven | lean | see §15.7 (checkpoint hook, per-path gate, unpublished overlay, id-less cells, convergent op model; native history replaces jj) |

## 14. Build order

| wave | delivers | proves |
|---|---|---|
| W0 | re-pin on merged main; core C1, C2, C4, C5 with tests (C2: the §8.3 probe becomes a regression test that must show two roots untouched by each other); C3: app-declared keys in beam-lisp + `omega.config` | omega's suite green; two worlds in one VM no longer cross-write; `{:omega {…}}` validates in a project's `env.bl`, `{:omgea …}` is still refused |
| W1 | `world!` as a realm `app` member; C6 file port; buffer servers with the op log (spike 2 → package); disk publish; C7 CLI attach | `bin/omega` and a REPL client share one world; an agent's edit is an op with a cell tag; `bl realm` lists `omega` |
| W1b | `omega.vcs`: History protocol, jj and native backends, one contract suite; the checkpoint policy as an extension (per step, trailers, gate, `[gate ✗]` + finding); upstream `vcs` changes (§5.9–5.10) | the contract suite green on both backends; `jj log` shows one change per step with `Omega-Task`; "what did t-41 change" is one query |
| W1c | `:cell-kinds` in `bl.doc.spans`; `write-results` after any cell | task blocks parse as cells on both targets |
| W2 | bl-ed socket; remote cursors; publish-on-pause; attention + parking (spike 1) | the second cursor, live |
| W3 | `:task` cells; home cells + journal; cards; `bl doc run --tasks`; TODO sync | a CLI-opened task appears as a live card |
| W4 | sidebar fact buffer; composer; human evals as steers; streaming region | the agent's REPL is your REPL |
| W5 | effect references; trace card; revert; copy-as-new; footprint badge | §7 end to end |
| W6 | marks + contention traces + `:context` lines (rungs 2–3); attention privacy | two agents settle a region without a human |
| FUP | OT/Eg-walker (FUP-003); jj workspaces for `:isolate` tasks; lazy paged mirror for external changes; footprint `File/*!` entries | — |

## 15. What the spikes changed (2026-10-03, before launch)

Nine runnable spikes in `spikes/` (index: `spikes/README.md`; each ends with `## Findings`). The user
directed: *prototype the autovcs-like part from scratch* (it will be redone almost entirely anyway),
and spike anything else before the plan launches. This section is the delta. Where it contradicts an
earlier section, **this section wins**, and the register (§13) and waves (§14) are updated to match.

### 15.1 History is beam-lisp native from day one; jj is out of the plan

`spikes/history.bl.md` builds history from first principles in ~300 lines over datom:
- **Objects.** Content-addressed in datom's blob store. A file version is one object
  `{:text :origins}`, so **line blame is written at checkpoint time** and read in 1.8 ms (400 lines),
  never computed by walking history.
- **Changes.** Immutable facts: parents, delta, touched paths, who/why/when, gate verdict,
  conflicts, renames. A keyframe every 32 steps.
- **Refs.** Append-only move facts.
- **Operations.** Three-way merge that commits conflicts as data; revert = merge as a new change, with
  restored lines keeping their original blame; exact rename following for `log` and blame.
- **Cost.** ~55 ms p50 per checkpoint on the durable store, flat over 1200 steps. The autovcs
  checkpoint with jj measured 1.4–1.8 s.

**Consequences:**
- **E6/E17 change.** §5.9's jj backend and §5.10's protocol-with-two-backends are superseded:
  there is one implementation, `omega.history`, native.
- **jj and git become import/export only.** git export at the human-decision tier is FUP-008.
- The five-verb protocol stays as the *contract suite*. It is the test the autovcs redesign must
  pass; it is no longer a seam for jj.
- jj is not installed on this workstation either.

### 15.2 Per-step checkpoints are a hook, and the gate is per path

- **Use a `:tool/after` hook, not an event.** `spikes/step-checkpoint.bl.md`: an `:on :tool/result`
  event handler runs in a spawned process *after* the task moved on, so it skews (a "step 1" change
  holds step 2's text) and loses steps (3–5 of 6 recorded). A `:tool/after` **hook** runs inline in
  the task's process and gave exact checkpoints (6/6, 0 skew, 0 pollution) in every run. Cost: it
  blocks the task ~160–200 ms per step today; see C8 for the part that is not history.
- **One owner process.** Without a single "historian", the history forked: 2 of 6 changes were
  reachable, from a racy head read-then-write plus per-process memos.
- **Per-path attribution.** A change carries only the files the stepping task wrote. Attributing
  "everything changed since the last checkpoint" polluted 2–3 of 3 changes with the other task's file.
- **Per-path gate.** `spikes/task-refs.bl.md`: gating only the files the change carries gives honest
  blame on ONE shared `main`. B was never failed for A's broken file (0/5 runs). Gating "head ∪ my
  files" failed B for A's file.
- **Per-task refs are optional.** They add a real end-of-task merge with per-task line blame (OBSERVED:
  `A3/l2/l3/l4/B5`, each line blamed on its writer), but they do **not** give test isolation. Under
  E17 (a) the shared directory still shows A's broken file to B's own `sh` tests.
  - **E23:** history records stay honest; test isolation, if wanted, is E17 (b) (a directory per task).
- **Attribution source.** Attribution comes from the writer, not from claims. `write`/`edit` know the
  task and the exact text; claims are per path and cannot split two tasks' hunks in one file.

### 15.3 C6 measured; edit drops the claim conflict

`spikes/file-port.bl.md`:
- **C6 is 29 changed lines** (prelude +17/−10, `task/start-system` must forward `:files`). It touches
  read/write/edit only.
- An agent edit through a buffer server behaves as designed: the agent reads unsaved buffer text, and
  the op carries actor and cell. A stale `:old` is refused with "changed since you read it (rev 1): t-3
  in cell t-3.123 at rev 2".
- The cell id key is `:omega/cell`. Its value today is `<task>.<n>`, which is why C4 exists.
- **Open question raised:** an agent's publish wrote the human's *unpublished* text to disk too. Rule
  (E24): a disk publish writes only *published* ops. The server keeps the human's unpublished ops as a
  pending overlay, shown to agents' reads but never written to disk until the human pauses.
- **Claims are advisory.** `spikes/claims-advisory.bl.md` corrects a mis-diagnosis in task-refs: two
  tasks edited one file under the default policy, and both landed. But `prelude/edit` writes, then
  calls `claim!`, and **drops** the `{:conflict …}`, so the agent never learns another task holds the
  path. Fix (C9): put the conflict in the tool result. That is rung 2 of the consensus ladder, for free.

### 15.4 The buffer rebase in §5.3 diverges; the fix is known

`spikes/convergence.bl.md`, a 2000-case property test over two actors and random ops:
- **§5.3's `transform` violates convergence in 63% of cases** (3.6% even for single-op pairs).
  Failures: same-position inserts with no tiebreak, inserts inside a replaced range, overlapping
  replaces, and deletes spanning another's insert.
- **Tiebreak + clip alone:** 42%.
- **The fix that reached 0/6000 (3 seeds):**
  - atomic ops (replace = delete + insert);
  - a transformed op may split into two;
  - an actor tiebreak for same-point inserts;
  - delete ends shift differently from starts (`shift-end`);
  - a list-vs-list transform for multi-op submissions.
- **Consequences for the buffer server:** log entries are op lists; ops carry an actor; the `:op`
  reply is a list.
- **What it does not give:** intent preservation (keystroke interleaving, orphaned inserts,
  replace-vs-replace concatenation, per-actor undo). That is why FUP-003 (Eg-walker) stays, after W1.
- Spike 1 in §5.3 is kept as the first sketch; FEAT-004 builds on the convergence spike's `transform3`.

### 15.5 omega's long tasks slow themselves down today (C8)

`spikes/hot-task.bl.md` + `spikes/turn-read-cost.bl.md`, independent of bl-ed:
- A scripted task of trivial steps went from **1.2 s to 2.7 s per step by step 160**, with a model
  that answers instantly.
- **Main cause: `loop/turns` re-reads every turn from datom on every step** (`request`), plus
  `turn-count` in `record!`. That is O(turns) per step: 0.84 s at 300 turns, so a long task costs
  O(turns²) overall.
- **The underlying datom costs:**
  - a 4-clause query over 602 turns: 1.4 s;
  - the same ids from the raw `:avet` index: 20 ms;
  - per-entity reads: ~0.6 ms each.
- **Also:**
  - `:task/cost` is rewritten per step, and an entity updated N times reads and writes in O(N)
    (`spikes/history.bl.md` §4, OBSERVED on the pin and on beam-lisp main);
  - `trace/claim!` costs 11 → 63 ms (one spike saw ~100 ms) and runs on every write/edit;
  - a beam-lisp `atom` deref copies the whole value (O(size)), so caches belong in a process.
- **C8 (new core change, raised ahead of time per E15).** The executor process caches the task's turn
  list and running cost: one writer per task, so exact. `request` and `turn-count` read the cache.
  Usage becomes append-only per turn, summed on read. The store stays the truth for recovery and other
  readers. Without C8, every bl-ed feature that adds per-step work (checkpoints, marks, attention lines)
  lands on an already-quadratic loop.
- **C8 prototyped** (`spikes/c8-turn-cache.bl.md`): a 120-step task ran 4.4× faster (138 s → 31 s).
  But a process-dictionary cache behind `loop/turns` went stale for a reader in another process
  (`:turns 0`). So C8 keeps `turns` as the store read, and `turn!` threads the turn list through
  `request`, `record!` and `run-tool` as a loop-local value.
- **Upstream (BUG-002, filed for beam-lisp):** datalog joins and `entity` are 10–70× slower than the
  raw index, and entities slow down with every update.

### 15.6 The `:task` cell works as a package — with its own span kind

`spikes/task-cell.bl.md`, on the js-actors branch's `bl.doc.spans` (it is not in omega's pin):
- The lifecycle of §3.3 ran against a real omega system **without changing `bl.doc.spans`**: open,
  focus, refine (the model receives the edited goal with heading context), `:after` waiting (a
  cancelled dependency does not count as done), reopen with `:prev`, TODO mirroring, idempotent sync.
- **Reverses §10.1:** a task cell must NOT become `{:kind :cell}`, because `bl.doc/cells-source` joins
  every `:cell` into the document's program. The package keeps its own `:task` kind, lifted from
  `{:kind :block :lang "task"}`. The upstream change shrinks to `write-results` accepting other kinds
  to insert after.
- References parse as EDN (data, never evaluated). `clojure.edn` does not consult `:readers` yet, so
  the `#omega/task` tag is stripped before reading until that lands.
- **E25:** a task cell evaluated without `:id` gets its derived id written into its header once, so
  renaming the heading cannot break `:after`.

### 15.7 Register and wave deltas

Register (§13) additions and changes: **E6 and E17 are revised** (native history, no jj); **E13 is
unchanged** (the file port; C6 measured); new **E22–E26**:

| # | decision | status | resolution |
|---|---|---|---|
| E6′ | history tier | lean (supersedes E6 (a)'s jj) | `omega.history`, beam-lisp native, one change per tool step; jj/git import/export only (FUP-008) |
| E17′ | concurrent tasks vs history | lean (refines E17 (a)) | one shared working copy; per-path attribution from the writer; optional per-task refs merged at idle/done |
| E22 | checkpoint mechanism | lean | a `:tool/after` hook snapshots the texts the step wrote and casts them to ONE historian (async, exact, ~5 ms task-side); `:sync` option for blocking gates; never `:on` events (§15.8) |
| E23 | gate scope | lean | per path: a change is gated on the files it carries; test isolation is E17 (b), not the gate |
| E24 | unpublished human text | lean | published layer (== disk) + per-human pending overlays; agent edits apply to published text and transform the overlays; an agent `:old` found only in an overlay is refused `:overlay` (§15.8) |
| E25 | id-less task cells | lean | the derived id is written into the header once, by actor `omega` |
| E26 | buffer op model | lean | atomic ops + split + actor tiebreak + list transform (convergence spike); Eg-walker stays FUP-003 |

Core changes (§8.4) gain **C8** (executor caches turns and cost; usage append-only) and **C9** (`edit`
and `write` report claim conflicts in their result). C5 is downgraded: the `:tool/after` hook already
gives exact step boundaries; `:step/end` stays a nice-to-have.

### 15.8 Improvement round: prototypes of the fixes

A second round prototyped the fixes the first round called for, each by runtime redefinition (omega's
source untouched):

- **C8 turn cache** (`spikes/c8-turn-cache.bl.md`).
  - A 120-step task: 138 s → 31 s (**4.4×**).
  - A process-dictionary cache behind `loop/turns` went stale for a reader in another process
    (`:turns 0`). The shipped C8 threads the turn list through `turn!` as a loop-local value, and
    `turns` stays the store read.
  - Residual growth points at the hot-entity writes (`:task/cost`), the other half of C8.
- **C9 claim conflicts** (`spikes/c9-claim-conflict.bl.md`).
  - ~12 lines. The second writer's model receives "t-1 also holds a.py; claims are advisory …" in
    its tool result. Both edits still land.
  - Only the second claimer learns; symmetric awareness needs `read` to report claims too. That is
    cheap only once claims are append-only.
- **Async checkpoints** (`spikes/async-checkpoint.bl.md`).
  - The `:tool/after` hook snapshots only the texts the step wrote and **casts** them to the one
    historian. 0 skew, 0 misattribution and 0 per-task order errors in 5/5 runs.
  - Task-side cost: **~5 ms p50** vs 70–130 ms blocking. ~3 ms of that is a `task/view` the hook
    can drop.
  - Per-task histories are identical to the blocking variant; gate verdicts are identical.
  - The historian commits 27–36 changes/s. A 60-cast burst queued 59 deep, so add a pending-depth
    bound.
  - **E22 refined:** snapshot inline, commit async, with a `:sync` option for gates that must block.
- **Buffer overlay** (`spikes/buffer-overlay.bl.md`, E24).
  - **Layers.** The published layer (== disk) plus per-human pending overlays, all on the convergent
    op model: 0 invariant violations in 3×500 random cases, deterministic replay.
  - **Agent edits** apply to the *published* text, then every pending branch is transformed over
    them. A replace is encoded as insert-at-end-then-delete, so a human's pending insert at either
    edge of the replaced text keeps its side.
  - **Rule for (d):** an agent's `:old` that exists only in a human's unpublished overlay is refused
    with `:overlay`. Applying it would create an agent edit that never reaches disk while the agent
    believes it landed.
  - **Errors as data:** `:not-found`, `:ambiguous`, `:overlay`, `:published-ambiguous`, `:conflict`
    (a self-check), `:invalid-op`.
  - **Latency:** read 0.04–0.5 ms, agent edit 1–5.5 ms. FEAT-004 should cache the view per revision.

Waves (§14):
- W0 gains C8 and C9; they come first, because every later wave adds per-step work.
- W1b becomes `omega.history` (native) + the checkpoint hook + per-path gate, built from
  `spikes/history.bl.md` and the contract suite. jj work leaves the plan.
- W1 (FEAT-004) builds the buffer server on the convergence spike's op model.
- W1c shrinks: the `:task` kind is lifted in the package; upstream is only `write-results`.


### 15.9 Round three (2026-10-04): core changes landed; captures, caching, the live image

The user's answers to §15.7's leans:
- jj out: **yes**, provided the history also catches file changes made by anything other than `edit`.
- Core changes are welcome; they are made and committed on main.
- Edit logic must be written down as rules that can be tuned after use.
- Test isolation may come later.

**Core changes, done (bfd3a9f, 88bf867).** C1, C2, C4, C5, C6, C8 and C9 are in `src/`, covered by
`test/core_changes_test.bl`, and the suite is green (16 files). C3 (app-declared `env.bl` keys) needs
beam-lisp and C7 (CLI attach) needs realm, so both stay in their waves. Details:
- **C2** fixes BUG-001.
- **C8** on the real code: a 120-step task went from 65.7 s to 16.7 s (3.9×), with the same 242
  turns and the same cost. `loop/turns` stays the store read.
- **The edit contract** is one data table, `omega.edit/RULES`:
  - `:occurrences :unique|:first`;
  - `:empty-old :refuse|:prepend`;
  - `:atomic`;
  - `:claims :report|:refuse|:ignore`;
  - `:preview`.
  It can be overridden per system with `:edit-rules`. Later rules (`:overlay`, `:changed-since`)
  join that table.
- **Encoding bugs found by the caching spike.** `jsonable` crashed on a `:meta` key, which killed a
  task for good, and turned JSON null into the string `"null"`. Both are fixed in omega. The `:meta`
  destructuring itself is a beam-lisp bug, filed upstream as BUG-003.

**Catching every file change, not only `edit`** (`spikes/fs-capture.bl.md`), for E22:
- **The precise part is a call trace of the cell.** `erlang:trace` on the cell process, with
  `set_on_spawn`, plus trace patterns on `file`/`prim_file` writes, renames and deletes and on
  `open_port`.
  - It sees every BEAM-level write: `File/*`, `:file`, raw handles, `prim_file` NIFs, spawned
    children.
  - Each event is attributed exactly, by pid.
  - Cost: under 1 ms per cell.
  - It subsumes the `write`/`edit` recorder.
- **The rest is a scan, only after cells that started an OS process** (`sh`).
  - What it is: a stat walk of the root, diffed against the previous after-scan (cached).
  - Skipped: `.git`, `.omega`, `_build`, `node_modules`, `target`.
  - Racy files are hashed: mtime has one-second granularity here.
  - Renames are detected by inode.
  - Cost: ~60–140 ms per 2,000 files. It runs in the cell or historian, off the 5 ms task-side budget.
- **Each path in a change records where it came from:**
  - `:source :trace` (exact);
  - `:source :scan` (the only OS-process cell in its window);
  - `:source :scan :ambiguous [tasks]` (overlapping `sh` cells);
  - `:source :external` (no omega cell running: a human or a daemon).
- **Rejected as the primary mechanism:**
  - inotify: events carry no writer, it races on new directories, and `.git` floods it;
  - `strace -f`: 3–31× slower;
  - overlayfs: it changes the paths the agent sees.
  `strace` stays an opt-in for paths that come out `:ambiguous`.
- **What it misses:** a create-then-delete inside one `sh` eval, and writes outside the root.
- **Hook point:** `codemode/run-eval` (the preamble starts the trace; it is collected after
  `eval-cell` returns), feeding the `:tool/after` hook → historian path of §15.8.
- This is FEAT-005 scope.

**Prompt caching** (`spikes/prompt-cache.bl.md`):
- **Today's requests already cache well.** `omega.loop/request` is already append-only and byte-stable
  (9/9 pairs over a real task).
- **The contract `omega.loop` keeps:**
  - append-only history;
  - one canonical encoder;
  - a stable head (system, tools and model fixed per task);
  - volatile context (attention lines, bl-ed's "what the human is looking at") only in a request-time
    `:tail` that is never recorded;
  - opaque provider blocks round-trip verbatim;
  - compaction and fork are explicit cache resets;
  - per-step hit-rate telemetry.
- **Per-provider adapters:**
  - **Anthropic:** explicit `cache_control`, 3 breakpoints: the last system block, a ladder ≥8
    messages back, and the last block before the tail. Confirmed live through the proxy: a 5,311-token
    read on step 2.
  - **OpenAI Chat:** automatic, plus `prompt_cache_key` = task id.
  - **Responses/Codex:** stateless replay with `store:false` and `reasoning.encrypted_content`, as
    the Codex CLI does; `previous_response_id` is only a later transport optimisation.
- **Cost:** a 40-step task drops to 15–23% of uncached input cost. One volatile line placed in the
  system prompt makes it 125%, silently.
- **∴** The `:tail` field is the rule bl-ed's attention lines must follow (E10/E14 placement), and
  the Anthropic planner is a W0 item: FEAT-012.

**The live image when the project is beam-lisp** (`spikes/live-image.bl.md`, all on the pin).

What the spike observed:
- **The image diff.** A step's code change can be recorded exactly as an `:image` part:
  - a per-var hash of the position-stripped source form; a whitespace-only re-eval changes 0 vars;
  - the compiled AST cannot be hashed: gensyms and module names change on every eval.
- **Removed vars.** Plain eval never removes a var, so "removed" needs `own_names`.
- **What running code sees after a reload:**
  - fully-qualified callers and held var values get the new code;
  - closures made by the old `defn` keep the old code;
  - a redefined `defserver` runs its NEW handlers on its OLD state, with no `code_change`.
- **Restoring code is cheap; restoring state is impossible.**
  - Replaying the stored text of only the vars that differ took 15–31 ms for 3 vars.
  - Whole-namespace eval is superlinear (100 fns = 4.2 s), so reload and restore must touch only the
    vars that differ.
  - Nothing restores process state, mailboxes or datom heads.
- **The ward gate.** `reload.ward/run-sandboxed` keeps the real registry untouched (~80–110 ms warm,
  7–8 s cold). Plain `ward/run` and a same-namespace `env/fork` LEAK into the live image: the real
  `f` changed in both cases.
- **Leftover modules.** Every redefinition leaves ~4 body modules loaded (no purge).

The experiences to support:
- **(a)** A step that edits `foo.bl` shows the human "changed `price`, added `extra`" next to the
  file diff, and the live app picks the change up.
- **(b)** "Back to step 12" restores the code and says plainly that the state did not come back.
- **(c)** A risky change is gated in a sandboxed ward before it reaches the live image.
- **(d)** Two tasks reloading one namespace are detected through claims and a `:prev` mismatch, not
  isolated.
- **(e)** The gate for a beam-lisp step is the ward, not `sh`.

The scope split proposed to the user (open: their choice):

| candidate | proposed | why |
|---|---|---|
| `:image` part per change (var hashes, added/changed/removed) | **in scope** (FEAT-005) | cheap, exact, same CAS as files |
| reload-on-checkpoint, opt-in, `reload/commit` of the touched namespaces, never on a failed gate; dev image only | **in scope** (FEAT-005, policy off by default) | the live app follows the agent; refusal on a failed gate |
| ward gate via `run-sandboxed` only, warmed at task start; lint that refuses a non-sandboxed ward | **in scope** (FEAT-005) | the leak is the easiest way to silently corrupt the live app |
| restore the image at step N (code only, explicit "state not restored") | FUP-009 | needs the history CAS of var texts first |
| process-state / datom-head checkpoints, `code_change` migrations | FUP-009 | no beam-lisp API; needs the project's cooperation |
| stale-closure detection, purging old body modules | FUP-009 / upstream | runtime work in beam-lisp |
| per-task images | not built | one registry per VM; claims + `:prev` warn instead |

