#!/usr/bin/env bash
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd -P)
cd "$here"
# Compatibility entrypoint. Root tasks are bl pelagic.dev / pelagic.bundle.
if [[ "${1:-}" == --local ]]; then
  exec env -u BL_USE "${PELAGIC_BL:-$HOME/.local/bin/bl}" bundle
fi
exec env -u BL_USE "${PELAGIC_BL:-$HOME/.local/bin/bl}" frontend
