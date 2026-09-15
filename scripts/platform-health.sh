#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/platform-lib.sh"
ULPIN_STORAGE_URL=http://127.0.0.1:19000
ULPIN_PROCESSOR_URL=http://127.0.0.1:18000
ULPIN_BUCKET=ulpin
if [[ "$(node "$ULPIN_ROOT/scripts/platform-mode.mjs" project)" = 'ulpin-repo' ]]; then
  ULPIN_STORAGE_URL=http://127.0.0.1:19010
  ULPIN_PROCESSOR_URL=http://127.0.0.1:18001
  ULPIN_BUCKET=ulpin-repo
fi
ulpin_compose exec -T postgres sh -ec 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "SELECT PostGIS_Full_Version()"'
test "$(ulpin_compose exec -T redis redis-cli ping)" = 'PONG'
echo 'PASS: Redis responds.'
curl --fail --silent --show-error "$ULPIN_STORAGE_URL/minio/health/live" >/dev/null
ulpin_compose --profile tools run --rm --no-deps storage-check
ULPIN_ANON_STATUS="$(curl --silent --output /dev/null --write-out '%{http_code}' "$ULPIN_STORAGE_URL/$ULPIN_BUCKET/")"
test "$ULPIN_ANON_STATUS" = 403
echo 'PASS: anonymous bucket access is denied (403).'
if [[ "${1:-}" != '--infra-only' ]]; then
  curl --fail --silent --show-error "$ULPIN_PROCESSOR_URL/health"
  echo
  ulpin_compose --profile app exec -T worker celery -A geo.tasks:celery_app inspect ping --timeout 5
fi
echo 'Platform checks passed.'
