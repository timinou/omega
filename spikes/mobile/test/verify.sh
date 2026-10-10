#!/usr/bin/env bash
set -euo pipefail
repo=$(cd "$(dirname "$0")/../../.." && pwd -P)
cd "$repo"
export BLED_OUT="$repo/vendor/bl-ed/web/out"
if [ -z "${BLED_ROOT:-}" ]; then
  pin=$(sed -n 's/^ *:bl "commit:\([^" ]*\)".*/\1/p' env.bl)
  for tree in "$HOME/.cache/bl/build-trees/$pin"*; do
    if [ -d "$tree/docs" ]; then export BLED_ROOT="$tree"; break; fi
  done
fi
: "${BLED_ROOT:?Set BLED_ROOT to the pinned Beam Lisp source tree.}"
node --test spikes/mobile/test/drive.test.mjs
node --test vendor/bl-ed/test/*.test.mjs
PP_OUT="$BLED_OUT" node spikes/present/test/check.mjs spikes/dwim/test/outline.bl.org vendor/bl-ed/web/welcome.bl.org vendor/bl-ed/web/split-demo.bl.org spikes/present/web/welcome.bl.org
