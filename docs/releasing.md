# Publishing Omega

Release from a committed revision. Source remains in its current layout,
including `spikes/`; experiments retain their documented status. The root
`LICENSE` declares GPL-3.0-or-later for author-owned material and
`THIRD_PARTY.md` records exceptions and provenance.

## Check the revision

```sh
bin/bl --cold test
git diff --check
git status --short
```

The core suite runs offline without a frontend build. For an editor/demo
release, also build with `bin/bl omega.build`, then run the package drive tests,
vendored-editor checks and unchanged presentation equivalence check documented
in the relevant spike. Record the tested revision and results with its proof.
Native browser and Android releases require their separate platform checks.
Use offline, in-memory worlds under `/tmp` on unused ports, never the user's
running world.

## Source and evidence archives

```sh
python3 scripts/release.py
# Or select a committed release explicitly:
python3 scripts/release.py --revision HEAD --output /tmp/omega-release
```

The script reads Git objects, not working files or ignored artifacts. It writes
three files under ignored `dist/releases/` by default:

- `omega-<commit>-source.tar.gz`: source, tests, package assets and license notices.
- `omega-<commit>-evidence.tar.gz`: recorded `spikes/*/proof/` material and
  `!tasks/reports/`, plus the license, notices and release documentation.
- `omega-<commit>-manifest.json`: full commit ID, archive sizes and SHA-256 hashes.

The source archive uses `.gitattributes` to omit supplemental evidence and local
tooling metadata. The evidence archive preserves original paths. Extract both
archives into the same directory to restore all screenshot/report links and
the recorded inputs needed by evidence viewers and historical analysis tools.
Ordinary unit tests need only the source archive. Package code and experiments
are never moved or deleted by packaging. Archive bytes are reproducible for the
same revision and Python/zlib toolchain.

Proof remains tracked in Git so literate package contracts retain their images,
used/unuse evidence and test receipts. Historical duplicate captures are kept
in that record rather than rewritten during publication cleanup. A pre-GPL
snapshot is retained at `archive/pre-gpl-publication-2026-10-15`, including the
local agent-memory files removed from current tracking. Those files stay local
and ignored; they are not part of the public source/evidence archives.

Publish the matching archives and manifest together after reviewing their
contents. This command only creates local files; it does not upload or publish.
Review externally sourced captures against `THIRD_PARTY.md` before distributing
an evidence archive. Neither public availability nor the root GPL declaration
relicenses external material.

## Compiled demos and Android

`bin/bl pelagic.bundle` creates the optional standalone demo ZIP. The Android
procedure is documented in `spikes/mobile/proof/android-standalone/README.org`.
That procedure selects its builder independently with `BEAM_LISP_MOBILE_BIN`;
record the exact builder commit in addition to `env.bl` and `bl.lock` inputs.

When publishing binaries, accompany them with `LICENSE`, `THIRD_PARTY.md`, the
licenses of bundled dependencies/runtime code, and matching source/build
instructions. Keep signing keys, passwords, model credentials, browser profiles
and databases private. APKs, demo ZIPs and frontend caches are generated release
outputs, not source files to commit.
