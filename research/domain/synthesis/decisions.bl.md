# Decision register — what we must settle before implementation

> **Literate**, no runnable blocks. This is the discussion agenda. The domain notes raise ~110 open
> questions; this register folds them into **13 decisions**, ordered so that each one unblocks the ones
> after it. Each decision lists the options, their tradeoffs, my current lean (INFERRED, *not* decided),
> and the source questions it absorbs. "Lean" means a starting position for discussion, not a choice.

## How to read this

- **Status** is one of `open`, `leaning`, or `decided`. Everything starts at `open`/`leaning`. Only the
  user moves an item to `decided`.
- **Absorbs** cites the source questions as `file Qn`, so the full argument stays one click away.
- The order is a dependency order: D1–D4 shape the data model, D5–D9 the loop and tools, D10–D13 the
  surfaces.

---

## D1. What is the source of truth: fact log, document, or org files?

**Options.**
- (a) **datom fact log is authoritative.** The `.bl.md` transcript and any `!tasks/`-style org view are
  projections. Queryable, time-travel, atomic claims. Costs a store dependency in core.
- (b) **`.bl.md` document is authoritative**, as `harness.bl` does today. Human-first, diffable,
  `bl run`-able. Weak for multi-writer facts and atomic claims.
- (c) **Split by field.** Status, claims and waits live in datom; goal and notes live in text.

**Lean:** (a), with the `.bl.md` as a first-class *projection* (always renderable, Stream-compatible).
Evidence: every note converges here, and spell stored `.bl.md` inside datoms.
**Absorbs:** pi-architecture Q1–Q2 · processes-and-harness Q1, Q3 · tasks-and-stigmergy Q1 · spell Q1 ·
impeccable Q8.

## D2. What is a task, physically?

**Options.**
- (a) A registered **process**, with a datom row mirroring it. Simple, but dies with the VM.
- (b) A datom **entity** plus a disposable **executor** that holds a lease, the way `proc.queue` claims
  jobs. Resumable across restarts.

**Lean:** (b) in the data model, but implement only the executor-as-`defserver` at first. Resumption is
"replay the log into a fresh executor".
**Sub-decisions:** supervision granularity (a tree per scope vs a flat dynamic pool; `proc.super` has no
dynamic-child verb yet). Whether a `(task …)` `defserver` clause is worth it vs plain library functions.
**Absorbs:** processes-and-harness Q2, Q5, Q7 · pi-architecture Q4 · tasks-and-stigmergy Q5, Q8.

## D3. Task granularity and lifetimes

**Questions.** Is one prompt always one task? Is a follow-up after `done` a new task with `:refines`
(A2A), or a reopened one? Are subtasks first-class, with owner edges and bottom-up cancel (pi `durable`)?
And who garbage-collects traces?
**Lean:** one prompt = one task. Terminal states are immutable, so a follow-up is a new task in the same
context. Ownership edges apply to sub-work only, and peers coordinate through traces.
**Absorbs:** tasks-and-stigmergy Q8 · pi-architecture Q4 · plugins Q2 (plan as task).

## D4. The stigmergic medium: trace types, decay, claims

**Questions.**
- Is the trace vocabulary fixed (claim, intent, finding, blocker, completion, heartbeat) or open?
- Decay: fixed half-lives or per-project? Do reads reinforce?
- Claim granularity: file, directory or symbol?
- Worktrees: always, never, or on conflict?
- Trust: do traces carry provenance, and do they get lower authority than the human prompt?

**Lean:**
- Fixed small vocabulary, emitted by the *harness* as side effects wherever possible.
- Read-time decay with per-type half-lives. Claims at file level by default.
- Worktrees on conflict only.
- Traces from tasks are framed as data, never instructions.

**Absorbs:** tasks-and-stigmergy Q2–Q4, Q6, Q9–Q10 · processes-and-harness Q1.

## D5. Where Jev decides, and how far it is trusted

**Questions.**
- Which coordination points ask Jev: scope proposal, in-scope check, wait-or-proceed, done check, hazard or
  permission?
- May Jev approve on its own, or only escalate?
- Thresholds, provider matrix, data/egress policy, budget owner, and whether cassettes get committed.

**Lean:**
- Jev may only *tighten*: escalate to the human, or refuse. It never waives a rule until shadow-mode
  data exists.
- Literal questions-as-values API, plus a cassette and a ledger.
- Group questions by shared state, not by timing.
- Every decision must declare a failure direction.
- Default egress `:never` until a project opts in.

**Absorbs:** jev Q1–Q12 · tasks-and-stigmergy Q7 · plugins Q10 · codemode Q11.

## D6. Codemode: language, sandbox strength, transactions

**Questions.**
- Which language does the model write: beam-lisp only, beam-lisp plus a JS escape, or a PTC-style subset?
- Sandbox: env caps `[]` in-VM, or a separate node?
- Transactions: none, file overlay, or overlay plus up-front refusal of mixed irreversible effects?
- Handles for large results: now or later?
- Exposure defaults for built-in tools, and where tool declarations live.

**Lean:**
- beam-lisp only, measured with a small eval.
- In-VM caps `[]` with runner-set `max_heap_size{kill}` and a deadline, after a one-off audit of what
  `core` exposes.
- File overlay, plus at most one irreversible effect, placed last.
- Built-in tools both `direct` and in codemode.
- One tool-table value as the single source of declarations.

**Prerequisite findings (OBSERVED):**
- The env's `:max_heap_words` did not stop an allocation, but the runner's process flag did.
- `(meta (var f))` returned nil, so docstrings cannot feed declarations yet.

**Absorbs:** codemode Q1–Q12 · processes-and-harness Q6.

## D7. The LLM layer

**Questions.**
- req_llm under relay (30+ providers, SSE quirks solved) or a pure-beam-lisp provider layer?
- Vendor or depend on relay?
- Event vocabulary: pi's block-indexed start/delta/end, or flat chunks?
- Cancellation, thinking tokens, retry taxonomy, subscription OAuth providers.

**Lean:**
- Vendor the trimmed ~12 relay files over req_llm. Adopt pi's block-indexed events as the canonical
  stream.
- One cassette seam for chat, tools and Jev. Knowledger's error taxonomy.
- Cancel by killing the consumer process (verify that req_llm's stream stops).

**NB (session fact):**
- Codex OAuth is available (copied to `.local/secrets/codex-oauth.json`, git-ignored, 0600).
- An Anthropic proxy is at `localhost:8080`. It returned 503 for every model during this session. Recheck
  before relying on it.

**Absorbs:** llm-relay Q1–Q10 · pi-architecture Q6 · processes-and-harness Q10 · spell Q4.

## D8. The loop's extension surface

**Questions.**
- How many events/hooks? pi has ~35. The minimal set is task/start, task/end, turn/start, tool/call,
  tool/result, context, before-compact and before-fork.
- Skills vs bundles: is a skill a bundle with a `SKILL.md`?
- Where does the system prompt live per task: scope as a prompt section *and* a value?

**Lean:**
- Three primitives (call-predicate, context-transform, turn-snapshot) plus the minimal event set, frozen
  early.
- A skill is prose plus optional code in one `.bl.md`.

**Absorbs:** pi-architecture Q5, Q7, Q12 · plugins Q9.

## D9. Editing and feedback tools

**Questions.**
- Edit format: `edits[]` str-replace only, or also Codex `apply_patch`?
- Tree-sitter for non-`.bl` code: NIF, CLI (ast-grep), or skip?
- Diagnostics: a command table or an LSP client?
- Checkpoint substrate: git stash create, jj, or datom?

**Lean:**
- Multi-edit `edits[]` with an atomic, hash-guarded apply. Add `apply_patch` when a GPT-family model is
  the default.
- ast-grep/tree-sitter CLI for other languages; beam-lisp-native for `.bl`.
- A command table first.
- A `snapshot/restore` protocol backed by `git stash create`.

**Absorbs:** plugins Q3–Q6, Q12.

## D10. Permissions and plan mode

**Questions.**
- Where does real read-only enforcement come from: a classifier over bash, caps, or a read-only
  mount/container?
- Is plan a mode or a task?
- Is there an auto-approve classifier (Jev)?

**Lean:**
- A rule table (glob → action, last match wins, deny beats allow) as core.
- Plan = a profile (mode) inside a task, as sugar over the task model.
- Caps for beam-lisp evals. Bash in plan mode stays the honest weak point until we choose a sandbox.

**Absorbs:** plugins Q1–Q2, Q8, Q10 · pi-architecture Q8.

## D11. Long tasks: compaction vs handoff

**Options.**
- (a) In-place summary entry (pi).
- (b) Spawn a successor task that holds the summary plus the trace links (omega-native, small contexts).
- (c) A compactor task triggered by trace pressure.

**Lean:** (b) as the default, with (a) as a fallback for tasks that must not change identity.
**Absorbs:** pi-architecture Q10 · plugins Q7 · tasks-and-stigmergy §5.3.

## D12. One view language, two renderers

**Questions.**
- Where does lowering happen? loom bakes layout into hashed CSS classes, so either the TUI parses CSS,
  loom emits a semantic tree, or an `omega.ui` façade emits semantic roles.
- Own ratatui crate or ex_ratatui?
- Layout solver in beam-lisp, ratatui Cassowary, or Taffy?
- Widget state in BEAM or in the NIF?
- Alt-screen vs inline scrollback.
- One driver for both back-ends?

**Lean:**
- An `omega.ui` façade with semantic roles. Two lowerings (loom HTML, TUI cells).
- Layout in beam-lisp and all state in BEAM. A thin own-crate NIF draws a flat widget list.
- One driver contract (`view`/`on-event`/`tick`) shared with `loom.desktop`.

**Baseline gotcha (OBSERVED):** the installed `bl` (2026.4.0) loom lacks `disclosure`/`facts` that the repl
worktree has. Decide which beam-lisp build omega targets.
**Absorbs:** loom-and-grammar Q1–Q10 · tui-ratatui Q1–Q12 · processes-and-harness Q9.

## D13. Look and feel

**Questions.**
- Register: pure Operate, or Operate with one identity carrier?
- Themes: dark only, or dual?
- Accent hue: amber, blue or teal? Amber collides with warning.
- How strict is the lint gate? Which TUI glyph policy? Liveness via text only, or a 4 Hz indicator?
- Keybinding scheme. Which Impeccable commands get surfaced?

**Lean:**
- Operate, dual themes, a small Unicode glyph set with an ASCII fallback, liveness as text.
- Mechanical rules gate CI with ignore-with-reason.
- vim and arrow keys mapped to the same events.
- Surface ~6 Impeccable verbs.

**Absorbs:** impeccable Q1–Q12 · loom-and-grammar Q8–Q9 · tui-ratatui Q3, Q7, Q12 · day-to-day Q1–Q4.

---

## Cross-cutting: scope discipline

spell's biggest lesson was scope creep: product work leaking into the harness, and Elixir orchestration
doing what the language should (`../lineage/spell.bl.md` §3). **Proposed non-goals for v1:**
- multi-machine distribution;
- non-harness products;
- a custom design system beyond tokens and roles;
- OAuth subscription providers beyond what is already available;
- a graph canvas (the layered list ships first);
- an MCP *client* (MCP *server* face only).

**Absorbs:** spell Q5–Q6 · processes-and-harness Q8 · tasks-and-stigmergy Q10.
