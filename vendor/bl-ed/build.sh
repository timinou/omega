#!/usr/bin/env bash
# vendor/bl-ed/build.sh — compile the vendored editor (Beam Lisp) to ES modules for the page.
#   vendor/bl-ed/build.sh   → vendor/bl-ed/web/out/
# Compiled by omega's PINNED bl (bin/bl). The in-page language (js.eval: reader,
# compiler, emitter, the boot macros) is compiled from beam-lisp SOURCE paths,
# so it needs a checkout of the pinned commit: BL_TREE (default: the sibling
# beam-lisp main worktree), refused unless its HEAD is the pin. ONE output
# directory, so the editor and the language share one runtime (rt.mjs, core.mjs).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd -P)
root=$(cd "$here/../.." && pwd -P)
tree=${BL_TREE:-$(cd "$root/../beam-lisp" && pwd -P)}
pin=$(sed -n 's/^ *:bl "commit:\(.*\)".*/\1/p' "$root/env.bl")
head=$(git -C "$tree" rev-parse HEAD)
case "$head" in
  "$pin"*) ;;
  *) echo "build.sh: $tree is at ${head:0:8}, omega pins $pin — check out the pin (or set BL_TREE)" >&2; exit 2 ;;
esac
out="$here/web/out"
${RUN:-} "$root/bin/bl" js build js.eval -p "$tree/priv/lib" -p "$tree/priv/boot" --stub lower --with reader --host run --out "$out"
${RUN:-} "$root/bin/bl" js build ed.main -p "$here" --host eval-ed,eval-cells --out "$out"
# the language's own macros, read by the page at start (boot.mjs)
mkdir -p "$out/src/priv/boot"
cp "$tree/priv/boot/core.bl" "$tree/priv/boot/sugar.bl" "$out/src/priv/boot/"
