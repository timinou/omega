# Impeccable → omega's interface (loom desktop + TUI)

> Abstract. [Impeccable](https://impeccable.style) is an open-source (Apache-2.0) *design skill for coding agents*: a
> single `SKILL.md` + ~40 reference playbooks that give an agent a shared design vocabulary (commands such as `typeset`,
> `layout`, `critique`, `polish`), a durable product/design record (`PRODUCT.md`, `DESIGN.md`), a deterministic
> anti-pattern detector (61 rules, no LLM), and a browser "live" iteration mode. Its most reusable idea for omega is that
> **taste is encoded as data and checked mechanically**; that is exactly what loom's `token.bl` + hiccup-as-data
> (`loom.transform/find-nodes`) already permit. This note (a) extracts Impeccable's principles, anti-patterns and
> typography/colour/spacing/motion rules, (b) classifies omega as an **Operate**-mode product and applies the Operate
> rules to both front-ends (loom webview, TUI), (c) shows concretely how a loom token map can encode them, with runnable
> proof (contrast ratios, theme install, a nested-card audit over hiccup), and (d) drafts six screens: project overview,
> task detail, message/wait graph, tool-call (codemode) inspector, diff/review, command palette. Everything runnable below
> was executed with `bl run`; everything under ```` ```clojure ```` is a proposal.

## 1. Sources

**Vendored** (provenance, commit, licence in `research/vendor/impeccable/README.md`; commit
`c74755d920985f7a92cef691ca970ba95f90126e`, 2026-10-01; licence **Apache-2.0**, `vendor/impeccable/LICENSE`):

- `research/vendor/impeccable/skill/SKILL.md:1-89` — entrypoint: setup, "How to design" (L23-27), **Modes** (L29-38), command table (L40-67).
- `…/skill/reference/craft-floor.md:1-45` — the *Verify* checklist (L5-17) and the *Refuse* ban-list (L19-45).
- `…/skill/reference/operate.md:1-60` — Operate-mode depth: product slop test (L5), typography (L11-16), colour (L18-24), layout (L26-28), components (L30-37), motion (L39-43), constraints (L45-52), permissions (L54-60).
- `…/skill/reference/typeset.md`, `layout.md`, `animate.md` (timing table L~42-56 "Timing and easing"), `colorize.md` (L38-65: OKLCH, state vocab, non-colour cues), `critique.md` (hard invariants L1-14: two *isolated* assessments), `polish.md`, `distill.md`, `harden.md`, `clarify.md`, `adapt.md`.
- `…/PRODUCT.md.impeccable-own:1-66`, `…/DESIGN.md.impeccable-own:1-60` — Impeccable's own records; the schema example (YAML frontmatter of named colour tokens with comments, then prose sections).
- `…/site/slop.md` (the 61-rule catalogue: ~40 "AI slop"/quality headings + "Your design system" rules), `site/home.md`, `site/designing.md`, `site/live-mode.md`, `site/docs-detector.md`, `site/faq.md`, `site/research.md`.

**Upstream URLs fetched:** https://impeccable.style/ · /slop · /designing · /docs · /docs/detector · /docs/layout · /docs/colorize · /docs/critique · /live-mode · /faq · /research · /changelog · /gallery; repo https://github.com/pbakaus/impeccable (shallow clone, then pruned). Not fetched: per-command doc pages other than four (same content is in `reference/*.md`), `/cases/neo-mirai`, `/tutorials/*`. The detector's Rust source (`crates/`) was **not** read — I only have its rule *catalogue*; statements about how rules are implemented are inference.

**beam-lisp (read-only):**
- `/home/user/code/undefine/beam-lisp--repl/priv/lib/loom/token.bl:1-332` — tokens map (L33-72), `install-theme!`/`theme`/`tok` (L74-115), `len`/`hue` (L117-145), `sx`/`sx*`/`keyframes` (L147-262), `base-css` (L~295-318).
- `…/loom/ui.bl` (button L65, field L117, card L196, heading L209, badge L237, alert L261, skeleton L293), `…/loom/parts.bl` (kbd L107, progress L126, timeline L167, events L205, tabs L316, facts L415, table L484, dialog L532, drawer L558, toast L622, empty-state L646, error-state L659), `…/loom/box.bl` (col/row/wrap/grid L158-162), `…/loom/transform.bl` (`element?` L26, `retheme` L47, `find-nodes` L109, `audit-missing-labels` L129, `map-text` L139), `…/loom/desktop.bl` (header contract L1-40: `view` = pure `state→hiccup`, `on-event` = pure reducer; `mount` L279, `app` L362, `bar` L369, `dropdown` L428).
- `…/priv/build/deps-compile.bl:148-155` — records that the Elixir lib **`ex_ratatui`** exists in beam-lisp's dependency set and compiled except for its `lib/mix/**` tasks (this is the only ratatui evidence I found in the repo; there is **no** `tui` namespace yet — `ls priv/lib/loom` shows only box/desktop/form/parts/token/transform/ui).
- Sibling research notes (same dir): `../coordination/tasks-and-stigmergy.bl.md:61-68` (task attribute schema `:task/id :task/slug :task/title :task/goal :task/status :task/parent :task/context :task/scope`).

OBSERVED = read/ran. INFERRED = my judgement; marked **(inf)**.

## 2. What Impeccable is and how it works

### 2.1 Shape of the thing (OBSERVED)

| piece | what | evidence |
|---|---|---|
| Skill | one `SKILL.md`; a **command table** routes `/impeccable <cmd> [target]` to a playbook in `reference/` | SKILL.md:40-67 |
| Context files | `PRODUCT.md` (users, purpose, principles, brand voice, "evidence on hand") and `DESIGN.md` (tokens + prose); loaded once per session by a `context` verb | SKILL.md:15-17, `PRODUCT.md.impeccable-own` |
| Detector | deterministic rules over **source** and **rendered DOM**; plus rules "against your design system" (font/colour/radius/size outside `DESIGN.md`); exit codes + `--json` for CI | site/docs-detector.md, site/slop.md |
| Hooks | run the detector automatically after the agent edits UI files | SKILL.md:78 (`hooks`) |
| Live mode | browser picker → N variants → accept writes to source | site/live-mode.md |
| Critique | design review with heuristic scoring; **two isolated assessments** (A: judgement, B: detector) then synthesis; a degraded single-context run must print a banner | critique.md:1-14 |

Control flow worth copying: *context load → pick playbook → inspect incumbent → build → one batched verification round → stop*. SKILL.md:12 forbids open-ended self-QA ("Verify in bounded passes, not a loop").

### 2.2 Principles (quoted/condensed, OBSERVED)

1. **Mode = what success looks like** (SKILL.md:29-38): *Persuade · **Operate** · Read · Experience*. "Operate: the visitor completes a task. App UI, dashboards, editors … Scanability, consistency, native expectations, and the real usage scene outrank expression. Brand lives in precise details." omega is Operate (+ Read for traces/diffs).
2. **The brief wins; refinement preserves, redesign replaces** (SKILL.md:23-27).
3. **Product slop test** (operate.md:5-9): "The tool should disappear into the task… failure mode isn't flatness, it's *strangeness without purpose*."
4. **Earned familiarity**: standard nav (top bar + side nav, tabs, **command palettes**), density, system fonts are *permitted* (operate.md:54-60).
5. **Restrained colour**: accent only for primary action, current selection, state (operate.md:18-24).
6. **Motion conveys state, not decoration**; 150-250 ms; no page-load choreography (operate.md:39-43).
7. **Every component has all states**: default, hover, focus, active, disabled, loading, error (operate.md:30-31); skeletons not spinners; empty states that *teach* (operate.md:33-34).
8. **Copy**: "Controls name their action; errors name the problem and the recovery" (craft-floor.md:15).
9. **Verify the built result**, not the intention (craft-floor.md:5-17).

### 2.3 Typography / colour / spacing / motion numbers (OBSERVED)

| axis | rule | source |
|---|---|---|
| Type, product | one family often right; **fixed rem scale**, not fluid; step ratio **1.125-1.2**; no display fonts in labels/buttons/data | operate.md:11-16, 47-48 |
| Type, universal | body measure **65-75ch** (typeset says 45-75); display ≤ 6rem; tracking floor **-0.04em**; body ≥ 16px ordinary floor; light-on-dark ⇒ slightly more leading/tracking/weight; tabular numerals for data | craft-floor.md:11, typeset.md "Apply" |
| Colour | body/placeholder ≥ **4.5:1**, large ≥ 3:1; on coloured surfaces tint secondary text from the hue, never grey; prefer **OKLCH** for new palettes, reduce chroma near white/black; never colour-only meaning; prefer explicit colours over stacked alpha | craft-floor.md:9, colorize.md:38,45,47,65 |
| Standard semantic vocabulary | hover, focus, active, disabled, selected, loading, error, warning, success, info; a **second neutral layer** for sidebars/toolbars | operate.md:20,22 |
| Depth | shadows have offset *and* blur; no zero-offset glow; declare elevation **once** (border *or* shadow); card radii 12-16 px | craft-floor.md:10, 33 |
| Spacing | documented scale, 4-unit base; tight groups, generous separation, **more space above a heading than below**; `gap` for sibling rhythm; squint test | layout.md "Apply", craft-floor.md:12 |
| Motion | 100-150 immediate feedback · 150-300 state change · 300-500 layout/overlay · 500-800 authored moment; exit faster than entrance; `cubic-bezier(0.16,1,0.3,1)`; **no bounce/elastic by reflex**; honour reduced-motion | animate.md:50-60, craft-floor.md:13 |
| Browser surfaces | theme text selection, caret, scrollbars, focus ring, underline offset, tabular numerals | craft-floor.md:16 |

### 2.4 Anti-patterns ("AI slop" tells), grouped (OBSERVED, `site/slop.md`, `craft-floor.md:19-45`)

- **Scaffold**: identical icon-heading-text card grids; hero-metric (big number + label + stats); eyebrow/kicker above a heading (a *ban*); numbered section labels with no real sequence; a modal where no interruption is needed; **nested cards** ("always wrong").
- **Surface**: gradient text; decorative glass/blur; coloured `border-left` > 1px (the "side-tab"); hard offset shadows outside a neobrutalist world; hairline border **plus** wide shadow (the "ghost card"); over-round cards; stripes/grid-lines backgrounds; glowing dark-mode accents; radial halos; "AI palette" (purple gradients, cyan on black); cream/beige by default; sparklines/progress rings as filler; emoji/unicode glyphs as icons; monospace as a costume for "technical".
- **Type**: "overused font" (Inter, Geist named explicitly); italic-serif display; flat hierarchy; tiny UI text; crushed tracking; all-caps body; justified text; wide tracking on body; skipped heading level.
- **Motion**: pulsing status dot; decorative blinking cursor; auto-scrolling marquee; bounce/elastic easing; animation that changes layout; images that move on hover.
- **Copy**: em-dash overuse; generic marketing claims; same text repeated in one container; words like "theater".
- **Layout/quality**: cramped padding; monotonous spacing; clipped menus/popovers (dropdown inside `overflow:hidden`); content overflow; low contrast; text covered by another element.

Note the **tension (OBS+inf)**: a few of these (pulsing dot, blinking cursor, mono-for-technical) are *exactly* what an agent harness UI is tempted to use to signal "alive/thinking". omega must signal liveness differently (§5.3).

### 2.5 Commands (OBSERVED, SKILL.md:40-67)

Build: `shape init document extract` · Evaluate: `critique audit` · Refine: `polish bolder quieter distill harden onboard` · Enhance: `animate colorize typeset layout delight overdrive` · Fix: `clarify adapt optimize` · Iterate: `live generate`. Also `hooks`, `doctor`, `pin`. Impeccable's own count: "23 design commands" (PRODUCT.md:Capabilities).

## 3. What omega should take / adapt / drop

| | item | why |
|---|---|---|
| **Take** | The *mode* concept; declare omega **Operate** (with Read for traces/diffs) in omega's own `PRODUCT.md`. | Prevents "landing-page" chrome (hero, eyebrow, gradient) in a tool. |
| **Take** | `PRODUCT.md` / `DESIGN.md` as repo-level durable context. omega already has task scopes; add *design* scope as just another trace. | Matches omega's "tasks know their scope" thesis; gives UI-building tasks a shared, citable basis. |
| **Take** | The **detector as data over hiccup** — port the *mechanical* rules (nested cards, side-stripe, gradient text, contrast, tiny text, skipped heading, missing label) as `find-nodes` queries (§5.4). | loom views are values; an audit is a query (`transform.bl:101-110` says so). Runs offline in tests. No browser, no LLM. |
| **Take** | Two-isolated-assessments critique (judgement vs mechanical), "degraded" banner. | Maps onto omega's own design: a *reviewer task* and a *lint task* with no shared context, synthesised by a third. (Note: assignment forbids spawning subagents in *this research phase*; omega's runtime is not so limited.) |
| **Take** | Bounded verification ("one batched round") | Prevents UI-polish tasks from burning tokens in loops; fits budgeted tasks. |
| **Take** | Operate rules verbatim as the loom/TUI house style (fixed scale, restrained accent, all states, skeleton, 150-250 ms, no load choreography). | Direct fit. |
| **Adapt** | Banned-pattern list → a **lint profile** (`:omega/ui`) rather than prose; keep the explanation strings (Impeccable's are good UX copy for findings). | A finding must name the problem *and* recovery (craft-floor.md:15). |
| **Adapt** | OKLCH guidance → keep tokens as hex in loom (loom resolves raw strings, hex needed for contrast math and for the TUI's 24-bit SGR), but *derive* them from OKLCH offline. **(inf)** | `token.bl` colours are plain strings; CSS would accept `oklch()` but the TUI cannot. |
| **Adapt** | Live mode (pick element → variants → accept) → *not for omega's own UI at first*; but the **idea** (a view is addressable, variants are values, accept = write source) matches omega's task model. Park. | Needs a browser picker; loom's hiccup tree could give element identity for free **(inf)**. |
| **Drop** | The Persuade/Experience machinery (hero, imagery, comps via image models, overdrive, bolder/delight, `new-work` visual-world selection — 58 KB). | omega is a tool, not a brochure. |
| **Drop** | Per-harness distribution build (provider folders, Rust CLI, browser extension, VS Code ext). | omega *is* the harness; the skill is one bundle. |
| **Drop** | Impeccable's own "kinpaku gold on lacquer-black" identity. | A world chosen for a design-publication site; omega should choose from its own use scene (§5.1). |

Licence note: vendoring is fine under Apache-2.0 (keep `LICENSE`/`NOTICE.md`, mark changes). If omega ships a *derived* skill (`omega/ui` bundle), keep attribution. The vendored `README.md` states this.

## 4. beam-lisp mapping

| need | existing | gap |
|---|---|---|
| Tokens as data, deep-mergeable per process | `loom.token/tokens`, `install-theme!`, `theme`, `tok` (fails loud on a typo) — `token.bl:33-115` | no `:dark`/`:light` pair mechanism (a theme is one map; switching = reinstall); no `:text` roles (`:text` is a *size* scale, not role); no tabular-numeral/`font-feature-settings` token; motion `:spring` (`cubic-bezier(.34,1.56,.64,1)`, L71) is an **overshoot curve** → Impeccable bans bounce by reflex |
| Scale-or-raw escape hatch | `len`, `hue`, `sx` merges raw `:style` last (`token.bl:10-16`) | good; lint must therefore flag raw values *outside* the scale ("Font/Colour/Radius outside DESIGN.md" analogue) |
| Components | `loom.ui` (button/field/card/badge/alert/skeleton), `loom.parts` (table/tabs/timeline/events/drawer/dialog/toast/empty-state/error-state/kbd/progress/facts) | no tree/graph, no diff viewer, no command palette, no split pane; **`ui/card` defaults to `:border true … :shadow :sm`** (`ui.bl:196-203`) = Impeccable's "hairline border + shadow ghost card" **(OBS)** — change default to border-only |
| Layout algebra | `loom.box` (`col row wrap grid`) | fine; add a *density* knob rather than per-component paddings |
| Audit as query | `transform/find-nodes`, `audit-missing-labels` (`transform.bl:109-137`) | only one audit exists; add the rule set (§5.4) |
| Native window | `loom.desktop/app` (view = pure fn, reducer = pure fn) | webview only |
| Live web | `priv/lib/live/*` (socket diff, hiccup→html) | — |
| TUI | **nothing in-tree**; `ex_ratatui` is a vendored Elixir dep that compiles | a `loom.tui` namespace: hiccup→cell grid; event mapping `:on-click [:intent …]` ⇒ key/mouse; the "mirror loom" requirement means the *same view fn* must render in both **(inf)** |

Current loom defaults vs Impeccable (OBS, `token.bl:33-72`): `:accent-2 "#7c5cff"` is a violet — Impeccable's "AI colour palette" tell; `:bg "#0b0c0e"` near-black with `:text "#e8eaed"`; `:faint "#5f656b"` on `:bg` computes to **3.3:1** (run below) — fails the 4.5 body floor, so `:faint` must be decoration-only or be lifted. System font stack is *allowed* in Operate.

### Runnable: measure the current defaults and a candidate omega palette

Pure arithmetic; offline. WCAG relative-luminance contrast.

```beam-lisp
(ns omega.interface
  (:require [loom.token :as t]
            [loom.transform :as x]))

(defn hex->rgb [h]
  (mapv (fn [i] (/ (erlang/binary_to_integer (subs h i (+ i 2)) 16) 255.0)) [1 3 5]))
(defn lin [c] (if (<= c 0.03928) (/ c 12.92) (math/pow (/ (+ c 0.055) 1.055) 2.4)))
(defn lum [h] (let [[r g b] (map lin (hex->rgb h))]
                (+ (* 0.2126 r) (* 0.7152 g) (* 0.0722 b))))
(defn ratio [a b]
  (let [x (lum a) y (lum b)]
    (/ (+ (max x y) 0.05) (+ (min x y) 0.05))))
(defn r1 [n] (/ (erlang/round (* 10 n)) 10.0))

;; loom's shipped defaults:
(println "loom default text/bg :" (r1 (ratio "#e8eaed" "#0b0c0e")))
(println "loom default faint/bg:" (r1 (ratio "#5f656b" "#0b0c0e")) "(< 4.5 -> decoration only)")
```

A candidate omega palette (my proposal, hex derived by eye — not yet OKLCH-derived), checked against the Impeccable floor. The accent is an amber so it avoids the "AI purple/cyan" tell; amber doubles as `:warning`, which is a real conflict — see Open Question 3.

```beam-lisp
(def dark
  {:bg "#14161a" :surface "#1a1d22" :surface-2 "#21252b" :border "#2f343b"
   :text "#e6e8eb" :muted "#a3a9b1" :faint "#868d96"
   :accent "#e0a43a" :accent-fg "#14161a"
   :danger "#ee7b6f" :success "#6fcf8f" :warning "#e0a43a"})
(def light
  {:bg "#f6f6f4" :surface "#ffffff" :surface-2 "#ecedeb" :border "#d3d6d3"
   :text "#1b1e22" :muted "#4d545c" :faint "#5f666e"
   :accent "#8a5a00" :accent-fg "#ffffff"
   :danger "#b3261e" :success "#1e7a43" :warning "#8a5a00"})

(def checks                       ; [fg bg floor]
  [[:text :bg 4.5] [:muted :bg 4.5] [:faint :surface-2 4.5]
   [:accent :surface 4.5] [:accent-fg :accent 4.5]
   [:danger :surface 4.5] [:success :surface 4.5]])

(defn audit-theme [th]
  (mapv (fn [[fg bg floor]]
          (let [r (ratio (get th fg) (get th bg))]
            {:pair [fg bg] :ratio (r1 r) :ok (>= r floor)}))
        checks))

(doseq [[nm th] [[:dark dark] [:light light]]]
  (println nm (mapv (fn [m] [(:pair m) (:ratio m) (:ok m)]) (audit-theme th))))
(assert (every? :ok (audit-theme dark)))
(assert (every? :ok (audit-theme light)))
```

Observed output (dark): text 14.8, muted 7.6, faint 4.6, accent 7.7, accent-fg 8.2, danger 6.2, success 8.8; (light): 15.5 / 7.1 / 4.9 / 5.9 / 5.9 / 6.5 / 5.4. All ≥ 4.5. This is the shape of the future `omega ui lint --contrast`: a *test*, not an opinion.

## 5. Applying it to omega

### 5.1 Register, users, use scene (design brief; **(inf)** — to confirm with the user)

- **Mode: Operate** (project overview, detail, palette) with **Read** surfaces (trace, diff, transcript).
- **Users:** a developer running *many concurrent tasks* on one repo, glancing at the machine between other work; sometimes an *agent developing omega* reading the same data via a text API (§6).
- **Use scene → theme** (the rule is "pick light/dark from who/where/ambient light", craft-floor.md:44): dark default (terminal-native, long sessions, beside an editor) **and** a real light theme; both contrast-tested. Do not pick by category.
- **One family**, system sans for UI, a monospace **only for code, paths, ids, tool args, diffs** (not as "technical" costume). Fixed rem scale, ratio ≈ 1.125-1.2. Tabular numerals for counts/durations/costs.
- **Accent rare:** primary action, current selection, "needs you". Status uses **shape + label + colour**, never colour alone.
- **Density is a feature** but with the 4-unit scale and tight/generous contrast, not uniform cramming.

### 5.2 loom desktop (webview) vs TUI — one vocabulary, two renderers

Impeccable's rules are CSS-flavoured; the TUI is a character grid. Translation table (**inf**):

| Impeccable rule | loom webview | TUI |
|---|---|---|
| spacing scale (4-unit) | `:space` tokens px | 1 cell = unit; scale `:0 :1 :2 :4` ↔ 0,1,2,4 cells; **vertical gap is the scarce resource** — group by blank row + dim rule, not boxes |
| no nested cards / no ghost card | `card` = surface step *or* border, never both; no card in card | **no box-drawing frames around everything**; at most one hairline rule (`─`) per region; panels distinguished by background tint (2 surface levels) |
| hierarchy via size/weight | scale 12/14/16/20/26 | only **weight (bold), dim, reverse, underline, colour**; headings = bold + a blank row above; no ASCII-art banners |
| contrast ≥ 4.5 | measured on tokens | measured on the *same* hex → 24-bit SGR; **detect `COLORTERM`**; on 256/16-colour fall back to a hand-picked ANSI mapping that keeps the contrast test (a palette must pass per depth) |
| status not colour-only | dot + label | glyph + word: `● running`, `◐ waiting`, `○ idle`, `✕ failed` — but Impeccable bans *emoji/unicode glyphs standing in for an icon system*; **resolve**: in a TUI the glyph set is the icon system; define ONE small set (5-7), same stroke class, in tokens |
| motion 150-250 ms, state only | CSS transition on state change | **no spinners/blinking** by default; at most one 1-cell progress glyph updated at ≤ 4 Hz tied to a real event; `NO_MOTION`/reduced-motion env disables |
| focus ring visible | `:focus-visible` outline (`token.bl` base-css) | reverse-video row + a `▌`-free cursor; *the focused row is the only reverse-video thing* |
| keyboard-first, command palette | `kbd` chips; `/`+`⌘K` | `:`/`Ctrl-p` palette; every mouse action has a key; hints bar bottom (3-5 items, context-sensitive) |
| overlays escape container | `dialog`/`drawer`, popover on top layer | overlay drawn last over the grid; never clip |
| empty states teach | `empty-state` | one line of what + one line of the key to press |
| tabular numerals | `font-variant-numeric: tabular-nums` | monospace by nature; right-align numeric columns |

**One-view-two-renderers (inf):** author each omega screen as a pure `state → hiccup` using a small set of *semantic roles* (`:omega/stack :omega/row :omega/list-row :omega/status :omega/kbd …`) that `loom.ui`/`loom.box` render as CSS and `loom.tui` renders as cells. The reducer (`on-event`) is the same. This mirrors `loom.desktop`'s contract (`desktop.bl:1-40`) and is what "TUI API mirrors loom" should mean in practice. Events stay the closed vocabulary `[:intent …]/[:navigate …]` — keys map to the same terms the click handlers carry.

### 5.3 Signalling liveness without slop

Agent UIs love pulsing dots, blinking cursors and shimmering "thinking…". Impeccable flags all three (`site/slop.md`: "Pulsing status dot", "Decorative blinking cursor"). omega alternatives (**inf**): show **elapsed time + last-trace-age** ("4m · last write 12s ago") as text that updates once a second; show *what* the task is waiting on ("waiting on `t-reader-hex`: needs `lexer.ex` claim"); use a **stale** state (no trace for N s) as the only attention-coloured liveness cue. Liveness = information, not animation.

### 5.4 Token encoding in loom (concrete)

Design sketch — **does not run yet** (the semantic-role layer and `omega.ui.theme` are proposals). First, what *does* run today: install a brand, resolve tokens, see a typo fail loud (`token.bl:88-113`), and observe stable hashed classes.

```beam-lisp
(t/install-theme!
  {:color  dark
   :radius {:md "6px" :lg "8px"}                     ; tighter than loom default 14px lg
   :motion {:fast "120ms" :base "180ms" :slow "300ms"
            :ease "cubic-bezier(0.16,1,0.3,1)"}})     ; ease-out-expo; NOT :spring

(println "accent:" (t/color :accent) "| radius md:" (t/radius :md))
(println "class:" (t/sx {:padding (t/len :3) :color (t/hue :accent)}))
(println (t/sheet-css))

;; the scale must fail loud on a typo — Impeccable's "design-system drift" idea, enforced at runtime
(println (try (t/color :nope) (catch e :caught-token-typo)))
```

A **semantic layer** on top of raw tokens is where Impeccable's vocabulary lives. Proposed `omega.ui.theme` (design only):

```clojure
(ns omega.ui.theme (:require [loom.token :as t]))

;; DESIGN.md as data: the single source; a lint rule compares used values to this.
(def design
  {:register :operate
   :roles  ; type roles, named by PURPOSE not value (typeset.md "Set the system")
   {:title   {:size :lg :weight :semibold :leading :tight}
    :body    {:size :md :weight :normal   :leading :normal}
    :label   {:size :sm :weight :medium}
    :meta    {:size :xs :weight :normal :color :muted :tabular true}
    :code    {:size :sm :font :mono}}
   :status  ; shape + word + colour; same table feeds loom badge AND TUI glyph
   {:running {:glyph "●" :word "running" :tone :accent}
    :waiting {:glyph "◐" :word "waiting" :tone :muted}
    :blocked {:glyph "◇" :word "blocked" :tone :warning}
    :review  {:glyph "◆" :word "in review" :tone :accent}
    :failed  {:glyph "✕" :word "failed" :tone :danger}
    :done    {:glyph "✓" :word "done" :tone :success}}
   :elevation :border            ; ONE of :border | :shadow (ghost-card rule)
   :motion {:ms [120 180 300] :ease :out-expo :reduced :none}})

;; Same tokens → CSS (loom) and SGR (TUI). One hex, two serialisations.
(defn sgr-fg [hex] …)            ; "224;164;58" as in the runnable block below
```

Lint = queries over the view tree (this *runs*: a nested-card audit built on `find-nodes`, the same mechanism as `audit-missing-labels`). A card is any element tagged `:data-role :card`; "nested card" = a card with a card descendant.

```beam-lisp
(defn role? [r] (fn [n] (and (vector? n) (map? (second n)) (= r (get (second n) :data-role)))))

(defn nested-cards
  "Impeccable 'nested-cards': every card that contains another card."
  [tree]
  (filter (fn [c] (seq (x/find-nodes (role? :card) (drop 2 c))))
          (x/find-nodes (role? :card) tree)))

(def good [:main [:section {:data-role :card} [:p "a"]] [:section {:data-role :card} [:p "b"]]])
(def bad  [:main [:section {:data-role :card} [:div {:data-role :card} "inner"]]])
(println "nested cards good/bad:" (count (nested-cards good)) (count (nested-cards bad)))
(assert (= 0 (count (nested-cards good))))
(assert (= 1 (count (nested-cards bad))))
```

The TUI half of "one hex, two serialisations": 24-bit SGR from a token.

```beam-lisp
(defn sgr [hex]
  (let [n (erlang/binary_to_integer (subs hex 1) 16)]
    (str (quot n 65536) ";" (rem (quot n 256) 256) ";" (rem n 256))))
(println "SGR for accent:" (sgr (:accent dark)) "-> ESC[38;2;" (sgr (:accent dark)) "m")
(assert (= "224;164;58" (sgr "#e0a43a")))
```

Proposed lint rules (mechanical, over hiccup; each carries Impeccable-style *problem + recovery* copy): `nested-card`, `card-border+shadow`, `side-stripe` (`border-left` > 1px on list/card), `gradient-text`, `tiny-text` (< `:sm` outside `:meta`), `skipped-heading`, `missing-label` (exists), `raw-colour-outside-theme`, `raw-size-outside-scale`, `contrast<4.5` (on resolved token pairs), `motion>300ms` in Operate, `bounce-ease`, `pulsing-status` (an infinite `keyframes` on a `:status` role), `blinking-cursor` (TUI). Judgement-only rules (extreme radius, rough illustration, glassmorphism-as-decoration) stay with a *critique task*, as Impeccable itself splits them ("Design review" vs "Source" in `site/slop.md`).

Changes to loom defaults (inf, small): `ui/card` default → border **or** surface step; remove `:accent-2` violet from defaults; replace `:motion :spring`; add `:text :tabular`; lift `:faint`; add `:surface-nav` (the second neutral layer, operate.md:22); add `:info` tone.

## 6. Interactions & observability (how a human and an agent peek, test, drive)

- **Views are values.** `(view state)` is a hiccup tree: print it, diff it, snapshot it, run `find-nodes` on it (done above). No browser needed to test hierarchy rules, labels, contrast, nested cards.
- **Reducers are pure:** `(on-event state ev) → state`; drive a screen by folding an event list; assert on state and on `(view state)`. Keyboard handling = a table `key → ev`, testable the same way.
- **Headless render for agents:** a `loom.tui` text-dump renderer (cells → plain text, no SGR) lets an agent "see" a screen as ASCII in a tool result, the way a human sees the TUI; the webview side can return the hiccup tree itself plus `retheme` variants (`transform.bl:47`) for dark/light. **(inf)**
- **Theme parity test:** for each theme × depth (truecolor/256/16) assert every status pair ≥ 4.5 (runnable pattern above).
- **Snapshots as traces:** a screen render written to the task's trace (path, theme, hash) so other tasks/agents can cite "the UI as of X" — consistent with the stigmergy model (`../coordination/tasks-and-stigmergy.bl.md:61-68`).
- **Critique as a task:** `omega ui critique <screen>` spawns a reviewer task with Impeccable's two isolated assessments; output = a trace item (heuristic scores, P0-P3 findings as shown on impeccable.style's demo).
- **Live mode analogue:** `[:omega/variant n]` events render N alternative views side-by-side in a dev-only route; accept = write source. Park until after the first screens ship.

## 7. The screens

Common frame. Top: **one** line (project, branch, counts, clock). Left (webview) / top-level tab (TUI): scope switcher. Bottom (TUI): hints bar. No logo block, no hero, no eyebrow. Headings are **nouns** ("Tasks", "Trace"). Status uses the §5.4 table everywhere. In the wireframes `▸` is the focused row (reverse-video in TUI, `:surface-2` + 2px outline in webview), `·` is whitespace for alignment, and `[x]` is a key hint, not a button frame.

### 7.1 Project overview — all tasks at once

**Purpose.** Answer in one glance: *what is happening, what needs me, what is stuck.* **Primary content.** One dense, scannable **table/list of tasks**, not cards. Group order = urgency: *Needs you* → *Running* → *Waiting/blocked* → *Done (collapsed)*. Columns: status word+glyph · slug · title · scope (top path/glob) · last-trace age · cost · waits-on. Not a metrics hero. A single-line summary replaces the hero-metric ("9 tasks · 2 need you · 1 stale").

```
omega · repo omega · main · 9 tasks · 2 need you · 1 stale            14:07

Needs you
▸ ◆ in review   fix-reader-hex     Reader: accept 0x hex literals     lib/boot/reader*   2m   $0.41   diff ready
  ◇ blocked     split-proc-bus     Split proc.bus per-sub demand       proc/bus.bl        9m   $0.88   waits on fix-reader-hex

Running
  ● running     ui-palette         Command palette                     ui/palette.bl      12s  $0.12   –
  ● running     jev-decisions      Typed decision API                  coord/decision.bl  41s  $1.30   –
  ◐ waiting     docs-tokens        Document tokens                     docs/*             6m   $0.07   waits on ui-palette (msg)

Stale (no trace > 5m)
  ○ idle        spike-ratatui      Ratatui cell-grid spike             tui/               23m  $0.30   –

Done  (3)  [d] expand
```

**Interactions.** Open task (`↵`), claim/steer (`s`), pause (`p`), cancel (`x`, confirm inline not modal), filter (`/` free text over slug/title/scope), group toggle (`g`), jump to graph for this task (`G`), to review (`r`). Selection-as-state: the *selected* task also filters the right pane (webview split) / is what `↵` opens (TUI). **Keyboard.** `j/k ↑/↓` move · `↵` open · `/` filter · `:`/`Ctrl-p` palette · `g` regroup · `r` review · `G` graph · `?` help · `1-4` jump to group · `Esc` clear filter. **Impeccable notes.** Table, not cards (no identical-card grid); status = glyph+word; numbers tabular and right-aligned; the "needs you" group is the only place accent colour appears; empty state: "No tasks yet. Press `n` and describe what you want done."; loading = skeleton rows; width collapse is structural (drop *scope* and *cost* columns first, then *title* truncates with end ellipsis).

### 7.2 Task detail — conversation + trace + files claimed

**Purpose.** Be inside one task: read what it said and did, steer it, see what it has claimed and touched. **Primary content.** Three regions with clear priority: (1) **Conversation** (the task's thread; user prompt verbatim at top as the *goal*; assistant turns; tool calls collapsed to one line each, linking to the inspector 7.4). (2) **Trace** (the stigmergic record: marks left/read, claims, messages sent/received, waits entered/released — a chronological `events`-style list, newest at bottom, relative times). (3) **Claimed** (scope: files/globs/symbols, claim state `claimed | read-only | contended`, last touched). Header: slug, status, parent, context, elapsed, tokens/cost, the one next action.

```
fix-reader-hex · ◆ in review · parent: – · 14m · 62k tok · $0.41            [r] review  [m] message

Conversation                                         Claimed (3)
You  Reader: accept 0x hex literals                  ▸ lib/boot/reader.ex      write  12s ago
Omega I'll look at the number branch first.            lib/boot/reader_test.exs write  4m ago
  ▸ read   lib/boot/reader.ex  (212 lines)             lib/boot/**             read   –
  ▸ edit   lib/boot/reader.ex  +14 −3
  ▸ test   mix test reader      passed 41             Trace
Omega Hex now parses; 0x prefix is case-insens.       14:03 claim   lib/boot/reader.ex
You  also reject 0x with no digits                    14:03 note    "number branch at L88"
Omega …                                               14:05 msg →   split-proc-bus: "reader API stable"
                                                      14:06 wait    on split-proc-bus  (released 14:07)
┃ message to this task…                              14:07 ready   review requested
```

**Interactions.** Send message / steer (`m`, composer at bottom, `↵` send, `Alt-↵` newline); expand a tool line (`→`/`↵` opens inspector); jump from a trace row to its source (message → other task, claim → file); release/steal claim (`c` with inline confirm); fork task (`f`); mark done (`D`). **Keyboard.** `Tab`/`Shift-Tab` cycle regions (Conversation → Trace → Claimed) · `j/k` within region · `↵` open · `m` message · `e` toggle expand all tools · `[`/`]` previous/next task · `g o` overview · `Esc` back. **Impeccable notes.** Regions are separated by whitespace and a single dim rule, **not** boxes-in-boxes; headings stay nouns; code and paths in mono only; message composer is inline, not a modal; a user may write while the task runs (no disabled state without an explanation line: "Task is writing; your message queues"). Reading width of the conversation clamps to ~72ch; tool lines are one row each (density), the *content* of a tool call lives in the inspector.

### 7.3 Inter-task message/wait graph

**Purpose.** Show *who is waiting on whom, and why*, plus message flow and shared-scope contention — the thing a chat UI cannot show. **Primary content.** A directed graph where nodes = tasks (status glyph + slug) and edges are typed: **waits-on** (solid, with the awaited condition on the edge label), **message** (dashed, count + last text on focus), **claim-contention** (two tasks claiming overlapping scope). Cycles/deadlocks are the first-class finding: a detected wait-cycle renders as a banner line at the top with the participants (Impeccable: errors name the problem *and the recovery* — "Cycle: A→B→A. `[b]` break by cancelling the lower-priority wait."). Alternative linear view (default for TUI): a **layered list** (topological layers) — a real graph canvas is a webview enhancement.

```
Waits & messages · 9 tasks · 3 edges · no cycles

layer 0  ● ui-palette
layer 1  ◐ docs-tokens        waits on ui-palette         "palette API stable"
layer 0  ◆ fix-reader-hex
layer 1  ◇ split-proc-bus     waits on fix-reader-hex     "reader/0x merged"
layer 2  ◐ jev-decisions      waits on split-proc-bus     "bus per-sub demand"   ← longest chain: 3

Messages (last 5)
14:05  fix-reader-hex → split-proc-bus   "reader API stable"
13:58  ui-palette    → docs-tokens       "need token names"
Contention
  lib/boot/**   fix-reader-hex (write) ⟂ spike-ratatui (read)   ok
```

**Interactions.** Select node/edge → side detail (trace rows of that wait, the full message, who can release it); `Enter` jumps to the task; release a wait manually (`R`, with confirm — destructive to flow); send a nudge (`m`); filter edge kind (`1 waits · 2 msg · 3 contention`); time scrub for replay (`,`/`.` step through trace — a cheap "what happened" tool). **Keyboard.** arrows/`hjkl` move along edges (follow-edge, not spatial nav) · `Tab` next node by layer · `↵` open task · `R` release · `f` filter kind · `L` toggle layered-list ⇄ canvas (webview) · `Esc` back. **Impeccable notes.** Colour never alone: edge kind = line style + label; wait-cycle is the sole red; no animated "flowing particles" along edges (decorative motion; state-only motion rule); node labels never overlap (layout test with long slugs); the graph needs a real **text equivalent** (the layered list is that equivalent, which is also what a screen-reader / agent reads).

### 7.4 Tool-call / codemode inspector

**Purpose.** Answer "what exactly did the agent run, with what, and what came back" — including **codemode** programs (the agent writes a beam-lisp program that composes tools; see sibling `../tools/codemode.bl.md`) — and let a human re-run or edit it. **Primary content.** A header (tool, task, time, duration, exit status, size); *Input* (args, pretty-printed, with secrets masked); for codemode: the **program** (syntax-highlighted, mono) beside a **call tree** (each nested `(tool/x …)` call as an indented row with duration and result summary); *Output* (truncated with "N more lines" and a path to the full artifact); *Side-effects* (files written, marks left — links to Claimed/Trace). Errors come first when present, in plain language.

```
codemode · fix-reader-hex · 14:04:12 · 1.8s · ok

Program                                         Calls (4)
(let [hits (tool/find {:target "lib/boot/       ▸ find   lib/boot/**::§line[~="0x"]   31ms  3 hits
    **::§line[text~=\"0x\"]"})]                   read   reader.ex                      9ms   212 lines
  (map #(tool/read {:path (:path %)}) hits))      read   reader_test.exs                7ms   88 lines
                                                  edit   reader.ex  +14 −3             22ms  ok

Output (3 values, 1.2 KB)  [o] full artifact://…
 [{:path "lib/boot/reader.ex" …} …]
```

**Interactions.** Step through calls (`j/k`), expand any call's args/result (`↵`), copy program (`y`), **re-run** read-only calls (`R`; writes require confirm), open a file/claim (`o`), diff the edit (`d` → 7.5), "explain" (ask the task, `?`). **Keyboard.** `j/k` calls · `↵` expand · `Tab` Program⇄Calls⇄Output · `y` yank · `R` re-run · `d` diff · `o` open · `[`/`]` prev/next tool call in this task · `Esc` back. **Impeccable notes.** Mono used for *code, data, measurements* — legitimate; durations right-aligned tabular; outputs are truncated with an explicit affordance (no silent clipping); long programs scroll *inside* the region (no `overflow:hidden` popovers); the error state names the failing call and the recovery ("Call 3 failed: file changed on disk. `R` re-run after reload"); no spinner while running — a row with elapsed time that updates.

### 7.5 Diff / review

**Purpose.** Decide *accept / request change / reject* for what a task wrote. **Primary content.** File list (left) with per-file `+/−` and review state (`unseen · seen · ok · comment`), the diff (right; unified default, split on wide), and a **review bar**: accept all, request changes (inline comments become a message to the task), reject. Context that makes the decision cheap: task goal one-liner, tests run + result, files *outside the claimed scope* highlighted as a finding. Diff colours: add/remove use **tint + sign column (`+`/`−`)** so colour is never sole carrier; intra-line changes get stronger tint.

```
fix-reader-hex · review · 3 files · +31 −7 · tests passed 41 · 0 outside scope        [a] accept  [c] request changes

▸ lib/boot/reader.ex            +14 −3  seen  │  @@ L88 number branch
  lib/boot/reader_test.exs      +17 −0  unseen│    (defn- read-number [s]
  docs/reader.md                 +0 −4  ok    │ −    (parse-int s 10)
                                              │ +    (if (hex-prefix? s) (parse-int (subs s 2) 16) (parse-int s 10))
                                              │ ▎ comment: also handle "0X"?   (you, 14:09)
```

**Interactions.** Move by file/hunk, mark seen/ok, add inline comment on a line (`c`), accept (`a`), request changes (sends bundled comments as a *message trace* to the task, task status → `running`), reject/revert hunk (`x` with inline confirm, undo available), open file at line in `$EDITOR` (`o`), toggle unified/split (`s`), toggle whitespace (`w`). **Keyboard.** `]`/`[` next/prev file · `n`/`p` next/prev hunk · `j/k` lines · `c` comment · `a` accept · `x` reject hunk · `Space` mark seen + next · `u` undo · `Esc` back. **Impeccable notes.** The review bar is the **single** primary action area; accept is the only accent-filled control; the comment marker must not be a coloured left stripe (side-stripe ban) — use the sign column or a gutter glyph + label; syntax highlighting uses ≤ 5 hues, tested for 4.5:1 on both add/remove tints; large diffs paginate/virtualise with a skeleton, not a spinner.

### 7.6 Command palette

**Purpose.** The one universal entry point: every action, task, file, trace item, setting — reachable by typing; also the discoverability surface for keybindings. (Operate permissions explicitly allow command palettes — operate.md:58.) **Primary content.** An input; a result list mixing *actions* (with their key), *tasks* (slug + status), *files/claims*, *recent*; right pane previews the selected item (task summary, file head, command description). Typed prefixes narrow scope: `>` actions · `@` tasks · `#` traces · `/` files · `?` help. Results are **ranked by recency + fuzzy score**, with the match characters shown in bold/underline (not colour only).

```
›  rev                                                    esc
Actions
▸ Review current task            r        │ fix-reader-hex
  Request changes                c        │ in review · +31 −7 · tests passed
Tasks                                     │ 3 files · 2 claims
  ◆ fix-reader-hex   in review            │ waits on: –
Files
  lib/boot/reader.ex      claimed by fix-reader-hex
```

**Interactions.** Type to filter; `↵` run; `Tab` complete the prefix; `Ctrl-↵`/`Alt-↵` run in background / secondary target; `→` open submenu (e.g. choose which task for "Message task…") ; `Ctrl-n/p` or arrows move; `Esc` closes and restores focus where it was. Commands with required args become a **second step in the same surface** (no stacked modal). Every command shows its key hint; keybindings are data, shown/edited from here (`> Keybindings`). **Keyboard.** open: `:` or `Ctrl-p` (TUI), `Ctrl-k`/`/` (webview; `Cmd-k` on macOS) · `↵` `Esc` `Tab` `↑↓` as above. **Impeccable notes.** It is an *overlay* (appropriate use: interruption + protected focus), must escape its container (no clipping), one authored motion at most (opacity/translate ≤ 150 ms, none in TUI), a visible focus ring on the input, empty state teaches prefixes ("`>` actions, `@` tasks"), screen-reader: listbox with `aria-activedescendant`. Implementation note: loom already has `dropdown`/`menu-item` (`desktop.bl:428-483`) and `dialog`/`drawer` (`parts.bl:532-558`); a palette is a new composition over them (**inf**).

## 8. Open questions for discussion

1. **Which register/identity?** (a) Pure Operate "disappears into the task", system font, restrained neutral + one accent; (b) Operate with a distinctive identity carried by *one* type choice and a signature colour (Impeccable's own approach for its site); (c) mimic an existing editor's look. (a) is fastest and lowest slop-risk but anonymous; (b) costs a typography decision and a testing burden (a non-system font in a TUI is impossible, so identity must live in colour/layout there); (c) risks looking like a clone. *Impeccable's advice leans (a)+(b-lite).*
2. **Dark-only first or dual-theme from day one?** Dual theme doubles contrast/lint tests but is cheap if tokens are data and the theme test exists (§4 runnable). Dark-only is faster but contradicts "pick from the use scene". Recommend dual with auto from `prefers-color-scheme`/terminal background query; confirm.
3. **Accent colour collision:** amber is distinctive but equals `:warning`. Options: (i) amber accent + distinct warning hue (orange-red), risking danger confusion; (ii) blue accent (loom's current, safe but "generic"), amber warning; (iii) teal accent. Needs a colour-vision-deficiency check (colorize.md:63) whichever is chosen.
4. **How strict is the in-tree lint?** (a) advisory findings in a trace; (b) CI-gating on the mechanical rules (nested-card, contrast, missing-label) with an *ignore-with-reason* list (Impeccable's `ignore-rule`/`ignore-value`); (c) a hook that runs after every agent UI edit (Impeccable `hooks`). (c) gives the fastest feedback but runs on every edit and may annoy; (b) is the sane default.
5. **Port Impeccable's detector, or write omega's?** Impeccable's is Rust, CSS/DOM-based; omega's views are hiccup data, so the same rules are small queries. Reuse its **rule names and messages** (Apache-2.0, attribution) and implement them natively; or adopt its CLI for URL/DOM scans of the webview as an *extra* external check. Native is simpler and offline; external catches real-layout problems (overflow, covered text).
6. **TUI glyph policy.** Impeccable bans glyph-as-icon, but a TUI has no other icons. Options: ASCII-only (`*`, `~`, `x`) — universally safe, uglier; a small fixed Unicode set (`● ◐ ◇ ◆ ✕ ✓`) with an ASCII fallback toggle (needs a font-support probe); Nerd-Font icons (nope: dependency on user font). Recommend the small Unicode set + fallback.
7. **Graph rendering (7.3):** layered list only (works in TUI, agent-readable, no layout engine) vs a laid-out canvas in webview (nicer for >15 tasks, needs a layout algorithm and a text equivalent anyway). Do we ship list first and treat canvas as an enhancement?
8. **Where does design context live?** `PRODUCT.md`/`DESIGN.md` at the repo root as Impeccable does (portable, human-edited) vs. omega facts in the task datom store (queryable, stigmergic) with markdown as an *export*. The second is more omega-native; the first lets the vendored skill run unmodified.
9. **Do we adopt Impeccable's command vocabulary as omega commands** (`/ui critique`, `/ui polish`…) so users and agents share terms, or keep omega's palette verbs and treat Impeccable only as a lint+playbook bundle? Shared vocabulary is Impeccable's core value; cost = 23 commands is a lot to surface — I'd expose ~6 (`shape critique audit polish distill harden`).
10. **Liveness signalling without animation (§5.3).** Elapsed-time text only, vs a single sanctioned 1-cell/4 Hz indicator. The former is pure Impeccable; the latter is friendlier on long silent tool runs. Which does the user prefer?
11. **Keybinding model:** vim-ish (`j/k`), emacs-ish (`Ctrl-n/p`), or both mapped to the same events? Both is cheap with a key→event table but doubles the docs/palette entries.
12. **Verification budget for UI tasks:** adopt Impeccable's "one batched inspection round, then stop" as a default budget on UI-polish tasks? Saves tokens, risks shipping an uncaught defect; the mechanical lint is the safety net.
