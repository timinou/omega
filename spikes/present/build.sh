#!/usr/bin/env bash
# spikes/present/build.sh — compile the presentation spike (pp.*) with the
# vendored editor (ed.*) to ES modules, beside the page's language runtime.
#   spikes/present/build.sh          → spikes/present/web/out/ (the spike's pages)
#   spikes/present/build.sh pkg      → also a package in vendor/bl-ed/web (?use=present)
# Needs vendor/bl-ed/web/out (bin/bl-ed build) for the in-page language
# (repl.mjs, boot.mjs …), copied, not rebuilt.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd -P)
root=$(cd "$here/../.." && pwd -P)
out="$here/web/out"
mkdir -p "$out"
cp -r "$root/vendor/bl-ed/web/out/." "$out/"
"$root/bin/bl" js build pp.main -p "$root/vendor/bl-ed" -p "$here" --host eval-ed,eval-cells --out "$out"
"$root/bin/bl" js build pp.check -p "$root/vendor/bl-ed" -p "$here" --host eval-ed,eval-cells --out "$out"
# --- as a package of the vendored bl-ed (ed/pkg.bl) -------------------------
# Compiled INTO the page's own out/ (modules import siblings by relative path,
# so pp.* shares the page's single ed.* instance), plus a two-line loader at
# web/pkg/present.mjs. Then: http://…/?use=present, or :(ed/use "present").
if [ "${1:-}" = pkg ] || [ "${1:-}" = all ]; then
  vout="$root/vendor/bl-ed/web/out"
  "$root/bin/bl" js build pp.main -p "$root/vendor/bl-ed" -p "$here" --host eval-ed,eval-cells --out "$vout"
  mkdir -p "$root/vendor/bl-ed/web/pkg"
  printf '%s\n' '// the presentation spike as a bl-ed package (spikes/present/build.sh pkg)' \
    'export { d_bl_package as package } from "../out/pp.main.mjs";' > "$root/vendor/bl-ed/web/pkg/present.mjs"
fi
