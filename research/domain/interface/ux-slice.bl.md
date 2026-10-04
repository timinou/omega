# The UX slice: one task cell, one card, one answer

*2026-10-04. The thinnest cut through the bl-ed + omega design that a human can **use**.*

*What this note does:*
- *§2 says what the slice looks like on screen;*
- *§3 lists the pieces it touches;*
- *§4 says what it leaves out;*
- *§5 shows how each piece left out plugs in later without rework.*

*Sources:*
- *beam-lisp main `55f0a2af` and `prototype/bl-js-actors` `f2d5f02c` (read on 2026-10-04);*
- *omega main;*
- *`bl-ed.bl.md` (the design);*
- *`../synthesis/how-it-fits.bl.md` (the integration).*

*`clojure` and `text` fences are design sketches; nothing here is built.*

---

## 0. What changed upstream, and why it shapes the slice (OBSERVED)

Since `bl-ed.bl.md` was written, beam-lisp main has merged the bl-js-actors line. bl-ed now has
three things the slice can stand on.

| new on main | where | what it gives the slice |
|---|---|---|
| **Split cells.** `system.place` analyses the whole document. A pure, terminating cell is ● and runs in the page; anything else is ◆ and runs on the BEAM, with the reason on hover | `priv/lib/system/place.bl`, `serve.bl /api/place`, `ed/main.bl` render `:place :place-why` | a cell already has a *place*, shown in the gutter with a reason. **A task cell is a third place: "runs as an agent".** No new concept for the human |
| **`:` is real Beam Lisp in the page.** Self-hosted reader, compiler and macros; boot ≈10 ms, an eval 0.2–1.5 ms; held to the BEAM by a 76/76 differential | `priv/lib/js/eval.bl`, FUP-134 | the console side of omega can be written as ordinary bl-ed commands and `ed/` fns, typed live, with no stand-in interpreter (`ed.lisp` is gone, decision 1) |
| **One effects loop.** Every command is `(fn [ed] ed')`; I/O is returned as `:effects` data; `host.mjs perform` handles `:save :eval-cell :place :clipboard-write` and answers with events (`:saved :eval-result :placements`) | `ed/main.bl`, `web/host.mjs:85-125` | omega needs **three more effect kinds and two more event types**, nothing structural |
| **One partition.** `bl.doc.spans` already parses `#+begin_task … #+end_task` as `{:kind :block :lang "task"}` and `#+RESULTS: id` as `:result` (bl-ed §3.5) | `priv/std/bl/doc/spans.bl` | the task cell is already a span; only `write-results` needs to accept it |

Also OBSERVED:
- omega's pin `2360b32e` is 234 commits behind main (an ancestor), so FEAT-001's re-pin is still
  ahead;
- bl-ed's server runs on main.

**∴ the slice crosses a VM boundary on purpose.** bl-ed's VM (main) talks to omega's world (on the
pin) over loopback HTTP.
- No re-pin, no core change and no buffer servers are needed before a human can use it.
- The world-as-realm-member (W1) later removes the hop, not the vocabulary.

---

## 1. The slice in one sentence

> **In bl-ed, put a `#+begin_task` block under a heading, press `C-Enter`, and watch a one-line card
> in place of its result: it tells you what the agent is doing, stops you when it needs an answer,
> lets you answer with the cursor on it, and turns into a self-contained summary when the task ends.**

That is bl-ed §3 (task cell) and §4.1 (card), with the smallest wire.

Why this cut, and not the second cursor or the sidebar:
- **The card is where the human meets the agent.** It is the whole of "the result is a live
  reference" (decision 6).
- **It is the only cut that needs no buffer servers.** The second cursor, attention and consensus
  all need buffer servers (W1–W2), which need the re-pin.
- **It uses things already proven on both sides.** On the omega side: `omega.ui.model/task-row`
  (the card's data), `task/open!`, `task/say!`, `actor/reply!` (asks), all tested. On the bl-ed
  side: `/api/place` and the effects loop.

---

## 2. What it looks like

### 2.1 Before evaluation

```text
 * TODO Hex literals in the reader
   Python's int() needs base 16 for 0x; keep the decimal path untouched.
✦ #+begin_task :id hex :scope reader.py test/test_reader.py
   Make read_number accept 0x hex literals. Keep decimals working.
   #+end_task
```

- The gutter mark `✦` sits beside ● (in the page) and ◆ (on the BEAM). Hover: *"runs as an agent in
  omega (world: ~/code/x); evaluating opens a task"*.
- If no omega world is reachable, the mark is a dimmed `✦` with *"no omega world: run
  `bin/omega serve`"*. This mirrors the existing *"no evaluation server — run `bl run
  apps/bl-ed/serve.bl`"* message.

### 2.2 Running: the card is how its result line is drawn

`C-Enter` writes the identity result into the buffer (dirty, saved like any edit):

```org
#+RESULTS: hex
: #omega/task {:id "t-41" :goal "b3f1c0"}
```

It is drawn as one card line:

```text
   #+end_task
   ● running  t-41 · make read_number accept 0x hex        1m12s · ✎ reader.py · 3 turns · $0.04
```

- **One line, always.** The card *replaces the drawing* of its `: #omega/task …` row. It adds no
  virtual rows, so scrolling, folding, motions and the round trip are untouched. The text on disk
  is still the reference (bl-ed §3.4: live = identity only; git stays quiet).
- Liveness is elapsed time and last-trace age, with no spinner (impeccable).
- `✎ reader.py` comes from the task's claims (`task-row :claims`).

### 2.3 It needs you

```text
   ⚑ needs you  t-41 · asks: Bump version to 0.2?          y yes · n no · RET reply…
```

- With the cursor on the card row, `y`/`n` answer and `RET` opens the minibuffer for free text.
- The binding applies **only on a card row** (a contextual keymap, a merge into `km/keymap-of`), so
  `y` still yanks everywhere else.
- An unanswered ask also shows in the status line (`⚑ 1`), so a card scrolled out of view is not
  silent.

### 2.4 It ends

The console rewrites the result **once** (bl-ed §3.4, E9) through `bl.doc.spans/write-results`:

```org
#+RESULTS: hex
: #omega/task {:id "t-41" :goal "b3f1c0" :status :done
:              :summary "read_number parses 0x hex; verified 0x1f and 7 → 31 7"
:              :touched ["reader.py"]}
```

It is drawn as `✓ done · read_number parses 0x hex … · 4m03s · reader.py`. A teammate without the
world sees the same line, from the text alone.

### 2.5 Re-evaluating (bl-ed §3.3, unchanged)

| state | `C-Enter` does |
|---|---|
| no result | open a task |
| live, body unchanged (goal digest) | focus: the message line shows the newest trace |
| live, body edited | `task/say!` the new body as a refinement |
| terminal | a new task; the old id goes to `:prev` |

### 2.6 From `:` (free, because `:` is real Beam Lisp now)

```clojure
(omega/tasks)                    ; [{:id "t-41" :status :running :title …} …]  — the cached rows
(omega/open "tidy imports")      ; a homeless task: no cell, card in the status line only
(omega/say "t-41" "also octal")  ; steer from anywhere
```

These are three `ed/defcmd`s over the same effects. It is the first taste of "the editor is the
agent's REPL" without the sidebar.

---

## 3. The pieces (the whole diff, by repo)

### 3.1 beam-lisp: one upstream change (bl-ed §15.6 predicted exactly this)

`bl.doc.spans`:
- read `:id` from a `#+begin_task` header, as `src-attrs` already does for source blocks;
- let `write-results` insert a missing result after a `:block` that has an id, not only after a
  `:cell`.

About 15 lines plus tests on both targets (the spans tests run on BEAM and JS).

Nothing in `bl.doc`'s runner changes. A task block still never compiles, and `bl doc run` skips it
because it is not a `:cell`. That *is* the independence property (bl-ed §10.1).

### 3.2 bl-ed: the console side (`apps/bl-ed`)

| file | change |
|---|---|
| `ed/main.bl` | two event types: `:tasks {id → row}` (merge into `(:tasks ed)`) and `:task-opened {:cell :id :goal}` (`write-results` the identity line). Render: a result row whose value reads as `#omega/task` gets `:card (get (:tasks ed) id)`; a task block's first row gets `:place "agent"` |
| `ed/commands.bl` | `:omega/eval-task` (the §2.5 table; `C-Enter` dispatches to it when the cell at the cursor is a task block), `:omega/answer-yes/no/reply`, `:omega/open`, `:omega/say` |
| `ed/keymap.bl` | the card-row contextual keymap (`y n RET`) |
| `web/host.mjs` | `perform`: `:task-open :task-say :task-answer` (POST) and `:task-watch` (a 1 s poll of `/api/omega/tasks?ids=…` while any card is visible, answered as `:tasks`). Draw: a line with `:card` renders a card segment instead of its text |
| `web/theme.css` | the card tones (status tones from omega's `ui/theme.bl STATUS`, so both UIs agree) |
| `serve.bl` | `/api/omega/*` forwards to the world's bridge URL (`OMEGA_URL`, or `.omega/url` in `BLED_ROOT`); `/api/place` marks task blocks `agent`. **`/api/save` gains a base-hash check** (§4, row 2) |

### 3.3 omega: a bridge, not a UI (`src/omega/ed/bridge.bl`, new)

Four JSON routes over verbs that already exist and are tested:

```clojure
;; design sketch
(ns omega.ed.bridge (:require [web :as w] [omega.task :as task] [omega.ui.model :as model] [omega.actor :as actor]))

;; POST /open    {goal scope}               → {:id}                (task/open! sys {:goal … :scope …}) — existing keys only;
;;                                                                 the cell→task link lives in the result line, not in omega
;; POST /say     {id text}                  → {:ok}                (task/say! sys id text)
;; POST /answer  {msg choice}               → {:ok}                (actor/reply! env msg choice)
;; GET  /tasks?ids=t-41,t-42                → {id (model/task-row …)} plus terminal :summary :touched
```

- `bin/omega serve` starts the bridge beside the world and writes its URL to `.omega/url`.
- It binds to loopback and uses the same origin rules as `serve.bl`.
- `task-row` already carries `:status :title :age-ms :stale? :asks :claims :cost`, which is the
  card's whole content. **No new projection.**

**Tests:**
- omega: one bridge test (open → poll → ask → answer → done, against a scripted model);
- beam-lisp: the spans tests;
- bl-ed: a `drive.test.mjs` case with a fake bridge (the drive tests already fake the server);
- acceptance: a `proof/10-task-card.png` from a real run, as bl-ed's other proofs.

---

## 4. What it leaves out, and what stands in for it

| left out | stand-in for the slice | honest consequence |
|---|---|---|
| **Buffer servers, second cursor, convergent ops** (FEAT-004, W1–W2) | the agent writes files on disk directly, exactly as omega does today | you do not *see* the agent type; the card's `✎ reader.py` tells you where it is |
| **Lost-update safety for the open document** | `/api/save` sends the text's base hash and refuses if the file changed on disk: *"changed on disk by t-41 — reload or overwrite"* | crude (whole-file) but never silent. Buffer servers replace it with merging |
| **Single writer for the result line** | the **console** writes both the identity and the terminal result into its own buffer; omega never writes the document | if no console has the file open at terminal time, the result stays identity-only until the next open, which rewrites it then. Correct, just late |
| **Sidebar, transcript, composer, streaming** (FEAT-009, W4) | `RET` on the card = the newest trace in the message line; `(omega/say …)` from `:`; omega's own web UI (`omega.ui.web`, `/?task=t-41`) one click away | depth lives in omega's existing UI for now |
| **The wire as a socket** (§9, FEAT-007) | a 1 s poll, only while a card is visible | ≤1 s card latency; zero cost when idle |
| **History, per-step checkpoints, revert** (FEAT-005) | none in the console; omega's traces still record everything | no "revert step 9" button yet |
| **Jail / effects summary** (how-it-fits §4) | none; `sh` is as today (D10) | the card shows no denied effects because nothing is denied |
| **TODO sync** (§3.6) | none: the heading keyword is yours to change | the card is the status |
| **Attention, consensus, overlays** (W6, E24) | none | — |
| **Effect references / not re-runnable** (§7, FEAT-010) | the §2.5 table already refuses to re-open a live task; terminal = new task | the "this cell changed the world" badge waits for effect facts |
| **Image / reload for beam-lisp projects** | none | — |
| **One world as a realm member** (W1, E3) | `bin/omega serve` as its own process, found through `.omega/url` | two processes to start; the launcher step comes with realm membership |

---

## 5. Why the slice is amenable to everything next

Each stand-in sits behind a seam that the later piece *fills in*. None is a parallel implementation
that has to be ripped out.

| seam | slice | next | what changes then |
|---|---|---|---|
| **card data** | `omega.ui.model/task-row` over HTTP | the same row as `[:view [:task id] row]` on the socket (§9) | transport only. `ed/main.bl`'s `:tasks` event is unchanged |
| **intents** | `open say answer` as POSTs | `[:intent :task/open …]` on the socket | transport only. The verbs are the §9 intent names already |
| **effects in the console** | three `perform` kinds | the socket becomes one more `perform` source; decorations (§10.4) generalise `:card` | `:card` becomes the first decoration, not a special case |
| **where cells run** | `system.place` + `✦ agent` | jail-backed `◆` cells (how-it-fits SB-Q3); the gutter reason gains *"writes: project only"* | `place` grows a value, as it grew ● and ◆ |
| **asks** | `actor/reply!` on a `:msg :ask` | the jail's `:ask` on a paused syscall is the **same message kind** with `:msg/data {:op :connect :host …}` | the card already renders it; only the text differs |
| **agent edits** | disk + base-hash refusal | C6 file port → buffer servers: the same edits arrive as ops; the refusal path is never hit | delete the refusal branch, or keep it for edits outside omega |
| **result line** | written by the console via `write-results` | the same, through the buffer server as an op by actor `omega` (§3.6 rule), which allows writing with no console open | the writer moves; the format is the same |
| **world discovery** | `.omega/url` | the realm member: `bl realm` attaches and the bridge becomes a route of the member | delete `.omega/url` |
| **`:` commands** | `(omega/tasks)` etc. as `ed/defcmd`s | the package's `:keys`/`:presentations` tables (§11) absorb them | move, not rewrite |
| **depth** | omega's web UI | the sidebar as a bl-ed window over the same `task-detail` projection | `task-detail` already exists (`ui/model.bl:85`) |

**Design rule kept throughout:** the console never holds authority or queries the store. It shows
views and sends intents (D1, bl-ed §9). The slice satisfies that rule over HTTP, so moving to the
socket changes no responsibilities.

---

## 6. Order, size, gate

| step | repo | size (estimate) | gate |
|---|---|---|---|
| S1 spans: task `:id` + write-results after a block | beam-lisp | ~15 lines + tests | spans tests green on BEAM and JS |
| S2 bridge + `bin/omega serve` + `.omega/url` | omega | ~120 lines + 1 test | scripted model: open → ask → answer → done through HTTP |
| S3 bl-ed effects, events, card render, keys, `/api/omega` forward, save base-hash | beam-lisp `apps/bl-ed` | ~250 lines + drive test | drive test with a fake bridge; the base-hash refusal tested |
| S4 real run + proof screenshot | both | — | a human opens, answers and finishes a task in bl-ed; `proof/10-task-card.png` |

S1 and S2 are independent; S3 needs both. None of them waits for FEAT-001 (re-pin) or touches
omega's core.

## 7. Open, for you

- **UX-Q1.** The card row's `y`/`n` vs a `space a y/n` chord. Lean: contextual `y n RET` on the card
  row only. It is what §4.1 promised, and keymaps are data, so it is cheap to change.
- **UX-Q2.** Where the slice's console code lives: inside `apps/bl-ed` (a temporary omega module
  there) or as the first file of omega's package (`omega/ed/omega.bl.org`, §11) loaded through `:`.
  Lean: `apps/bl-ed/ed/omega.bl`, small and named, moved into the package when §10.3's hot-load
  lands. Hot-loading console code is not on main yet.
- **UX-Q3.** Homeless tasks from `:` (`(omega/open …)`): status line only, or append to
  `journal/YYYY-MM-DD.bl.org` now (E7)? Lean: status line only in the slice. The journal needs the
  single-writer rule, which needs buffer servers.
