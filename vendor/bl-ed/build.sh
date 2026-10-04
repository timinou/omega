#!/usr/bin/env bash
# vendor/bl-ed/build.sh — compile the vendored editor (Beam Lisp) to ES modules for the page.
#   vendor/bl-ed/build.sh   → vendor/bl-ed/web/out/
# Built by beam-lisp MAIN, not omega's pin: the pin lacks js.eval, system.place
# and bl.doc.spans (see VENDOR.md). BL_TREE = that checkout (default: the
# sibling beam-lisp main worktree). ONE output directory, so the editor and Beam
# Lisp itself (reader + compiler + emitter + eval, for `:`) share one runtime.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd -P)
tree=${BL_TREE:-$(cd "$here/../../../beam-lisp" && pwd -P)}
out="$here/web/out"
cd "$tree"
${RUN:-} bin/bl js build js.eval -p priv/lib -p priv/boot --stub lower --with reader --host run --out "$out"
${RUN:-} bin/bl js build ed.main -p "$here" --host eval-ed,eval-cells --out "$out"
# the language's own macros, read by the page at start (boot.mjs)
mkdir -p "$out/src/priv/boot"
cp priv/boot/core.bl priv/boot/sugar.bl "$out/src/priv/boot/"
