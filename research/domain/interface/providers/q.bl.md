# `q:<id>` — a datalog query over the world, as a live table

*Provider design. The protocol is in [`README.bl.md`](README.bl.md). Item: FEAT-019.*

## 1. Purpose

The prelude's `(q query & inputs)` gives the agent datalog over the world: tasks, messages,
traces and turns. `q:` gives the human the same power, as a document that **stays true**: the
table re-renders when the facts change.

This is the Lisp machine's inspector pointed at the fact store. Questions like these each become
one query you can leave open:
- what touched `reader.py` today;
- which tasks wait on t-41;
- what did the agent find.

## 2. What it looks like

```org
#+TITLE: q · tasks waiting on another task · 3 rows · live
#+begin_src beam-lisp :id query
[:find ?id ?title ?on
 :where [?t :task/waits-on ?w] [?t :task/id ?id] [?t :task/title ?title] [?w :task/id ?on]]
#+end_src

| ?id  | ?title           | ?on  |
|------+------------------+------|
| t-39 | release notes    | t-41 |
| t-46 | bump version     | t-41 |
| t-47 | announce         | t-46 |
```

- **Cells that look like task ids** (`t-\d+`) are `:omega/task` presentations, so `RET`, `y`, `t`
  and `e` work in the table too. This is the composition rule (README §4.4): a provider that emits
  a known type gets that type's commands for free.
- **Editing the query.** `e` on the query cell opens the minibuffer pre-filled with the query.
  `RET` mints a new `q:` path and visits it, and `C-o` returns to the old one. So no document is
  ever edited.

## 3. Where queries come from

| from | how |
|---|---|
| `:` | `(omega/q '[:find …])` → `POST /api/view {:kind :q :text …}` → `{path "q:3fa9c1"}` → visit |
| any cell | the same call in a scratch cell |
| the palette | `omega: saved queries` lists the named ones |
| naming | `n` on the title saves `q:3fa9c1` as `q:waiting-on` in `.omega/queries.edn` |

**The id is the hash of the query text,** so the same query gets the same path, and a link to it
in a note keeps working.

## 4. Provider

| op | does |
|---|---|
| `:read` | `(env/q e query)` → rows sorted by the `:find` order → pure `render-table` (org table; column header = the `:find` vars; values `pr-str`'d and clipped at 60 chars with `…`) |
| `:rev` | `basis-t` gate, then a hash of the result rows (not the text), so formatting changes cannot cause spurious reloads |
| `:eval` | `C-Enter` on the query cell re-runs it now. Useful while the gate is off, otherwise a no-op |
| store | query texts in `.omega/queries.edn` (bridge-owned, like the homes index) |

**Safety.** Datalog is read-only by construction, so a query cannot write. Pull and `:in` inputs
are accepted. A query that errors renders its error in place of the table, with the line marked.
It is never a 500 error.

## 5. Efficiency

- A query runs only when `basis-t` moves while the document is visible.
- **Cap:** 500 rows. Past that, the title says `500 of 12,330 rows` and `RET` on it visits `?all`.
  Rendering is linear in the rows shown.
- Join speed is the store's: BUG-002 measured joins 10–70× slower than the raw index. A slow query
  is slow here exactly as it is for the agent. The view shows the run time in its title (`· 84
  ms`), so the human sees the cost the agent pays.

## 6. Acceptance

- `(omega/q '[:find ?id :where [?t :task/status :running] [?t :task/id ?id]])` from `:` visits a
  table.
- Opening a task adds a row within one long-poll.
- `RET` on a task id visits its home.
- `e`, an edit and `RET` give a new `q:` path; `C-o` goes back.
- A malformed query shows its error inline.
