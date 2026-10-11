#!/usr/bin/env bash
set -euo pipefail
repo=$(cd "$(dirname "$0")/../../.." && pwd -P)
cd "$repo"
if [ -z "${BLED_OUT:-}" ]; then
  log=$(mktemp)
  trap 'rm -f "$log"' EXIT
  bin/bl omega.build | tee "$log"
  web=$(awk '/^\/.*\/dist\/frontend\/[a-f0-9]+$/ {p=$0} END {print p}' "$log")
  test -f "$web/.inputs"
  export BLED_OUT="$web/out"
fi
if [ -z "${BLED_ROOT:-}" ]; then
  pin=$(sed -n 's/^ *:bl "commit:\([^" ]*\)".*/\1/p' env.bl)
  for tree in "$HOME/.cache/bl/build-trees/$pin"*; do
    if [ -d "$tree/docs" ]; then export BLED_ROOT="$tree"; break; fi
  done
fi
: "${BLED_ROOT:?Set BLED_ROOT to the pinned Beam Lisp source tree.}"
bin/bl --cold test spikes/mobile/test/shared_world_test.bl spikes/mobile/test/attention_test.bl test/actor_test.bl test/task_test.bl test/frontend_test.bl test/dev_host_test.bl
node --test spikes/mobile/test/drive.test.mjs
node spikes/mobile/test/host-browser.mjs
for test in spikes/workspace/test/*drive*.mjs spikes/dwim/test/drive.test.mjs spikes/present/test/scroll.test.mjs vendor/bl-ed/test/*.test.mjs; do
  node "$test"
done
PP_OUT="$BLED_OUT" node spikes/mobile/test/presentation-check.mjs spikes/dwim/test/outline.bl.org vendor/bl-ed/web/welcome.bl.org vendor/bl-ed/web/split-demo.bl.org spikes/present/web/welcome.bl.org
python3 spikes/mobile/test/shared-launch.py
