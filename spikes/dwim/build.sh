#!/usr/bin/env bash
# Compile into the real editor's output so every package shares its runtime.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd -P)
root=$(cd "$here/../.." && pwd -P)
"$root/bin/bl" js build dwim.main -p "$root/vendor/bl-ed" -p "$here" \
  --host eval-ed,eval-cells --out "$root/vendor/bl-ed/web/out"
mkdir -p "$root/vendor/bl-ed/web/pkg"
printf '%s\n' '// DWIM policy, compiled beside the editor: spikes/dwim/build.sh' \
  'export { d_bl_package as package } from "../out/dwim.main.mjs";' \
  > "$root/vendor/bl-ed/web/pkg/dwim.mjs"

