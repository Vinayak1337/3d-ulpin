#!/usr/bin/env bash
set -euo pipefail
ULPIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
case "${1:-}" in
  ''|'--infra-only') ;;
  *) echo 'Usage: pnpm platform:start [--infra-only]' >&2; exit 2 ;;
esac
source "$ULPIN_ROOT/scripts/platform-lib.sh"
# Check actual engine storage BEFORE Compose/configuration. Never generate .env,
# initialize a bucket, migrate/reseed, build, or create/recreate containers here.
node "$ULPIN_ROOT/scripts/platform/runtime.mjs" "${1:-}"
if [[ "${1:-}" = '--infra-only' ]]; then
  ulpin_compose start --wait --wait-timeout 90 postgres minio redis
else
  ulpin_compose --profile app start --wait --wait-timeout 90 postgres minio redis geo worker
fi
node "$ULPIN_ROOT/scripts/platform/doctor" "${1:-}"
