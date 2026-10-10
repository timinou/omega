#!/usr/bin/env bash
# Compatibility entry: package frontends are assembled together, never installed on use.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd -P)
root=$(cd "$here/../.." && pwd -P)
exec "$root/bin/bl" omega.build "$@"
