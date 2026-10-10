#!/usr/bin/env bash
# Private HTTPS only. Use a separate listener to preserve existing mappings.
set -euo pipefail
port=${1:-8812}
case "$port" in 8790|*[!0-9]*|'') echo 'Use an isolated numeric demo port, never 8790.' >&2; exit 2;; esac
command -v tailscale >/dev/null
if [ "${2:-}" = --enable ]; then
  tailscale serve --bg --https=8443 "http://127.0.0.1:$port"
else
  printf 'Enable the private tailnet listener with:\n  %s %s --enable\n' "$0" "$port"
fi
printf '\nAppend this path to the HTTPS address printed by Tailscale:\n/?file=workspace:all&use=present,dwim,workspace,places,references,buffers,workbench,mobile&layout=mobile\n'
