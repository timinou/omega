# `omega:scratch` — the one writable virtual document

*Provider design. The protocol is in [`README.bl.md`](README.bl.md). Item: FEAT-016. Decision: E29.*

## 1. Purpose

- **The home of homeless tasks.** These are tasks opened from `:` (`(omega/open …)`), from
  `bin/omega "goal"`, or spawned by another task, until the journal (E7, FEAT-008) takes over.
- **The Lisp machine's `*scratch*`.** Notes, task blocks and cells that belong to no file.
- **The only place a view's cell is edited.** `c` on a cell in `task:`, `q:` or `bl:` copies it here
  with its context (README §2.3).

## 2. What it looks like

```org
#+TITLE: omega scratch

* tidy imports
#+begin_task :id t-44
tidy imports
#+end_task
#+RESULTS: t-44
: #omega/task {:id "t-44" :goal "9a01de"}

* from task:t-41 · cell t-41/2
#+begin_src beam-lisp :id s-3 :ns omega.task.t-41 :as human:me
(edit "reader.py" [{:old "    return int(s)" :new "    return int(s, 0)"}])
#+end_src
```

- Task blocks get cards (FEAT-015) like anywhere else.
- A cell with `:ns omega.task.<id>` runs in that task's namespace, and the result is delivered to
  the task as a `:steer` from `human:me` (bl-ed §4.2's rule). Its gutter shows `✦ t-41`.
- A cell with no `:ns` is placed like any cell. ● (pure) runs in the page. ◆ runs in omega's VM
  through `harness/eval-cell` in `omega.scratch`, with an agent cell's limits (heap, deadline).

## 3. Provider

| op | does |
|---|---|
| `:read` | the text of `.omega/scratch.bl.org`; seeded with `#+TITLE: omega scratch` on first read. `:rev` = content hash. `:read-only? false`. `:objects` = `:omega/task` on each `#omega/task` result row |
| `:rev` | the file's hash. Kept in memory and updated on every write, so it costs no read |
| `:write` | `base-rev` must equal the current rev, else `{:conflict rev}` (the page offers reload or overwrite) |
| `:eval` | a cell with `:ns omega.task.<id>` → `(codemode/run-eval sys id code)` (runs in that task's namespace with its prelude and limits), then `(task/steer! sys id text "human:me")` carrying the cell and its result, so the steer is attributed to you. A cell without `:ns` → `harness/eval-cell` (the primitive `run-eval` wraps) in namespace `omega.scratch` with the same heap and deadline. A `:task` block → the §3.3 table (open / focus / refine / new) |
| `:place` | `:task` blocks → `agent`; `:ns omega.task.*` cells → `agent` with why "runs in t-41 as you"; other cells → `system.place` as today (● local cells still run in the page) |

**The bridge as a second writer** (homeless tasks): it appends under the same rev rule, re-reading
on conflict. Appends only; it never rewrites your text.

## 4. Why a file under `.omega/`, not a fact

- It needs no schema change. A `:scratch/text` attribute would be a core change to `omega.schema`;
  E15 asks for those to be raised first, and nothing here needs one.
- It is gitignored with the rest of `.omega/`: private by default, and it survives restarts.
- When the store gains C1 (package schema at open), it can move into the store with no
  protocol change.

## 5. Edge cases

- **Two consoles editing it at once:** the rev rule turns this into a visible conflict, never a lost
  update. Merging waits for buffer servers (FEAT-004).
- **A huge scratch:** it is a normal document. bl-ed's measured frame costs (p95 ≈ 11–21 ms on
  1,161 lines) apply.
- **The world is down:** visiting answers 502 "no omega world: run `bin/omega serve`", and the
  editor stays where it was.

## 6. Acceptance

- `(omega/open "x")` from `:`, then `space a s`, shows the new task block with a live card.
- Editing prose there and saving survives a reload and a bridge restart.
- A save with a stale base is refused with *"changed by omega — reload or overwrite"*.
- `c` on a cell in `task:t-41` lands here with `:ns omega.task.t-41`. `C-Enter` on it produces a
  `:steer` message on t-41 that carries the cell and its result.
