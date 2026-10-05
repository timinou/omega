# Scrolling a conversation: the position is a value, in rows

*Built 2026-10-04: `spikes/present/pp/{present,main}.bl`, `vendor/bl-ed/ed/docs.bl`, `vendor/bl-ed/web/host.mjs`.
Tests: `spikes/present/test/scroll.test.mjs` (6). Proof: `spikes/present/proof/25-…png`.*

## What was wrong

1. **A refresh jumped the view.** A new rev rebuilt the editor and kept the cursor's ROW NUMBER and the view's `:top`
   row. New text above, or a doc that re-wrapped, moved the picture; a reader scrolled up got `scroll-to-cursor`
   dragged back to the cursor.
2. **No "latest".** Opening a task showed wherever the cursor happened to be; a new answer needed `follow`, which
   moved the CURSOR to the new turn and hoped the view followed.
3. **Scrolling moved by whole rows.** A wrapped answer is one text row but many screen rows; a 2-row headline made it
   worse. A wheel notch jumped 3 rows at once.

## The model

The view is a value (`ed :view`), and a presentation owns two keys in it:

| key | meaning |
|---|---|
| `:anchor {:row r :off k :sub f}` | slot `k` of text row `r` is at the top, `f` rows (fractional) scrolled past its top |
| `:pin :end` | the viewport is the one that ENDS at the end of the body (a chat's "latest shown") |

- **Pinned** ⟺ following (`⇣ follow` mode) ∧ at the tail. The render then computes the top from the END every
  time, so growth keeps the end in view with nothing to keep in sync.
- **Scrolling up lets go; scrolling to the end (or `G`) pins again.** Scrolling is `scroll-by delta-rows`: `walk`s the
  slots, so a headline or a wrapped answer is just more rows.
- **A refresh keeps the place by what is around it.** `docs/row-map` maps old rows to new ones through the text
  change (the common prefix and suffix stay; the middle keeps its offset), the cursor stays on its OBJECT if it still
  exists, and the view's `:top`/`:anchor` row map the same way. The view is only scrolled to the cursor if the cursor
  was on screen, and never for a presentation (it owns the view).
- **Opening a task is a visit, a refresh is not.** A visit lands at the latest (`:pin :end`, cursor on the newest
  turn's last line, NOT the composer: the composer takes typed characters). `:seen` in `:pkg-state` tells them apart;
  the host's empty boot document is not "seen".
- **A key moves from what is on screen.** `unpin` turns a pinned view into the anchored one that draws the same
  picture, and brings an off-screen cursor onto the body first.

## Smooth: the grid stays integral, only transforms move

The render stays in whole slots, with one addition: `:frac` (rows past the top slot). Lines carry `:vy` (fractional),
`:fixed?` (the sticky headline and the docked composer do not scroll), `:clip-top`/`:clip-bottom` (how much of the
row the body's edges hide), and `:peek?` (the slot just below the body that the shift uncovers, out of flow). The host
`translateY`s body rows by `-frac` lines and `clip-path`s them; frames move the same way. No layout work per frame.

The wheel is a **glide**: each notch adds a target in rows, and a `requestAnimationFrame` loop sends 32% of what is
left per frame as `:scroll-slots`. A trackpad's small deltas pass through the same easing. Plain documents glide too
(whole rows).

## Not done

- Memoising the render per (object, lod): scroll still lays the screen out once per step (3–7 ms).
- Pixel-exact keyboard scrolling (`C-e`/`C-y` by a row is already exact; `C-d`/`C-u` jump).
- An "N new" chip when something arrives while you read (the digest idea in scroll-and-type §4).
