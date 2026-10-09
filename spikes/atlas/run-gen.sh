#!/usr/bin/env bash
# Persistent isolated research desk; no writes to the user's running Omega world.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd -P)
repo=$(cd "$here/../.." && pwd -P)
if [ "${ATLAS_PORT:-8831}" = 8790 ]; then echo "Refusing live-world port" >&2; exit 2; fi
if [ "${ATLAS_SKIP_BUILD:-0}" != 1 ]; then "$here/build.sh"; fi
export ATLAS_WORLD="${ATLAS_WORLD:-$repo/.omega/atlas-desk}"
export OMEGA_HOME="$repo"
mkdir -p "$ATLAS_WORLD/spikes/atlas"
# Seed once: restarts preserve the user's notebook, acquired evidence and task artifacts.
if [ ! -f "$ATLAS_WORLD/spikes/atlas/desk.bl.org" ]; then
 cp -R "$here/." "$ATLAS_WORLD/spikes/atlas/"
 rm -rf "$ATLAS_WORLD/spikes/atlas/data/runs"
fi
exec "$repo/bin/bl" run "$here/world.bl" -p "$here"
