#!/usr/bin/env bash
# Compatibility: Pocket belongs to the shared immutable package graph.
set -euo pipefail
repo=$(cd "$(dirname "$0")/../.." && pwd -P)
exec "$repo/bin/bl" omega.build
