#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."

pnpm typecheck:backend
pnpm exec tsx --tsconfig apps/api/tsconfig.json --test \
  tests/intake-zip-layers.test.ts \
  packages/server/src/modules/usp/ingestion/intake-zip-layers.test.ts

# The complete attempt and the unchanged migration-order failure are recorded in result.json.
mapfile -t intake_tests < <(
  printf '%s\n' tests/intake-*.test.ts packages/server/src/modules/usp/ingestion/intake-*.test.ts \
    | grep -v '^tests/intake-migration.test.ts$'
)
pnpm exec tsx --tsconfig apps/api/tsconfig.json --test "${intake_tests[@]}"
git diff --check
