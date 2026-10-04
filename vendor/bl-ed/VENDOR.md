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
| `serve.bl` | `BLED_WEB` env var for the static dir | it runs from omega's root while its files live here |
| `proof/` | not copied (1.6 MB of screenshots) | proofs for omega's work go in `vendor/bl-ed/proof/` as they are made |

Every later change made here is listed in this table, so that it can be upstreamed.

## Build, run, test
```sh
bin/bl-ed build                                   # ~3 min cold (the in-page language), ~20 s for the editor
bin/bl-ed                                         # http://127.0.0.1:8790/  (BLED_ROOT defaults to omega)
BLED_OUT=vendor/bl-ed/web/out BLED_ROOT=../beam-lisp node --test vendor/bl-ed/test/
```
The drive tests' round-trip corpus is the beam-lisp tree's `.bl.org` files, hence `BLED_ROOT`.
Verified on 2026-10-04 with the pin: build OK, drive tests 19/19, server answers `/` and
`/api/place`.

## Leaving
Two ways out, whichever comes first:
1. Upstream the changes listed above to `beam-lisp/apps/bl-ed` and delete this directory.
2. Move the omega parts into omega's package (FUP-010), with bl-ed loading them live.
