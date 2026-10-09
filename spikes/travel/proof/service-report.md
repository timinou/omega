# Travel listing service: phase report

Files: `spikes/travel/service.mjs` (service, ESM, no deps), `spikes/travel/test/service.test.mjs`,
`spikes/travel/live-seed.mjs` (live discovery + refresh -> `data/seed.json`). No UI, no contact/booking, port 8790 untouched.

## What exists
- `TravelService` (persisted to `<dataDir>/state.json`, atomic write; falls back to `data/seed.json` when the world is empty): `getTrip/setTrip`, `discover`, `addCandidate`, `refresh(id)`, `refreshAll`, `addManualEvidence`, `addNote`, `setShortlist`, `setKind`, `list`, `compare`, `snapshot`, `exportSeed`. `searchFn` and `fetchFn` are injectable.
- Trip defaults: Essaouira, 2026-12-19, 4 or 5 nights, 11 adults + 9 children = 20, unlimited budget, one editable group with `childAges: []` (never invented). `validateTrip` checks real dates, sums, group totals, child ages, budget.
- Discovery: `runSearchCli` spawns `bin/bl run spikes/travel/search-cli.bl -- <json>` with argv (`shell:false`), takes the `@@RESULT@@` line out of mixed stdout. The model `answer` is kept separate (`modelAnswer.synthesized`) and is not stored as evidence. Candidates are only search citations. Query cache with TTL, inflight dedup and a concurrency limiter (`CachedCall`, `Limiter`); failures are not cached.
- Refresh: bounded-concurrency fetch with timeout, manual redirect following (http(s) only), conditional `If-None-Match`/`If-Modified-Since`, per-listing TTL and inflight dedup. It records status, reason, title, final URL, check time, SHA-256 of extracted text, a clipped text excerpt (default 6000 chars, live seed 2500) and capacity claims. Full HTML is never stored.
- Statuses: `ok` (link reachable, page read), `not-modified`, `blocked` (401/403/429, bot-challenge page, unsafe/looping/too many redirects), `not-found`, `server-error`, `unknown` (transport failure/timeout), `unchecked`. Each has a human label. Every listing view says availability and price are `unknown` (not verified): a reachable link is not availability.
- Capacity: only claims with a quoted excerpt. Header-region claims are preferred over later related-listing text. An `N guests (M max)` pattern gives base N plus a flagged extra-bed max (-> `unknown`, verify). Below 20 -> `below` / `unsuitable`; no evidence -> `unknown` ("Capacity unverified"). Manual evidence (value + excerpt) takes precedence. Collection pages never yield a capacity.
- Classification: `property` / `collection` / `excluded` with a reason (exa.ai library pages and for-sale listings are excluded). Users can override with `setKind`.
- Ranking: `rankListings` (decorate-sort, 20k listings < 1s in test), `compareListings`.
- `safeUrl`: http(s) only, no credentials, no localhost/private hosts.

## Tests
`node --test spikes/travel/test/service.test.mjs` -> 23 pass, 0 fail (35 with the 12 package tests: `node --test spikes/travel/test/service.test.mjs spikes/travel/test/package.test.mjs`). They cover trip validation, URL safety, the bridge parser and spawn argv, cache TTL/dedup/concurrency, failed-vs-blocked-vs-unknown sources, redirects and conditional headers, capacity evidence rules, persistence across instances, manual evidence/notes/shortlist, and ranking.

## Live result (OpenRouter via bridge, 2 queries, then real fetches of 16 URLs)
`data/seed.json` (~70 KB, clipped text only). Results vary run to run. The last run:
- Reachable pages with a quoted capacity >= 20 (stated capacity only, availability unknown):
  Villa Sultana (livingessaouira.com, "50 Guests"), Villa Granvia (vitabrevis.travel, claim 30 comes from a "(32 max)" / dining-room text and needs a human read), Bellavista Essaouira-area villa for 22, Dar Algie (villa-essaouira.com, 22 guests, 11 bedrooms), villas-bookings single property 1880 ("Sleeps 22"), Bellavista Mirleft villa for 20 (Mirleft is far from Essaouira town).
- Dar El Salam: 18 guests (21 max): shown as unknown/verify, not as meets.
- Below 20 (unsuitable): bookabach 16, Riad Caletino 10, a Vrbo riad 10.
- Blocked (HTTP 403, so capacity not checked): rentbyowner "Entire Riad of 7 Suites (19pers)" (this snippet says 19 persons / 21 guests, unconfirmed), fvrentals Riad Lailouza, a rentbyowner 6-8 person riad, bedroomvillas Riad Bacha Mogador.
- booking.com Villa Al Jaouhara: reachable but the page is a JS shell with almost no text, so capacity is unknown (the search title said "20 Guests"; unverified).
- Collections kept separate (no capacity): Villanovo 20-24-persons filter page, cozycozy.com.
- Excluded: exa.ai library page.

## Honest caveats
- No confirmed whole-medina-riad for 20 was found; the confirmed >=20 listings are mostly villas/estates, some outside the medina or the town. Location checks are manual.
- Capacity extraction is regex-based, so excerpts must be human-reviewed. Dates, price and house rules (groups, children) are never inferred.
- The extractor can pick up secondary numbers (for example a dining room for 28).
- Two parallel live searches can fail in the bridge (exit 1 with no result line, seen once); the live script runs searches serially.
- `live-seed.mjs` writes only to a temp world dir and `data/seed.json`.
