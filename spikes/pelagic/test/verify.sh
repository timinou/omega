#!/usr/bin/env bash
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd -P)
root=$(cd "$here/../../.." && pwd -P)
cd "$root"
spikes/pelagic/build.sh
mkdir -p spikes/pelagic/proof/club
node --test spikes/pelagic/test/*.test.mjs > spikes/pelagic/proof/club/contract-tests.log 2>&1
BLED_ROOT=${BLED_ROOT:-$root/../beam-lisp} BLED_OUT="$root/vendor/bl-ed/web/out" \
  node --test vendor/bl-ed/test/*.test.mjs > spikes/pelagic/proof/club/vendor-tests.log 2>&1
node spikes/present/test/check.mjs vendor/bl-ed/web/welcome.bl.org spikes/pelagic/demo.bl.org \
  > spikes/pelagic/proof/club/equivalence.log 2>&1
python3 spikes/pelagic/test/browser.py
