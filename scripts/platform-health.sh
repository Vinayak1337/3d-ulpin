#!/usr/bin/env bash
set -euo pipefail
ULPIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Compatibility entry; health checks must not write/delete probe objects or run tools.
node "$ULPIN_ROOT/scripts/platform/doctor" "$@"
