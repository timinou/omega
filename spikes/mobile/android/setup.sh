#!/usr/bin/env bash
# Build and install with the mobile worktree, independently of Omega's pin.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd -P)
mobile_bl=${BEAM_LISP_MOBILE_BIN:-"$here/../../../../beam-lisp--mobile/bin/bl"}
cd "$here"
"$mobile_bl" deps fetch
"$mobile_bl" deps compile
"$mobile_bl" android build
if [ "${1:-}" = --install ]; then
  "$mobile_bl" android install
  "$mobile_bl" android push
  "$mobile_bl" android up
fi
