#!/usr/bin/env bash
# Build a self-contained signed APK, independently of Omega's server pin.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd -P)
mobile_bl=${BEAM_LISP_MOBILE_BIN:-"$here/../../../../beam-lisp/bin/bl"}
cd "$here"
"$mobile_bl" deps fetch
"$mobile_bl" deps compile
"$mobile_bl" android build --standalone --release
python3 "$here/release.py"
if [ "${1:-}" = --install ]; then
  "${ANDROID_HOME:-$HOME/Android/Sdk}/platform-tools/adb" install -r "$here/release/omega-pocket-0.1.1-arm64-v8a.apk"
  "${ANDROID_HOME:-$HOME/Android/Sdk}/platform-tools/adb" shell am start -n org.beamlisp.omega.pocket/.MainActivity
fi
