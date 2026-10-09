#!/usr/bin/env bash
# Shared only by the platform scripts. It does not print environment secrets.
set -euo pipefail
ULPIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ULPIN_ROOT"
if [[ -n "${ULPIN_DOCKER_CONTEXT:-}" ]]; then
  export DOCKER_CONTEXT="$ULPIN_DOCKER_CONTEXT"
fi
if docker compose version >/dev/null 2>&1; then
  ULPIN_COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  ULPIN_COMPOSE=(docker-compose)
else
  echo 'Docker Compose is required: use Docker Desktop on Windows or the existing local Docker/Compose installation.' >&2
  exit 1
fi
ulpin_compose() {
  if [[ "${REPO_DATA:-false}" != 'false' ]]; then
    echo 'STOP: platform commands only resume ulpin; profile switching requires owner reconciliation.' >&2
    return 1
  fi
  if [[ ! -f "$ULPIN_ROOT/.env" ]]; then
    echo 'STOP: existing runtime configuration is missing; ask the owner to supply it. No .env will be generated.' >&2
    return 1
  fi
  "${ULPIN_COMPOSE[@]}" --project-directory "$ULPIN_ROOT" --env-file "$ULPIN_ROOT/.env" -p ulpin -f "$ULPIN_ROOT/compose.yaml" "$@"
}
