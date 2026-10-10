#!/usr/bin/env bash
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd -P)
port=${2:-8812}
printf 'Phone UI: http://127.0.0.1:%s/?file=workspace:all&use=present,dwim,workspace,places,references,buffers,workbench,mobile&layout=mobile\n' "$port"
exec "$here/../workspace/desk.sh" "${1:-/tmp/omega-mobile}" "$port"
