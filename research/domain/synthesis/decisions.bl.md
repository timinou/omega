# Decision register — what we must settle before implementation

> **Literate**, no runnable blocks. This is the discussion agenda. The domain notes raise ~110 open
> questions; this register folds them into **13 decisions** (D14 was appended 2026-10-03 for PLAN-003), ordered so that each one unblocks the ones
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

**Update 2026-10-03 (PLAN-003).** `research/domain/interface/bl-ed.bl.md` keeps (a) and adds projections, not new
sources of truth. The `:task` cell's result is a reference (`#omega/task {:id :goal}`), rewritten once at
terminal into a self-contained value (§3.4, E9 lean), so the document never holds live state. The
`journal/YYYY-MM-DD.bl.org` is committed text (§3.7, E7 user-decided). The package's own facts (editor ops,
effects, jj changes, attention-derived facts) live in omega's store through core change C1 `:schema` at
`env/open` (§8.4, E4 user-decided), so they join task facts in one query. Disk is a projection of the buffer
servers' published text (§5.7, E5). Status of D1 unchanged.

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

**Update 2026-10-03 (PLAN-003).** `bl-ed.bl.md` §3.3 relies on "terminal is final": evaluating a `:task` cell
whose result points at a live task with an edited goal is `task/say!` (a refinement of the same task);
whose result points at a terminal task opens a NEW task and records the old id in `:prev`. §3.4 rewrites
the result exactly once at terminal because terminal states never change again. Status of D3 unchanged.

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

**Update 2026-10-03 (PLAN-003).** `bl-ed.bl.md` §11 gives omega's bl-ed package one value shape,
`(ed/defpackage omega {… :omega-ext {:name :ed :schema … :hooks {:context …} :on {:turn/start … :turn/end …}}})`,
which uses the extension surface as it stands: an ext `:schema` (joined to omega's store via C1, §8.4), a
`:context` hook (attention, §6) and `:on` handlers from the minimal event set. It adds one event, C5
`:step/end` (`{:task :step :tools}`, emitted after each tool step beside `:turn/start`, §8.4), so the jj
checkpoint point is named, not inferred; until C5 lands, `:turn/start`/`:turn/end` handlers stand in.
Status of D8 unchanged.

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

**Update 2026-10-03 (PLAN-003).** `bl-ed.bl.md` adds an editing substrate under D9's tools. One buffer
server (`defserver`) per file in use holds the op log as datom facts (§5.1, §5.5) and gives agent edits a
second coloured cursor: concurrent ops are rebased by position, and an exact replacement is a
compare-and-set on the *content* it expects to find, refused with the story when it is gone (§5.3, §5.5;
E1, E2 user-decided). omega's `read`/`write`/`edit`
reach those servers through core change C6, a file port `(:files sys)` defaulting to today's disk functions
(§8.4, §5.6; E13 lean), so D9's hash-guarded `edits[]` stays the tool contract. The checkpoint substrate
lean (`git stash create`) is refined by §5.9–5.10: jj per step, opt-in (E6 user-decided), behind an
`omega.vcs` History protocol with jj and native backends (E17 user-decided). Status of D9 unchanged.

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

**Update 2026-10-03 (PLAN-003).** `bl-ed.bl.md` adds a third console to D12's two renderers: bl-ed, a Lisp
machine console. It differs in kind: it **receives views, not facts** (§2, §9), so the world renders cards,
transcripts and the overview and the console keeps only a text replica, selections and view state. The
wire is one socket per console (§9). Runners (CLI, `bl doc run --tasks`) are not consoles; they call the
same verbs inside the same world (§8). Status of D12 unchanged.

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

## D14. omega inside bl-ed (PLAN-003)

**Source:** `research/domain/interface/bl-ed.bl.md` (design for discussion; nothing built). The argument,
spikes (OBSERVED, RAN) and sketches (INFERRED) live there; this entry is the index. Status vocabulary is
that note's §13: **user** = decided by the user, **lean** = proposed, awaiting confirmation, **open** = needs
the user. Rows are copied from §13.

**Thesis (§2).** One world per realm, many consoles. The world is omega, a member of the project's realm,
holding code, data and work. A console (bl-ed tab, CLI, `omega-ui`, MCP) holds only what makes typing
instant, and **consoles receive views, not facts**. Runners are not consoles. Everything beyond the
seven named core changes is projection plus a literate package (§11).

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

**Core changes (§8.4), named ahead of time.** Each is additive; current tests and playground keep their
meaning.

| # | change | where |
|---|---|---|
| C1 | `env/open` takes `:schema` (extra attribute defs after `schema/all`) | `omega.env/open`, `open-durable!` |
| C2 | task ids qualified by world; registries and namespaces keyed by `[world-id task-id]` | `prelude`, `codemode/task-ns`, `stream` group |
| C3 | project policy in an `:omega` section of the project's `env.bl`, via apps declaring their own keys, validated by omega's reader | `bl.env` (beam-lisp) + `omega.config` (new) |
| C4 | cell id carries the tool-use id: `<task>/<step>/<tool-use-id>` | `codemode/run-eval` |
| C5 | `:step/end` emitted after each tool step (`{:task :step :tools}`) | `omega.loop` |
| C6 | `prelude/read`, `write`, `edit` dispatch through a file port `(:files sys)` | `omega.prelude` |
| C7 | `omega.cli` attaches to the realm's world when running (`--warm`), cold otherwise | `omega.cli`, `bin/omega` |

**Cells & cards (§3, §4, §7; E8–E11).** A `:task` cell is a cell kind whose result is a reference,
transcluded as a card whose height is its urgency; entering it opens the task in a sidebar. The result is
rewritten once at terminal so finished documents are self-contained. Cells that changed files are not
re-runnable; the effect record, not a static footprint, decides (E10). Org TODOs stay independent of
omega (§3.6).

**Buffers & consensus (§5, §6; E1, E2, E5, E13, E14).** One buffer server per open file; agent edits are a
second cursor; agents settle contention stigmergically through marks and traces on bitemporal servers,
with OT deferred (FUP-003). Human attention is a transient, decaying signal in the domain model. Disk is
a projection, published on pause. Agent edits route through the C6 file port.

**History & vcs (§5.8–5.10; E6, E17, E18).** Four granularities of history on one stack; jj per tool step,
opt-in, behind an `omega.vcs` protocol with jj and native backends, because history will eventually be
beam-lisp native. A failing gate still checkpoints, visibly marked, so the human can steer.

**Runners & realm (§8, §9; E3, E12, E16, E19).** The world is a realm `app` member that owns `.omega/db`;
CLI and `bl doc run --tasks` attach as runners (C7); task cells can run headless. C2 is the prerequisite
for one VM serving many omega projects. The world exits after an idle timeout. The beam-lisp branches (bl-js-actors,
realm, autovcs) are assumed merged before implementation.

**Config (§8.4.1, §11; E20, E21).** Project policy lives in the project's `env.bl` under `:omega`; personal
taste in `~/.config/omega/config.bl`; omega's build config in its own repo. Apps declare their own
`env.bl` keys with a validator (C3); undeclared keys stay errors.

**Build order:** waves W0–W6 plus follow-ups, §14 of the note.
**Absorbs:** `bl-ed.bl.md` §1 decisions 1–20 and §13 E1–E21.

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

**The bl-ed work (PLAN-003) keeps the kernel's verbs** and adds only the seven named core changes C1–C7
(`bl-ed.bl.md` §8.4), each listed ahead of time; anything else found during implementation is raised
before it lands (E15, lean). Everything else is projection and a literate package.
