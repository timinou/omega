#!/usr/bin/env bash
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd -P)
root=$(cd "$here/../.." && pwd -P)
"$root/bin/bl" js build pq.main -p "$root/vendor/bl-ed" -p "$root/spikes/present" -p "$root/spikes/browser" -p "$here" --host eval-ed,eval-cells --out "$root/vendor/bl-ed/web/out"
mkdir -p "$root/vendor/bl-ed/web/pkg"
printf '%s\n' 'export { d_bl_package as package } from "../out/pq.main.mjs";' > "$root/vendor/bl-ed/web/pkg/procurement.mjs"
