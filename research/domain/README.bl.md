# omega — research domain

> Literate index. Every `*.bl.md` under this directory passes `bl run` (verify with the loop at the
> bottom). `beam-lisp` blocks were executed. `clojure` blocks are design sketches. Other fences are quotes.

**What this is.** The shared basis to think from *before* any omega code exists. omega is the simplest
coding harness: pi's architecture (minimal loop plus extensions, codemode), rebuilt on beam-lisp
primitives, with **tasks instead of chats**. Tasks coordinate stigmergically through a shared fact
environment, use Jev for typed decisions, and render through one view language to both a loom desktop and
a ratatui TUI, styled per impeccable.style.

## Start here

1. `synthesis/omega-at-a-glance.bl.md`: the thesis, the layers, and a **runnable smallest loop** (two
   tasks, a tool call, a wait sensed through the environment, the human's query).
2. `synthesis/day-to-day.bl.md`: the verb set every surface shares, a normal day as sequences, the
   observability contract, and how an agent develops omega.
3. `synthesis/decisions.bl.md`: **the discussion agenda**. 13 decisions (D1–D13) absorb the ~110 open
   questions below, each with options, tradeoffs and a current lean.
4. `interface/bl-ed.bl.md` (after the interface notes it builds on): the worked design for running omega
   inside the bl-ed editor. Read it for the `:task` cell, the second-cursor edit model, the world-as-realm-member
   shape, and the named core changes (C1–C7) that touch omega itself.

## The notes, by concern

| dir | note | what it answers |
|---|---|---|
| `loop/` | `pi-architecture.bl.md` | pi's agent loop, `ai` provider layer, coding-agent (tools, JSONL session trees, compaction, extension API, modes), every other package, and a concept → file:line → omega table |
| | `llm-relay.bl.md` | talking to LLMs from beam-lisp via `ora/relay` over req_llm: call path, streaming fold, tool calls, accounting; the **vendoring table** (12 files) and comparisons with knowledger and pi |
| `tools/` | `codemode.bl.md` | **pi CodeMode in full** (QuickJS-WASM worker, protocol, exposure modes, BM25 discovery, budgets), the wider code-mode literature, Spell's `execute` as prior art, and a beam-lisp design with a runnable caps-`[]` sandbox probe |
| | `plugins.bl.md` | canonical plan mode, structural/tree-sitter editing, light LSP and 14 more plugins, ranked by value/complexity, giving a core/bundled/optional bundle |
| `coordination/` | `tasks-and-stigmergy.bl.md` | stigmergy (Grassé, Heylighen), tuple spaces and blackboards, today's agent systems (Claude teams, Beads, A2A); omega's task entity, lifecycle, trace types, decay (runnable), message vs trace, waits, file-conflict layers |
| | `processes-and-harness.bl.md` | beam-lisp's process tier (`proc.*`, `defserver` clauses, reg, bus/flow, super, fence), the existing `harness.bl`, the repl branch / Playground, datom as medium. **Runnable demos** of messaging, registry, parked waiters, supervision, `datom/watch` |
| | `jev.bl.md` | Jev (TypeSafe System One): the `/v1/systemone` contract, Choice/Score/Noul, confidence, limits, data policy; community harness use; knowledger's exact wire shapes; a proposed `jev` namespace with a **runnable offline kernel** |
| `interface/` | `loom-and-grammar.bl.md` | the grammar-of-the-web (seven parts), loom's full API, events as data, the desktop (wry) launch; runnable tree building |
| | `tui-ratatui.bl.md` | ratatui's model, beam-lisp NIFs, BEAM TUI survey, where state and rendering live, a loom→ratatui mapping table, an API sketch; runnable layout solver + lowering |
| | `bl-ed.bl.md` | **omega inside bl-ed** (design, 2026-10-03): the `:task` cell (full header params, reference results, card + sidebar), agent edits as a second cursor through per-file buffer servers (**runnable spike 1**: rebase, cursors, attention-parked suggestions), consensus ladder + bitemporal op log as datom facts (**spike 2**), `omega.vcs` History protocol with jj and native backends (**spike 3**, §5.10), non-re-runnable effectful cells, one world many runners incl. the OBSERVED shared-VM cross-write probe (§8.3, BUG-001), core changes C1–C7 (§8.4) and the three config layers (§8.4.1), decision register E1–E21 and waves W0–W6 (PLAN-003) |
| | `impeccable.bl.md` | Impeccable's principles, anti-patterns and numbers; loom token encoding (runnable contrast and lint checks); **six screen drafts** (overview, task, graph, inspector, review, palette) |
| `lineage/` | `spell.bl.md` | the first attempt (`../spell`, `spell-app`): architecture, an evidence-ranked pain table, what to keep |

## Vendored references (`../vendor/`)

- `pi/`: shallow clone of `github.com/earendil-works/pi` (the user's "earendil/pi-mono"; the org was
  renamed, per pi.dev changelog 2026-05-07).
- `impeccable/`: `github.com/pbakaus/impeccable` @ `c74755d9`, Apache-2.0, with provenance in its README.

## Conventions

- **OBSERVED vs INFERRED** is marked throughout. Source paths carry line ranges. URLs are cited.
- No secret values appear anywhere. Env vars are named only: `TYPESAFE_API_KEY`, etc. The local Codex login
  is copied to the git-ignored `.local/secrets/` (0600).
- Notes are named by topic, not number. Cross-links are relative (`../coordination/jev.bl.md`).

## Verify

```sh
cd omega && for f in $(find research/domain -name '*.bl.md' | sort); do
  bl run "$f" >/dev/null 2>&1 && echo "ok   $f" || echo "FAIL $f"; done
```
