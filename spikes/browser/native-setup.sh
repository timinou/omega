#!/usr/bin/env bash
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd -P)
root=$(cd "$here/../.." && pwd -P)
mkdir -p "$here/.native"
# Dependency installation is explicit. Runtime never silently installs a daemon,
# changes a system package, downloads an extension, or disables the sandbox.
if [ "${1:-}" = --nix ]; then
  nix build "path:$root/vendor/browser-port#runtime" --out-link "$here/.native/runtime"
  export CHROMIUM="$here/.native/runtime/bin/chromium"
  export XVFB="$here/.native/runtime/bin/Xvfb"
  export X11VNC="$here/.native/runtime/bin/x11vnc"
fi
export CHROMIUM=${CHROMIUM:-$(command -v chromium || command -v google-chrome || true)}
export XVFB=${XVFB:-$(command -v Xvfb || true)}
export X11VNC=${X11VNC:-$(command -v x11vnc || true)}
for name in CHROMIUM XVFB X11VNC; do
  value=${!name}
  if [ -z "$value" ] || [ ! -x "$value" ]; then
    echo "Missing $name. Install Chromium, Xvfb and x11vnc, set their executable paths, or use native-setup.sh --nix." >&2
    exit 2
  fi
done
cargo build --release --locked --manifest-path "$root/vendor/browser-port/Cargo.toml" --target-dir "$here/.native/build"
export BL_BROWSER_PORT="$here/.native/build/release/bl-browser-port"
[ -d "$here/node_modules/@novnc/novnc" ] || npm --prefix "$here" ci
npm --prefix "$here" run build:native-view
node --input-type=module - "$here/.native/paths.json" <<'JS'
import fs from 'node:fs/promises';
const fields=['BL_BROWSER_PORT','CHROMIUM','XVFB','X11VNC'];
await fs.writeFile(process.argv[2],JSON.stringify(Object.fromEntries(fields.map(k=>[k,process.env[k]])),null,2),{mode:0o600});
JS
printf '%s\n' 'Native runtime prepared. spikes/browser/run.sh starts the browser on demand.'
