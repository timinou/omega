#!/usr/bin/env bash
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd -P)
root=$(cd "$here/../.." && pwd -P)
"$root/bin/bl" js build travel.main -p "$root/vendor/bl-ed" -p "$here" --host eval-ed,eval-cells --out "$root/vendor/bl-ed/web/out"
mkdir -p "$root/vendor/bl-ed/web/pkg/travel"
cp "$here"/host/*.mjs "$root/vendor/bl-ed/web/pkg/travel/"
printf '%s\n' 'export { d_bl_package as package } from "../out/travel.main.mjs";' 'export { createHost } from "./travel/desk.mjs";' > "$root/vendor/bl-ed/web/pkg/travel.mjs"
