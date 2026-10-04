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
| `ed/docs.bl` (new) | documents that are not files: visit, `C-o` back, read-only views, refresh by rev, minibuffer prompts | generic |
| `ed/keymap.bl` | presentations: the row under the cursor may BE an object; its type's keys win on that row (`:presentation-keys`, `:object-at`) | generic |
| `ed/main.bl` | `:doc :cards :intent-result` events; render carries `:card :agent? :object`, `:cards :doc-rev :virtual?`; status `:read-only? :asks :back`; `:prompt` minibuffer kind; package install (`install`, replaced by FUP-010) | |
| `ed/commands.bl` | `save` sends `:base` (the loaded rev); refuses on read-only views | lost-update safety |
| `ed/omega.bl` (new) | omega's console half (E28): task cells, cards, presentation commands, `space a o/s/n/q/i` | moves into omega's package with FUP-010 |
| `web/host.mjs` | effects `:visit :intent`; save with base; long-poll watchers for the shown document and the cards; boot through `/api/doc`; card drawing; status chips | |
| `web/theme.css` | `✦` agent mark, card tones, presentation row | |
| `test/omega.test.mjs` (new) | 10 drive tests of the console contract | |
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
Verified 2026-10-04 on the pin: drive tests 29/29 (19 upstream + 10 omega); omega's suite
18/18 files (incl. `ed_test`, `ed_image_test`); a real browser run (proof/10–15).

**Host traps found on the way** (this workstation):
- the shell's `kill` builtin rejects `-9`, so `kill -9` does nothing. Use `/bin/kill -KILL`, or a
  stale server keeps its port and every "restart" silently serves old code.
- `edit`/`create` on a script resets its mode; `chmod +x bin/bl bin/bl-ed vendor/bl-ed/build.sh`
  after touching them.

## Leaving
Two ways out, whichever comes first:
1. Upstream the changes listed above to `beam-lisp/apps/bl-ed` and delete this directory.
2. Move the omega parts into omega's package (FUP-010), with bl-ed loading them live.
