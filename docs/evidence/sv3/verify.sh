#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
preload="$PWD/docs/evidence/sv3/offline-preload.cjs"
if command -v cygpath >/dev/null; then preload=$(cygpath -m "$preload"); fi
export NODE_OPTIONS="--require=$preload"
export TSX_TSCONFIG_PATH="$PWD/scripts/agent/tsconfig.json"
pnpm typecheck:backend
node --import tsx --test \
  tests/model-gateway/*.test.ts \
  scripts/agent/mapping-teacher.test.ts \
  scripts/agent/mapping-teacher-review.test.ts \
  scripts/agent/live-proof.test.ts \
  packages/server/src/modules/ai/document-storey-agent.test.ts \
  packages/server/src/modules/ai/storey-document-proposals.test.ts \
  packages/server/src/modules/usp/ingestion/column-profile.test.ts \
  packages/server/src/modules/usp/ingestion/document-proposal-quotes.test.ts
node --import tsx docs/evidence/sv3/measure.ts
scratch=$(mktemp -d)
if command -v cygpath >/dev/null; then scratch=$(cygpath -m "$scratch"); fi
pnpm exec tsx scripts/agent/live-proof.ts --plan --out "$scratch/plan" > "$scratch/plan.log"
pnpm exec tsx scripts/agent/live-proof.ts --dry-run --out "$scratch/dry-run" \
  --recordings "$scratch/empty-recordings" > "$scratch/dry-run.log"
node --input-type=module - "$scratch" <<'JS'
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const root = process.argv[2];
const plan = JSON.parse(readFileSync(join(root, 'plan/plan.json'), 'utf8'));
const receipt = JSON.parse(readFileSync(join(root, 'dry-run/receipt.json'), 'utf8'));
assert.equal(plan.totals.calls, 10);
assert.equal(receipt.summary.providerDispatches, 0);
assert.equal(receipt.summary.fetchAttempts, 0);
assert.equal(receipt.summary.ledgerReservations, 0);
assert.equal(receipt.summary.requestsMatchingPlan, 10);
console.log(JSON.stringify({ plannedCalls: plan.totals.calls, dryRun: receipt.summary }));
JS
