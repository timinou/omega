# Spike: scroll and type, in bl (the conversation and the frame)

> **Spike, 2026-10-04.** Follows [`present-pipeline.bl.md`](present-pipeline.bl.md). Design:
> [`research/domain/interface/scroll-and-type.bl.md`](../research/domain/interface/scroll-and-type.bl.md).
> The plain-DOM mock (`web/mock.html`) showed the IDEA; this spike builds it in BL on the
> presentation pipeline, so it stays an editor: a monospace grid, every row an object with a
> source, keys, modes, and org underneath.
> ```sh
> spikes/present/build.sh                                       # pp.* (now + conv, rail, frame)
> node spikes/present/serve.mjs 8791 http://127.0.0.1:8790      # → /frame.html
> node spikes/present/test/check.mjs FILE…                      # equivalence still holds
> node spikes/present/test/bench.mjs /tmp/t-1.org task:t-1      # conversation frame cost
> ```
> **Question.** Can the conversation (your words as headlines, the model's work as follow-ups,
> sticky questions, a question index) and a one-screen overview (rail | pane) be built from the
> same BL pieces: readtable, presenters, layout and modes? And is it cheap enough, without turning
> the editor into a web page?

## Lisp-machine choices (and why not the mock's)

| the mock did | the spike does | Lisp-machine / bl-ed precedent |
|---|---|---|
| proportional serif + sans | **one monospace grid**; hierarchy from *rows*, weight, colour, indentation | Genera's character styles (`:large` `:bold`) on a fixed-pitch screen |
| CSS `font-size: 1.9rem` headings | a **double-height row** (`:size 2`): the headline takes two grid rows, glyphs scaled into them | VT100 DECDHL. The grid, caret math and gutter stay integral |
| browser text wrapping | **`wrap-segs`** in BL fills styled words into the pane's measure (`:cols`); a resize re-wraps | Emacs `visual-line-mode` |
| `position: sticky` | **the layout** repeats the head row of the section the viewport is inside (`:sticky-heads?`, `head-card`) | Genera's sticky headers in Dynamic Windows; same mechanism as the bottom-pinned composer |
| two DOM panes + JS state | **`pp.frame`**: a pure frame of panes, each a whole bl-ed editor; `C-w w/h/l` moves focus; a link `{:rail :pane}` visits the rail's selection in the pane | a Genera **program frame** (Zmail: summary pane + message pane); Vim/Emacs windows |
| JS parses the documents | **readtable + reader**: `pp.conv/read-conv` regroups turns into `:conv/thread` objects (a reader macro over the outline); `pp.read` splits provider rows into objects | CL's readtable |
| clicking a heading | `J`/`K` from the readtable (`:conv/thread` motion); `j/k` in the rail by `:omega/task` | readtable-derived motions (spike 1) |

## What was built (`spikes/present/pp/`)

- **`conv.bl`**: the task as a conversation. Thread reader. `said` reads a handed-over
  `#omega/task` as words. The headline is a `:size 2` row with role `:title`/`:question`.
  Follow-ups: tools fold to `⌁ code ⇒ N lines ▸` (whole at the cursor, lod 3); prose is drawn
  (labels, bullets with hanging indent, `**strong**`, `` `code` ``) and word-wrapped on the grid to
  `min(84, pane cols)`. A question index is `questions`.
- **`rail.bl`**: the overview as a rail. Three rows per task (`◆ t-1 2h` / goal as words /
  snippet); a group draws only when non-empty; the selected task is a `picked` card.
- **`frame.bl`**: the pane frame (generic, no omega). Effects come back tagged `{:pane id}`; a
  resize carries `:cols` per pane.
- **`present.bl`** grew: `line-mark` takes `{:size :role}`; `head-card`; layout and viewport work
  in ROWS (a slot may be 2 rows: `take-rows`, `top-for-bottom`, `:vy` per line); a presentation may
  supply its own `:read` and `:ctx-of`.
- **`read.bl`**: a prose span whose rows carry provider objects reads as one object per row (the
  overview is ONE span of task rows).
- **`main.bl`**: `task:` → conversation, `omega:overview` → rail. `space t p` cycles
  text → omega → conversation. `J`/`K`/`] q`/`[ q` move by thread.
- **`web/frame.mjs`** (≈200 lines): the frame host; paints `:vy`/`:size`/`:role`, frames, per-pane
  status; routes effects and rev watches per pane.

## Findings

1. **It works on the real world.** `/frame.html` against the live 8790 world (read-only; nothing
   was sent): the rail shows 3 tasks; `j` in the rail opens `task:t-1` in the pane through the
   frame link, with no RET and no `C-o` (`proof/15`). `C-w w` focuses the pane. `J` jumps to "wehere did
   we stop then". Scrolling 30 rows into its follow-ups keeps that question at the top as a
   double-height row while the result rows scroll under it (`proof/16`). The question index
   highlights question 2.
2. **The default presentation is still today's screen.** Equivalence: 38 documents (37 corpus +
   t-5), 0 mismatches, after the layout moved from slots to rows of varying size. Drive tests
   30/30 on the vendored editor.
3. **Cost.** Frame = BL handle + render, node, no DOM:

   | document | | `j` | `k` | `G`/`gg` | type |
   |---|---|---|---|---|---|
   | t-1 (190 rows, 123 slots) | today | 1.02 / 1.94 | 0.76 / 1.16 | 1.29 / 1.90 | 0.81 / 1.58 |
   | | conversation | 0.63 / 6.52 | 0.41 / 1.17 | 5.04 / 7.44 | 0.57 / 0.99 |
   | t-5 (83 rows) | today | 0.89 / 1.55 | 0.57 / 1.07 | 0.73 / 1.12 | 0.58 / 0.98 |
   | | conversation | 0.26 / 1.69 | 0.26 / 0.95 | 2.70 / 3.42 | 0.45 / 0.75 |

   Typing and line motion are as cheap as today or cheaper (the conversation shows fewer rows).
   **A relayout costs ~3–7 ms** (`G`/`gg` and the `j` p95, i.e. when the cursor crosses into
   another object and the lod changes): the whole thread tree is re-presented and re-wrapped.
   That is fine at 60 fps, but it grows with the transcript. The fix is to memoise presenters on
   `(object identity, lod)`: only the thread whose lod changed re-wraps. Not done.
4. **Bugs the spike found in itself.** JS-profile gaps again (`(range)` without an end is refused,
   `& {:keys}` rest maps are rejected). Wrapping before inline parsing split `**bold**` across rows;
   wrapping now runs over styled words, gluing punctuation that touched a styled word in the source.
   The pane's fit counted the padding as a row; the measure didn't follow the pane width (it now
   comes from `:cols`).

## Not verified

- **Writing in the frame.** The composer is drawn in the pane, but `g s`, typing and RET in the
  frame were not driven (writing was proved in the single-editor spike; the frame routes the same
  events).
- **Mouse.** `frame.mjs` has no click-to-position yet; keys only.
- **The question index as a pane.** It is painted by the host from `pp.conv/questions`, not yet a
  third bl-ed pane with its own presentation.
- **Pane-local rev watching under churn** (a running task streaming turns into the pane while the
  rail also changes).
- **Editing code inside a thread** (lod 3 cells show the text rows; insert mode was not driven).

## Answer

Yes. The conversation and the one-screen overview are built from the same four pieces: a reader
that regroups turns into threads, presenters, a rows-aware grid layout with sticky heads, and a
pure frame of panes linked by a mode. There is no proportional layout and no DOM state. It reads as
bl-ed: monospace, keys, objects with sources, the org text unchanged underneath. Typing stays
under 1 ms. Relayout at 3–7 ms is the next thing to memoise.

## Round 2 (2026-10-04): minimap, a chat composer, and the spike as a bl-ed package

**Minimap** (`pp.present/minimap`, generic): the right column is a miniature of the pane's LAID-OUT
screen, one bar per screen row, coloured by role; your questions carry their words; a lens shows what
the pane shows. Clicking or dragging scrolls the pane (`:scroll-to-slot`), and it never switches the
view. Scrolling is by screen rows now: the view keeps an anchor `{:row :off}` (the k-th slot of a
wrapped row is at the top), so a long answer scrolls line by line instead of jumping (`proof/17`).

**Chat composer** (`pp.conv/present-composer`): the say block is a DOCK (`p/dock`): always at the
bottom of the pane, outside the scrolling body. `i` writes from anywhere in a task, and the draft is
drawn in the dock, wrapped to the measure. `S-Enter` breaks the line and the dock grows with the
draft (`proof/18`: three lines, one wrapped). Enter sends; Esc leaves. Driven against the live world
and cancelled with Esc: nothing was sent (the task text has no trace of the draft).

**Loadable into bl-ed** (FUP-010's seam): `vendor/bl-ed/ed/pkg.bl`. A package is a BL map of layers
(`:commands :keys :intercept :on-event :adopt :render`) that `ed.main` consults and never merges, so
`(ed/unuse "present")` is exact by construction. `spikes/present/build.sh pkg` compiles `pp.*` into
the vendored page's `out/` (one shared `ed.*`) and writes `web/pkg/present.mjs`. Then, in the real
bl-ed served by `bin/bl-ed`: `?use=present`, or `:(ed/use "present")` at runtime, and
`:(ed/unuse "present")` to remove it (`proof/20`). The package is `pp.main/bl-package`, not a
copy: the spike's pages call `pkg/use` on the same value. Verified on the live 8790 world: loaded →
`task:t-1` drawn as the conversation (▣ conversation · follow · compose in the status line);
`space a o` → the overview as a rail; `j j t` → back to a conversation; unuse → plain text and `J`
unbound; use again → conversation. Without `?use`, bl-ed is unchanged (no frames, no packages).
`proof/19` is the first try: the loader reported "does not provide an export named 'd_package'"
(`package` is a reserved word in JS, so the var is `bl-package`).

Tests: `vendor/bl-ed/test/pkg.test.mjs` (3) pins use/unuse exactness, intercept/on-event/adopt/
render and the `ed/use` effect; it fails on the pre-seam build (built from HEAD in a temporary
worktree) and passes now. Drive tests 33/33; equivalence 38/38.

Not done: the frame (rail | pane | minimap) is still the spike's own page (`frame.html`). In bl-ed
proper, a package draws ONE editor; splitting bl-ed's window into panes is a host change (a frame
host), the next step. `~/.bl-ed/init` autoload is not built (`?use=` stands in).

## Round 3 (2026-10-04): the frame in bl-ed proper, as a layout

The three-pane screen is no longer `frame.html`: it is a LAYOUT value (`pp/inbox.bl`, ~15 lines)
that the `present` package provides, run by bl-ed's generic frame (`vendor/bl-ed/ed/frame.bl`; design
and decisions: `research/domain/interface/frames.bl.md`). `pp/frame.bl`, `web/frame.{html,mjs,css}`
were deleted. One implementation.

- `?use=present&layout=inbox` on the live world: rail | conversation | minimap (`proof/23`), with
  parity to the mockup's interactions: `j` opens, `C-w w` + `J` jump threads, the minimap drags
  end to end, `i` drafts in the docked composer (`proof/24`).
- `:(ed/unuse "present")` → one pane, plain org, no frames (exact, via `:owns`); `use` + `layout`
  again → three panes; `C-w o` keeps the pane you are in.
- `proof/22` is the first boot: the host threw in `syncPanes` (the original `#editor` was keyed
  under the wrong pane) and left the `:` command on screen.
- Tests: `vendor/bl-ed/test/frame.test.mjs` (8). Drive 41/41. One-pane parity: `proof/21`.
