#!/usr/bin/env bash
set -euo pipefail
ULPIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Stop only existing ulpin-labelled containers; no configuration/credentials needed.
node "$ULPIN_ROOT/scripts/platform/runtime.mjs" --stop
