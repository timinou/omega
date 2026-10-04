# `task:<id>` — a task as a livebook

*Provider design. The protocol is in [`README.bl.md`](README.bl.md). Item: FEAT-018. It replaces
the "sidebar" machinery of bl-ed §4.2 / FEAT-009 with a document. A side window comes later, when
bl-ed has windows (§10.5).*

## 1. Purpose

> **The agent's REPL is your REPL.**

You read what the task did as prose plus cells, and you re-run any of its cells as yourself. You
steer it from inside its own work, with no chat pane: the transcript *is* a notebook in the
language the agent writes.

## 2. What it looks like

```org
#+TITLE: t-41 · make read_number accept 0x hex · ● running · 1m12s · $0.04
see: plan.org · effects:t-41 · parent: — · subtasks: t-45

* you · prompt
Make read_number accept 0x hex literals. Keep decimals working.

* model · 2
I'll edit the reader, then verify.
#+begin_src beam-lisp :id t-41/2 :ns omega.task.t-41
(edit "reader.py" [{:old "    return int(s)" :new "    return int(s, 16) if s.startswith('0x') else int(s)"}])
#+end_src
#+RESULTS: t-41/2
: {:ok true :ops ["reader.py@1"]}

* model · 3
#+begin_src beam-lisp :id t-41/3 :ns omega.task.t-41
(sh "python -c 'from reader import read_number as r; print(r(\"0x1f\"), r(\"7\"))'")
#+end_src
#+RESULTS: t-41/3
: {:out "31 7\n" :exit 0}

* ⚑ asks you
Bump version to 0.2?                                            y yes · n no

* traces
- finding · reader.py · int() needs base 0 for 0x/0o — 40s ago
- claim · reader.py

* say ▸
```

## 3. Presentations and keys

| row | type | keys |
|---|---|---|
| title | `:omega/task` | the whole task table (`s` say, `x` cancel, `e` effects, `RET` home) |
| a cell | `:omega/cell` | `C-Enter` re-run as you → steer · `c` copy to scratch · `d` diff of its effects (once effects exist) |
| the ask | `:omega/msg` | `y` / `n` / `a`, or `RET` for a free-text reply |
| `* say ▸` | `:omega/composer` | `RET` opens the minibuffer → `task/say!` · `C-RET` → `task/steer!` |
| a trace | `:omega/trace` | `RET` visits its subject (a file path) |
| a `see:` link | `:link` | `RET` visits it |

The document is read-only (B2). Each verb above is an intent, so nothing needs write-back.

## 4. Provider

| op | does |
|---|---|
| `:read` | `(model/task-detail sys id)` = `{:turns (loop/turns …) :traces (tr/all e {:task id}) :messages (actor/messages e id)}`, plus the row from `task-row` for the title → pure `render-task` → `{:text :objects}` |
| `:rev` | `basis-t` gate, then a hash (README §2.2). In practice it changes once per turn, ask or trace |
| `:eval` | `C-Enter` on cell `t-41/3` → `(codemode/run-eval sys "t-41" code)` in `omega.task.t-41` with the agent's prelude and limits (heap, deadline), then `(task/steer! sys "t-41" text "human:me")` with the cell text and its result. The steer carries the attribution; the eval itself runs in the task's namespace. The answer is the result only; the document refreshes via its rev when the steer lands |
| `:place` | every cell → `agent`, with why "runs in t-41 as you; the result goes to the task as a steer" |

**Cells from turns.** codemode turns carry the model's `eval` code and its result. A turn with
role `:assistant` and a tool call becomes a heading, its text and a cell. The tool result becomes
`#+RESULTS:`. The cell id is C4's cell id (`codemode/cell-id`), so `effects:` and history refer to
the same cell by the same name.

## 5. Efficiency

- `loop/turns` is one query per read. C8 already made turn reads cheap for the loop (65.7 → 16.7 s
  on 120 steps).
- **Long tasks:** the document shows the **last 30 turns** and puts `* … 90 earlier turns (RET to
  expand)` at the top. Expanding is a visit with `?all`, a different path, so a different cache
  entry. The default view stays bounded however long the task runs.
- No streaming in v1: the view refreshes at turn boundaries. Streaming deltas (`omega.stream`)
  arrive with FEAT-007's socket as a marked region.

## 6. Safety

Re-running a cell as yourself runs it in the task's namespace with the agent's prelude: the same
code the agent ran, with the steer attributed to `human:me`. The minibuffer confirms once per document
visit for a cell that calls `sh`, `write` or `edit`, using system.analyze's footprint (§7.3
footprint warning). Once the jail exists, the cell runs under the task's floor, not yours.

## 7. Acceptance

- `t` on an overview row visits `task:t-41` and shows the turns as cells.
- `C-Enter` on a cell steers the task: its next turn sees a `:steer` that carries the cell and its
  result.
- `RET` on `say ▸` sends a message.
- `y` on the ask answers it, and the `⚑` section disappears on the next rev.
- A 200-turn task renders its default view under the same budget as a 30-turn one.
