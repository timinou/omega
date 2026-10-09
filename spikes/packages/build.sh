#!/usr/bin/env bash
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd -P)
root=$(cd "$here/../.." && pwd -P)
"$root/bin/bl" js build catalog.main -p "$root/vendor/bl-ed" -p "$here" --host eval-ed,eval-cells --out "$root/vendor/bl-ed/web/out"
mkdir -p "$root/vendor/bl-ed/web/pkg/packages"
cp "$here/host/catalog.mjs" "$root/vendor/bl-ed/web/pkg/packages/"
printf '%s\n' 'export { d_bl_package as package } from "../out/catalog.main.mjs";' 'export { createHost } from "./packages/catalog.mjs";' > "$root/vendor/bl-ed/web/pkg/packages.mjs"
