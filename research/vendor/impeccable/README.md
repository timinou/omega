# Vendored: Impeccable (design skill for coding agents)

| field | value |
|---|---|
| Upstream site | https://impeccable.style |
| Upstream repo | https://github.com/pbakaus/impeccable (author: Paul Bakaus) |
| Commit vendored | `c74755d920985f7a92cef691ca970ba95f90126e` (2026-10-01T00:06:23Z), shallow clone of default branch; `ENGINE_VERSION` 0.1.9, skill `version: 4.4.0` |
| Fetched | 2026-10-01 |
| License | Apache License 2.0 (`LICENSE` here, verbatim; README.upstream.md line 508-510 "Apache 2.0"). `skill/reference/ios.md`/`android.md` (NOT vendored) derive from ehmo/platform-design-skills (MIT), see `NOTICE.md` |

Apache-2.0 obligations if redistributed: keep LICENSE + NOTICE.md, state changes. Files here are **unmodified copies** except the two renamed ones below; the site pages are rendered-text captures, not originals.

## Layout
- `skill/SKILL.md` ← upstream `.agents/skills/impeccable/SKILL.md` (the built skill entrypoint; source is `skill/SKILL.src.md`, a template, so the built file is the readable one).
- `skill/reference/*.md` ← upstream `skill/reference/` (subset: craft-floor, operate, typeset, layout, animate, colorize, clarify, distill, polish, critique, audit, harden, adapt, quieter, bolder, delight, onboard, shape, init, document, extract, routing, new-work, optimize, overdrive). `{{scripts_path}}`/`{{command_prefix}}` are unrendered template placeholders upstream.
- `DESIGN.md.impeccable-own`, `PRODUCT.md.impeccable-own` ← upstream root `DESIGN.md`, `PRODUCT.md` (Impeccable's OWN product/design records; the best worked example of the `PRODUCT.md`/`DESIGN.md` schema). Renamed to avoid being mistaken for omega's.
- `README.upstream.md` ← upstream `README.md`.
- `site/*.md` ← text capture of impeccable.style pages via a reader proxy (jina): `home`, `slop` (full 61-rule anti-pattern catalog), `designing`, `docs`, `docs-detector`, `docs-layout`, `docs-colorize`, `docs-critique`, `live-mode`, `faq`, `research`, `changelog`, `gallery`. Interactive demos are lost; headings/rule names/prose survive.

## What I could / could not get
- Got: everything above. The site is server-rendered enough that text fetch works; the home page testimonials are noise.
- Not vendored (large/irrelevant): the Rust detector crates (`crates/`, `cli/`), browser extension, VS Code ext, `font-index.json`, per-harness build outputs (3296 files in repo), `new-work.md`-adjacent `live*.md`/`generate.md`/`visualize.md`/`hooks.md`/`doctor.md` (web-browser-specific live mode), iOS/Android references.
- Not fetched: individual `docs/<command>` pages other than layout/colorize/critique/detector (the same content is in `skill/reference/<command>.md`); the `/cases/neo-mirai` and `/tutorials/*` pages; per-rule `#rule-*` anchors (all in `site/slop.md`).
- The detector rules themselves (61) are in Rust under `crates/` upstream; only their human-readable catalog (`site/slop.md`) is vendored.
