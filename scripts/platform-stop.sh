#!/usr/bin/env bash
set -euo pipefail
ULPIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ "${1:-}" = '--profile' ]]; then
  [[ "${2:-}" = 'demo' ]] || { echo 'Only --profile demo is supported.' >&2; exit 2; }
  shift 2; export ULPIN_PROFILE=demo
fi
if [[ "${ULPIN_PROFILE:-}" = 'demo' ]]; then
  exec node "$ULPIN_ROOT/scripts/platform/demo.mjs" stop "$@"
fi
source "$ULPIN_ROOT/scripts/platform-lib.sh"
ulpin_compose --profile app stop
echo 'Existing profile stopped; database, objects and queue volumes preserved.'
