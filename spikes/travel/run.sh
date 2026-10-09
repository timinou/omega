#!/usr/bin/env bash
# Isolated offline travel desk. Never touches the live world (8790).
# editor: bin/bl-ed --offline --memory on $TRAVEL_EDITOR_PORT (8841); desk+browser host on $TRAVEL_PORT (8842).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd -P)
root=$(cd "$here/../.." && pwd -P)
export OMEGA_HOME=$root
port=${TRAVEL_PORT:-8842}; eport=${TRAVEL_EDITOR_PORT:-8841}
for p in $port $eport; do [ "$p" != 8790 ] || { echo 'Refusing live-world port 8790' >&2; exit 2; }; done
"$here/build.sh"
base=${TRAVEL_BASE:-$(mktemp -d /tmp/omega-travel.XXXXXX)}
world=$base/world; state=$base/browser-state; data=$base/travel-data
mkdir -p "$world" "$state" "$data"
cp -n "$here/trip.bl.org" "$world/trip.bl.org"
export BROWSER_STATE_ROOT=$state BROWSER_BACKEND=${BROWSER_BACKEND:-native}
[ -z "${TRAVEL_NATIVE_CONFIG:-}" ] && [ -f "$root/spikes/browser/.native/paths.json" ] && export BROWSER_NATIVE_CONFIG=$root/spikes/browser/.native/paths.json
export TRAVEL_ROOT=$world TRAVEL_DATA=$data TRAVEL_PORT=$port TRAVEL_UPSTREAM=http://127.0.0.1:$eport
printf 'Travel desk: http://127.0.0.1:%s/?file=trip.bl.org&use=travel\nBase: %s (world, browser-state, travel-data)\n' "$port" "$base"
# bin/bl-ed prepends --root "$PWD" (FUP-012): run from the isolated world so both agree.
(cd "$world" && exec "$root/bin/bl-ed" --offline --memory --port "$eport" --root "$world") &
ed_pid=$!
trap 'kill -TERM $ed_pid 2>/dev/null || true' EXIT INT TERM
for i in $(seq 1 60); do curl -fs "http://127.0.0.1:$eport/" >/dev/null 2>&1 && break; sleep 0.5; done
node "$here/serve.mjs"
