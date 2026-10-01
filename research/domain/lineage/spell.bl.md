# 40 — spell, the first attempt: architecture, what worked, what hurt

> **Abstract.** `/home/user/code/undefine/spell` (28 commits, 2026-08-27 → 2026-09-30) is a Mix umbrella
> (`interface`, `spell`, `mcp`, `librarium`) in which an LLM "grows" a web app by emitting definitions that
> walk a validation *ladder* before they are accepted into an immutable *machine* value. The page is a
> Spacetime/verse EDN projection served over Phoenix LiveView. Its strong ideas — one-owner state,
> conversation as datoms, errors as turns, "a rejection leaves the machine unchanged", one tool schema
> shared by chat and MCP — transfer directly to omega. Its pain — a 2047-line Elixir `loop.ex` doing
> orchestration the language should do, a three-runtime stack (beam-lisp → Spacetime/verse (Rust) →
> LiveView), global `BeamLisp.Env`, 40-minute cold builds, redb with no close — is the argument for omega's
> "language = harness = runtime". The follow-on `spell-app` (2012 lines of `.bl`, no Elixir) already
> pivoted that way and is the closer ancestor of omega. This is a research note: nothing here is omega code.

Legend: **[OBS]** read or run this session · **[INF]** inference.

## 1. Sources

All paths under `/home/user/code/undefine/spell` unless stated.

| What | Where |
|---|---|
| README (umbrella shape, agent bridge) | `README.md:1-54` |
| `git log` (28 commits) | `git log --format='%h %ad %s'`; notable: `baebc40` "way too much shit ot make it work" (2026-09-16, 40 files, +2547/−581), `9e67776` "oof org files", `66fe431` scaffold → `517bd9b`/`5e16f86`/`ad722e7`/`0cf33e4` phase 1/1b/1c → `c1817ca` phase 2 "cut the model call over to relay.engine in-process" (all 2026-08-27) |
| The turn loop | `apps/spell/lib/spell/loop.ex` (2047 lines; moduledoc L1-60, tool schema L68-110, `@max_attempts` L63, ladder refs L249-300, `run_turn` L927) |
| Model seam over relay | `apps/spell/lib/spell/model.ex:1-329` (moduledoc L1-35, `default_model` L60-90, `.env` discovery L92-150, `local_stream` L170-215, `wire_messages` L225-250, `install_stub!` L275-329) |
| MCP face | `apps/spell/lib/spell/mcp.ex:1-50`; `apps/mcp/src/mcp/{server,jsonrpc,tools,transport-stdio}.bl` (stateless MCP 2026-07-28) |
| Transcript as datoms | `apps/spell/src/spell/transcript.bl:1-60`, `session.bl:1-25`, `timeline.bl` (391 l), `blocks.bl`, `seed.bl` |
| Desktop-face prototypes | `apps/spell/session/README.md` (`prompt.bl`, `loop.bl`, `spell.bl`, `verify.bl`) |
| Interface emitter | `apps/interface/src/interface/{contract,machine,run,server,live,st-edn}.bl`, `lib/interface/*.ex` |
| librarium (briefly) | `apps/librarium/src/librarium/{lib,ingest,embed,reader}.bl` — datom-backed "libraries" w/ schema packs, embeddings, PDF reader |
| Docs | `docs/prototype-2-live-turns.typ` (185 l), `docs/prototype-3-live-blocks.typ` (206 l) |
| Org tasks | `!tasks/plans/PLAN-001…015`, `!tasks/features/FEAT-001…003`, `!tasks/bugs/BUG-001,002`, `!tasks/follow-ups/FUP-001…004`; `!sessions/` is empty (only `reference.org`) |
| Successor | `/home/user/code/undefine/spell-app/`: `README.md`, `src/spell/*.bl` (12 files, 1.5 kLOC), `scenarios/*.bl`, `notebooks/hello.bl.md`, `!tasks/plans/PLAN-001-the-ledger…` |
| relay (the LLM half) | see file `../loop/llm-relay.bl.md` |

## 2. What it is / how it works

### 2.1 Umbrella and dependency arrow [OBS: README.md, PLAN-001]

```
beam_lisp (language + datom + native)
   ▲     ▲
interface  (defcontract/defview → Spacetime EDN page + generated LiveView)
   ▲
  spell    (turn loop + ladder + journal/replay + chat shell + MCP face + Phoenix endpoint)
```

`interface` must not reference `spell` at compile time, so `Interface.Server` reaches the agent through
three fn-valued hooks registered at boot (`Interface.Server.register_agent/1`): resolve contract, restore
transcript, perform `(ask! …)`. (PLAN-001 "The ONE real code coupling to invert".) This was the product of
PLAN-001, an extraction of `spell/` out of the beam-lisp monorepo so that beam-lisp became "pure language +
datom + native".

### 2.2 The loop: tool = "grow the machine" [OBS: loop.ex:1-110]

One process (`GenServer`) owns **the machine** (an immutable value) and the transcript. The model is offered
**one tool**, `run`, whose argument is *definition SOURCE* — the same `(defcontract …)` / `(defview …)` /
`(defn …)` text a human writes — plus a one-sentence `rationale` that is journaled. Quote:

```elixir
@max_attempts 3
@tool_name "run"
…
required: ["source", "rationale"],
…
"walks the validation ladder — read, machine, verse compile, ghost selectors, fence for code —
 and the verdict comes back with the rung named. A rejection leaves the machine unchanged;
 an acceptance rebuilds the page immediately."
```

**The ladder** (rungs, cheapest first): read → machine (does it compose with existing contracts?) → verse
compile (Rust Spacetime compiler) → ghost selectors (a style rule naming a class absent from markup is
rejected) → fence (code `bl` blocks evaluated in a bounded env). A refusal is *fed back to the model with
the failing rung and diagnostic*, up to 3 attempts; every attempt is recorded as a `:run` transcript entry
"because a rejected attempt is the most informative thing the loop produces".

**Rollback is "keep the old value"**. The loop's moduledoc records a bug it fixed: the machine used to be
`(def live-machine …)` in the process-global `BeamLisp.Env`, written from two places; "last writer won,
silently". Now it is threaded: `state.machine` in → candidate out → bind only if accepted.

**Journal/replay.** Accepted definitions are journaled (`journal.bl` for DEFINITIONS, `vars/` for code)
and replayed through *the same ladder* at boot ("a journal entry that no longer validates … the ladder got
stricter" is refused loudly, loop.ex ~L249-290).

### 2.3 Transcript = datoms [OBS: transcript.bl, docs/prototype-2]

`:msg/id :msg/session :msg/seq :msg/role :msg/source :msg/at` in a redb-backed datom store. `:msg/source` is
a **`.bl.md` document** (user text is a degenerate one-prose-block document). Choices that survived
review: `:msg/seq` from `[:find (max ?s)]` not a count (retractions); `(durable? …)` exposes
redb-vs-memory fallback so a session that would vanish on restart is *marked*; the JSON snapshot was
"*removed, not demoted*. Two truths is a bug farm"; commit-before-publish ordering; verdicts recorded as
`:msg/role "verdict"` rendered as subdued meta rows; "thinking" is derived (`pending?` ≡ last turn is the
user's); a failure is a turn (no key → a `system` turn, session stays usable).

### 2.4 The model seam [OBS: model.ex]

`Spell.Model.stream/2` → `relay.engine/stream` in-process (relay as an Elixir path dep, `serve: false`).
Everything is req_llm's `%StreamChunk{}` vocabulary (`:content :tool_call :meta`), so the loop folds one
shape. Offline = `relay.completion/set-backend!` with canned chunks (`PROVIDER=fake`,
`SPELL_FAKE_SCENARIO` = JSON chunk array). Provider choice is DATA (an alias row); default model is
auto-detected from whichever key exists in env/`.env` (nearest `.env` walking up 4 dirs;
`SPELL_ENV_FILE=none` for hermetic tests).

The interop seam produced a documented bug: relay's message converter reads **string** keys
(`Map.get(msg,"role")`) but spell passed atom-keyed maps → every message arrived with empty content, so
"glm-5.3 replied 'It looks like your message came through empty!'; deepseek answered an unrelated
question" (model.ex L225-245, measured 2026-09-11). Fix: `wire_messages/1` normalises once.
Lesson [INF]: the BEAM-map/atom-vs-string key boundary is the #1 silent failure at Elixir↔bl seams.

### 2.5 The MCP face [OBS: mcp.ex, apps/mcp]

A second front door for external clients (Claude Code, mcp-remote): Streamable-HTTP POST, JSON-only,
loopback, Origin-validated, no auth, **no eval**; tools `run`, `state`, `transcript`; the schema is
*adapted from `Loop.run_tool/0` so the two faces cannot drift*; the machine briefing rides in
`initialize.instructions`, computed from the machine at session start. `apps/mcp` additionally has a pure-bl
JSON-RPC + stdio transport (`jsonrpc.bl` 186 l, `server.bl` 170 l).

### 2.6 `.bl.md` responses and live blocks [OBS: PLAN-002, docs/prototype-2/3]

Target shape (user directive 2026-08-27): relay only sends chat; replies are `.bl.md` — fences `bl`/`clojure`
(evaluated, result shown), `st`/`st-edn` (Spacetime UI, **live** in P3), tangled like verse's `.st.md`;
unknown fence languages inert; malformed fence ⇒ a visible warning block, document stored verbatim; two
view kinds (**app** views like the timeline, **chip** views = meta, e.g. view-registry picker). Model-authored
`bl` blocks: pure expressions evaluate through `bounded_eval`; *definitional* blocks render as source +
"proposes a definition — run via the run tool", later auto-laddered at turn end (PLAN-004 §4).

### 2.7 Prototype track: from web to desktop [OBS: session/README.md, PLAN-015]

`session/prompt.bl` (P1: wry window shows one value) → `loop.bl` (P2: state is a datom log, page is a query;
**naming a component mounts it**; widget registry doubles as the model's affordance menu — "a new widget
teaches the model about itself with no second list to keep in sync"; a component may `:provide` context to
siblings) → `spell.bl` (both). "There is no server and no browser: one BEAM node holds the session, and the
window is a viewer of it (wry → WebKitGTK through loom.desktop)". This is exactly omega's loom front-end.

### 2.8 librarium & mcp (brief) [OBS]

`librarium`: "a LIBRARY is a datom space with a manifest" (`lib.bl`): schema packs (`facts proc legal dev
research kb crm support ops`), manifest asserted as datoms so *which packs does this space have* is a
query; embeddings w/ Gemini + concurrent chunk embed (8 at a time) + 30 s timeouts + retry; a verified
multilingual PDF/HTML reader (938 l, the last commit). It was drifting toward "knowledger" (PLAN-008…014:
company-memory MCP product), i.e. *scope escaped the agent harness*. [INF] Omega should treat it as a
separate product, not a dependency.

### 2.9 Relation to `spell-app` [OBS: spell-app/README.md, PLAN-001, src/spell/*.bl]

`spell-app` is the successor ("The alive environment. A workspace of files that stay claimed, sessions that
are processes, and a face that is only ever a query over the log"). 2012 lines of pure `.bl`, **no Elixir**.
Modules: `boot` (per-file coherent claim; a broken file is *held* alone), `claim` (watcher; `@spell:`
mentions → facts → sessions launched from documents), `session` (log in datoms + **manners** as a
`defserver` whose invariant z3 proves inductively: "an ask is outstanding ⇔ machine is in asked phase"),
`cassette` (record/replay at the model-fn seam, digest-keyed EDN, replay of a missing digest *raises*),
`handoff` (cassette + env + cursor as one value), `observatory` (the live image as a datom db), `edit`
(structural edit-by-symbol through reload's gate), `chat` (4 screens as one `live.app` value), `main`.
Its PLAN-001 "The Ledger" decides: `.bl.org` is the ledger dialect (append-only chat), agents get scratch
`.bl.org` ledgers, agent disk = its own ledger path only. Commits show W0–W2 landed with "gates blocked
upstream" (waiting on beam-lisp), i.e. it is blocked on language features, not on design.

## 3. What hurt (evidence-ranked)

| # | Pain | Evidence | Lesson for omega |
|---|---|---|---|
| 1 | **Orchestration in Elixir, not the language.** `loop.ex` grew to 2047 lines; commit `baebc40` ("way too much shit ot make it work", 2026-09-16) touched 40 files, +2547/−581, 731 lines in `loop.ex` alone, plus `verse.ex` +155, `timeline.bl` +288, `transcript.bl` +206. | `git show --stat baebc40`; org commit `9e67776` "oof org files" landed 15 plan/bug/fup files in one commit (plans were never committed as they went) | The harness loop must be a beam-lisp process (`proc`) — small enough to read. Commit plans/org items alongside code. |
| 2 | **Three UI runtimes** (bl → verse/Spacetime Rust → LiveView) with fragile seams: BUG-002 "baked live-block holes are inert: `[:st/raw]` is opaque to verse's signal runtime" (block HTML must sit at its document position *and* be reactive; raw string kills reactivity). | `!tasks/bugs/BUG-002…` | Single UI vocabulary (loom) and a *tree*, not baked HTML strings. |
| 3 | **Global mutable `BeamLisp.Env`** → every ExUnit case `async: false`; "0.00s async" (FEAT-003); a VM-global `persistent_term` once swapped one loop's store under another (transcript.bl L25-35). | `!tasks/features/FEAT-003`; `transcript.bl` header | State = value in the owning process; threading beats cells. Omega tasks-as-processes must not share a global env. (beam-lisp since added `^:per-env` defs — relay.env uses them.) |
| 4 | **Cold builds**: 40+ min silent CPU for a private `MIX_BUILD_PATH`; datom `relations.bl` 162 s compile, interface `machine.bl` 12 s; "Elixir 1.20 Module.Types.Descr tuple intersections" root cause (FEAT-001/002). | `!tasks/features/FEAT-001,002` | Make `bl`'s warm daemon + global AOT cache the dev loop; avoid Mix umbrellas. |
| 5 | **redb has no close** (FUP-002): a same-VM reopen of a path races GC and silently falls back to memory. Workaround: memoize store by path, one open per VM. | `!tasks/follow-ups/FUP-002` | Open durable stores once, as supervised resources; expose `durable?`. |
| 6 | **Interop key mismatch** (atom vs string keys) → empty messages sent to LLMs (§2.4). | `model.ex` L225-245 | One canonical message representation inside omega; convert at exactly one edge. |
| 7 | **Scope creep**: librarium/knowledger/MCP/typst docs/design-system plans (PLAN-007…014) in a repo named "spell". | `!tasks/plans`, `apps/librarium` | Ship the harness core first; products consume it. |
| 8 | `.spell/org/workspace.bin` (a 238 KB binary) committed in the same commit as code. | `git show --stat baebc40` | Binary caches in `.gitignore`. |
| 9 | Plans were written then abandoned mid-way (PLAN-003/004 "DOING"; BUG-001 reel "still references removed modules"). | `!tasks` | Smaller waves; tasks that can *finish*. |

## 4. What worked (keep)

1. **State is a value; one process owns it; rollback = not binding the candidate** (loop.ex moduledoc).
2. **Errors/rejections are first-class transcript entries** — "a rejected attempt is the most informative thing".
3. **One tool schema, two faces** (chat and MCP derived from one map).
4. **Registry as the model's affordance menu** (derive the system prompt from the registry; no second list).
5. **Derived, not stored** (`pending?`, style plane derived from the rendered tree: "style and content cannot drift because they are the same walk").
6. **Cassettes** (spell-app): record/replay at the model-fn seam makes agent behaviour testable and handoff-able; "a replay that improvises is not a replay".
7. **Journal replayed through the same gate** that admitted it (stricter gate ⇒ loud refusal at boot).
8. **Proof, not demo**: `verify.bl` and the z3-proved session manners; `serve_live_check.exs` smoke.
9. **Offline path = the same code path** (`relay.completion/set-backend!` stub; only the transport differs).
10. **Claim-per-file** (spell-app `boot.bl`): a broken file holds alone while neighbours go live.

## 5. What omega should take / adapt / drop

| Item | Verdict | Reason |
|---|---|---|
| Machine-as-value + candidate/accept/rollback | **take** | Cheap atomicity for self-modification. |
| Ladder (ordered cheap→costly gates with named rung in the verdict) | **adapt** | Generalise to omega's "gates" for a *task's* edits (parse → compile → test → ...); drop verse/ghost rungs. |
| Datom transcript with `:msg/source` as `.bl.md` | **adapt** | Keep datoms for facts about tasks/messages (stigmergic traces); the document form is optional (see pi session JSONL in other notes). |
| `durable?` visible, one-open-per-VM stores | **take** | Honest degradation. |
| `Interface.*`, `defcontract/defview`, Spacetime EDN, verse | **drop** | Replaced by loom + TUI; three-runtime stack was the main cost. |
| `Spell.Loop` GenServer | **drop** | Re-implement as a `proc` process; orchestration in bl. |
| MCP face (`Loop.run_tool` adaptation, `initialize.instructions` from live state) | **adapt** | Omega tasks should be reachable from outside; reuse `apps/mcp` pure-bl JSON-RPC (or beam-lisp's `priv/lib/mcp`). |
| Cassette record/replay at the model seam (spell-app) | **take** | Deterministic tests of tasks; see `../loop/llm-relay.bl.md` §7 for the seam. |
| z3-proved manners | **maybe** | Great for task-state-machine invariants; cost = z3 dependency. |
| Journal replay through same gate | **take** | For restoring task state after restart. |
| librarium/knowledger/PDF reader | **drop** | Different product. |
| `.env` walk-up discovery + auto-detect default model by key | **adapt** | Good DX; but keep an explicit `OMEGA_ENV_FILE=none` hermetic switch (`SPELL_ENV_FILE` pattern). |

## 6. beam-lisp mapping

| Need | Where in beam-lisp (`/home/user/code/undefine/beam-lisp--repl`) | Gap |
|---|---|---|
| Processes, mailboxes, waits | `priv/std/proc.bl`, `priv/std/proc/*.bl` (covered in sibling files) | — |
| Datom store | `priv/lib/datom.bl`, `priv/lib/datom/` (`store-redb`, `store-fjall`, ets) | redb close (FUP-002) — check whether since fixed |
| Per-VM isolation | `^:per-env` defs (used in `ora/relay/src/relay/env.bl:44`) | verify availability on target `bl` version |
| Wry/desktop | `priv/lib/wry.bl`, `priv/lib/loom/`, `priv/lib/live.bl` | covered elsewhere |
| LLM call | `priv/lib/gen/llm.bl` (pure bl, OpenAI-compat, non-streaming, 84 l) and `priv/lib/harness/model.bl` (105 l; `.bl.md` session → chat messages) | **no streaming, no tools** → vendor from relay (`../loop/llm-relay.bl.md`) |
| Literate sessions | `priv/lib/harness.bl` (434 l) append-only `.bl.md` session; `bl.doc` slicer | spell-app chose `.bl.org` for the ledger |
| Reload/claims | `priv/std/reload*` | spell-app uses it; omega should too |

Runnable sketch of the one idea worth carrying forward — *machine as a value, ladder as ordered gates,
rejection leaves the old value* — in plain beam-lisp (offline, deterministic):

```beam-lisp
;; gates: (fn [machine source] -> nil | {:rung kw :reason str})
(def gates
  [[:read    (fn [_ src] (if (= 0 (count src)) {:rung :read :reason "empty"} nil))]
   [:machine (fn [m src] (if (contains? (:defs m) src) {:rung :machine :reason "duplicate"} nil))]
   [:fence   (fn [_ src] (if (some? (index-of src "unsafe")) {:rung :fence :reason "unsafe form"} nil))]])

(defn ladder [machine src]
  (or (some (fn [[_ g]] (g machine src)) gates)   ; first refusal wins; nil = every rung passed
      :accepted))

(defn run-source
  "{:machine m'} on success; the OLD machine plus a verdict entry on refusal."
  [machine src]
  (let [v (ladder machine src)]
    (if (= v :accepted)
      {:machine (update machine :defs conj src) :verdict {:ok true}}
      {:machine machine :verdict (assoc v :ok false)})))

(def m0 {:defs #{}})
(def r1 (run-source m0 "(defn f [] 1)"))
(def r2 (run-source (:machine r1) "(defn f [] 1)"))
(def r3 (run-source (:machine r2) "unsafe thing"))
(println (:verdict r1))
(println (:verdict r2))
(println (:verdict r3))
(println "machine unchanged by refusals:" (= (:machine r1) (:machine r3)))
```

## 7. Interactions & observability

- **Human**: spell offered a chat page (LiveView) and a wry window; transcript timeline with verdict rows
  and visible rejected attempts; `/claims` and `/prove` screens in spell-app (facts as queries).
- **Agent developing omega**: `mix run --no-halt scripts/serve_live.exs` + `serve_live_check.exs` smoke;
  `mix test` (ExUnit, serial) and `mix beam_lisp.test` (bl suites); `session/verify.bl` as a single
  exit-code proof; run-per-scenario `scenarios/*.bl` + `run-all.bl` in spell-app (exit-code verdict — the
  commit "regression: exit-code verdict (harness/rule-debug/legal-demo print no checkmark)" shows a
  scenario that *printed* ✓ without failing the process was a real defect: **verdicts must be exit codes**).
- **Observability that existed**: datom transcript (queryable), `observatory.bl` (image/sources/dbs/heat as
  a datom db), `spell.observe` (77 l), journal files. [INF] Omega's analogue: every task, message, trace is a
  datom; every gate verdict is a fact.

## 8. Open questions for discussion

1. **Document vs datom for the conversation.** spell stored `:msg/source` `.bl.md` inside datoms; spell-app
   moved to append-only `.bl.org`/`.bl.md` ledgers + datom log. For omega tasks: (a) datoms only (query-first,
   stigmergy-friendly, needs a renderer), (b) append-only literate file per task (human-diffable, git-friendly,
   needs a slicer — `bl.doc`), (c) both with one as derived. Spell's "two truths is a bug farm" argues for one
   source of truth; which?
2. **Is the ladder a core primitive or a task type?** A reusable "gate" protocol (named rung, cheap→costly)
   could govern every self-edit. Cost: designing the contract early. Alt: leave gates to bundles.
3. **Proof (z3) for task manners.** spell-app proves turn-taking inductively. Worth it for omega's
   task/wait protocol (deadlock freedom)? Cost: z3 dependency + spec upkeep.
4. **Cassettes as a first-class seam.** Keep record/replay at the model fn (spell-app) — then `Jev` decisions
   would need the same seam. One cassette format for both?
5. **MCP face.** Expose omega tasks over MCP (as spell did) in v1, or later? Reuse `apps/mcp` code or
   beam-lisp's own `priv/lib/mcp`?
6. **Scope discipline.** What is the explicit non-goal list (librarium-like products, design systems) to stop
   a repeat of §3 row 7?
