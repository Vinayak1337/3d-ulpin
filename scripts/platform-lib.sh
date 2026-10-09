#!/usr/bin/env bash
# Legacy linked/repository modes; demo is dispatched separately without repo .env.
set -euo pipefail
ULPIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ULPIN_ROOT"
if [[ -n "${ULPIN_DOCKER_CONTEXT:-}" ]]; then
  export DOCKER_CONTEXT="$ULPIN_DOCKER_CONTEXT"
elif [[ "$(uname -s)" = 'Darwin' ]] && docker context inspect colima-ulpin >/dev/null 2>&1; then
  export DOCKER_CONTEXT=colima-ulpin
fi
if docker compose version >/dev/null 2>&1; then
  ULPIN_COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  ULPIN_COMPOSE=(docker-compose)
else
  echo 'Docker Compose is required (Docker Desktop on Windows).' >&2; exit 1
fi
ulpin_compose() {
  local env_file project
  env_file="$(node "$ULPIN_ROOT/scripts/platform/legacy-mode.mjs")"
  project="$(node "$ULPIN_ROOT/scripts/platform/legacy-mode.mjs" project)"
  "${ULPIN_COMPOSE[@]}" --project-directory "$ULPIN_ROOT" --env-file "$env_file" -p "$project" -f "$ULPIN_ROOT/compose.yaml" "$@"
}
