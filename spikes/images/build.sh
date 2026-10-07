#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd -P)
if [ ! -f "$root/vendor/bl-ed/web/out/repl.mjs" ] || [ ! -f "$root/vendor/bl-ed/web/out/ed.frame.mjs" ]; then
  "$root/bin/bl-ed" build
fi
"$root/bin/bl" js build img.main -p "$root/vendor/bl-ed" -p "$root/spikes/present" -p "$root/spikes/images" --host eval-ed,eval-cells --out "$root/vendor/bl-ed/web/out"
mkdir -p "$root/vendor/bl-ed/web/pkg"
printf '%s\n' 'export { d_bl_package as package } from "../out/img.main.mjs";' > "$root/vendor/bl-ed/web/pkg/images.mjs"
