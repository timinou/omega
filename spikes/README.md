# spikes/ — pre-implementation experiments for PLAN-003

Each spike is a runnable literate file: `bin/bl run spikes/<name>.bl.md` (omega's pinned beam-lisp).
Each one asks one question, prints OBSERVED output, and ends with `## Findings`. A spike that disproves
the design is a success. Spikes are not product code. They are deleted or turned into tests once the
feature they de-risk lands.

| spike | question | answer, in one line |
|---|---|---|
| `history.bl.md` | can history be beam-lisp native, from scratch, fast enough per agent step? | yes: CAS objects with line blame written at checkpoint, merges, revert-by-merge, renames; ~55 ms p50 on durable fjall, flat over 1200 steps; no jj |
| `step-checkpoint.bl.md` | can an extension checkpoint each tool step of a real task, with gate verdicts, two tasks at once? | only as a `:tool/after` HOOK (exact); `:on` events skew and lose steps; per-path attribution via claims removes pollution; a shared `main` cannot attribute gate failures honestly |
| `file-port.bl.md` | is C6 small, and does an agent edit through a buffer server behave as designed? | C6 = 29 lines; eval cells see the port; the CAS refusal names the other task and cell; `trace/claim!` costs ~100 ms per call |
| `convergence.bl.md` | where does §5.3's position rebase diverge, and what is the smallest fix? | it diverges on 63% of random concurrent pairs; atomic ops + split + actor tiebreak + list transform → 0/6000 |
| `hot-task.bl.md` | does a long omega task slow itself down today? | yes: 1.2 s → 2.7 s per trivial step by step 160 |
| `c8-turn-cache.bl.md` | does caching turns in the executor (C8) fix it? | yes: 4.4× faster on 120 steps; but a process-dictionary cache goes stale for non-executor readers, so C8 must thread the list through `turn!` as a value |
| `c9-claim-conflict.bl.md` | is telling the agent who else holds a path (C9) small and effective? | yes: ~12 lines; the second writer's model reads "t-1 also holds a.py" in its tool result |
| `buffer-overlay.bl.md` | can a buffer server keep the human's unpublished text off disk while agents still see it (E24)? | yes: published layer + per-human pending overlay, convergent ops; 0 violations in 1500 random cases; an agent `:old` found only in the overlay is refused (`:overlay`) |
| `turn-read-cost.bl.md` | where does that time go? | re-reading every turn from datom on every step (O(turns), 0.84 s at 300 turns) plus a rewritten `:task/cost` entity |
| `task-cell.bl.md` | does the `:task` cell work as a package on `bl.doc.spans`? (needs the js-actors beam-lisp, see its header) | yes, full lifecycle; it must keep its own span kind, never `:cell` |
| `task-refs.bl.md` | do per-task history refs fix gate blame? | no; a per-path gate does, on one shared main; refs add merge and blame, not test isolation |
| `claims-advisory.bl.md` | do claims refuse a second writer? | no (advisory, as designed), but `edit` drops the conflict instead of telling the agent |
| `async-checkpoint.bl.md` | can step checkpoints be exact AND non-blocking (snapshot inline + cast)? | yes: 0 skew, p50 3.8 ms vs 127 ms blocking, history identical to the blocking hook's, commit order = hook arrival order; historian 27-36 commits/s |
| `fs-capture.bl.md` | how do we also catch file changes that are not `edit` (sh, File/write!, git checkout)? | trace the cell's BEAM file calls (exact, <1 ms, sees spawned children), scan the tree only after cells that ran `sh` (60-140 ms on 2,000 files, racy-hash rule), window-attribute with `:ambiguous` for overlapping `sh` cells; inotify has no writer and loses files in new dirs; strace x3-31 |

The decisions these change are recorded in `research/domain/interface/bl-ed.bl.md` §15 (spike
results) and in the FEAT/FUP/BUG items it names.
