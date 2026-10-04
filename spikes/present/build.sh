#!/usr/bin/env bash
# spikes/present/build.sh — compile the presentation spike (pp.*) with the
# vendored editor (ed.*) to ES modules, beside the page's language runtime.
#   spikes/present/build.sh          → spikes/present/web/out/
# Needs vendor/bl-ed/web/out (bin/bl-ed build) for the in-page language
# (repl.mjs, boot.mjs …), copied, not rebuilt.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd -P)
root=$(cd "$here/../.." && pwd -P)
out="$here/web/out"
mkdir -p "$out"
cp -r "$root/vendor/bl-ed/web/out/." "$out/"
"$root/bin/bl" js build pp.main -p "$root/vendor/bl-ed" -p "$here" --host eval-ed,eval-cells --out "$out"
"$root/bin/bl" js build pp.check -p "$root/vendor/bl-ed" -p "$here" --host eval-ed,eval-cells --out "$out"
