#!/usr/bin/env bash
set -euo pipefail
ULPIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# After --profile demo, --runtime <name> (default ulpin-demo) reaches the Node entry with the other arguments.
if [[ "${1:-}" = '--profile' ]]; then
  [[ "${2:-}" = 'demo' ]] || { echo 'Only --profile demo is supported.' >&2; exit 2; }
  shift 2; export ULPIN_PROFILE=demo
fi
if [[ "${ULPIN_PROFILE:-}" = 'demo' ]]; then
  exec node "$ULPIN_ROOT/scripts/platform/doctor" --profile demo "$@"
fi
source "$ULPIN_ROOT/scripts/platform-lib.sh"
ULPIN_PROJECT="$(node "$ULPIN_ROOT/scripts/platform/legacy-mode.mjs" project)"
# Preserve legacy Docker-only scope; full native/migration admission is platform:doctor.
node "$ULPIN_ROOT/scripts/platform/doctor" --project "$ULPIN_PROJECT" --processing-only "$@"
