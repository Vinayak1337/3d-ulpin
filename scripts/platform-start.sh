#!/usr/bin/env bash
set -euo pipefail
ULPIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bash "$ULPIN_ROOT/scripts/platform-env.sh"
if ! command -v docker >/dev/null 2>&1; then
  echo 'Install the runtime first: brew install colima docker docker-compose' >&2
  exit 1
fi
if [[ -z "${ULPIN_DOCKER_CONTEXT:-}" ]] && command -v colima >/dev/null 2>&1; then
  if ! colima status --profile ulpin >/dev/null 2>&1; then
    colima start --profile ulpin --vm-type vz --vz-rosetta --cpu 4 --memory 6 --disk 20 --mount-type virtiofs
  fi
fi
source "$ULPIN_ROOT/scripts/platform-lib.sh"
docker info >/dev/null
if [[ "${1:-}" = '--infra-only' ]]; then
  ulpin_compose up -d --wait postgres minio redis
  ulpin_compose run --rm minio-init
else
  if [[ ! -f "$ULPIN_ROOT/services/geo/Dockerfile" ]]; then
    echo 'Geo Dockerfile is not present. Use --infra-only during initial development.' >&2
    exit 1
  fi
  ulpin_compose --profile app up -d --build --wait
fi
bash "$ULPIN_ROOT/scripts/platform-health.sh" "${1:-}"
