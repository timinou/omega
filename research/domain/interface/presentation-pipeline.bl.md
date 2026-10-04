# Drawing the screen from scratch: readtables, presentations, modes

*Design, 2026-10-04. Spike: [`spikes/present-pipeline.bl.md`](../../../spikes/present-pipeline.bl.md)
(RAN, findings below). Plan: PLAN-004. Builds on [`bl-ed.bl.md`](bl-ed.bl.md),
[`providers/task.bl.md`](providers/task.bl.md), [`loom-and-grammar.bl.md`](loom-and-grammar.bl.md).*

## 1. The idea in one paragraph

bl-ed's screen today is a list of text lines with a fixed set of decorations (`:band :card
:place :agent? :object`), wired to omega inside the core render. The proposal inverts that. A
document is READ into typed objects by a **readtable**. Each object is drawn by a **presenter**
that its package registers, wrapped by **mode** advice. The result is a tree of **marks**, and
every mark knows the source text it came from. A pure **layout** turns marks into screen slots
and frames, and the host only paints. Every arrow is a pure BL function you can swap, inspect
and test. This is what a Lisp machine gives you (Genera's presentation types, CLIM's
`present`/`accept`, Zmacs minor modes), applied to an org editor that keeps org as the single
source of truth.

```
text ──read──▶ objects ──present──▶ marks ──layout──▶ slots + frames ──paint──▶ DOM | TUI
      readtable           presenters (+ :around)      grid arithmetic          host: dumb
```

## 2. Why: what `task:t-5` showed (OBSERVED, 2026-10-04)

- **Turns are not units.** `* model · 4` is a heading, then prose, a cell and results; nothing
  moves by, folds or selects "a turn".
- **Types travel separately from the text.** `render.bl` emits `:objects [{:row :type}]`. The
  editor never derives a type from the text, and `ed.omega/reference-at` is a hand-written
  parser (`grab ":id \""`).
- **The prompt is far from where you are looking.** `* say ▸` is a read-only row; RET opens a
  minibuffer floating in the middle of the screen.
- **Noise.** Raw markdown, `eval#8/toolu_01V6MDi…` traces, 12-line results, everything always expanded.
- **No following.** A new rev keeps the cursor's row number; nothing brings you to the newest turn.

## 3. The pieces

### 3.1 The readtable: text → objects

Reading is done on the span partition bl-ed already keeps (`bl.doc.spans`, `ed.org`), so nothing
is parsed twice. Headings open sections by level; every other span is a leaf of the innermost
open section. Each span is classified, first hit wins:

1. **readtable entries** (syntax): `{:type :match (fn [span line]) :attrs (fn [span line])}`
2. **a provider's object** on the span's first row, for rows that have no syntax (overview lines, traces)
3. **the span kind**: `:heading → :section`, `:cell → :src`, `:result → :result`, otherwise `:prose`

The dispatch points are the ones CL's reader has dispatch characters for: `#+begin_X` blocks,
heading `:tags:`, and `#tag` data literals on result rows (`#omega/task`, `#omega/effect`,
already a `data-reader!`).

**Safety rule** (the `*read-eval* nil` rule): readers and presenters come only from loaded
packages. A document can SELECT among installed ones but can never install one. Opening a file
never runs code.

**Totality rule:** reading never fails. An unclosed block is `:open? true` (as spans already are).
A type no presenter knows draws as text (spike finding 4a: the page failed to boot on `:omega/msg`
until the isa chain always ended at `:node`).

### 3.2 Presenters: objects → marks

```clojure
; marks — plain maps
{:m :text  :row r}                        ; a source row (EDITABLE, drawn as today)
{:m :line  :src r :segs [seg…] :key k}    ; an ornament: derived text; RET/click lands on :src
{:m :stack :kids […]}
{:m :card  :key k :tone s :kids […]}      ; a frame around its kids' slots
{:m :sticky :key k :kids […]}             ; in place, or pinned to the viewport edge while below it
```

- **Lookup** walks an isa chain: `:omega/cell → :src → :node`.
- **`:around` advice** wraps a presenter the way CLOS method combination does, so a mode changes
  how a type draws without editing it: `(fn [o ctx next] …)`.
- **Level of detail:** `ctx` carries `(:lod ctx) : object → 0..3`. 0 = its first row, 3 =
  everything. **Folding stops being a mechanism**: the default policy gives a folded heading lod 0.
- **Policies** are modes: *fisheye* (whole at the cursor, a line elsewhere), *urgency* (an ask is
  always 3; ux-slice's "a card's height is its urgency", made general), *budget* (fit the task on
  one screen).

### 3.3 Layout: marks → slots + frames

On a monospace grid, layout is arithmetic, so it lives in BL: testable as data, identical in a TUI
back-end, deterministic. A mark tree flattens to **slots** (one screen row each) and **frames**
(`{:key :tone :y0 :y1 :depth :sticky?}`), plus a `row → slot` index. Only the slots inside the
viewport get segments, through ed.main's own line drawing (`render-rows`). Frames are boxes drawn
UNDER the lines, so caret, selections and gutter stay on the row grid.

The viewport rule that keeps it faithful: if the cursor is on screen in text space, keep it on
screen in slot space. A presentation that shrinks the document (`:fill? true`) fills the screen
from the end instead of leaving it blank.

### 3.4 Modes: data, folded over events

```clojure
{:name :follow :lighter "⇣ follow"
 :on-event (fn [old new ev] new')}      ; reacts to what an event DID; never re-implements it
```

`handle` runs `ed.main/handle`, then folds each active mode's `:on-event` over the result. Modes
are chosen per scheme (`task:` → follow + compose) and toggled at runtime (`space t f`); lighters
appear on the mode line.

- **follow:** at the tail, a NEW TURN moves the cursor to it. Scrolling up lets go. A rev that is
  not news (the age in the title) does nothing, and the composer is never taken from under you
  (spike finding 6).
- **compose:** when the task hands you the turn (`● running` → `◆ your turn`) and you were at the
  tail, the cursor lands in the say block.

### 3.5 The say block is where you write (spike finding 4)

- **Type-to-compose.** On the composer row, a printable key opens the say prompt with that
  character in it. `g s` then typing just writes, and letters are never commands there.
- **The draft is drawn in the composer card**, not floated. The minibuffer still owns the text
  (RET, Esc, Backspace and IME unchanged); the view model says `:inline? true`.
- **A draft survives the world.** A read-only refresh keeps an open prompt. This was an editor bug
  that dropped it on every rev, fixed with a regression test.
- **A finished task cannot take messages.** The composer says so, and the same keystrokes draft a
  new task.

## 4. What the spike measured (2026-10-04)

| claim | result |
|---|---|
| default presentation == today's screen | **785/785** variants (37 corpus files + `task:t-5`; every 7th scroll top, two fold patterns), 0 mismatches |
| per-keystroke cost | within ~0.5 ms of today at p50 (e.g. `task:t-5` `j` 1.58 → 1.74 ms; changelog 1,162 rows `type` 1.80 → 1.15 ms; ±0.5 run to run) |
| fewer screen rows for a task | `task:t-5`: 83 text rows → 32 slots |
| works on a real world in a real browser | yes: fisheye, block motions, sticky composer, follow, compose, writing in place; proof in `spikes/present/proof/` |
| vendored editor regressions | none: drive tests 30/30 (29 + 1 new), BEAM selftest 46/46, bench unchanged |

## 5. What is left, in build order (PLAN-004)

1. **Cut over in bl-ed.** `pp.*` becomes `ed.present` + `ed.readtable`. `render` IS the default
   presentation. The ornament/frame contract goes into `web/host.mjs`. `presentation-keys` and
   `object-at` become readtable `:keys`, with no parallel path. Gate: equivalence over the corpus,
   drive tests, bench.
2. **omega's presentation moves into omega's package** (with FUP-010). Its readtable keys on the
   syntax `render.bl` prints, and `(read (print x)) ≡ x` becomes a property test of `task-doc`.
3. **Selections and insert mode across ornaments** (not verified in the spike): a selection snaps
   to source rows, and typing in a `:text` mark inside a frame edits the text underneath.
4. **`:flow` marks:** proportional prose (markdown rendered, not printed) measured by the host and
   reported back as an event, the same pattern revs use.
5. **Chrome as presenters:** status line, gutter and minibuffer from a `screen:` document, so a mode
   can add `↓ 3 new` with one `:around`.
6. **Presentation-based input (CLIM `accept`):** while composing, pointing at any object (`C-r`)
   inserts it as a reference (`#omega/cell "t-5/4"`); the model receives the resolved content.
7. **Time as an input:** a `scrub` mode presents `rev − n` with the same presenters; a diff of two
   revs is an `:around` that marks changed spans.
8. **Nested panes:** a task inside the overview is a nested presentation at lod 1; zoom moves from
   row to transcript.

## 6. Decisions

| id | decision | why |
|---|---|---|
| P1 | org stays the single source of truth; drawing is never saved | round trip, greppable files, no lock-in to the editor |
| P2 | readers/presenters only from packages; documents select | opening a file never runs code |
| P3 | every type falls back to `:node` (text) | a provider can add a type without breaking the screen (found by the spike) |
| P4 | grid layout in BL; only `:flow` asks the host | testable, same in TUI, deterministic |
| P5 | one cutover: today's render becomes the default presentation | no parallel renderers; equivalence is the gate |
| P6 | modes react to what an event did (`old → new`) | composable, never re-implement commands |
| P7 | the draft lives in the minibuffer state, drawn by the composer | keeps IME/RET/Esc behaviour; one input path |
