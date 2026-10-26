import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { migrateUsp } from '../packages/server/src/modules/usp/migrations';
import { sql } from '../packages/server/src/infrastructure/sql-loader';
import { schemaRequirements } from '../packages/server/src/infrastructure/database-readiness';

test('USP runs the intake ledger exactly once after streamed profile and streaming capacity in its transaction', async () => {
  const globals = globalThis as unknown as { ulpinPool?: Pool };
  const previous = globals.ulpinPool;
  let reviewMarked = false;
  const query = mock.fn(async (text: string, values: string[] = []) => {
    if (values[0] !== 'usp_import_package_review_001') return { rows: [], rowCount: 0 };
    if (text === sql('usp.import-package-review.mark')) reviewMarked = true;
    return { rows: [], rowCount: text === sql('usp.import-package-review.check') && reviewMarked ? 1 : 0 };
  });
  const release = mock.fn();
  globals.ulpinPool = { connect: async () => ({ query, release }) } as unknown as Pool;
  try {
    await migrateUsp();
    const calls = query.mock.calls.map(call => call.arguments[0]);
    const ledger = sql('ingestion.intake.schema');
    assert.equal(calls.filter(text => text === ledger).length, 1);
    const index = calls.indexOf(ledger);
    assert.equal(calls[index - 1], sql('ingestion.streaming-vector.capacity'));
    assert.equal(calls[index - 2], sql('ingestion.streamed-profile.schema'));
    assert.equal(calls[0], 'BEGIN');
    assert.equal(calls.at(-1), 'COMMIT');
    assert.equal(release.mock.callCount(), 1);
    assert.equal(calls.filter(text => text === sql('usp.import-package-review.schema')).length, 1);
    assert(calls.indexOf(sql('usp.import-package-review.schema')) > index);
    await migrateUsp();
    const schemas = query.mock.calls.filter(call => call.arguments[0] === sql('usp.import-package-review.schema'));
    assert.equal(schemas.length, 1);
    const marks = query.mock.calls.filter(call => call.arguments[0] === sql('usp.import-package-review.mark')
      && call.arguments[1]?.[0] === 'usp_import_package_review_001');
    assert.equal(marks.length, 1);
    const requirements = schemaRequirements();
    assert(requirements.columns.includes('public.import_packages.review_current'));
    assert(requirements.markers.includes('usp_import_package_review_001'));
  } finally {
    globals.ulpinPool = previous;
  }
});
