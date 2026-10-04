# bl-ed, vendored

These files come from `beam-lisp/apps/bl-ed` at beam-lisp main `55f0a2af` (the last commit
touching it was `b637e2bf`, split cells). They are vendored here so that omega's UX slice
(`research/domain/interface/ux-slice.bl.md`) and its document providers
(`research/domain/interface/providers/`) can change editor and server code in one repo. This is
temporary, by the user's decision on 2026-10-04.

omega's pin `94700545` contains everything bl-ed needs (`bl.doc.spans`, `system.place`,
`js.eval`), so **the editor is built and served by omega's own pinned `bl`**. The page, the server
and omega's world run on one beam-lisp.

## What differs from upstream
| file | change | why |
|---|---|---|
| `build.sh` | compiles with omega's `bin/bl`; the in-page language comes from `$BL_TREE` (default `../beam-lisp`), which must be checked out at the pin (it refuses otherwise); writes to `vendor/bl-ed/web/out` | the in-page language is compiled from beam-lisp source paths |
| `src/bl_ed/serve.bl` (new) + `serve.bl` | the server is a LIBRARY (`bl-ed.serve/start!`) with `/api/doc`, `/api/rev` (long-poll), rev-checked `/api/save`, `scheme:` providers, `/api/intent`; `serve.bl` is a thin script over it | omega starts the same server in its own VM with its providers (one VM, no bridge) |
| `src/bl_ed/image.bl` (new) | the `bl:` provider: namespaces and per-var state (matches / changed / live-only / not loaded / lazy) against the source, reload through `reload/commit` | generic beam-lisp, useful without omega |
| `ed/pkg.bl` (new) | packages: a loaded module's layers (`:commands :keys :intercept :on-event :adopt :render`), never merged into the editor's tables, so `unuse` is exact; `ed/use` / `ed/unuse` / `ed/packages` on the `:` line; `:use` event; `:load-package` effect | FUP-010's seam (2026-10-04) |
| `ed/frame.bl` (new) | frames: a layout value (`:panes` editor/view, `:links`, `:focus`) brought to life as `{:layout :editors :focus :effects}`; `handle`/`take-effects`/`render` pure; links emit effects tagged `{:pane}`; `C-w w h l o`; `ed/layout` / `ed/layouts` on the `:` line; a frame of one pane renders exactly `ed.main/render` | design: research/domain/interface/frames.bl.md |
| `ed/docs.bl` (new) | documents that are not files: visit, `C-o` back, read-only views, refresh by rev, minibuffer prompts; a refresh keeps an open prompt (2026-10-04: it dropped your draft on every rev) | generic |
| `ed/keymap.bl` | presentations: the row under the cursor may BE an object; its type's keys win on that row (`:presentation-keys`, `:object-at`) | generic |
| `ed/main.bl` | `handle` = package intercept → core → package on-event (+ adopt after a fresh document); `render` = a package's `:render` or the text, `:packages` in the view; `:doc :cards :intent-result` events; render carries `:card :agent? :object`, `:cards :doc-rev :virtual?`; status `:read-only? :asks :back`; `:prompt` minibuffer kind; package install (`install`, replaced by FUP-010); `render` split into `line-context` / `line-view` / `render-rows` (no behaviour change; the seam presentations draw through, PLAN-004) | |
| `ed/commands.bl` | `save` sends `:base` (the loaded rev); refuses on read-only views | lost-update safety |
| `ed/omega.bl` (new) | omega's console half (E28): task cells, cards, presentation commands, `space a o/s/n/q/i` | moves into omega's package with FUP-010 |
| `web/host.mjs` | effects `:visit :intent`; save with base; long-poll watchers for the shown document and the cards; boot through `/api/doc`; card drawing; status chips | |
| `web/theme.css` | `✦` agent mark, card tones, presentation row | |
| `test/frame.test.mjs` (new) | 8 drive tests of frames: one pane ≡ ed.main, arrange keeps your editor, :select link → one visit for the right pane, effects/answers per pane, C-w skips views + C-w o, views draw from their pane, unknown layout, unuse spreads and ends its layout | |
| `test/pkg.test.mjs` (new) | 3 drive tests of packages: use/unuse exact, intercept/on-event/adopt/render, `ed/use` → effect (fail on the pre-seam build) | |
| `test/omega.test.mjs` (new) | 11 drive tests of the console contract (+1 2026-10-04: a refresh keeps the draft) | |
| `proof/` | upstream's 1.6 MB not copied; ours are `10-` … `15-` (2026-10-04, real browser run) | |

Every later change made here is listed in this table, so that it can be upstreamed.

## Build, run, test
```sh
bin/bl-ed build                    # ~3 min cold (the in-page language), ~25 s for the editor
bin/bl-ed --offline                # omega's world + bl-ed in ONE VM; open the printed URL
bin/bl-ed                          # the same with the live model
BLED_OUT=vendor/bl-ed/web/out BLED_ROOT=../beam-lisp \
  node --test vendor/bl-ed/test/drive.test.mjs vendor/bl-ed/test/omega.test.mjs
```
The drive tests' round-trip corpus is the beam-lisp tree's `.bl.org` files, hence `BLED_ROOT`.
Verified 2026-10-04 on the pin: drive tests 41/41 (19 upstream + 11 omega + 3 packages + 8 frames); omega's suite
18/18 files (incl. `ed_test`, `ed_image_test`); a real browser run (proof/10–15).

`web/host.mjs` is a FRAME host (holds an `ed.frame`, paints each pane into `#panes`; the first editor pane is the original `#editor`, others clone its skeleton; view panes have painters by kind — `minimap`); per-pane node lookup is by class (`.lines .gutter .page …`, ids kept for the first pane). It draws what a package's presentation returns: ornament rows (`:ornament? :src`, a click lands on `:src`), `:size`/`:role` rows, frames under the lines (`#frames`), an inline minibuffer (`:inline?`), `S-Enter`, wheel by screen rows (`:scroll-slots`), and loads packages (`:load-package` → `import('./pkg/<name>.mjs')`; `?use=a,b` at boot). `fitHeight` subtracts the page's padding and refits on resize (the clipped-last-row trap below is fixed). `web/pkg/` holds package loaders (generated, e.g. `spikes/present/build.sh pkg`).

**Host traps found on the way** (this workstation):
- `build.sh` refuses unless `../beam-lisp` is AT the pin. To rebuild only the editor modules (the
  in-page language unchanged): `bin/bl js build ed.main -p vendor/bl-ed --host eval-ed,eval-cells --out vendor/bl-ed/web/out`.
- `fitHeight` in `web/host.mjs` counts `#page`'s top padding as rows and measures before the status
  line lays out: the last row is clipped by a few px (found by spikes/present-pipeline.bl.md; fixed in the spike's host only).
- the shell's `kill` builtin rejects `-9`, so `kill -9` does nothing. Use `/bin/kill -KILL`, or a
  stale server keeps its port and every "restart" silently serves old code.
- `edit`/`create` on a script resets its mode; `chmod +x bin/bl bin/bl-ed vendor/bl-ed/build.sh`
  after touching them.

## Leaving
Two ways out, whichever comes first:
1. Upstream the changes listed above to `beam-lisp/apps/bl-ed` and delete this directory.
2. Move the omega parts into omega's package (FUP-010), with bl-ed loading them live.
