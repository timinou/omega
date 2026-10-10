#!/usr/bin/env bash
# QR contains only a private HTTPS URL. Tailscale authenticates the phone.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd -P)
port=${1:-8812}
case "$port" in 8790|*[!0-9]*|'') echo 'Use a separate numeric mobile port.' >&2; exit 2;; esac
host=$(tailscale status --json | python3 -c 'import json,sys; s=json.load(sys.stdin); assert s.get("BackendState")=="Running", "Connect Tailscale first"; print(s["Self"]["DNSName"].rstrip("."))')
url="https://$host:8443/?file=workspace:all&use=present,dwim,workspace,places,references,buffers,workbench,mobile&layout=mobile"
mkdir -p "$here/.local"
printf '%s\n' "$url" > "$here/.local/phone-url.txt"
qrencode -l M -s 8 -m 4 -o "$here/.local/phone-qr.png" "$url"
printf 'On the computer, enable private HTTPS (sudo may ask for your password):\n  sudo tailscale serve --bg --https=8443 http://127.0.0.1:%s\n\nConnect Tailscale on your phone, then scan:\n%s\n\nQR image: %s/.local/phone-qr.png\n' "$port" "$url" "$here"
