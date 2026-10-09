#!/usr/bin/env bash
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd -P)
export OMEGA_HOME=$(cd "$here/../.." && pwd -P)
export BROWSER_DEMO_ROOT=${BROWSER_DEMO_ROOT:-/tmp/omega-browser-demo}
[ -d "$here/node_modules/@onkernel/sdk" ] || npm --prefix "$here" ci
export BROWSER_BACKEND=${BROWSER_BACKEND:-native}
if [ "$BROWSER_BACKEND" = native ]; then
  if [ -f "$here/.native/paths.json" ]; then
    # Pass path configuration as data to the host; never source executable shell.
    export BROWSER_NATIVE_CONFIG="$here/.native/paths.json"
  elif [ -z "${BL_BROWSER_PORT:-}" ]; then
    echo "Prepare native dependencies with spikes/browser/native-setup.sh (or --nix)." >&2
    exit 2
  fi
  npm --prefix "$here" run build:native-view
fi
# Fail before launching either process if a requested port is already in use.
node --input-type=module <<'JS'
import net from 'node:net';
for (const port of [8796,8797,...(process.env.BROWSER_OPENAI==='1'?[8808]:[])]) {
  const occupied = await new Promise(resolve => {
    const socket = net.createConnection({host:'127.0.0.1',port});
    socket.once('connect',()=>{socket.destroy();resolve(true);});
    socket.once('error',()=>resolve(false));
    socket.setTimeout(1000,()=>{socket.destroy();resolve(true);});
  });
  if (occupied) {console.error(`Port ${port} is occupied; stop the existing demo before starting another.`);process.exit(1);}
}
JS
mkdir -p "$BROWSER_DEMO_ROOT"
if [ "${BROWSER_LIVE:-0}" = 1 ]; then
  cp "$here/procurement/"* "$BROWSER_DEMO_ROOT/"
else
  cp "$here/demo.bl.org" "$BROWSER_DEMO_ROOT/demo.bl.org"
fi
if [ "${PROCUREMENT_DEMO:-0}" = 1 ]; then
  cp "$OMEGA_HOME/spikes/procurement/pages.mjs" "$BROWSER_DEMO_ROOT/"
  cp "$OMEGA_HOME/spikes/procurement/desk-tool.mjs" "$BROWSER_DEMO_ROOT/"
  cp "$OMEGA_HOME/spikes/procurement/instructions.bl.org" "$BROWSER_DEMO_ROOT/procurement-instructions.bl.org"
fi
world_pid= proxy_pid= model_pid=
cleanup() {
  [ -z "$model_pid" ] || kill -TERM "$model_pid" 2>/dev/null || true
  [ -z "$proxy_pid" ] || kill -TERM "$proxy_pid" 2>/dev/null || true
  [ -z "$world_pid" ] || kill -TERM "$world_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM
if [ "${BROWSER_OPENAI:-0}" = 1 ]; then
  node "$here/procurement/model-adapter.mjs" &
  model_pid=$!
fi
"$OMEGA_HOME/bin/bl" run "$here/world.bl" &
world_pid=$!
# Print the usable demo link only after the world can answer requests.
node --input-type=module <<'JS'
let ready=false;
for(let attempt=0;attempt<100;attempt++) {
  try {
    const r=await fetch('http://127.0.0.1:8796/api/doc?path=omega:overview',{signal:AbortSignal.timeout(1000)});
    if(r.ok && (await r.json()).ok){ready=true;break;}
  }catch {}
  await new Promise(r=>setTimeout(r,500));
}
if(!ready){console.error('Offline world did not become ready; inspect its startup output.');process.exit(1);}
JS
node "$here/serve.mjs" &
proxy_pid=$!
wait -n "$world_pid" "$proxy_pid"
