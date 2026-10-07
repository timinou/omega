#!/usr/bin/env bash
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd -P)
root=$(cd "$here/../.." && pwd -P)
demo_root=${1:-/tmp/omega-workspace-slice}
demo_port=${2:-8792}
case "$demo_port" in 8790) echo 'do not use the live-world port' >&2; exit 2;; *[!0-9]*|'') echo 'invalid port' >&2; exit 2;; esac
case "$demo_root" in /tmp/*) ;; *) echo 'demo root must be under /tmp' >&2; exit 2;; esac
mkdir -p "$demo_root"
entry=$(mktemp --suffix=.bl)
trap 'rm -f "$entry"' EXIT
printf '%s\n' '(ns workspace-entry (:require [ws.demo :as d]))' \
  '(d/launch (System/get_env "OMEGA_WORKSPACE_ROOT") (erlang/binary_to_integer (System/get_env "OMEGA_WORKSPACE_PORT")) (System/get_env "OMEGA_WORKSPACE_REPO"))' > "$entry"
OMEGA_WORKSPACE_ROOT="$demo_root" OMEGA_WORKSPACE_PORT="$demo_port" OMEGA_WORKSPACE_REPO="$root" \
  "$root/bin/bl" run "$entry" -p "$here"
