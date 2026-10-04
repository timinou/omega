# Spike: drawing the screen through presentations

> **Spike, 2026-10-04.** Design: [`research/domain/interface/presentation-pipeline.bl.md`](../research/domain/interface/presentation-pipeline.bl.md).
> Code: `spikes/present/` (BL namespaces `pp.*`, compiled to JS beside the vendored editor).
> Runnable:
> ```sh
> spikes/present/build.sh                                   # pp.* + ed.* → spikes/present/web/out (~1 min)
> node spikes/present/test/check.mjs FILE…                  # equivalence: default presentation == today's render
> node spikes/present/test/bench.mjs FILE [task:t-5]        # frame cost: today vs presentations
> node spikes/present/serve.mjs 8791 http://127.0.0.1:8790  # the page, /api → a running bin/bl-ed world
> ```
> **Questions.**
> 1. Can the screen be drawn as `text ─read→ objects ─present→ marks ─layout→ slots ─paint→ DOM`, with
>    a DEFAULT presentation that reproduces today's screen exactly?
> 2. What does that cost per keystroke?
> 3. Does an omega presentation of `task:<id>` (folded turns, fisheye, a sticky composer) and two
>    modes (`follow`, `compose`) work against a REAL world in a real browser?
> 4. Added during the run, at the user's request: **write something.** Does writing to a task feel right?

## What was built

| file | what |
|---|---|
| `pp/read.bl` | the readtable: spans (`bl.doc.spans`) → a TREE of typed objects. Headings open sections by level. Each span is classified by readtable entries (syntax), then by the provider's objects (rows without syntax), then by span kind |
| `pp/present.bl` | marks (`:text` = a source row, editable · `:line` = an ornament, derived, with `:src` · `:stack` · `:card` · `:sticky`); presenters looked up through an isa chain, with CLOS-style `:around` advice; level of detail per object; grid layout → slots and frames; the view model |
| `pp/omega.bl` | omega's task presentation: turn / cell / result / traces / composer readtable; turns away from the cursor fold to ONE line; long results show 6 rows; traces fold to a count; the composer is a sticky card that draws your draft in place; fisheye lod |
| `pp/main.bl` | entry: presentation + modes per document scheme (`task:` → omega + follow + compose); `] t [ t ] c [ c g s` from the readtable; `space t p` toggles text/presented; type-to-compose |
| `pp/check.bl` | equivalence + shape checks (BL, run in JS) |
| `web/host-pp.mjs` | a copy of the vendored host with four marked changes: ornament slots, frames under the lines, mode lighters, an inline minibuffer |

`vendor/bl-ed` changes (listed in VENDOR.md):
- `ed/main.bl`: `render` is split into `line-context` / `line-view` / `render-rows`. No behaviour
  change; drive 29/29 before and after.
- `ed/docs.bl`: **bug fix**, a refresh no longer closes an open prompt. See finding 5.

## Findings

**1. The default presentation reproduces today's screen exactly.** `pp.check/equivalence` compares
`ed.main/render`'s `:lines` with the presented `:lines`. It covers every 7th scroll position and two
fold patterns, over all 37 `.bl.org` files under `../beam-lisp` (first 100 found) plus the real
`task:t-5`: **785 variants, 0 mismatches.** The first run had a mismatch, and it was real: a rule
that kept the cursor in view moved the viewport where today's renderer does not. It was fixed by
applying the rule only when the cursor is on screen in text space.

**2. The cost is in the noise.** A frame is BL `handle` + `render` with no DOM, in node, p50/p95 ms over 200–300 keys:

| document | | `j` | `k` | `w` | `G`/`gg` | type |
|---|---|---|---|---|---|---|
| `task:t-5` (83 rows) | today | 1.58 / 3.27 | 1.13 / 2.19 | 1.15 / 1.94 | 1.92 / 3.46 | 0.76 / 1.44 |
| | presented (omega) | 1.74 / 3.28 | 1.19 / 2.25 | 1.49 / 3.46 | 2.17 / 3.89 | 1.39 / 2.51 |
| changelog (1,162 rows) | today | 2.11 / 3.69 | 1.60 / 3.15 | 1.44 / 2.25 | 1.74 / 2.70 | 1.80 / 2.84 |
| | presented (default) | 1.65 / 3.17 | 1.60 / 2.65 | 1.66 / 2.90 | 1.76 / 3.01 | 1.15 / 2.26 |

Runs vary by about ±0.5 ms. The first version cost 2–3×, for two reasons that were fixed:
`render` was called twice (once whole, then per row), and slot lookups were linear. After
`render-rows` (one pass over exactly the rows on screen) and a `row → slot` index built during
layout, the read and layout stages are cached by the identity of `(:struct ed)` and the focus key.
Typing invalidates the structure, so typing is the worst case. It still stays within ~0.6 ms of today.

**3. On a real world in a real browser, the presentation does what the design said.** Screenshots
are in `spikes/present/proof/`:
- `task:t-5` (83 text rows) draws in **32 slots**. Turns away from the cursor are one line each,
  e.g. `◆ model · 4  (println (read "README.md")) · (println (sh "grep…  ⇒ 13 lines ▸`. The
  newest turn is a card, traces are `3 traces · all ok ▸`, and the say block is a sticky card
  pinned to the bottom edge (`01`). Moving with `] t` changes which turn is whole (`02`, fisheye).
- **follow** (a simulated rev with one more turn): at the tail the cursor moves to the new turn.
  After `gg` (scrolled away) a new turn leaves it alone. **compose**: when the title changes from
  `● running` to `◆ your turn` while you are at the tail, the cursor lands on the say block (`03`).
- Line numbers in the gutter are the SOURCE rows (`59, 60, …`). Ornament rows show `·`. A click on
  an ornament lands on its source row.

**4. Writing: the first try failed three different ways.** `g s`, RET, then typing, against a
separate offline world (`bin/bl-ed --offline --memory --port 8792`; the live `t-5` was never written to):
- *(a) the page did not boot.* `present` failed on an object type nobody had declared
  (`:omega/msg`, the ask row). Fix: every type's lineage ends at `:node`, so an unknown type
  draws as text. This is a rule worth keeping: **a provider can add a type without breaking the screen.**
- *(b) typing ran commands.* With the boot broken, the first `y` answered yes and `e` visited
  `effects:t-1` (`04`). In normal mode on a task view, every letter is a command. That is a
  sharp edge for people who just want to write.
- *(c) once it worked, it worked as a floating minibuffer* in the middle of the screen (`05`), far
  from the say block. The reply arrived and follow showed it (`06`), but the thing you wrote was
  never where you were looking.

Then the say block was made the place where you write:
- **The draft is drawn inside the composer card** (`07`). The minibuffer still holds the text, so
  RET, Esc, Backspace and IME behave as before; the host is told `:inline? true` and does not float it.
- **Type-to-compose:** on the composer row, a printable key opens the prompt with that character
  already in it. So `g s` followed by typing just writes. No RET first, and no `y`/`e` accidents.
- **A finished task cannot take messages.** The world said `error: task t-15 is done` (`08`). The
  composer now says so up front, and the same keystrokes draft a NEW task instead (`09`, `t-35`
  in the overview was opened this way).

**5. A real bug in the vendored editor: a refresh closed your draft.** The read-only refresh in
`ed.docs/load-doc` reset `:mode :normal` and dropped `:minibuf`. Any rev while a prompt was open
threw the text away, and a task view gets a rev at least once a minute (the age in its title).
This is also true in today's editor, with any prompt (`space a n`, `say`). Fix: an open prompt
survives a refresh. Regression test `a refresh of a read-only view keeps what you are typing`
(`test/omega.test.mjs`): **fails on the old build, passes on the new one.** Proof `10`: half
a draft, a real rev 20 s later, the second half, sent. Drive tests 30/30.

**6. `follow` must ignore revs that are not news.** As first written, follow jumped on ANY text
change while at the tail. The age in the title changes every minute, so follow would pull the
cursor off the composer while you typed. Now only a new TURN moves it, and never while the cursor
is on the composer.

**7. Smaller host facts.**
- `fitHeight` measured at boot, before the status line had laid out, and counted the page's top
  padding as rows. The last row was clipped by a few pixels. Today's `host.mjs` has the same
  off-by-one. The spike host subtracts the padding and refits on a `ResizeObserver`.
- The JS profile has no `re-find`/`re-pattern` (the build rejects it), no 3-argument `map`/`range`
  and no `take-nth`. The BEAM runner of `ed.*` has no `true?` here. The editor's namespaces are
  JS-first; equivalence therefore runs in JS, the real target.

## Not verified

- **Insert mode inside a presented document.** Every presented view in this spike is read-only.
  Typing into `:text` marks of a writable document through frames has not been driven.
- **Selections across ornament rows** (a selection drawn from one source row to another with
  folded turns between them): the selection layer still positions by row → slot, which skips
  ornaments. Not exercised.
- **Proportional `:flow`** (markdown rendered as prose, measured by the host): not built. Every
  mark is one grid row.
- **Chrome as presenters** (the status line and gutter from a `screen:` document): only the
  lighters moved. The status line is still JS.
- **Streaming / a live tail.** Revs refresh at turn boundaries, as before.
- The live `t-5` world was never written to. Writing was tested against an offline world with a scripted model.

## Answer

Yes to all four questions, with corrections. The pipeline reproduces today's screen exactly
(785/785) at the same cost. The omega presentation, `follow` and `compose` work against a real
world. Writing to a task works in place in the say block: you type and the draft shows there, it
survives the world's ticks, and RET sends it. Getting there found three bugs in the spike and one
in the vendored editor.
