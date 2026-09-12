#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/platform-lib.sh"
ulpin_compose exec -T postgres sh -ec 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "SELECT PostGIS_Full_Version()"'
test "$(ulpin_compose exec -T redis redis-cli ping)" = 'PONG'
echo 'PASS: Redis responds.'
curl --fail --silent --show-error http://127.0.0.1:19000/minio/health/live >/dev/null
ulpin_compose --profile tools run --rm --no-deps storage-check
ULPIN_ANON_STATUS="$(curl --silent --output /dev/null --write-out '%{http_code}' http://127.0.0.1:19000/ulpin/)"
test "$ULPIN_ANON_STATUS" = 403
echo 'PASS: anonymous bucket access is denied (403).'
if [[ "${1:-}" != '--infra-only' ]]; then
  curl --fail --silent --show-error http://127.0.0.1:18000/health
  echo
  ulpin_compose --profile app exec -T worker celery -A geo.tasks:celery_app inspect ping --timeout 5
fi
echo 'Platform checks passed.'
