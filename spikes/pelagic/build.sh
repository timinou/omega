#!/usr/bin/env bash
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd -P)
root=$(cd "$here/../.." && pwd -P)
out="$root/vendor/bl-ed/web/out"
"$root/bin/bl" js build pelagic.main -p "$root/vendor/bl-ed" -p "$here" --host run,eval-ed,eval-cells --out "$out"
"$root/bin/bl" js build pelagic.live -p "$here" --host run,eval-ed,eval-cells --out "$out"
"$root/bin/bl" js build pelagic.shadertone -p "$here" --host run,eval-ed,eval-cells --out "$out"
pkg="$root/vendor/bl-ed/web/pkg"
mkdir -p "$pkg/pelagic"
cp "$here/host/"*.mjs "$here/host/style.css" "$pkg/pelagic/"
cp "$here/shaders/"*.glsl "$pkg/pelagic/"
cp "$here/pelagic/overtone.bl" "$pkg/pelagic/overtone.bl"
cp "$here/demo.bl.org" "$pkg/pelagic/demo.bl.org"
printf '%s\n' 'export { d_bl_package as package } from "../out/pelagic.main.mjs";' \
  'export { createHost } from "./pelagic/host.mjs";' > "$pkg/pelagic.mjs"
