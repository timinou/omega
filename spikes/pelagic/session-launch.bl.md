# Open PELAGIC as an Omega session

From the Omega repository root:

```sh
bl pelagic.dev
```

Open the printed studio link and click **PERFORM**. By default this starts an
offline, in-memory Omega development world on port 8812. The source documents
are under the repository root. `bl pelagic.dev -- --port 8820` selects another host; `-- --live`
selects normal model configuration and durable world storage. Ctrl+C stops a
host you started. Running the same command while a compatible host is up prints
the link and exits; it does not start another world.

Task options go after `--`, so the BL launcher leaves them for the task.

Open that link in two tabs for two independent editor sessions. PELAGIC loads
through the ordinary `bl-package` contract. Each session owns its editor state,
audio context, render worker and preparation jobs. `:(ed/unuse "pelagic")`
releases those resources in that session. Other sessions continue playing.
Browser module imports reuse one module instance within a realm; separate tabs
remain separate realms. This does not share an AudioContext between tabs.

For a plain editor session on the same host, open `http://localhost:8812/`.
For the package catalog, open `http://localhost:8812/?file=package:catalog&use=packages`.
The shared frontend includes the packages selected by `package-manifests` in
`pelagic/build.bl`, with their declarations in the root `packages/` directory.
Some standalone experiments still use their own documented build commands.

## One compilation, separate launch and export

Root `env.bl` declares task names and their BL entry files. It also selects the
single compiler pin for the shared frontend (see `:bl` in root `env.bl`). There is no compiler build per package:
the launcher resolves the pinned compiler once and reuses its cached image.
A first uncached compiler setup can take tens of minutes.

[build.bl](pelagic/build.bl) owns the frontend build:

1. Hash BL inputs and compiler identity (including compiler sources for checkout overrides). Reuse a checked graph under
   `dist/graph/<hash>/`, or call `bl.js/build!` and the canonical actor linker.
2. Hash the complete frontend inputs. Stage modules, host JavaScript, CSS,
   shaders, example documents and tutorials into `dist/frontend/<hash>/`.
   Asset-only changes reuse the compiled graph.
3. Check cached output against its recorded SHA256 inventory before reuse.
   Source contents matter; timestamps do not. Generations have separate paths,
   so a new build does not overwrite an older host's frontend.

`bl pelagic.build` performs those steps without starting a host or exporting a
ZIP. `bl pelagic.dev` then gives the frontend directory directly to
`omega.ed.main/start!`. No installation copy into the vendored editor is needed.
The old JavaScript staging/installation implementation has been removed.
`spikes/pelagic/build.sh` remains a compatibility command for frontend compilation,
but no longer installs files into `vendor/bl-ed/web`.

[launch.bl](pelagic/launch.bl) checks an existing host with one read-only document
request. Its dynamic identity covers the repository/document root, frontend,
backend sources and offline/live mode. A matching host is reused. An occupied
port with a different identity is rejected; use another port or stop your older
host. No activation or task mutation is sent during this check. With the shared
launcher, `bin/bl omega.stop` stops the world; closing its client window does not.

## Optional standalone demos

```sh
bl pelagic.local                 # default port 8818
bl pelagic.local -- --port 8820
bl pelagic.bundle                # dist/pelagic-local.zip
```

The local target copies the same frontend and adds the IndexedDB document
adapter and generated offline cache. It includes the showcase tutorials. The
local launcher serves it without starting an Omega task world. Only `bundle`
adds the ZIP, which can be served by any static HTTP server without BL or BEAM.

## What remains

The cache currently recompiles the BL graph when any BL build input changes;
module-level incremental compilation belongs in upstream `bl.js`. Concurrent
cold builds also need upstream process-wide build coordination. `bl omega.watch`
prepares immutable candidates for explicit session reload; backend changes still
require restarting the realm.

Root package declarations supply frontend entries and assets to the shared graph.
Existing experiment-specific shell builds have not all been migrated. Reuse must
preserve explicit resource ownership and cancellation; package loading must not
imply a new realm.

## Verification

The [proof directory](proof/session-launch/) records:

- Omega: 23 test files; headless UI: 9 scenarios; PELAGIC: 61 checks;
  catalog: 6; editor: 75; launch helpers: 3 tests / 15 assertions.
- Presentation: 12 variants, zero differences.
- Real server-backed sessions with non-silent audio, isolated unload, explicit
  package loading, and catalog load/open without world activation.
- Compatible host reuse, mode/listener conflict rejection, standalone server
  reuse, unchanged vendored output, and local Play/Perform with both graphics modes.
- Complete local asset hashes and ZIP integrity.

[Cache measurements](proof/session-launch/cache.json) from the final run:
305 ms for an unchanged frontend check within the same VM; 2.10 s to stage an
asset-only generation while reusing the BL graph. The complete root command to
reuse an existing host took [6.98 s](proof/session-launch/cli.json), including
BL startup and initial compiler/source checks. These are individual samples,
not latency guarantees. Warm CLI task dispatch is a useful next optimization.

[Used editor](proof/session-launch/used.png),
[after unuse](proof/session-launch/unused.png),
[package catalog](proof/session-launch/catalog.png),
[after catalog unuse](proof/session-launch/catalog-unused.png).


`bl omega.watch` builds validated immutable candidates and prints a generation
URL for explicit session navigation. Asset edits reuse both checked modules and
preparation actors. `bl omega.watch.stop` preserves the host and admitted tabs.
Backend, root manifest or build-tool edits require restarting the project realm;
the watcher preserves the working frontend rather than claiming those sources
are already running. See [ownership, routes and artifact lifetime](../../research/shared-development.bl.org).
