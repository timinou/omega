#!/usr/bin/env bash
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd -P)
root=$(cd "$here/../.." && pwd -P)
# Compatibility command; the root env.bl owns the compiler and every pipeline.
if [[ -n "${PELAGIC_BL:-}" ]]; then export OMEGA_BL="$PELAGIC_BL"; fi
if [[ "${1:-}" == --local ]]; then
  exec "$root/bin/bl" pelagic.bundle
fi
exec "$root/bin/bl" pelagic.build
