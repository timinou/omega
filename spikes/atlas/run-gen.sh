#!/usr/bin/env bash
# Starts an isolated Gen-backed review harness. API calls use existing .env.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd -P)
root=$(cd "$here/../.." && pwd -P)
if [ "${ATLAS_PORT:-8831}" = 8790 ]; then echo "Refusing live-world port" >&2; exit 2; fi
"$here/build.sh"
export ATLAS_WORLD=$(mktemp -d /tmp/omega-atlas.XXXXXX)
export OMEGA_HOME="$root"
mkdir -p "$ATLAS_WORLD/spikes"
cp -R "$here" "$ATLAS_WORLD/spikes/atlas"
exec "$root/bin/bl" run "$here/world.bl" -p "$here"
