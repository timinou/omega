# omega

Omega is a coding harness and shared Lisp workbench built on Beam Lisp.
Prompts are tasks: humans and agents coordinate through a shared fact log,
messages, traces and editable documents. The desktop, browser and Pocket views
connect to the same host. PELAGIC adds an audiovisual studio as an editor package.

This is an experimental project. Runnable packages and exploratory work remain
under `spikes/`; each package's literate notes describe its status and evidence.

## License

Copyright (C) 2026 Othman Benkiran.

Omega is free software: you can redistribute it and/or modify it under the
terms of the GNU General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later version.

Omega is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE. See [LICENSE](LICENSE) for the full terms.

This applies to author-owned material throughout the repository, including the
vendored bl-ed and browser port relicensed by their copyright holder. Third-party
material retains its own terms; see [THIRD_PARTY.md](THIRD_PARTY.md).

## Requirements

Install the [Beam Lisp](https://github.com/timinou/beam-lisp) launcher at
`~/.local/bin/bl`, following its upstream setup instructions. `bin/bl` resolves
and builds the commit pinned by `env.bl`; the first uncached setup can take tens
of minutes. Use the platform prerequisites documented by Beam Lisp for its
runtime and optional native WebView. Python 3 is required for the shell client
and release packaging; Node.js is needed for JavaScript tests.

An explicit `OMEGA_BL=/absolute/path/to/beam-lisp/bin/bl` override runs that
checkout instead of resolving the normal pin. Keep it at the `env.bl` revision
when checking a release. Optional native-browser and Android builds have their
own prerequisites in their respective guides.

## Try it offline

From the repository root:

```sh
bin/bl run omega.bl.md                 # scripted task playground
bin/bl run docs/domain-model.bl.md     # executable model and invariants
bin/bl --cold test                     # offline unit suite; no frontend build required
bin/bl omega.build                     # compile the shared package frontend
bin/bl-ed --offline --memory --port 8792 --root /tmp/omega-demo
```

Open the printed editor URL. The isolated editor above uses a disposable,
in-memory world. Use an unused port and a temporary root for testing.

The shared development host defaults to port 8812. Its presets include:

```sh
bin/bl pocket                         # scripted Pocket workbench
bin/bl home.dev                       # scripted Home prototype
bin/bl pelagic.dev                    # scripted audiovisual studio
bin/bl runtime.dev                    # scripted runtime observatory
```

Compatible launches reuse the host and compiled frontend. Task options follow
`--`, for example `bin/bl pocket -- --port 8820`. Stop the shared world with
`bin/bl omega.stop` before changing its live/offline mode or backend sources.
Closing a browser tab or native window does not stop the shared world.

## Live work and shell commands

Copy `.env.example` to `.env` in this repository and configure the model endpoint
and key. The example selects the direct Anthropic API. Without an override,
Omega uses the local proxy at `http://localhost:8080`. Optional Jev integrations
use `TYPESAFE_API_KEY`. Credentials come from Omega's home, not an attached project.
`OMEGA_MAX_TOKENS` controls the reply limit (default 8000, range 1–128000).

```sh
bin/bl omega -- --browser              # live Home; omit --browser for a native window
bin/bl omega -- --demo --browser --port 8820  # scripted Home on a separate host
bin/omega --help
bin/omega "add a test for X and run it"
bin/omega list
bin/omega read task:t-1
bin/omega say t-1 "continue with the smaller change"
bin/omega answer MESSAGE_ID "yes"
```

`bin/omega` is a Python client for the shared host, not a separate task executor.
From another directory, use its absolute path; the caller's directory becomes
the task's working place. It starts the default host if absent. `--no-start`
requires an existing host; `--url` selects one explicitly; `--offline` requires a
scripted host; `--json` prints structured results. See `--help` for all commands.

`bin/omega-ui` opens the shared Pocket preset (live by default, `--demo` for
scripted work). `bin/bl-ed` opens the package catalog on the live shared host;
its explicit `--offline`/`--memory` mode is the isolated foreground editor.

Live shared-host tasks, turns, messages and traces are stored in this
repository's `.omega/db`, unless `--db` selects another store. Attached folders
provide working places; they do not each own a separate host database. Scripted
hosts use memory unless given `--db`. Keep `.omega/` ignored. Interrupted work
is recovered without replaying unknown tool effects.

## Packages and experiments

The package catalog is at `http://localhost:8812/?use=packages&file=package:catalog`.
Packages load through `?use=<name>` or `:(ed/use "<name>")`; `:(ed/unuse "<name>")`
removes their session behavior. Tasks can live in `#+begin_task` document blocks.

```sh
bin/bl pelagic.local                  # standalone demo, default port 8818
bin/bl pelagic.bundle                 # generated ZIP under spikes/pelagic/dist/
```

See the [PELAGIC launch guide](spikes/pelagic/session-launch.bl.md),
[Home notes](spikes/home/home.bl.md), [Pocket notes](spikes/mobile/mobile.bl.md),
and [spike index](spikes/README.md). The
[Android release notes](spikes/mobile/proof/android-standalone/README.org)
describe the optional signed Pocket APK. Its builder is selected separately with
`BEAM_LISP_MOBILE_BIN`; use the recorded builder revision when reproducing it.

## Layout

| Path | Purpose |
|---|---|
| `src/omega/` | Task model, actors, tools, model transport, host services and document providers |
| `bin/` | Pinned BL wrapper, shared-host shell client, editor/UI launchers and legacy headless probe |
| `scripts/` | Desktop/client entrypoints, evidence viewer and release packaging |
| `packages/*.edn` | Package declarations, frontend assembly and backend capabilities |
| `spikes/` | Runnable packages, prototypes and standalone experiments; code stays with its literate notes |
| `vendor/` | Editor and optional native browser port, with provenance and license records |
| `test/` | Offline core tests, fixtures and the legacy headless UI scenarios |
| `docs/`, `research/` | Executable model, domain decisions and reference material |
| `!tasks/` | Development plans, issues and milestone reports |
| `spikes/*/proof/` | Recorded package contracts, screenshots, logs and captures |

## Checks and publication

Run `bin/bl --cold test` for the core suite. Package-specific drive, browser and
presentation checks are documented with each spike. JavaScript editor tests need
a compiled frontend and the matching Beam Lisp corpus; historical recordings do
not substitute for a current test run. Never test by writing to a running user
world; use the isolated command above.

[Release instructions](docs/releasing.md) cover paired source/evidence archives,
checksums, retained proof paths and optional demo/APK publication. Generated
archives, compiler output, credentials and local agent memory are ignored.

## Known beam-lisp gotchas (observed on main, 2026-10-01)

- Call arguments evaluate **right-to-left**: never sequence effects by argument position.
- `:true` / `:false` read as booleans. Use string keys.
- Not in core: `ffirst`, `take-last`, `false?`, `read-string` (data), `requiring-resolve`, `#'ns/private-var`.
- **Never name a public fn after a core fn** (`run!`, `count`, …): a qualified call runs CORE on the first, cold call (filed upstream as beam-lisp BUG-109). omega's `run!` became `turn!`.
- `json/encode` refuses vectors (tuples), so use `omega.llm/jsonable`.
- `(range a b step)` and `vector` are missing; `erlang/whereis` returns `:undefined`; `re-find`/`re-seq`
  resolve only in some load contexts (use `Regex/run`/`Regex/scan`). A top-level `swap!` into a registry
  may not have run when another ns calls in (demand loading): keep registries as fns returning literals.
- live.diff honours `:key` only when every sibling is keyed (BUG-110): key whole lists, empty groups included.
- wry: one window per VM, and GTK binds `WAYLAND_DISPLAY` at the first window.
- Datom: a transaction map needs `:db/id`; a lookup-ref is not accepted as a ref value
  (resolve it first); negation is `[:not …]` / `missing?`.
