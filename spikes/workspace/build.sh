#!/usr/bin/env bash
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd -P)
root=$(cd "$here/../.." && pwd -P)
"$root/bin/bl" js build ed.frame -p "$root/vendor/bl-ed" \
  --host eval-ed,eval-cells --out "$root/vendor/bl-ed/web/out"
"$root/bin/bl" js build ws.main -p "$root/vendor/bl-ed" -p "$here" \
  --host eval-ed,eval-cells --out "$root/vendor/bl-ed/web/out"
mkdir -p "$root/vendor/bl-ed/web/pkg"
printf '%s\n' '// Workspace slice: spikes/workspace/build.sh' \
  'export { d_bl_package as package } from "../out/ws.main.mjs";' \
  > "$root/vendor/bl-ed/web/pkg/workspace.mjs"
