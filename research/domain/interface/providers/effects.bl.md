# `effects:<id>` — what a task did to the world

*Provider design. The protocol is in [`README.bl.md`](README.bl.md). Item: FEAT-021. Sources:*
- *bl-ed §7 (cells that changed the world are not re-runnable);*
- *how-it-fits §4.4 (the `:effect/*` fact shape);*
- *`spikes/fs-capture.bl.md`;*
- *`spikes/beam-jail.bl.md`.*

## 1. Purpose

Answer *"what did t-41 (or cell t-41/3) do?"* as one list: files written, renamed and deleted,
processes run, connections made, image vars changed. Each row says how it was caught and links to
the cell that caused it.

This is the reading side of everything the sandbox, history and live-image work records. It is
the human's audit trail and the source for "revert" and "this cell is not re-runnable".

## 2. What it looks like

```org
#+TITLE: effects · t-41 · 6 effects · 0 denied
#+begin_src text
filter: all · group: cell
#+end_src

* t-41/2 · edit
- write  reader.py            +1 −1                    :edit     ✓
* t-41/3 · sh "python -c …"
- exec   /usr/bin/python3                              :syscall  ✓
- write  __pycache__/reader.cpython-313.pyc            :pass     ✓
* t-41/5 · sh "pip install requests"
- connect pypi.org:443                                 :syscall  ✗ denied (network is :proxy)
```

Each row is an `:omega/effect` presentation:

| key | does |
|---|---|
| `RET` | visit the path (files), or `bl:<ns>` (image vars) |
| `d` | a diff of this write against the step before (history, FEAT-005) |
| `r` | revert this effect (FEAT-010), only for kinds that can be reverted |
| `g` | regroup: by cell / by path / by kind |
| `f` | filter: all / denied / writes |

`effects:t-41/3` (a cell id) is the same document narrowed to one cell. It is what the
"changed the world" badge of bl-ed §7 links to.

## 3. Data: v0 now, v1 with the jail

| version | source | what it can show | honest gap |
|---|---|---|---|
| **v0** (buildable today) | the task's turns: each codemode cell's `edit` / `write` / `sh` calls and their results (C4 cell ids) | `:edit` writes with their ops; `sh` commands as opaque rows (`sh "…" · effects not captured`) | anything a script did inside `sh` is invisible; it is labelled as such, never guessed |
| **v1** | `:effect/*` facts (how-it-fits §4.4), written by the jail (`:syscall`), the BEAM trace (`:trace`), the build-dir scan (`:scan`), image recording (`:eval`) | every row of §2, with verdicts | needs the jail FEAT (not yet filed; sandbox decisions SB-Q1..Q6 are pending) |

**The provider's renderer takes rows of the v1 shape from day one.** v0 produces rows of that
shape with `:source :edit` or `:source :opaque`. Switching to v1 replaces the row source and leaves
the renderer, the presentations and the tests unchanged.

## 4. Provider

| op | does |
|---|---|
| `:read` | rows for the task or cell → group/filter from params (`?group=path&only=denied`) → pure `render-effects` |
| `:rev` | `basis-t` gate, then a hash of the rows |
| `:write` / `:eval` | none |

## 5. Efficiency

- v0 reads turns, the same query `task:` uses. A task with 200 cells is one pass.
- v1: effect facts are indexed by `:effect/task` and `:effect/cell`, so one indexed read per view.
  Build dirs are `:pass` in the jail's BPF (beam-jail spike), so `node_modules` churn never becomes
  rows. **Cap:** 1,000 rows per view, with a collapsed `… N more` per group.

## 6. Acceptance

- **v0:** `e` on a task row after an `edit` shows the write with its cell. An `sh` cell shows as
  opaque with its command.
- **v1:** a denied connect shows `✗` with the rule that denied it. `effects:t-41/3` shows only that
  cell.
