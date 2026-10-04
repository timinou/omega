# `omega:overview` — every task, grouped by urgency

*Provider design. The protocol is in [`README.bl.md`](README.bl.md). Item: FEAT-017. Sources:
bl-ed §3.7 (the overview is a projection, `RET` goes home) and impeccable §7.1 (urgency first).*

## 1. Purpose

One place to see everything the world is doing, ordered by what needs you, and one keystroke to go
where each task lives. This is omega's home screen, as a document.

## 2. What it looks like

```org
#+TITLE: omega · 7 tasks · 1 needs you

* Needs you (1)
⚑ t-41  make read_number accept 0x hex — asks: Bump version to 0.2?      1m12s · plan.org
* Running (2)
● t-44  tidy imports                                                     12s · scratch
● t-45  ↳ write tests for hex (sub of t-41)                              40s · plan.org
* Waiting (1)
◌ t-39  release notes — waits on t-41                                    9m · journal
* Stale (0)
* Finished (3)
✓ t-38  reader handles leading + · 4m03s · reader.py                     plan.org
```

- These are **headings and lines, not a widget.** `] h`, folding a group (`Tab`), `/` search and
  the outline overlay all work unchanged.
- Each task line is an `:omega/task` presentation (README §4.4). Its keys are the same as on a
  card, from the one `:omega/task` table:

| key | does |
|---|---|
| `RET` | visit the home cell (path + block id); no home → `task:<id>` |
| `t` | visit `task:<id>` |
| `e` | visit `effects:<id>` |
| `y` / `n` / `a` | answer the open ask (only when the row has one) |
| `s` | say: the minibuffer, then `task/say!` |
| `x` | cancel, after a confirmation in the minibuffer |

## 3. Provider

| op | does |
|---|---|
| `:read` | `(model/snapshot env)` → `:by-group` in `model/GROUPS` order → a pure `render-overview` → `{:text :objects}`. Homes come from the bridge's homes index (§4) |
| `:rev` | two-stage (README §2.2): `basis-t` unchanged → the cached rev; else re-render and hash |
| `:write` / `:eval` | none (read-only; no cells) |

**The renderer is pure** (`omega.ed.render/overview : snapshot × homes × now → {:text :objects}`).
Its tests are plain data in, text out, and need no VM, bridge or page. The web UI's
`screens/overview` reads the same snapshot (README §4.4 rule 3).

**Elapsed times and freshness.** "1m12s" changes every second. Re-rendering on every tick would
make `rev` change constantly. So **ages are rounded per line**:
- second-level for ages under 1 min;
- minute-level under 1 h;
- hour-level beyond that.

The rev then moves at most once per unit, and only while something young is visible.

## 4. The homes index (bridge-owned)

omega does not know where a task's cell lives: the cell → task link is in the document's result
line (bl-ed §3.4). The bridge records it when it opens a task:
- `/open` from a task block → `{t-41 {:path "plan.org" :block "hex"}}`;
- homeless → `{t-44 {:path "omega:scratch" :block "t-44"}}`.

The index is kept in `.omega/homes.edn`. It is a cache and can be rebuilt:
- a scan of `BLED_ROOT`'s `.bl.org` files for `#omega/task {:id …}` results restores it;
- `bin/omega serve --reindex` runs that scan.

## 5. Efficiency

`snapshot` is the same projection the web UI renders on every change, so rendering it as text adds
one pure pass over the rows.

Unmeasured. **Budget, as an acceptance check:** render ≤ 20 ms for 100 tasks and 2,000 traces on the
pin. If `snapshot` itself exceeds that, the fix belongs in the projection: `tr/all` reads every
trace (BUG-002 is the store side of that). It is not a reason to add a separate cache here.

## 6. Acceptance

- A task opened from `bin/omega` shows up in Running within one long-poll.
- An ask moves it to "Needs you", and `y` on its line answers it.
- `RET` on a task opened from `plan.org` visits `plan.org` at its block; `C-o` returns.
- An unrelated trace on another task causes no page reload when the text is unchanged (the rev is
  equal).
