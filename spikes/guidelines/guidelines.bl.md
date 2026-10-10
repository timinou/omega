# Guidelines: rules that find their own moment, and get better with use

*Spike, 2026-10-10. Status: the **mechanics are built and measured** (`guidelines/core.bl`,
`guidelines/ext.bl`, tests and a live A/B below). The **explorer package and inbox integration
are designed, not built** (§5). Nothing under `vendor/bl-ed` or `src/` is touched, and no live
world was written to.*

## 1. What this is, against "skills"

The Agent Skills convention (Anthropic, adopted by pi and others) is a directory with a `SKILL.md`.
Its frontmatter `name` and `description` sit in the system prompt (a few dozen tokens each). The
**model** decides when to read the body (progressive disclosure). That works for procedures (how to
build a PDF), but it has three gaps for *taste* rules such as "distinguish states through style,
layout, typography and placement rather than text":

1. **The model must notice that it needs the skill.** A taste rule is precisely the thing a model
   does not know it is violating.
2. **It is static.** Nothing records where a skill helped or misfired.
3. **It is opaque to the human.** You cannot see which rules shaped which turn.

A **guideline** turns this around:
- The **harness** matches a small rule to the current *situation* on every step, using the bundled
  `code.embed` model.
- The harness puts the rule at the request tail.
- The harness records `shown` / `applied` / `misfire` / `proposed` as datoms.
- An `applied` note becomes a new **example**, which is also a new match anchor. The guideline
  sharpens with use, and you can browse all of it in bl-ed.

## 2. What was measured (all offline unless marked LIVE)

Model: `potion-code-16M-v2@75cf7a6c` (static, 256-d), already on this machine via the pinned
beam-lisp. `code.embed/available?` → true.

| finding | evidence |
|---|---|
| **The rule text is a poor anchor.** Abstract rules score 0.02–0.12 against concrete situations. Concrete "when" phrases score 0.52–0.88 on the same queries. ∴ a guideline needs `** When` lines; it cannot get by with the rule alone. | `/tmp` probe, reproduced in `test/match.bl` design |
| Cost: 7 guidelines / 30 anchors index in **274 ms including model load**. A match takes **0.75 ms/query** (exact scan). This is cheap enough to run on every step. | `proof/match.txt` |
| 24 held-out situations, threshold 0.42: **precision 0.88, recall 0.35**. The sweep shows no threshold that fixes it (0.30 → P 0.47 / R 0.40). | `proof/match.txt` |
| **Learning works.** After recording one *paraphrased* example per missed guideline (never the test text): **P 0.93, R 0.70**. The same test inside a real task system: "highlight the current guideline in the explorer list" moves 0.14 → 0.21 after one `applied` call. | `proof/match.txt`, `test/loop_test.bl` |
| Lexical (BM25-ish) does not rescue recall: P 0.75 / R 0.30. Hybrid ∪: P 0.73 / R 0.40. | `proof/tiers.txt` |
| Injection rides the **tail** and is **never recorded**: step 2's rebuilt request has no trace of step 1's block. The cacheable prefix is byte-stable (prompt-cache contract §4). | `test/loop_test.bl` (13/13 green) |
| **LIVE A/B, rail row (4 + 4 runs):** without the guideline, 4/4 render a visible `"needs you"` text badge. With it injected, 0/4 do: they use a left rule, tint, opacity/strikethrough for done, weight and a dot for needs-you. | `proof/ab-rail-x4.edn`, `proof/ab.edn` |
| **LIVE A/B, benchmark report (1 + 1 run):** the matcher did **not** fire (a recall miss), and it did not matter: the model already flagged SIMD as a hypothesis and said how it measured. | `proof/ab.edn` |

The last two rows give the main insight for "how guidelines make output better". **A guideline is
worth its tokens only where the model's default departs from your taste.** The rail guideline
flips behaviour 4/4. The reporting guideline is redundant for this model. So a guideline's
definition should carry its own probe (§6.4), and "is it still needed?" becomes a test.

## 3. Defining guidelines: three options

| | A. `.bl.org` only | B. datoms only | **C. org for rules, datoms for use (built)** |
|---|---|---|---|
| Author | edit text in bl-ed | a form or tool | edit text in bl-ed |
| Review/diff/git | ✓ | ✗ (export needed) | ✓ for rules |
| Usage history (where it fired, per task) | ✗, or bloats the file | ✓ (queries, decay) | ✓ traces `{:kind :guideline}` |
| Learning write-back | appends to the file (race with the open buffer) | a transaction | **promote**: a trace becomes an `** Examples` line, gated (§4) |
| Layering user ⊂ project | by file order | by attribute | by file order, layered by `:ID:` like bl-ed packages |

Format (see `guidelines.bl.org`): one top-level heading per guideline, with `:ID:`, tags, the rule
paragraph, and `** When` / `** Not when` / `** Examples` lists. Sources are
`~/.omega/guidelines.bl.org` (user) and `<root>/guidelines.bl.org` (project). The parser is about 30
lines of pure BL. Possible additions: `:PATHS:` globs (a deterministic trigger, §4) and
`:BODY: skill://…`, so a guideline can link a procedure (it then subsumes skills).

## 4. Challenges (what the spike ran into)

1. **Recall is the weak point, and the situation text is the lever.** The goal alone is a thin
   description. The strongest signals omega already has are **structural**: file claims (absolute
   paths, `omega.trace`), the tool about to run, and the language of the edited file. A `:PATHS:
   *.css, **/render.bl` trigger is precise and free. Proposed pipeline: deterministic triggers ∪
   semantic top-k at low threshold → **Jev** as the precision stage. Jev is already in omega (a
   calibrated closed question, "does guideline X apply here?") and fails open to "don't show".
   Semantic gives recall, Jev gives precision. Not built: Jev is network-only.
2. **Self-reinforcing examples.** If the agent writes its own examples, a bad reading of a rule
   gets reinforced. Gate promotion:
   - the task ended `:done` and was not reverted;
   - the example is not a near-duplicate (cosine > 0.9 → reinforce instead);
   - keep the last N per guideline.

   `misfire` and `propose` never write the file. They are traces for a human to accept.
3. **Write-back vs. the open buffer.** Org is the source of truth, and bl-ed may have it open. Write
   through the editor (an effect the host applies with the document rev), not `File/write!`. The
   spike's `:write-back?` direct write is test-only.
4. **The human cannot see what the model saw**, because tail blocks are not turns. Hence the
   `shown` trace, with score and anchor. The task view must draw it (§5).
5. **Reporting overhead.** An `applied` tool call costs a step. An alternative is a post-hoc judge at
   `:turn/end`: an event handler in its own process asks Jev "did the output follow X?" per shown
   guideline. It is free for the agent and auditable. In the live A/B, `tools` was empty, so whether
   Sonnet calls `guideline` unprompted is **untested**.
6. **Dialect friction met along the way:**
   - no `take-last` or `array-map`;
   - `erlang/unique_integer [:positive]` fails, because a vector is a tuple;
   - a hook that throws is **silently skipped**. That is right for production but hid a bug for
     several minutes; only a `:finding` trace showed it.

## 5. Spike design: what to build next (to the package contract)

**P2: `guideline:` provider + `guidelines` bl-ed package.**
- `omega.ed.providers` gains `"guideline"`:
  - `guideline:index` lists guidelines grouped by tag. The visual weight of a row is its use: applied
    count is drawn as the strength of a left rule; misfires as a hollow marker; never-shown ones dim.
    It obeys its own rule, with no "(unused)" text.
  - `guideline:<id>` is the org heading, editable in place (it IS the file region), plus a read-only
    **Uses** section: one row per trace (task, step, score, anchor, note), each linking to `task:<t>`.
- The package (`spikes/guidelines/guidelines/pkg.bl`) provides:
  - a layout `"guidelines"`: `:list` (guideline:index, `[:ch 34]`) | `:main :linked` | `:uses`
    (a view of matches for the line under the cursor, *live*: type a situation in scratch and watch
    scores move);
  - `:links {"omega/guideline" #(str "guideline:" (:key %))}`;
  - the commands `:guidelines/open` (`space g o`), `:guidelines/try` (match the current
    line/selection) and `:guidelines/accept` (promote a proposal).

  Proof per AGENTS.md: screenshots on an offline world (`--port 8792 --memory`), used and after
  `unuse`; a drive test; the vendor drive suite green; the present equivalence check unchanged.

**P3: guideline-aware inbox (the existing `inbox` layout, no new screen).**
- Rail: proposals and misfires waiting for a decision join the **Needs you** group, as
  `omega/guideline` rows. `y`/`n` accept or reject through the same keys as asks. Rows sit in the
  group; their kind shows in typography, not a label.
- Task view (conversation): a `shown` guideline is drawn as a **margin note** beside the step it was
  shown at. It is solid when later `applied`, hairline when only shown, and struck through on
  `misfire`. Hover or `RET` opens `guideline:<id>` in `:main`.
- Minimap: the steps where guidelines fired get a tick, so you can see where a session was steered.

**P4: wiring.** `bin/bl-ed --guidelines` installs the extension in `omega.ed.main/start!`, with
sources from user + project. The `:tail` request field replaces the hook's last-message append.

## 6. Proposed guidelines to test (each with a falsifiable probe)

| id | rule (short) | probe: what to count |
|---|---|---|
| `visual-not-verbal` | style/placement, not labels | visible status words in hiccup (**tested: 4/4 → 0/4**) |
| `errors-name-the-fix` | an error says what to do next | error strings with a verb + path/command |
| `no-silent-fallback` | missing config fails loud | `(or x default)` on parsed input |
| `bl-dialect` | use `subvec` not `take-last`; vectors aren't Erlang lists | compile errors per task |
| `one-question` | ask one question with options | asks with ≥ 2 options vs open asks |
| `effects-not-io` | bl-ed packages return effects | `File/`/`http` inside `:on-event`/`:render` |
| `measure-first` | number before optimisation | perf-PRs with a before/after table |
| `offline-world` | never touch :8790 | tool calls containing `8790` |

§6.4: each guideline can carry a `** Probe` (a prompt + scorer, like `test/ab.bl`). `bl test` runs
it against a **cassette** (offline, deterministic), and re-records on demand. A guideline whose probe
shows no difference is flagged as **dead weight**: the explorer dims it, and it costs no tokens.

## 7. Making the BL harness better (beyond guidelines)

1. **Implement `:tail`** on the loop request (decided in `prompt-cache.bl.md` §4, not in `src/`
   yet). Guidelines are its second consumer after the attention line.
2. **A `situation` value**, `{:goal :step :last-tool :paths-claimed :file-langs}`, built once per step
   from traces. Guidelines, the attention line and Jev scope checks all want it.
3. **Turn the always-on instruction files into guidelines.** `~/.agents/AGENTS.md` is 9.4 KB, loaded
   into every session in every repo. Most of it (Android emulator, Elixir dirty-IO, direnv fds) is
   situational: textbook "when" material. Matched, it would cost ~0 tokens on unrelated work and
   would surface exactly when `adb`, `mix` or `.envrc` appears.
4. **Dev-mode loud hooks**: `OMEGA_DEV=1` makes a throwing hook fail the turn instead of skipping it.
5. **A dialect lint as a guideline source**: each `undefined var: X` the harness sees becomes a
   proposal (`bl-dialect`, "when: X"), so the harness learns the dialect gaps it keeps hitting.

## Files

- `guidelines.bl.org`: 7 seed guidelines (the format).
- `guidelines/core.bl`: parse, layer, index, match, situation, inject, add-example (pure except embed).
- `guidelines/ext.bl`: the omega extension (`:context` hook + `guideline` tool + traces + write-back).
- `test/loop_test.bl`: 13 assertions in a real task system (scripted model).
  Run: `bin/bl test -p spikes/guidelines spikes/guidelines/test/loop_test.bl`.
- `test/match.bl`, `test/tiers.bl`: matching quality → `proof/match.txt`, `proof/tiers.txt`.
- `test/ab.bl`, `test/ab_repeat.bl`: LIVE A/B → `proof/ab.edn`, `proof/ab-rail-x4.edn`.
