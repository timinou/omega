#!/usr/bin/env bash
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd -P)
root=$(cd "$here/../.." && pwd -P)
export PROCUREMENT_DEMO=1 BROWSER_LIVE=1 BROWSER_OPENAI=1
export BROWSER_PROVIDER=${BROWSER_PROVIDER:-deepseek}
export BROWSER_MODEL=${BROWSER_MODEL:-deepseek-flash}
export BROWSER_DEMO_ROOT=${BROWSER_DEMO_ROOT:-$root/.local/procurement-flash-run}
export BROWSER_CREDENTIAL_FILE=${BROWSER_CREDENTIAL_FILE:-$root/.local/browser-credentials.json}
exec "$root/spikes/browser/run.sh"
