#!/usr/bin/env bash
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd -P)
repo=$(cd "$here/../../.." && pwd -P)
cd "$repo"
"$repo/bin/bl" test test/ "$here/backend_test.bl" "$here/place_test.bl" "$here/links_test.bl" "$here/buffer_test.bl" "$here/demo_test.bl" -p "$repo/spikes/workspace"
export BLED_OUT="$repo/vendor/bl-ed/web/out"
if [ -z "${BLED_ROOT:-}" ]; then
  pin=$(sed -n 's/^ *:bl "commit:\([^" ]*\)".*/\1/p' "$repo/env.bl")
  for tree in "$HOME/.cache/bl/build-trees/$pin"*; do
    if [ -d "$tree" ]; then export BLED_ROOT="$tree"; break; fi
  done
fi
if [ -z "${BLED_ROOT:-}" ]; then
  echo 'Set BLED_ROOT to the pinned beam-lisp source tree for the vendor corpus checks.' >&2
  exit 2
fi
# Separate processes also keep evaluator host fixtures isolated.
for test in "$here"/*drive*.mjs "$repo/spikes/dwim/test/drive.test.mjs" "$repo/spikes/present/test/scroll.test.mjs" "$repo/vendor/bl-ed/test/"*.test.mjs; do
  node "$test"
done
PP_OUT="$BLED_OUT" node "$repo/spikes/present/test/check.mjs" \
  "$repo/spikes/dwim/test/outline.bl.org" "$repo/vendor/bl-ed/web/welcome.bl.org" \
  "$repo/vendor/bl-ed/web/split-demo.bl.org" "$repo/spikes/present/web/welcome.bl.org"
