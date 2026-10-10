#!/usr/bin/env bash
# Mount a real directory. State is independent of any running Omega world.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd -P)
repo=$(cd "$here/../.." && pwd -P)
project=$(cd "${1:-$repo}" && pwd -P)
port=${2:-8812}
case "$port" in 8790|*[!0-9]*|'') echo 'Use a separate numeric mobile port, never 8790.' >&2; exit 2;; esac
identity=$(printf '%s' "$project" | sha256sum | cut -c1-12)
state=${OMEGA_MOBILE_STATE:-${XDG_STATE_HOME:-$HOME/.local/state}/omega-pocket/$identity}
mkdir -p "$state"
entry=$(mktemp --suffix=.bl)
trap 'unlink "$entry"' EXIT
printf '%s\n' '(ns pocket-entry (:require [mob.server :as s]))' \
 '(s/launch (System/get_env "OMEGA_MOBILE_PROJECT") (System/get_env "OMEGA_MOBILE_STATE") (erlang/binary_to_integer (System/get_env "OMEGA_MOBILE_PORT")) (System/get_env "OMEGA_MOBILE_HOME"))' > "$entry"
OMEGA_MOBILE_PROJECT="$project" OMEGA_MOBILE_STATE="$state" OMEGA_MOBILE_PORT="$port" OMEGA_MOBILE_HOME="$repo" \
 "$repo/bin/bl" run "$entry" -p "$repo/spikes/workspace" -p "$here"
