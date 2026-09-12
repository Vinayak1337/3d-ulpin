#!/usr/bin/env bash
# Shared only by the platform scripts. It does not print environment secrets.
set -euo pipefail
ULPIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ULPIN_ROOT"
if [[ -n "${ULPIN_DOCKER_CONTEXT:-}" ]]; then
  export DOCKER_CONTEXT="$ULPIN_DOCKER_CONTEXT"
elif docker context inspect colima-ulpin >/dev/null 2>&1; then
  export DOCKER_CONTEXT=colima-ulpin
fi
if docker compose version >/dev/null 2>&1; then
  ULPIN_COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  ULPIN_COMPOSE=(docker-compose)
else
  echo 'Docker Compose is required. On macOS: brew install colima docker docker-compose' >&2
  exit 1
fi
ulpin_compose() {
  "${ULPIN_COMPOSE[@]}" --project-directory "$ULPIN_ROOT" --env-file "$ULPIN_ROOT/.env" -f "$ULPIN_ROOT/compose.yaml" "$@"
}
