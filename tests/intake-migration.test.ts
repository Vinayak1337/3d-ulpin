import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { migrateUsp } from '../packages/server/src/modules/usp/migrations';
import { sql } from '../packages/server/src/infrastructure/sql-loader';

test('USP runs the intake ledger exactly once immediately after streamed profile in its transaction', async () => {
  const globals = globalThis as unknown as { ulpinPool?: Pool };
  const previous = globals.ulpinPool;
  const query = mock.fn(async (_text: string) => ({ rows: [], rowCount: 0 }));
  const release = mock.fn();
  globals.ulpinPool = { connect: async () => ({ query, release }) } as unknown as Pool;
  try {
    await migrateUsp();
    const calls = query.mock.calls.map(call => call.arguments[0]);
    const ledger = sql('ingestion.intake.schema');
    assert.equal(calls.filter(text => text === ledger).length, 1);
    const index = calls.indexOf(ledger);
    assert.equal(calls[index - 1], sql('ingestion.streamed-profile.schema'));
    assert.equal(calls[0], 'BEGIN');
    assert.equal(calls.at(-1), 'COMMIT');
    assert.equal(release.mock.callCount(), 1);
  } finally {
    globals.ulpinPool = previous;
  }
});
