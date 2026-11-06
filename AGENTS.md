# omega — agent rules

## Spikes that touch the editor are bl-ed packages

Any spike under `spikes/` that changes what bl-ed draws or does MUST be written as a bl-ed
package. Contract and rationale: `research/domain/interface/packages.bl.md`.

- **Export one value:** `(def bl-package {:name … :doc … :commands :keys :intercept :on-event
  :adopt :render :provides})`, as plain maps and fns. Not `package` (a reserved word in JS).
  Build-time `defmacro` is supported by the pinned compiler; macro sugar must expand to these
  same values, not establish another package/reader implementation. Macro helpers must be
  statically referenced top-level `defn`/`defn-`; imported templates must fully qualify inner
  macro names. Do not rely on application top-level initialization during a JS build.
- **Layers, never merges:** never write into `:user-commands` / `:user-keys`, never mutate shared
  tables. Per-editor state goes under `(:pkg-state ed)` by name; editor keys `:adopt` sets go in
  `:owns`. `:(ed/unuse "<name>")` must leave the editor, and every pane, exactly as before.
- **Screens are layouts:** several panes = a `:provides {:layouts …}` value for `ed/frame.bl`
  (`research/domain/interface/frames.bl.md`); never a page of your own.
- **Pure:** functions of `ed` and events only; IO goes out as effects for the host.
- **Generic below, domain above:** `vendor/bl-ed/ed/*` knows nothing about omega.
- **Loads into the real editor:** compile into `vendor/bl-ed/web/out` and a loader at
  `web/pkg/<name>.mjs`, so `bin/bl-ed` serves it with `?use=<name>` / `:(ed/use "<name>")`. A
  spike's own page, if any, must `pkg/use` the SAME value; no private render loop.
- **Proof, in the spike's `.bl.md`:**
  - screenshots of the real bl-ed with the package used and after `unuse`;
  - a drive test of its contract;
  - `vendor/bl-ed` drive tests green;
  - the default-presentation equivalence check (`spikes/present/test/check.mjs`) unchanged.
- Vendored-editor changes go in `vendor/bl-ed/VENDOR.md`.

## Writing to live worlds

Never write to the user's running world (port 8790) to test. Use an offline one:
`bin/bl-ed --offline --memory --port 8792 --root /tmp/x`.

## Building and releasing

Build steps are Nix derivations, and Nix runs them on the Build host. The
compiled frontend is the flake output `.#frontend`: the same
`pelagic.build/frontend-into!` the development cache uses, compiled by the drop of
env.bl's `:bl` pin. Change `flake.nix`'s beam-lisp rev together with that pin.

- Remote builds are mandatory: pass `--max-jobs 0` to Nix build/realise commands.
  Use `bin/omega-build` for frontend and prototype builds. Do not rely solely on
  a user configuration or permit fallback to a local Work build.

- Prepare without changing the live frontend: `bin/omega-frontend --prepare`.
  It keeps the candidate GC root and records its backend checkout under
  `~/.local/state/omega/`.
- Live account host: pair the backend launcher checkout and compiler pin with
  the frontend before cutover. `bin/omega-frontend` builds `.#frontend`, keeps
  its GC root in `~/.local/state/omega/frontend`, and writes
  `~/.config/omega/frontend.path`; it does not change the backend launcher.
  Restart only after that pairing is correct. The installed `omega-host` may
  still point at `/home/othman/projects/omega`; a frontend build alone does not
  move it to this checkout. Never compile the live frontend on Work.
- Secrets never enter a derivation (the store is world-readable). Pocket's APK is
  signed on Work after the build by `spikes/mobile/android/app_update.py`, with the
  key in `~/.local/share/omega-pocket/signing` (0700).

## Harness work: Beam Lisp first

An Omega task's eval runs inside the Omega VM. Prefer structured Beam Lisp
(data in/data out, one program per round trip) over shell pipelines; use `(sh …)`
for git, Nix and one-liners. Reusable introspection helpers live in `tools/`;
see `tools/README.md` for loading and the measured memory findings.
