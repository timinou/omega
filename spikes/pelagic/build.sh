#!/usr/bin/env bash
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd -P)
root=$(cd "$here/../.." && pwd -P)
# Both launch modes use the package's native-JS compiler pin and one build graph.
cd "$here"
env -u BL_USE "${PELAGIC_BL:-$HOME/.local/bin/bl}" bundle
if [[ "${1:-}" != --local ]]; then
  exec node local/frontend.mjs --install
fi
