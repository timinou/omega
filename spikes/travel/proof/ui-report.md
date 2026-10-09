# Travel desk: UI report

Final clean run: `node spikes/travel/test/browser.mjs` (live OpenRouter search, real listing loads), exit 0, 13 steps
(`proof/logs/browser-live.log`, `proof/browser.json`, screenshots in `proof/screens/01..13`). The harness builds the package assets first
(`build.sh`), refuses to start if its ports (18841/18842) are already in use, and runs the editor in its own process group, so only
this run's isolated world is exercised. Port 8790 is never touched.

## What the tour exercises (real bl-ed + travel package + native Chromium)
| # | Check | Result |
|---|---|---|
| 1 | Editor pane and desk pane laid out side by side (420 + 1260 px at 1680), rectangles do not intersect; no available/bookable claim anywhere in the page | pass |
| 2 | Notebook edited with real keys in the editor and saved with C-s; desk tab state independent; offline research form says it is a scripted demo | pass |
| 3 | Live search: 8 sources / 8 candidate links; repeat query served from cache; Search fresh is a real second `/discover` call (`cache: miss`) | pass |
| 4 | Forced refresh fetched exactly once; cached refresh reused the read | pass |
| 5 | Shortlist, compare (3 columns), note and checklist persisted through the service | pass |
| 6 | Trip: bad edit (10 adults vs groups) refused with the sum error and not written; valid edit (9000 EUR) survives page reload; restored to unlimited; header stays 11 adults + 9 children = 20, 2026-12-19, 4/5 nights | pass |
| 7 | Manual URL: `javascript:` refused; `https://example.com/` stored with `origin: user`; forced fetch never marks it as meeting capacity; manual evidence shown as user-provided | pass |
| 8 | Inspect: the selected listing loads in the native browser pane (iframe, own `tv-` session); selecting another listing re-points the same session; back, forward, reload work | pass |
| 9 | Compact viewport (820 px): editor, desk, browser stack top to bottom without overlap; Close browser releases only the owned session; an unrelated session opened by the test is untouched | pass |
| 10 | Route errors: 400/404/415, invalid writes refused | pass |
| 11 | `(ed/unuse travel)` with a browser open: layout, panes, style, iframe and the owned session removed; notebook text identical | pass |

## Bugs found and fixed while finishing the tour
- Host `ask()` could pick a stale (disconnected) view after a layout switch and drop `travel/inspected`; it now skips and disposes disconnected views.
- The `travel/browser` model carries `:inspect` at the top level, but the host polled `state.inspect`, so the address bar never updated after the first load; now reads both, re-targets title/url/link on a new inspect, with a regression test in `package.test.mjs`.
- The public listing view lacked `origin`; now exposed (the tour asserts `user` for manual URLs).
- Test harness: rebuild assets before start (stale `web/pkg` copies produced false failures), port-in-use guard, editor spawned in its own process group and awaited on stop (an orphaned beam VM had served stale notebook text).
- Test fixes without weakening: notebook saved before the page reload; forced search asserted on the actual response (`cache: miss`); route recorder paths made consistent.

## Regressions (logs in `proof/logs/`)
- `travel-unit.log`: package 12 + service 23 = 35 pass (`node --test spikes/travel/test/service.test.mjs spikes/travel/test/package.test.mjs`, run from the repo root; the log is the final run, after the facts fix below).
- `bl-ed.log`: `BLED_OUT=vendor/bl-ed/web/out BLED_ROOT=../beam-lisp node --test vendor/bl-ed/test/*.test.mjs` 73/73.
- `present-check.log`: `node spikes/present/test/check.mjs <7 .bl.org files>`, script unchanged, `:bad []` everywhere.
- `browser-hook.log`: new `spikes/browser/test/routes-hook.test.mjs` (the generic `routes` hook runs after Host/Origin checks, unclaimed paths fall through, foreign Host/Origin never reach it) + `host.test.mjs`, 2/2.

## Supervisor visual review and a late facts fix
The supervisor reviewed screenshots 01, 04, 10 and 13 and passed them: native pane separation, readable comparison, compact browser, clean unuse.
The review also found a mapping problem, fixed afterwards in `service.mjs` `factsOf` (narrow, no UI rewrite):
- **Whole-property use** matched any "private", so a private bathroom showed as whole-property evidence. It now needs explicit wording: entire/whole/full house, home, riad, villa, property...; exclusive/sole use, occupancy, access, hire; buyout; private rental/hire. Private bathroom, pool, parking, terrace, "private villa" and "self-catering" alone no longer count.
- **Access** is relabelled "Access: logistics mentions" (parking, medina, airport, stairs...), and a new separate "Step-free / accessibility" row only fills from step-free, wheelchair, no steps, accessible room/entrance/bathroom, disabled access or mobility wording; otherwise it says unknown.
- Regression: `service.test.mjs` "facts: only explicit whole-property wording counts as private use; generic access mentions are not step-free evidence".
Screenshots 01-13 were taken BEFORE this change and were not re-shot, so 04-compare.png still shows the old row labels. The browser tour was not re-run after the fix; the unit suites above were.

## Limits of this report
Screenshots were produced and size-checked by the tour; this task did not view them (the supervisor review above did), only the DOM geometry and text assertions. Shortlist
persistence is shown across a page reload (tour) and across service instances (`service.test.mjs`); an OS-level host restart is not part of the tour.
The scripted demo research task is offline by design.
