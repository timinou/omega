# Travel desk: Essaouira group stay (draft planning only)

A bl-ed package (`spikes/travel/travel/main.bl`) that turns a `#+TRAVEL:` notebook into an editable notebook beside a host-drawn desk
for finding a place to sleep 20 people (11 adults + 9 children) in Essaouira, Morocco, check-in 2026-12-19, 4 or 5 nights,
budget unlimited. It never contacts owners, books or pays, and it never claims availability.

## Run
```sh
spikes/travel/run.sh        # builds the package, starts an isolated offline bl-ed (8841) and the desk host (8842); never 8790
```
Usable URL: http://127.0.0.1:8842/?file=trip.bl.org&use=travel  (override with TRAVEL_PORT, TRAVEL_EDITOR_PORT).
Search needs the OpenRouter key that `bin/bl` already uses; page reads are public HTTP(S) only.
Tests: `node --test spikes/travel/test/package.test.mjs spikes/travel/test/service.test.mjs`, then the browser tour
`node spikes/travel/test/browser.mjs` (TRAVEL_LIVE_SEARCH=0 skips only the live search; ports 18841/18842; the harness rebuilds assets).

## Contract
- Package: plain maps/fns (doc commands keys intercept adopt owns provides); adopts only documents with `#+TRAVEL:`; layouts
  `travel` (notebook + desk), `travel-inspect` (+ real browser pane), `travel-research` (+ Omega task pane); views `travel/desk` and
  `travel/browser`. The browser view model carries `:inspect` {session listing url title} at the top level.
  Package state (tab, selection, compare set, inspect) lives under `:pkg-state` key travel; `ed/unuse` removes all of it.
- Host (`host/*.mjs`, copied to `vendor/bl-ed/web/pkg/travel/` by `build.sh`): draws the desk into the frame pane, all I/O through
  `/travel/api/*`. The browser pane is the native browser panel (`/browser/view/<session>`), not a private page.
- Service (`service.mjs`, `routes.mjs`): `TravelService` persists trip, listings, shortlist, notes, checklist, manual evidence. Routes plug into
  `spikes/browser/serve.mjs` through its generic `routes` option (runs after Host/Origin checks). Owned `tv-` browser sessions are created,
  navigated and closed only for the desk that asked.
- Evidence rules: capacity is shown only with a quoted excerpt; collections and excluded pages never give a capacity; availability and price are always
  not verified; page read means only that the link works.

## Proof
`spikes/travel/proof/ui-report.md` (results, fixes, regression logs), `proof/browser.json`, `proof/screens/`:
01 editor + desk, 02 after live search, 03 details/refresh, 04 compare, 05 notes/checklist, 06 trip validation, 07 manual URL + evidence,
08 embedded listing, 09 embedded navigation, 10 compact inspect, 11 compact desk, 12/13 before/after unuse. `proof/service-report.md` has the service-side live results.

## Actual limitations (as found)
- No confirmed 20-guest medina riad was found. Candidates that state 20+ capacity are mostly villas outside the medina (Villa Sultana, Dar Algie, Bellavista villas; Bellavista Mirleft is outside the target area); riads seen were below 20 (Riad Caletino 10) or blocked/unverified (a 7-suite rentbyowner riad quoting 19 persons returned HTTP 403).
- Availability for 2026-12-19 and price are unknown for every candidate; stated capacity is the page's claim, not a confirmation.
- Some sites block automated reads (403/bot challenge) or are JS shells; those show as blocked/unknown, never as meeting.
- The research button in the offline launcher runs a scripted demo task (labelled in the UI); search and listing reads are real.
- No owner was contacted and nothing was booked.
- Persistence is shown across page reload and service instances, not an OS-level host restart. Screenshots 01, 04, 10 and 13 were reviewed and passed by the supervisor (see `proof/ui-report.md`); they predate the later facts-label fix, which is unit-tested but not re-shot.
- Harness fixes made while building this are in `proof/harness-report.md`. Set `OMEGA_MAX_TOKENS=32000` in omega's `.env` for large construction replies.

## Provenance
Built by Omega tasks (service, package + host + launcher, then this UI-test finishing task) in this repository; the final tour, regression logs and
this document come from the finishing task. Unrelated dirty files (present, vendor/bl-ed core/host) were left as found.
