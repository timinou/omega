#!/usr/bin/env bash
# Compile the guideline explorer into the real editor's output (shared runtime) and
# install its loader + host modules: bin/bl-ed serves it with ?use=guidelines.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd -P)
root=$(cd "$here/../.." && pwd -P)
"$root/bin/bl" js build guidelines.pkg -p "$root/vendor/bl-ed" -p "$here" \
  --host eval-ed,eval-cells --out "$root/vendor/bl-ed/web/out"
mkdir -p "$root/vendor/bl-ed/web/pkg/guidelines"
cp "$here"/host/*.mjs "$root/vendor/bl-ed/web/pkg/guidelines/"
printf '%s\n' '// Guideline explorer, compiled beside the editor: spikes/guidelines/build.sh' \
  'export { d_bl_package as package } from "../out/guidelines.pkg.mjs";' \
  'export { createHost } from "./guidelines/explorer.mjs";' \
  > "$root/vendor/bl-ed/web/pkg/guidelines.mjs"
