#!/usr/bin/env bash
set -euo pipefail
ULPIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ULPIN_ROOT"
if [[ -e .env ]]; then
  echo 'Existing .env preserved.'
  exit 0
fi
umask 077
ULPIN_DB_SECRET="$(openssl rand -hex 24)"
ULPIN_S3_SECRET="$(openssl rand -hex 24)"
ULPIN_GEO_SECRET="$(openssl rand -hex 32)"
cat > .env <<EOF
POSTGRES_DB=ulpin
POSTGRES_USER=ulpin
POSTGRES_PASSWORD=$ULPIN_DB_SECRET
DATABASE_URL=postgresql://ulpin:$ULPIN_DB_SECRET@127.0.0.1:15432/ulpin
S3_ENDPOINT=http://127.0.0.1:19000
S3_ACCESS_KEY=ulpinlocal
S3_SECRET_KEY=$ULPIN_S3_SECRET
S3_BUCKET=ulpin
S3_REGION=us-east-1
GEO_URL=http://127.0.0.1:18000
GEO_SERVICE_TOKEN=$ULPIN_GEO_SECRET
REDIS_URL=redis://127.0.0.1:16379/0
EOF
unset ULPIN_DB_SECRET ULPIN_S3_SECRET ULPIN_GEO_SECRET
echo 'Created private .env with new local-only secrets.'
