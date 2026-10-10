#!/usr/bin/env bash
# A fresh, isolated guideline world (never port 8790): builds the package, copies the
# seed guidelines into a temp root and serves bl-ed with the explorer.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd -P)
root=$(cd "$here/../.." && pwd -P)
port=${GX_PORT:-8792}
[ "$port" = 8790 ] && { echo "refusing the live world port" >&2; exit 2; }
[ "${GX_SKIP_BUILD:-}" = 1 ] || "$here/build.sh"
world=${GX_WORLD:-$(mktemp -d /tmp/omega-guidelines.XXXXXX)}
mkdir -p "$world"
[ -f "$world/guidelines.bl.org" ] || cp "$here/guidelines.bl.org" "$world/guidelines.bl.org"
[ -f "$world/host.guidelines.bl.org" ] || cp "$here/drafts/host.bl.org" "$world/host.guidelines.bl.org"
cd "$world"
GX_WORLD="$world" GX_PORT="$port" OMEGA_HOME="$root" exec "$root/bin/bl" run -p "$here" "$here/world.bl"
