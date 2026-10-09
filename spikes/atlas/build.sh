#!/usr/bin/env bash
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd -P)
root=$(cd "$here/../.." && pwd -P)
"$root/bin/bl" js build atlas.main -p "$root/vendor/bl-ed" -p "$root/spikes/present" -p "$here" --host eval-ed,eval-cells --out "$root/vendor/bl-ed/web/out"
mkdir -p "$root/vendor/bl-ed/web/pkg/atlas"
cp "$here/host/desk.mjs" "$here/models.mjs" "$root/vendor/bl-ed/web/pkg/atlas/"
printf '%s\n' 'export { d_bl_package as package } from "../out/atlas.main.mjs";' 'export { createHost } from "./atlas/desk.mjs";' > "$root/vendor/bl-ed/web/pkg/atlas.mjs"
