#!/usr/bin/env bash
# Compatibility for the original service. Preserve its store; use the root task.
set -euo pipefail
repo=$(cd "$(dirname "$0")/../.." && pwd -P)
project=$(cd "${1:-$repo}" && pwd -P)
port=${2:-8812}
case "$port" in 8790|*[!0-9]*|'') echo 'Use a numeric Pocket port, never 8790.' >&2; exit 2;; esac
identity=$(printf '%s' "$project" | sha256sum | cut -c1-12)
state=${OMEGA_MOBILE_STATE:-${XDG_STATE_HOME:-$HOME/.local/state}/omega-pocket/$identity}
# Existing service stays foreground, and its original durable path is explicit.
# After adoption use bl pocket -- --live --db <same-store> from every launcher.
exec "$repo/bin/bl" --cold pocket -- --live --db "$state/db" --port "$port"
