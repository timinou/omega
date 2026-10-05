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
