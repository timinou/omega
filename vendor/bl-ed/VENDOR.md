# bl-ed, vendored

These files come from `beam-lisp/apps/bl-ed` at beam-lisp main `55f0a2af` (the last commit
touching it was `b637e2bf`, split cells). They are vendored here so that omega's UX slice
(`research/domain/interface/ux-slice.bl.md`) and its document providers
(`research/domain/interface/providers.bl.md`) can change editor and server code in one repo.
This is temporary, by the user's decision on 2026-10-04.

## What differs from upstream
| file | change | why |
|---|---|---|
| `build.sh` | builds from `$BL_TREE` (default `../../../beam-lisp`, i.e. beam-lisp main) and writes to `vendor/bl-ed/web/out` | the editor is compiled by **beam-lisp main**, not omega's pin |
| `serve.bl` | `BLED_WEB` env var for the static dir | it is run from the beam-lisp tree while its files live here |
| `proof/` | not copied (1.6 MB of screenshots) | proofs for omega's work go in `vendor/bl-ed/proof/` as they are made |

Every later change made here is listed in this table, so that it can be upstreamed.

## Why main, not the pin
omega's pin `2360b32e` lacks:
- `js.eval` (the `:` command line);
- `system.place` (split cells);
- `bl.doc.spans`;
- `js.build`.

So the editor (browser) and its server (`serve.bl`) run on beam-lisp main, while omega's world runs
on the pin. The two talk over loopback HTTP (the bridge, FEAT-014). This is the same VM boundary the
slice designs for. FEAT-001 (re-pin) removes it.

## Build, run, test
```sh
vendor/bl-ed/build.sh                                         # ~50 s cold
cd ../beam-lisp && BLED_WEB=$OLDPWD/vendor/bl-ed/web BLED_ROOT=$OLDPWD bin/bl run $OLDPWD/vendor/bl-ed/serve.bl
BLED_OUT=vendor/bl-ed/web/out BLED_ROOT=../beam-lisp node --test vendor/bl-ed/test/drive.test.mjs
```
The drive tests' round-trip corpus is the beam-lisp tree's `.bl.org` files, hence `BLED_ROOT`.

## Leaving
Two ways out, whichever comes first:
1. Upstream the changes listed above to `beam-lisp/apps/bl-ed` and delete this directory.
2. Move the omega parts into omega's package (FUP-010), with bl-ed loading them live.
