#!/usr/bin/env bash
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd -P)
repo=$(cd "$here/../.." && pwd -P)
if [ "${1:-}" != --package-only ]; then
  "$repo/spikes/workspace/build.sh"
  "$repo/spikes/present/build.sh" pkg
  "$repo/spikes/dwim/build.sh"
fi
"$repo/bin/bl" js build mob.main -p "$repo/vendor/bl-ed" -p "$repo/spikes/workspace" -p "$here" --host eval-ed,eval-cells --out "$repo/vendor/bl-ed/web/out"
mkdir -p "$repo/vendor/bl-ed/web/pkg/mobile"
cp "$here/host/"* "$repo/vendor/bl-ed/web/pkg/mobile/"
printf '%s\n' 'export { d_bl_package as package } from "../out/mob.main.mjs";' 'export { createHost } from "./mobile/host.mjs";' > "$repo/vendor/bl-ed/web/pkg/mobile.mjs"
