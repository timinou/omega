# Canonical harness plugins — what proven harnesses do, and what omega should take

> **Literate.** Blocks tagged `beam-lisp` run under `bl run research/domain/tools/plugins.bl.md`
> and were run before this was written. Blocks tagged `clojure` are design sketches of omega code that
> does not exist yet. Blocks tagged `ts`/`json`/`text` are quotes from other sources.

This is a survey of the *plugins* every serious coding-agent harness grows around its agent loop. The
plugins covered are plan mode, structural editing, light LSP, compaction/handoff, subagents, todos,
memory, hooks, permission gates, checkpoints, skills, MCP, web, repo map, test feedback, telemetry,
export/replay and sandboxes. For each one it records the mechanism, cites the primary source, picks a
canonical design, and gives the beam-lisp angle. The recurring finding is that almost every plugin
reduces to **one of three primitives**: (a) a *predicate over a tool call* (plan mode, permissions,
protected paths, hooks), (b) a *transformation of the context window* (compaction, repo map, skills,
memory), or (c) a *snapshot of the world at a turn boundary* (checkpoint, replay, export). If omega's
core exposes those three primitives as data, most plugins become a few dozen lines each. The document
ends with a ranked bundle proposal (core / bundled / optional).

## 1. Sources

**Read locally (OBSERVED).**

| path | lines | used for |
|---|---|---|
| `research/vendor/pi/packages/coding-agent/examples/extensions/plan-mode/README.md` | 1-60 | pi plan mode behaviour |
| `…/plan-mode/index.ts` | 22-25, 93-112, 160-200, 262 | tool sets, `setActiveTools`, `tool_call` block, `context` filter |
| `…/plan-mode/utils.ts` | 1-60 | destructive / safe bash regex lists |
| `…/extensions/permission-gate.ts` | 1-34 | confirm-or-block on dangerous bash |
| `…/extensions/git-checkpoint.ts` | 1-53 | `git stash create` per turn, restore on fork |
| `…/extensions/custom-compaction.ts` | 60-117 | `session_before_compact` override |
| `…/extensions/todo.ts` | 1-30 | todo state stored in tool-result `details` (branch-correct) |
| `…/extensions/` (directory listing) | – | `subagent/`, `handoff.ts`, `protected-paths.ts`, `sandbox/`, `dirty-repo-guard.ts`, `git-merge-and-resolve.ts`, `claude-rules.ts`, `jev-router.ts`, `summarize.ts`, `structured-output.ts` |
| `research/vendor/pi/packages/coding-agent/docs/compaction.md` | 1-60 | trigger `contextTokens > contextWindow - reserveTokens`, cut point, `firstKeptEntryId` |
| `…/docs/extensions.md` | 54-265 (headings) | event list: `agent_start/end/settled`, `tool_call`, `context`, `session_before_*` |
| `…/src/core/tools/edit.ts` | 23-49 | pi's `edits[].oldText/newText` multi-replace tool |
| `/home/user/code/undefine/beam-lisp--repl/research/structural-rewrite/README.md` | 1-60 | trivia-preserving span rewrite |
| `…/priv/std/rewrite.bl` | 1-30, 300-342 | pattern/replacement rules as data, `apply-rules` |
| `…/priv/std/span-rewrite.bl` | 1-40, 295-340 | `rewrite-source`, `smell->rule` |
| `…/research/lsp/README.md` | 1-50 | "a language server that is not a server" |
| `…/priv/lib/lsp.bl` | defn index (hover/diagnostics/references/…) | in-process analysis API |
| `…/priv/lib/lsp/rpc.bl.md`, `server.bl.md`, `cli.bl` | heads | JSON-RPC framing, stdio loop, `bl lsp check` |
| `…/editors/tree-sitter-beamlisp/README.md` | 1-30 | tree-sitter grammar for `.bl`, 822 files / 0 errors |
| `…/priv/std/dev/change.bl` | 1-12 | `dev.change` plan→verify→apply→undo |
| `…/priv/std/executor/sandbox.bl` | 1-14 | capability + memory + disk ceilings per session |
| `…/priv/lib/code/index.bl`, `priv/std/codebase.bl` | heads | code-as-datom-facts index (repo map substrate) |
| `…/priv/lib/harness.bl`, `harness/doc.bl`, `harness/mcp.bl` | heads | session = `.bl.md` document; harness as MCP server |
| `…/priv/lib/mcp/{server,tools,jsonrpc}.bl` | heads | MCP server over code facts |
| `…/priv/std/proc/{bus,flow,fence,reg}.bl` | heads | pub/sub, demand-driven streams, bounded isolation, registry |
| `…/docs/jj-in-front-datom-in-the-back.md` | 1-25 | beam-lisp's current VCS stance |

**Fetched (OBSERVED).**

- Claude Code permission modes / plan mode: <https://code.claude.com/docs/en/permission-modes> (`.md` alternate)
- Claude Code checkpointing: <https://code.claude.com/docs/en/checkpointing.md>
- opencode agents (Build/Plan, permissions): <https://opencode.ai/docs/agents/>
- opencode LSP: <https://opencode.ai/docs/lsp/>
- Cline Plan & Act: <https://docs.cline.bot/core-workflows/plan-and-act.md>
- Aider architect/editor: <https://aider.chat/2024/09/26/architect.html>
- Aider repo map: <https://aider.chat/docs/repomap.html>, <https://aider.chat/2023/10/22/repomap.html>
- Anthropic text editor tool: <https://platform.claude.com/docs/en/agents-and-tools/tool-use/text-editor-tool>
- ast-grep rule model: <https://ast-grep.github.io/guide/rule-config.html>
- Serena README: <https://github.com/oraios/serena>
- Codex `apply_patch` grammar, via the parser source quoted by a code search:
  `codex-rs/apply-patch/src/parser.rs` at <https://github.com/openai/codex/blob/f1affbac/codex-rs/apply-patch/src/parser.rs>
  (the raw `apply_patch_tool_instructions.md` URL 404'd; the parser's doc-comment grammar was read instead).

**NOT verified (INFERRED from general knowledge, flagged where used).** Codex CLI's read-only/approval
modes, Amp's modes, morph fast-apply, multilspy internals, Claude Code hooks/skills/subagent
frontmatter details, Aider's PageRank implementation details (the docs say "graph ranking algorithm"
over a file graph; the exact algorithm name is not on the pages I read).

## 2. The three primitives (the lens)

Every plugin below is one of these. Omega's core should expose them as plain data/functions:

| primitive | shape | plugins that reduce to it |
|---|---|---|
| **call predicate** | `(fn [ctx call] → :allow \| [:deny reason] \| [:ask prompt])` run before each tool call | plan mode, permissions, protected paths, dirty-repo guard, hooks (PreToolUse), sandbox policy |
| **context transform** | `(fn [messages] → messages)` run before each model request, plus a *tool-set* selector | compaction, repo map, skills, memory injection, plan-mode reminder, handoff |
| **turn-boundary snapshot** | `(fn [] → ref)` at turn start, `(restore ref)` on rewind/fork | git checkpoint, edit-undo, session export/replay, cost ledger |

pi implements exactly these as events: `tool_call` can return `{block, reason}`; `context` can return
a filtered `messages`; `turn_start` + `session_before_fork` implement checkpoints
(`git-checkpoint.ts:21-47`). OBSERVED.

```beam-lisp
;; The call-predicate primitive, as data. A "mode" is a map; a decision is a value.
(def modes
  {:plan {:allow #{:read :grep :find :ls :outline}
          :deny  #{:edit :write :patch}}
   :act  {:allow #{:read :grep :find :ls :outline :edit :write :patch :bash}}})

(defn decide
  "Ask the mode about a tool. Deny beats allow; unknown tools ask."
  [mode tool]
  (let [m (get modes mode)]
    (cond (contains? (get m :deny #{}) tool)  [:deny (str (name mode) "-mode")]
          (contains? (get m :allow #{}) tool) [:allow]
          :else                               [:ask])))

(println (map (fn [t] [t (decide :plan t)]) [:read :edit :bash]))
(println (map (fn [t] [t (decide :act t)])  [:read :edit :bash]))
```

## 3. Plan mode (the light kind)

### 3.1 What each harness does

| harness | mechanism | enforcement point | exit/approval | source |
|---|---|---|---|---|
| **pi example** | `PLAN_MODE_TOOLS = ["read","bash","grep","find","ls","questionnaire"]`; `setActiveTools(...)` swaps tool set; bash passes only through a regex allowlist (`isSafeCommand`); agent emits a numbered `Plan:` section, extension parses it into todos; `[DONE:n]` markers track execution; stale plan context stripped by a `context` handler | tool *set* + `tool_call` block | `agent_end` prompts "Execute the plan?", restores full tools | `plan-mode/index.ts:22-25,93-112,164-175,201,262`; `utils.ts:1-60` |
| **Claude Code** | permission mode `plan`: "Claude reads files, runs shell commands to explore, and writes a plan, but does not edit your source"; edits blocked until a plan is approved; approval menu = *auto mode / manually approve edits / keep planning*; `Ctrl+G` opens the plan in `$EDITOR`; Shift+Tab cycles modes; optional "clear context on plan accept" | permission layer (mode = baseline, rules layered on top) | `ExitPlanMode`-style approval prompt (approving switches mode) | code.claude.com permission-modes, "Analyze before you edit with plan mode" |
| **opencode** | not a mode but an **agent**: `plan` is a primary agent with `permission: {edit: ask, bash: ask}`; Tab cycles primary agents; per-agent model/prompt/temperature; permission keys accept glob→action maps with last-match-wins | per-agent permission table | user flips agent back to `build` | opencode.ai/docs/agents |
| **Cline** | two modes, *same conversation history*; Plan "cannot modify any files or execute commands"; optional separate model per mode; `/deep-planning` command; "have Cline write a markdown file summarizing the plan" | mode flag in the tool dispatcher | user clicks Act | docs.cline.bot plan-and-act |
| **Aider architect** | not read-only gating; a **two-model pipeline**: Architect describes the solution freely, Editor turns it into edit-format output. SOTA 85% with o1-preview + (deepseek \| o1-mini) in "whole" format; Sonnet+Sonnet 80.5% vs 77.4% solo | pipeline, no tool gating | automatic | aider.chat/2024/09/26/architect.html |
| Codex CLI, Amp | INFERRED: read-only/approval presets in Codex; Amp has agent modes. Not verified. | – | – | – |

### 3.2 Canonical choice for omega

**Plan mode = a named tool-policy + a context reminder + a handoff gesture. Not a separate engine.**
The best synthesis of what I read:

1. **opencode's formulation** is the cleanest data model: a mode is an *agent profile* =
   `{prompt, model, permission-table}`; "plan" is just a profile whose `edit`/`write` are `deny` and
   whose `bash` is allowlisted. This unifies plan mode, subagents (opencode's `explore` is read-only by
   the same mechanism), and permission gating into one table. 
2. **pi's belt-and-braces** is worth stealing: *remove* write tools from the tool list (so the model
   never sees them) **and** keep a `tool_call` predicate as a backstop for bash. Hiding tools saves
   tokens and prevents wasted attempts; the predicate is the safety net.
3. **Claude Code's exit gesture**: plan ends by *proposing*, user approves, mode switches, and the
   plan text (optionally edited) becomes the next turn's input. Context carries over (Cline) with an
   option to clear (Claude Code `showClearContextOnPlanAccept`).
4. **pi's weakness to avoid**: the bash allowlist is a regex blacklist+whitelist
   (`DESTRUCTIVE_PATTERNS`, `SAFE_PATTERNS`, 30+ regexes). Regexes over shell are bypassable
   (`cat x > y` is caught only by the `>` pattern, `$(...)`, `xargs rm`, etc.). Claude Code needed a
   classifier/"read-only command set" with a shell parser. For omega: **plan mode's reliable guarantee
   should come from the sandbox/capability layer, not from parsing bash** — see §4.10 and the
   beam-lisp angle below.

### 3.3 Omega-specific twist: tasks, not chats

Omega prompts are *tasks*. A plan is then naturally **a task artifact**, not a chat phase: a planning
task produces a plan (a document + an ordered list of child-task specs); approving it spawns the
child tasks (each with its own scope) and the stigmergic layer lets them find each other. This makes
Claude Code's "plan → approve → act" and pi's `Plan:`→todos extraction the *same* thing as
"decompose into tasks" (§4.4, §4.5). INFERENCE (design proposal; nothing in the surveyed harnesses
does this).

### 3.4 beam-lisp mapping

- Tool-policy as data: plain maps (runs above). The enforcement hook is omega's own tool dispatcher.
- **Real read-only guarantee**: `priv/std/executor/sandbox.bl` — "CAPABILITY — which host modules the
  code may name. Enforced at COMPILE time by env caps … Ungranted module = compile error." A plan-mode
  evaluator that simply *cannot name* `File/write`, `System/cmd` is a stronger guarantee than any
  regex. OBSERVED that the mechanism exists for sessions; INFERRED that it applies per-tool-call.
- Bounded child for any exploratory eval: `proc.fence/fence-fn` (`priv/std/proc/fence.bl:1-14`,
  `:ms` timeout, kill).
- Gap: no plan *document* type; `harness/doc.bl` (session = `.bl.md`) is the natural carrier.

```beam-lisp
;; pi's idea: extract the numbered steps of a plan into todos. In omega the same
;; step is "plan text -> child-task specs". Pure data, offline, deterministic.
(def plan-text "Plan:\n1. Read the parser\n2. Add the rule\n3. Run the tests")

(defn plan-steps [text]
  (->> (split text "\n")
       (map (fn [l] (let [i (index-of l ". ")]
                      (if (and (some? i) (> i 0) (<= i 2)) (subs l (+ i 2)) nil))))
       (filter some?)
       (map-indexed (fn [i s] {:id (inc i) :text s :done false}))
       vec))

(println (plan-steps plan-text))
```

### 3.5 Verdict

**Take**: opencode's agent-profile model; pi's hide-tools + backstop-predicate; Claude Code's
approve-and-switch gesture; Cline's "same history, switch model per mode". **Adapt**: plan output
becomes child-task specs. **Drop**: regex bash allowlists as the primary guard; Aider architect as a
default (valuable, but it's an optional *two-model pipeline* bundle — cheap to add since a task can
name its model).

## 4. Structural editing with tree-sitter

### 4.1 The landscape

| approach | unit of edit | how the model addresses code | failure mode | source |
|---|---|---|---|---|
| **`str_replace`** (Anthropic text editor tool) | exact text span | `old_str` must match uniquely | ambiguity / whitespace drift; retried | platform.claude.com text-editor-tool (`view`, `str_replace`, `create`, `insert`; `max_characters` truncation) |
| **pi `edit`** | N exact spans per call | `edits[].oldText` matched against the *original* file, non-overlapping, "as small as possible while unique" | same, mitigated by multi-edit batching | `pi/.../tools/edit.ts:23-49` |
| **Codex `apply_patch`** | hunks across many files | V4A envelope: `*** Begin Patch` / `*** Add|Update|Delete File:` / `*** Move to:` / `@@ ctx` / ` `,`+`,`-` lines / `*** End of File`; parser has a *lenient* mode stripping `<<'EOF'` heredocs | models wrap it in JSON/fences → "first line must be Begin Patch" retry loops (codex issue #35361) | `codex-rs/apply-patch/src/parser.rs` grammar comment |
| **Aider formats** (whole / diff / udiff / architect) | file or search-replace block | text format | model spends attention on format; hence architect/editor split | aider architect article |
| **morph fast-apply** | file | model emits lazy edit sketch, a small model merges | INFERRED; not verified | – |
| **Serena** (LSP/JetBrains) | **symbol**: `find symbol`, `symbol overview`, `find referencing symbols`, `replace symbol body`, `insert before/after symbol`, `safe delete`, `rename` | name path | needs a language server per language (40+) | github.com/oraios/serena README |
| **ast-grep** | AST node set | rule objects: atomic (`pattern` with `$META`, `kind`, `regex`), relational (`inside`, `has`, `follows`, `precedes`, `stopBy`), composite (`all`, `any`, `not`, `matches`) — "like CSS selectors" | pattern authoring is a skill | ast-grep.github.io/guide/rule-config |
| **Spell `edit`/`find` CodePath** (from this session's tool list) | symbol / span | `file::Sym#body`, `#sig`, `::§call[name=log]`, heading targets, line slice as last resort; `replace`/`rename`/`delete`/`patch`/`restructure`/`undo`; post-edit parse gate rejects braceless bodies | needs per-language symbol resolution; kernel is large | session tool description (OBSERVED, not source-read) |
| **Aider repo map** | *read-side only* (see §4.7) | – | – | aider docs |

### 4.2 What actually works (evidence available)

- Format-fragility is real and measured: Aider's architect/editor split exists *because* "o1 models …
  often fail to output properly formatted code editing instructions" and "the model has to split its
  attention between solving the coding problem and conforming to the edit format". OBSERVED.
- Codex' parser carries scar tissue: a lenient mode for heredocs, and an open issue where JSON-wrapped
  patches produce an uninformative error and the model loops forever resending it. **Lesson: error
  messages from the edit tool are part of the prompt.** (Show the first bytes received; name the
  common mistake.) OBSERVED (issue text), INFERRED for generalization.
- Serena's own evaluation quotes (README) say symbol tools beat line/regex edits for cross-file
  renames and reference lookups, but agents "lean on built-ins for tiny text edits and non-code
  work". Vendor claim; one agent's testimony, not a benchmark. OBSERVED claim, treat as anecdotal.

### 4.3 Canonical choice for omega

A **two-layer editor**, both layers sharing one commit path:

1. **Layer 0 (core, language-agnostic): exact multi-replace on the original text** —
   pi's `edits[]` shape, with hash-guarded atomic apply. Rationale: every model is trained on it, it
   works for prose/config/anything, and it's ~100 lines. Add Codex-style *multi-file atomicity*
   (stage all, write all, or none) and *informative errors*.
2. **Layer 1 (bundled, tree-sitter): symbol-addressed edits** — the Spell CodePath idea reduced to
   its useful core: `target = path::Symbol(#body|#sig)` + `replace | rename | delete | insert
   before/after`, followed by a **parse gate** (re-parse after edit, refuse to write if the node count
   of ERROR nodes increased). Serena proves the verbs; Spell proves the parse gate. Drop Spell's
   `restructure` (move/transpose/splice/clone) and CSS/heading families from v1 — niche.
3. **Layer 2 (optional): pattern rewrite** — ast-grep-style `pattern → replacement` with `$META`
   captures for codemods. In beam-lisp this already exists as *data* (§4.5) and is better than
   ast-grep's YAML because rules are ordinary values.

`apply_patch` is **not** chosen as canonical because it requires the model to emit a bespoke grammar
(fragile for non-OpenAI models, per the issue thread), but the *staged atomic commit* it implements
is worth copying.

### 4.4 Interaction with tasks

Many tasks may edit concurrently. pi has a `file-mutation-queue.ts` in `core/tools` (OBSERVED in the
directory listing, not read) — per-file serialization. Omega should make **the edit commit a message
to a per-file owner process** (beam-lisp `proc`), which gives serialization, hash-guard
("file changed since you read it" → conflict signal to the task), and a natural **stigmergic trace**:
each commit leaves a `{:file :hash :task :span}` fact other tasks can see. INFERENCE.

### 4.5 beam-lisp mapping — more built already than elsewhere

| need | beam-lisp asset | status |
|---|---|---|
| parse `.bl` with exact spans | reader nodes carry `{:line :col :end-line :end-col}` (`research/structural-rewrite/README.md`) | OBSERVED |
| trivia-preserving rewrite | `span-rewrite/rewrite-source rules src → {:source :changed}` (`priv/std/span-rewrite.bl:312`); unmatched bytes (comments, indentation) carried through | OBSERVED, README measurements |
| pattern rules as data | `rewrite/apply-rules`, `?x` vars, `?*xs` rest vars, fixed-point with cycle cap (`priv/std/rewrite.bl:307-342`) | **ran below** |
| hash-guarded plan→verify→apply→undo | `dev.change` (`priv/std/dev/change.bl`, host impl `BeamLisp.DevChange`; journal at `.beam-lisp/change-journal/`) | OBSERVED header only |
| tree-sitter for `.bl` | `editors/tree-sitter-beamlisp` (822 files, 0 parse errors) | OBSERVED README |
| tree-sitter for *other* languages (a general harness!) | **none** in beam-lisp | **GAP**. Options: (a) NIF/port to tree-sitter + grammar packages; (b) shell out to the `ast-grep` binary (it exposes `--inline-rules`, "useful for … calling ast-grep from another program"); (c) rely on LSP `documentSymbol` (Serena's approach). |

```beam-lisp
;; Codemods are values (priv/std/rewrite.bl). This is the ast-grep idea in 3 lines.
(ns demo50 (:require [rewrite :as rw]))
(def rules [{:pattern '(if (not ?p) ?a ?b) :replacement '(if-not ?p ?a ?b)}
            {:pattern '(= ?x nil)           :replacement '(nil? ?x)}])
(println (rw/apply-rules rules '(defn f [x] (if (not (= x nil)) 1 2))))
;; and a rest-variable splice, as documented in rewrite.bl's header
(println (rw/apply-rule {:pattern '(do ?*body) :replacement '(let [] ?*body)}
                        '(do (a) (b) (c))))
```

### 4.6 Verdict

**Take**: pi `edits[]` (L0); Serena verbs + Spell parse gate (L1); beam-lisp `rewrite` (L2). **Adapt**:
errors-as-prompt (Codex lesson). **Drop**: `apply_patch` grammar as the model-facing format; morph-style
second-model merge (a cost/latency layer, optional later).

### 4.7 Repo map (Aider) — the read-side companion

Mechanism (OBSERVED, aider docs): tree-sitter extracts *definitions and references* per file using
`tags.scm` queries; build a graph "where each source file is a node and edges connect files which have
dependencies"; rank with a graph algorithm (PageRank-style — the docs say "graph ranking algorithm";
the specific name is INFERRED from common knowledge of aider's source); select the highest-ranked
definitions that fit a token budget (`--map-tokens`, default 1k; larger when no files are in chat);
render signatures only with `⋮...` elisions. The map is **personalized to the chat** (relevance to
files currently in context).

**Canonical for omega: yes, but via beam-lisp's own fact index** — `priv/lib/code/index.bl` ("ONE
index per tree, and every question reads it") and `priv/std/codebase.bl` (`[?d :fn/name "double"]
[?c :call/caller …]`, `impact`, `reachable`) already store defs+calls as datom facts, and `mcp/tools.bl`
exposes `code/ask`. PageRank over `:call/caller → :call/callee` is a ~20-line pure function. For
non-beam-lisp languages the gap is again tree-sitter tags (§4.5). Value/complexity is high **only for
large repos**; a minimal harness can ship without it (agents with `find`+`grep` do fine on small trees).

```beam-lisp
;; Repo-map ranking is a tiny pure function over a def→refs graph. Power iteration:
(defn pagerank [edges n-iter]
  (let [nodes (vec (distinct (mapcat identity edges)))
        outs  (reduce (fn [m [a b]] (update m a (fnil conj []) b)) {} edges)
        n     (count nodes)
        r0    (into {} (map (fn [k] [k (/ 1.0 n)]) nodes))]
    (loop [r r0 i 0]
      (if (= i n-iter)
        r
        (recur (reduce (fn [acc k]
                         (let [os (get outs k [])
                               share (if (empty? os) 0.0 (/ (get r k) (count os)))]
                           (reduce (fn [a o] (update a o + (* 0.85 share))) acc os)))
                       (into {} (map (fn [k] [k (/ 0.15 n)]) nodes))
                       nodes)
               (inc i))))))

(def ranks (pagerank [["main" "parse"] ["main" "emit"] ["emit" "parse"] ["test" "parse"]] 20))
(println (->> ranks (sort-by (fn [[_ v]] (- v))) first first))   ; parse is the most-referenced
```

## 5. Light LSP

### 5.1 What exists

| system | scope | mechanism | source |
|---|---|---|---|
| **opencode** | diagnostics-as-feedback | ~35 built-in server definitions keyed by extension (`typescript`, `pyright`, `rust` → rust-analyzer, `elixir-ls`, `clojure-lsp`, `gopls`…); starts a server lazily when a matching file is opened; config `lsp: {name: {command, extensions, env, initialization, disabled}}`; **off by default** | opencode.ai/docs/lsp |
| **opencode's own advice** | "Language servers can get out of sync, use significant memory, vary by version … In many projects it is better to have the agent run lint, typecheck, or other diagnostic CLI tools directly … Document those commands in … `AGENTS.md`" | – | same page, "Best Practices" |
| **Serena** | semantic retrieval/edit via LSP (or JetBrains plugin): symbol overview, find symbol, find referencing symbols, rename, replace symbol body, diagnostics | MCP server wrapping an LSP abstraction layer | Serena README |
| **Claude Code LSP plugins**, **multilspy** | INFERRED: Claude Code can load LSP servers via plugins for diagnostics/go-to-definition; multilspy is a Python client library normalizing server startup/requests. **Not verified.** | – | – |
| **beam-lisp** | "A language server that is not a server": pure functions over the analyzed program (`hover`, `definition`, `references`, `document-symbols`, `diagnostics`, `completion`, `signature-help`, `inlay-hints`, `code-actions`, `impact`, `dead-code`, plus proof-backed `proof-hover`, `native-eligible`) | `priv/lib/lsp.bl` (in-process); `priv/lib/lsp/rpc.bl.md` (`decode-frame`/`encode-frame`/`handle` state-machine); `priv/lib/lsp/server.bl.md` (stdio loop, `bl lsp serve`); `priv/lib/lsp/cli.bl` (`bl lsp check FILE`) | OBSERVED |

### 5.2 The *light* shape (canonical)

The lightest thing that captures nearly all the value is **"diagnostics after edit"**, not
go-to-definition. Concretely:

1. After any edit tool commits, run a **diagnostic command for that file type** and append the result
   to the tool result (the model sees its own breakage immediately).
2. The command is *configured data*: `{:ext ".bl" :cmd ["bl" "lsp" "check" :file]}`,
   `{:ext ".ts" :cmd ["tsc" "--noEmit"]}`, `{:ext ".py" :cmd ["ruff" "check" :file]}`.
3. A true LSP *client* (spawn server, `initialize`, `didOpen`/`didChange`, collect
   `publishDiagnostics`) is an *upgrade of step 2* for languages where CLI diagnostics are slow
   (rust-analyzer, tsc full-project). opencode's advice and its default-off flag are evidence that
   (2) should be the default and (3) opt-in.
4. Navigation tools (`references`, `symbols`) are a second, separable bundle (Serena shows value,
   but at the cost of a server per language).

This is the same *call-predicate/transform* shape as everything else: a post-tool hook that appends to
the result.

### 5.3 beam-lisp angle

- For `.bl`, omega gets **richer-than-LSP feedback for free and in-process**: type errors across call
  boundaries, effect footprints, termination, native-eligibility
  (`research/lsp/README.md`: the example diagnostic `3:30 type error: + expects [:float :int], got [:kw]`
  is inter-procedural). Because `lsp.bl` is a function of source text, omega can call
  `(lsp/diagnostics src)` directly — no process, no JSON, no sync drift (the very failure opencode
  warns about does not exist when there is no separate server state).
- For other languages: `lsp.rpc` already implements Content-Length framing both directions
  (`decode-frame`/`encode-frame`), so the *client* half is the mirror image of code that exists. Gap:
  a client state machine (request ids, `initialize` handshake, notification routing) and a
  port-spawn wrapper; `proc.server` (`priv/std/proc/server.bl`) is the natural home for one process per
  language server, with `proc.super` restarting it, and `proc.reg` finding it by `{:lang :root}`.
- Gap: a multi-language "diagnostic command table" does not exist; it is just config.

```beam-lisp
;; The diagnostics hook is a table lookup + argument templating. Pure, testable.
(def diag-table
  {".bl" ["bl" "lsp" "check" :file]
   ".ts" ["tsc" "--noEmit"]
   ".py" ["ruff" "check" :file]})

(defn diag-cmd [path]
  (let [dot (last-index-of path ".")
        ext (if (some? dot) (subs path dot) "")]
    (when-let [cmd (get diag-table ext)]
      (mapv (fn [x] (if (= x :file) path x)) cmd))))

(println (diag-cmd "src/a.bl"))
(println (diag-cmd "README"))
```

### 5.4 Verdict

**Take**: opencode's "diagnostics after edit" and default-off LSP; beam-lisp's in-process analyzer for
`.bl`. **Adapt**: diagnostics = configurable command first, LSP client second. **Drop** in v1:
navigation tools, completion, hover (the model reads code; it doesn't hover).

## 6. The other plugins

For each: mechanism → source → canonical pick → beam-lisp angle. Ranking is in §7.

### 6.1 Compaction / handoff

- **Mechanism (pi, OBSERVED)**: trigger `contextTokens > contextWindow - reserveTokens` (default
  16 384). Walk backwards accumulating tokens until `keepRecentTokens` (20 k); summarize everything
  before the cut with a *structured* prompt, passing the previous summary as iterative context; append
  a `CompactionEntry{summary, firstKeptEntryId}`; rebuild context as `summary + messages from
  firstKeptEntryId`. Also checks *between turns* after tool results, and one compact-and-retry on a
  provider overflow error. File operations are tracked cumulatively. A `session_before_compact` event
  lets an extension replace the summarizer (`custom-compaction.ts`: "The summary will replace the
  ENTIRE conversation history"). A second mechanism, **branch summarization**, runs on `/tree`
  navigation. `docs/compaction.md:1-60`.
- **Claude Code**: `/rewind` offers "Summarize from here" / "Summarize up to here" — compaction as a
  *user-directed, range-bounded* operation with optional guidance text; the originals stay in the
  transcript. (checkpointing.md)
- **Handoff** (`pi/.../handoff.ts`, 190 lines, listed not read): INFERRED = summarize into a fresh
  session rather than continuing in place.
- **Canonical for omega: pi's append-only `CompactionEntry` with `firstKeptEntryId`**, because it keeps
  the full log (replay/audit) and makes the *projection* the thing that shrinks. In a task model,
  **handoff is the primary mechanism and compaction the fallback**: when a task nears its window, it
  *spawns a successor task with a brief* (like `/handoff`), and the stigmergic trace (what was
  touched, what's pending) is the brief's backbone. INFERENCE.
- **beam-lisp angle**: the session is a `.bl.md` append-only document (`harness/doc.bl`: "APPENDED,
  never rewritten"), so *log vs projection* is already the architecture. Summarization is just
  another typed LLM decision (Jev), which gives a schema-checked summary
  (`{decisions, files, open-questions, next-steps}`) instead of free markdown.
- **Gap**: token counting (needs a tokenizer or provider usage numbers — pi uses provider `usage`).

### 6.2 Subagents

- **Mechanism (opencode, OBSERVED)**: primary vs subagent; built-ins `general` (full tools except
  todo), `explore` (read-only), `scout` (external docs); invoked automatically by description or
  `@mention`; child sessions navigable; per-agent `steps` cap — at the cap the agent gets a special
  prompt to summarize its work and remaining tasks. Markdown agent files with frontmatter
  (`description`, `mode`, `model`, `permission`). pi's `examples/extensions/subagent/` (1038 lines) +
  `agents/planner.md`, `scout.md`, `prompts/scout-and-plan.md` is the same shape.
- **Claude Code caveat (OBSERVED)**: subagent edits are *not* captured by checkpoints — rewind
  can't undo them; use git.
- **Canonical for omega: nothing to build** — a "subagent" *is* a task. The harness-level difference
  between a subagent and a peer task disappears; what remains is (a) a `spawn` tool (`task` with a
  profile + scope + model), (b) a result envelope back to the parent, (c) a step/budget cap with a
  forced summary at the cap (opencode). Agent profiles stay as markdown+frontmatter files (opencode
  and pi converge on it: LLM-readable, diffable, user-editable).
- **beam-lisp angle**: `proc` is the substrate — `proc.reg` (find by attributes, auto-deregisters on
  death), `proc.super` (supervision), `proc.fence` (bounded child, kill on timeout), `proc.bus`/
  `proc.flow` (publish/subscribe, demand-driven backpressure). **Gap**: a task-level protocol on top
  (spawn / await / message / cancel / result-schema); that is the design discussion's core, not this
  doc's.

### 6.3 Todo / roster

- **Mechanism (pi `todo.ts`, OBSERVED)**: a `todo` tool the LLM calls (`list|add|toggle|clear`);
  **state lives in the tool result's `details`** so branching/forking automatically shows the todo
  list *as of that point in history*. opencode: `todowrite`/`todoread` permission keys; `general`
  subagent excluded from todo.
- **Canonical**: pi's trick (state-in-log, projection by replay). In omega the todo list is a *view
  over task facts* (child tasks and their states) rather than a separate store — the roster **is** the
  task table. Keep the tiny `todo` tool for within-task checklists only.
- **beam-lisp angle**: datom facts (`priv/lib/datom.bl`) give time-travel and branch semantics
  (`docs/datom-branches.bl.md`); trivial.

### 6.4 Memory

- **Mechanism**: (1) instruction files (`AGENTS.md`, `CLAUDE.md`; pi has `claude-rules.ts`); (2) agent-
  written notes (Serena `.serena/memories/*.md`, per-project, read on demand, with `memory_maintenance`
  guidance — OBSERVED in its file listing); (3) summaries (§6.1).
- **Canonical**: *plain markdown files in the repo/home, loaded by name, written by the agent via the
  ordinary write tool.* No vector DB. This is the lowest-complexity thing that works and is what
  every surveyed harness converged on.
- **beam-lisp angle**: `.bl.md` is the file format (prose + runnable cells); a memory that contains a
  runnable check ("this convention holds: `(assert …)`") can be *verified* with `bl run` — memory that
  fails its own test is stale, a property markdown-only harnesses don't have. INFERENCE.

### 6.5 Hooks / extension events

- **Mechanism (pi, OBSERVED)**: an event bus: `agent_start`, `agent_end`, `agent_before_settle`,
  `agent_settled` (final), `turn_start`, `tool_call` (can block), `tool_result`, `context` (can rewrite
  messages), `session_before_fork`, `session_before_compact`, `input` transforms
  (`docs/extensions.md:54-265`; example list). Claude Code's hooks (PreToolUse etc.) INFERRED
  equivalent, with shell commands as handlers; deny rules override hook "allow"
  (permission-modes: "no `PreToolUse` hook `allow` approves" a critical-path `rm`).
- **Canonical**: a small fixed set of events with *typed return values* (`:block`, `:rewrite`,
  `:append`), handlers are ordinary functions. Use the same set for plugins and for user scripts.
- **beam-lisp angle**: `proc.bus` is already a publish/subscribe with demand/lag policy; events are
  messages; a handler that returns a decision is a `call` (synchronous) vs `cast` (notification) —
  the prelude has both. **The event list is the omega plugin API; freeze it deliberately.**

### 6.6 Permission / approval gates

- **Mechanism**: Claude Code modes (`default` reads only; `acceptEdits`; `plan`; `auto` = a second
  classifier model reviews each action; `dontAsk`; `bypassPermissions`), layered with allow/deny/ask
  *rules* where **deny wins in every mode**, plus never-auto-approved categories (protected paths,
  critical `rm`, ask-rule matches, tools requiring interaction). opencode: per-agent `permission`
  with `allow|ask|deny`, glob maps, **last matching rule wins**, and a `doom_loop` key for "agent
  appears stuck". pi: `permission-gate.ts` (regex → `ctx.ui.select` confirm; no UI ⇒ block),
  `protected-paths.ts`, `confirm-destructive.ts`, `dirty-repo-guard.ts`.
- **Canonical**: *opencode's rule table* (glob→action, last-match-wins, per-profile) as the model;
  Claude's "deny always wins" as the invariant; pi's "no UI ⇒ block" as the headless default. Auto-
  classifier mode = a Jev typed decision `{:allow|:deny|:ask, :reason}` — an optional bundle.
- **beam-lisp angle**: rule tables are data; `auth` and Biscuit caps (`executor/sandbox.bl` — "caps
  derived from the principal's Biscuit token") give *cryptographic attenuation*: a child task gets a
  strictly weaker token than its parent. That is a stronger primitive than any surveyed harness has.
  Gap: asking a human requires the front-end (loom/TUI) to expose one `ask` call — keep it a single
  function so both UIs mirror each other.

```beam-lisp
;; opencode's permission semantics: glob -> action, LAST matching rule wins, "*" first.
(defn glob->pred [g]
  (if (= g "*")
    (fn [_] true)
    (if (= (last g) "*")
      (let [pre (subs g 0 (dec (count g)))] (fn [s] (starts-with? s pre)))
      (fn [s] (= s g)))))

(defn permit [rules cmd]
  (reduce (fn [acc [g act]] (if ((glob->pred g) cmd) act acc)) :ask rules))

(def bash-rules [["*" :ask] ["git diff" :allow] ["git log*" :allow] ["git push" :deny]])
(println (map (fn [c] [c (permit bash-rules c)])
              ["ls" "git diff" "git log --oneline" "git push"]))
```

### 6.7 Checkpoints / undo

- **Mechanism**: Claude Code snapshots file state *before each prompt* (100 most recent), via its own
  edit tools only; `/rewind` restores code, conversation, or both; **known holes: Bash-made changes,
  subagent edits, external edits, symlinks are not tracked**; "not a replacement for version control".
  pi `git-checkpoint.ts` (OBSERVED, 53 lines): on `turn_start` run `git stash create` (a commit object
  of the working tree that does *not* touch the stash list or working tree), map it to the session
  entry id; on `session_before_fork` offer `git stash apply <ref>`. Spell `edit` has `undo/redo` per
  edit-log entry id with "undo of a committed file declines unless forced".
- **Canonical: pi's `git stash create` per turn** — it captures *everything* (including what bash did),
  needs no tracking of which tool touched what, and costs one subprocess. Pair with the edit tool's
  own hash-guarded undo for fine-grained per-edit revert. Caveat: `git stash create` ignores untracked
  files unless `-u`-style handling is added (INFERRED from git semantics; verify when implementing).
- **beam-lisp angle**: `dev.change` already journals `plan → apply → receipt` with undo for edits;
  `docs/jj-in-front-datom-in-the-back.md` is a standing design thread on jj vs git vs datom for
  history — **omega should not decide VCS here**; checkpoint = `(vcs/snapshot) → ref`,
  `(vcs/restore ref)` behind a 2-function protocol. `research/autovcs/` exists (not read).

### 6.8 Skills

- **Mechanism**: a skill is a directory with `SKILL.md` (frontmatter `name`, `description`), loaded on
  demand: the *description* is always in the prompt, the *body* is read only when relevant
  (progressive disclosure). pi: `docs/skills.md`; this very harness: `skill://<name>`.
  (INFERRED for exact frontmatter; the progressive-disclosure idea is consistent across pi docs and
  this session's own system prompt, which lists skills by name and loads on `skill://`.)
- **Canonical**: pi/Claude-style SKILL.md. Cheapest possible extensibility: no code, just files.
- **beam-lisp angle**: a skill can be a `.bl.md` — prose the model reads *plus runnable cells* the
  model (or `bl`) executes; `priv/lib/mcp/skill.bl.md` and `mcp/instructions.bl.md` already ship
  skills as livebooks over MCP (heads seen only). This is a genuine advantage over markdown-only
  skills.

### 6.9 MCP

- **Mechanism**: external tool servers over JSON-RPC (stdio/HTTP). pi has `docs/mcp.md` and an
  extension API `MCP servers` (extensions.md:188); opencode permission keys gate `mymcp_*` wildcards.
- **Direction matters for beam-lisp**: beam-lisp *serves* MCP already — `priv/lib/mcp/{server,jsonrpc,
  tools,transport-stdio,transport-http}.bl` (protocol 2026-07-28 with legacy handshakes) exposing
  `code/list|query|ask|verify|subscribe|poll`; `harness/mcp.bl` exposes the harness itself as MCP
  (`eval`, `start_turn`, `steer_turn`). **Gap is the client side**: consuming third-party MCP servers.
- **Canonical**: *MCP client as an optional bundle*, each remote tool wrapped as a native tool with
  the same permission table. Not core: every MCP tool costs prompt tokens; pi's own philosophy docs
  (not read) are, INFERRED, skeptical of MCP-by-default.

### 6.10 Sandboxes

- **Mechanism**: Claude Code: Bash sandbox (macOS/Linux/WSL2) + permission modes, "work independently
  and combine"; `bypassPermissions` only in containers/VMs. pi: `examples/extensions/sandbox/`
  (321 lines, not read) and `gondolin/`.
- **Canonical for omega**: *capability-based, not syscall-based*: `executor/sandbox.bl` — compile-time
  module caps + per-process heap quota (`max_heap_size, kill:true`) + disk quota; plus OS-level
  container for `bash`. This is the one category where beam-lisp is *ahead*: bash is the only escape
  hatch, and everything else (eval) is capability-bounded by construction.

### 6.11 Web fetch / search

- **Mechanism**: two tools `webfetch(url)→cleaned markdown` and `websearch(q)→snippets+links`;
  opencode gates both with a permission key; `scout` subagent for dependency source research.
- **Canonical**: both as *thin tools*, `fetch` returning markdown with a size cap (Anthropic editor
  tool's `max_characters` truncation idea applies). Optional bundle (network = new risk surface).
- **beam-lisp angle**: `priv/lib/web.bl` (head not read), `bl.json`; Jev for typed extraction.

### 6.12 Test-runner feedback loop

- **Mechanism**: nothing special — the agent runs the test command via bash; harnesses help by
  (a) AGENTS.md documenting the command (opencode's LSP advice says the same), (b) truncating long
  output keeping head+tail (`pi/.../tools/truncate.ts`, `output-accumulator.ts`, listed), (c) Aider-
  style "auto-test after edit" (INFERRED).
- **Canonical**: *post-edit hook running the project's declared check command* — the **same hook as
  §5.2 diagnostics**. One mechanism: `(on :tool-result edit → run (project :check-cmd) → append)`.
- **beam-lisp angle**: `bl check`, `bl test`, `bl lint`, `bl fix`, `bl watch` (`priv/std/bl/*.bl.md`
  names) are the verify loop (`docs/bl/02-the-verify-loop.bl.md`); `bl fix` + `deodorant` = auto-repair.
  Structured results (pass/fail counts) rather than raw text are available for `.bl`.

### 6.13 Cost / telemetry

- **Mechanism**: provider `usage` per response, cumulative per session; pi has `packages/telemetry`
  and `core/cache-stats.ts`, `cache-warmer.ts` (listed). Compaction requests disable prompt-cache
  writes (compaction.md:17). opencode `steps` caps cost per agent.
- **Canonical**: *ledger as facts*: one `{:task :model :in :out :cache-read :cache-write :cost}` row per
  model call; budgets are predicates over the ledger (a call-predicate!). Cheap, and it makes the
  stigmergic layer cost-aware (a task can see siblings' spend).
- **beam-lisp angle**: datom; `bl.monitor`, `bl.trace`, `tooling/trace.bl.md`.

### 6.14 Session export / replay

- **Mechanism**: pi `core/export-html`, `session-export.ts`, `docs/session-format.md`; Claude Code
  stores transcripts, rewinds, resumes, `--fork-session`.
- **Canonical**: *the log is the product*: append-only entries with `id`/`parentId` (tree, enabling
  branches), exportable as-is.
- **beam-lisp angle**: omega's log **is** a `.bl.md` (`harness/doc.bl`) — export is the identity
  function, replay is `bl run` (cells re-evaluate; results are the ```bl-result blocks). Replay with
  recorded model responses stubbed gives deterministic harness tests (see §8).

## 7. Ranked by value per complexity (for a *minimal* harness)

Scores are my judgment (1-5), not measured. "Cx" = implementation complexity in omega given the
beam-lisp substrate, not in general.

| rank | plugin | value | Cx | primitive | why it ranks here |
|---|---|---|---|---|---|
| 1 | **Permission/approval table** | 5 | 1 | call predicate | Prerequisite for letting an agent touch anything; a map + one function. Plan mode, sandboxing, protected paths are all *entries*. |
| 2 | **Plan mode as a profile** | 4 | 1 | call predicate + tool set | Falls out of #1 for free. |
| 3 | **Multi-replace edit + atomic apply + hash guard** | 5 | 2 | – | The agent's main verb; `dev.change` is a head start. |
| 4 | **Checkpoint (`git stash create`/turn)** | 4 | 1 | snapshot | One subprocess; fixes every "agent trashed my tree" story, including bash-made changes that Claude Code's tracker misses. |
| 5 | **Post-edit diagnostics / check command** | 4 | 1 | post-hook | Closes the feedback loop; unifies LSP-light + test runner. |
| 6 | **Compaction/handoff** | 5 | 3 | context transform | Without it long tasks die; harder: summarizer quality and cut-point logic. Tasks-as-handoff reduces the need. |
| 7 | **Hooks (event set)** | 4 | 2 | all three | It *is* the plugin API; freeze early. |
| 8 | **Subagent = spawn task** | 4 | 2 | – | Mostly the task model itself. |
| 9 | **Skills (SKILL.md / `.bl.md`)** | 3 | 1 | context transform | Zero code, big leverage. |
| 10 | **Memory files** | 3 | 1 | context transform | Same. |
| 11 | **Todo (state-in-log)** | 2 | 1 | – | Subsumed by the task table. |
| 12 | **Session export/replay** | 3 | 1 | snapshot | Free given `.bl.md` log. |
| 13 | **Cost ledger** | 3 | 1 | – | Facts; budgets as predicates. |
| 14 | **Symbol edits (tree-sitter)** | 4 | 4 | – | High value, but multi-language grammar is the cost; beam-lisp has it for `.bl` only. |
| 15 | **Web fetch/search** | 3 | 1 | – | Cheap but optional. |
| 16 | **MCP client** | 3 | 3 | – | Ecosystem access; token cost; beam-lisp already *serves* MCP. |
| 17 | **Repo map (PageRank)** | 3 | 3 | context transform | Matters for big repos; fact index exists for `.bl`. |
| 18 | **LSP client (real servers)** | 2 | 4 | – | opencode itself says CLI diagnostics are often better. |
| 19 | **Auto-approve classifier** | 2 | 3 | call predicate | Nice UX (Claude's default now), needs a trusted second model. |
| 20 | **Aider architect pipeline** | 2 | 2 | – | Benchmarked gain (+3 pts Sonnet self-pair), at 2× cost/latency. |

## 8. Interactions & observability

How a human and an agent developing omega would peek into, test, and drive these plugins.

- **Everything-is-data** makes inspection trivial: `(decide :plan :edit)`, `(permit rules cmd)`,
  `(diag-cmd path)`, `(plan-steps text)` are the blocks above — callable from a REPL cell, from `bl
  run`, or from a model's eval tool (`harness/mcp.bl` `eval`).
- **Dry-run everywhere**: the edit tool returns the *plan* (`dev.change/plan`: hash-guarded, preview)
  before apply; plan mode can be exercised with a stub model returning canned tool calls — a
  *replay test*: feed a recorded `.bl.md` session, assert the gate denied the write.
- **Trace as a first-class stream**: every predicate decision becomes an event on `proc.bus`
  (`{:task :tool :decision :rule}`); a TUI/loom panel subscribes (`proc.flow` demand-driven so a slow
  UI can't stall agents). Human question "why was this blocked?" = look up the `:rule` in the event.
- **Golden tests**: `bl test` + literate docs such as this file; for edits, property: *parse(after) ok
  ∧ unmatched bytes identical* (the span-rewrite invariant, README "byte-identical outside the
  skeleton").
- **Agent self-development**: because skills/memories/plugins are `.bl.md`, omega can edit its own
  plugin, run its cells (`bl run`), and `bl check`/`bl lsp check` it before activating — the loop the
  user wants ("build itself from primitives, patterns, bundles").
- **OBSERVED limitation**: I did not execute `bl lsp check`, `dev.change`, or the sandbox; the
  statements about them rest on source headers and docs. Only the blocks in this file were run.

## 9. Proposed plugin bundle

Three tiers. "Core" = in the kernel, no way to turn off. "Bundled" = ships by default as ordinary
omega code using only the public plugin API (so it's also the documentation of that API). "Optional" =
separate bundles, off by default.

```clojure
;; Design sketch (does NOT run yet). A bundle is data: name, events it subscribes to,
;; tools it contributes, and the policy rows it adds.
{:omega/core
 {:primitives [:call-predicate        ; (fn [ctx call] → :allow | [:deny r] | [:ask q])
               :context-transform     ; (fn [msgs] → msgs), + active tool-set selector
               :turn-snapshot]        ; (snapshot) → ref, (restore ref)
  :tools      [:read :write :edit :bash :grep :find :ls :spawn-task :ask-user]
  :log        :append-only-bl.md      ; entries with id/parent-id; projection ≠ log
  :events     [:task/start :task/end :turn/start :tool/call :tool/result
               :context :before-compact :before-fork]
  :policy     :rule-table}            ; glob→action, last-match-wins, deny beats allow

 :omega/bundled
 {:permissions  {:modes [:plan :act] :headless-default :deny}
  :edit-l0      {:shape :edits[] :commit :atomic-hash-guarded}
  :checkpoint   {:when :turn/start :via :vcs-snapshot}      ; git stash create, VCS-neutral
  :post-edit    {:diagnostics :cmd-table :check :project-cmd}
  :compaction   {:trigger :context-minus-reserve :entry :CompactionEntry
                 :handoff :spawn-successor-task}
  :skills       {:format :SKILL.md|.bl.md :disclosure :progressive}
  :memory       {:format :md :load :by-name}
  :cost-ledger  {:rows :per-model-call}
  :export       {:format :bl.md}}

 :omega/optional
 {:symbol-edit   {:backend :tree-sitter|ast-grep :gate :parse}   ; L1; bl-native for .bl
  :pattern-edit  {:backend :rewrite}                            ; L2, beam-lisp rewrite.bl
  :repo-map      {:rank :pagerank :budget :tokens :source :code/index}
  :lsp-client    {:servers :config-table}
  :mcp-client    {:wrap-as :native-tools}
  :web           {:tools [:fetch :search]}
  :auto-approve  {:judge :jev-decision}
  :architect     {:planner-model :x :editor-model :y}
  :sandbox       {:caps :executor/sandbox :bash :container}}}
```

**Why this split.** Core contains exactly the three primitives plus the tools that cannot be built from
them; everything else was shown above to be a *configuration or composition* of those primitives. The
"bundled" tier is chosen by rank (§7: ranks 1-13) minus symbol editing, which is high-value but
carries the one real cost in the whole survey (multi-language tree-sitter) and so sits at the head of
optional. Nothing in core mentions a specific VCS, LSP, language, or model vendor.

## 10. Open questions for discussion

1. **Where does the real read-only guarantee for plan mode come from?** Options: (a) regex/classifier
   over bash (pi/Claude Code; bypassable, familiar); (b) beam-lisp capability caps so plan-mode evals
   *cannot name* writers (strong, but bash remains an escape hatch); (c) run plan mode's bash in a
   read-only mount/container (strong, platform-specific, heavier). Likely (b)+(c) with (a) as UX
   sugar; needs your call on how much Linux-specific sandboxing omega should own.
2. **Is a plan a mode or a task?** (a) Mode: toggle within a task, Claude/pi style — simple, familiar.
   (b) Task: a planning task emits child-task specs for approval — fits omega's thesis, but makes
   "just think first" heavier. Could offer both with (a) as sugar over (b).
3. **Edit format.** L0 `edits[]` only, or also accept Codex-style `apply_patch` for models trained on
   it? Tradeoff: provider-specific tuning vs one more parser to maintain. Note GPT-family models
   are reportedly tuned for `apply_patch` (INFERRED), Claude for `str_replace`.
4. **Tree-sitter for non-`.bl` code.** (a) NIF/port into BEAM (fast, build complexity);
   (b) shell out to `ast-grep`/`tree-sitter` CLI (zero build, process overhead, versioning);
   (c) skip, rely on `edits[]` + LSP symbols. Given "general coding harness, not just beam-lisp", (c)
   is a weak default; which of (a)/(b) do you prefer?
5. **Diagnostics default.** CLI command table (opencode's own recommendation) vs. an LSP client.
   Should the `.bl` in-process analyzer be the *model* here — i.e. is "language = harness" such that
   omega-internal code gets a richer feedback channel (types, effects, termination) than external
   languages, and do we want to surface that asymmetry?
6. **Checkpoint substrate.** `git stash create` (works today) vs jj (see
   `beam-lisp--repl/docs/jj-in-front-datom-in-the-back.md`) vs datom-native history. A 2-function
   `snapshot/restore` protocol defers the choice; is that acceptable, or does the checkpoint design
   *drive* the VCS decision? Also: untracked files and bash-made changes need explicit handling.
7. **Compaction vs handoff as the default for long tasks.** In-place summary (pi) preserves
   continuity; spawn-successor (omega-native) keeps each task's context small and the trace explicit
   but loses fine-grained working memory. Which do you want as default, and should the successor's
   brief be a Jev-typed record?
8. **Permission asker UX.** One `ask(question, options) → choice` function shared by loom and TUI is
   the minimal contract. Do background tasks block on it (Claude's approach) or queue approvals into a
   shared inbox (more stigmergic)? What is the headless default — deny (pi) or fail the task?
9. **Event set freeze.** The plugin API *is* the event list (§6.5). Which events beyond pi's set are
   needed for tasks (`task/spawned`, `task/blocked-on`, `trace/left`)? Freezing too early costs
   churn; too late costs plugin breakage.
10. **Auto-approval classifier.** Claude Code now defaults to a model-judged `auto` mode. Do we want a
    Jev-typed judge as an optional bundle, and who is trusted to judge actions that *another task*
    requested (cf. Claude's classifier also reviewing inter-agent `SendMessage`)?
11. **MCP direction.** beam-lisp already serves MCP. Is omega also an MCP *client* in the default
    bundle, or does tool extension happen purely via `.bl.md` bundles, keeping MCP at the edge?
12. **Subagent step caps.** Adopt opencode's forced "summarize and stop" at a step cap as a per-task
    budget? What is the unit — steps, tokens, dollars (the cost ledger enables any)?
