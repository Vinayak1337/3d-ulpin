#!/usr/bin/env bash
set -euo pipefail
ULPIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ "${1:-}" = '--profile' ]]; then
  [[ "${2:-}" = 'demo' ]] || { echo 'Only --profile demo is supported.' >&2; exit 2; }
  shift 2; export ULPIN_PROFILE=demo
fi
if [[ "${ULPIN_PROFILE:-}" = 'demo' ]]; then
  exec node "$ULPIN_ROOT/scripts/platform/demo.mjs" start "$@"
fi
case "${1:-}" in ''|'--infra-only') ;; *) echo 'Use --profile demo --create for the explicitly new demo profile.' >&2; exit 2 ;; esac
source "$ULPIN_ROOT/scripts/platform-lib.sh"
# Restore existing linked/repository behaviour, but require the original config
# and existing storage bindings before any up. No environment/password generation.
ULPIN_PROJECT="$(node "$ULPIN_ROOT/scripts/platform/legacy-mode.mjs" project)"
node "$ULPIN_ROOT/scripts/platform/runtime.mjs" --project "$ULPIN_PROJECT" --infra-only
ulpin_compose up -d --no-recreate --wait postgres minio redis
ulpin_compose run --rm minio-init
if [[ "${1:-}" != '--infra-only' ]]; then
  if [[ "$ULPIN_PROJECT" = 'ulpin-repo' ]]; then pnpm db:migrate; fi
  ulpin_compose --profile app up -d --build --wait
fi
bash "$ULPIN_ROOT/scripts/platform-health.sh" "${1:-}"
