#!/usr/bin/env bash
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd -P)
root=$(cd "$here/../.." && pwd -P)
[ "${BL_BROWSER_ENABLED:-1}" != 0 ] || { echo 'Browser support is disabled (BL_BROWSER_ENABLED=0).' >&2; exit 2; }
display_backend=${BROWSER_DISPLAY_BACKEND:-wayland}
case "$display_backend" in wayland|x11) ;; *) echo 'Choose wayland or x11 BROWSER_DISPLAY_BACKEND.' >&2; exit 2;; esac
mkdir -p "$here/.native"
# Explicit opt-in only: runtime never installs services or extensions.
if [ "${1:-}" = --nix ]; then
  runtime="$here/.native/runtime-$display_backend"
  nix build "path:$root/vendor/browser-port#runtime-$display_backend" --out-link "$runtime"
  export CHROMIUM="$runtime/bin/chromium"
  if [ "$display_backend" = wayland ]; then
    export SWAY="$runtime/bin/sway" WAYVNC="$runtime/bin/wayvnc"
  else
    export XVFB="$runtime/bin/Xvfb" X11VNC="$runtime/bin/x11vnc"
  fi
fi
export CHROMIUM=${CHROMIUM:-$(command -v chromium || command -v google-chrome || true)}
if [ "$display_backend" = wayland ]; then
  export SWAY=${SWAY:-$(command -v sway || true)} WAYVNC=${WAYVNC:-$(command -v wayvnc || true)}
  required=(CHROMIUM SWAY WAYVNC)
  features=native-browser
else
  export XVFB=${XVFB:-$(command -v Xvfb || true)} X11VNC=${X11VNC:-$(command -v x11vnc || true)}
  required=(CHROMIUM XVFB X11VNC)
  features=native-browser,x11
fi
for name in "${required[@]}"; do
  value=${!name}
  [ -n "$value" ] && [ -x "$value" ] || { echo "Missing $name for $display_backend. Set its executable path or use native-setup.sh --nix." >&2; exit 2; }
done
cargo build --release --locked --features "$features" --manifest-path "$root/vendor/browser-port/Cargo.toml" --target-dir "$here/.native/build"
export BL_BROWSER_PORT="$here/.native/build/release/bl-browser-port" BROWSER_DISPLAY_BACKEND="$display_backend"
[ -d "$here/node_modules/@novnc/novnc" ] || npm --prefix "$here" ci
npm --prefix "$here" run build:native-view
node --input-type=module - "$here/.native/paths.json" <<'JS'
import fs from 'node:fs/promises';
const fields=['BL_BROWSER_PORT','CHROMIUM','BROWSER_DISPLAY_BACKEND',...(process.env.BROWSER_DISPLAY_BACKEND==='wayland'?['SWAY','WAYVNC']:['XVFB','X11VNC'])];
await fs.writeFile(process.argv[2],JSON.stringify(Object.fromEntries(fields.map(k=>[k,process.env[k]])),null,2),{mode:0o600});
JS
printf '%s\n' "Native $display_backend runtime prepared. Browsers start only on request. BL_BROWSER_ENABLED=0 disables launches."
