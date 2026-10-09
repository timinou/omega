#!/usr/bin/env bash
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd -P)
root=$(cd "$here/../.." && pwd -P)
"$here/build.sh"
port=${ATLAS_PORT:-8831}
if [ "$port" = 8790 ]; then echo "Refusing live-world port" >&2; exit 2; fi
world=$(mktemp -d /tmp/omega-atlas.XXXXXX)
mkdir -p "$world/spikes"
cp -R "$here" "$world/spikes/atlas"
printf 'Atlas offline notebook: http://127.0.0.1:%s/?file=spikes/atlas/desk.bl.org&use=atlas\nWorld: %s\n' "$port" "$world"
cd "$world"
exec "$root/bin/bl-ed" --offline --memory --port "$port" --root "$world"
