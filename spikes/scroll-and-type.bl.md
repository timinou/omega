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
