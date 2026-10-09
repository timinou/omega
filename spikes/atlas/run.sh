#!/usr/bin/env bash
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd -P)
root=$(cd "$here/../.." && pwd -P)
"$here/build.sh"
world=$(mktemp -d /tmp/omega-atlas.XXXXXX)
mkdir -p "$world/spikes"
cp -R "$here" "$world/spikes/atlas"
printf 'Atlas offline notebook: http://127.0.0.1:8792/?file=spikes/atlas/desk.bl.org&use=atlas\nWorld: %s\n' "$world"
exec "$root/bin/bl-ed" --offline --memory --port 8792 --root "$world"
