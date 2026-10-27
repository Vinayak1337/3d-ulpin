import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { sql } from '../../../packages/server/src/infrastructure/sql-loader';
import { migrateUsp } from '../../../packages/server/src/modules/usp/migrations';

// Diagnose the unrelated baseline test without opening a database or changing migration order.
const globals = globalThis as unknown as { ulpinPool?: Pool };
const previous = globals.ulpinPool;
const calls: string[] = [];
const query = async (text: string) => {
  calls.push(text);
  return { rows: [], rowCount: 0 };
};
globals.ulpinPool = { connect: async () => ({ query, release() {} }) } as unknown as Pool;
try {
  await migrateUsp();
  const profile = calls.indexOf(sql('ingestion.streamed-profile.schema'));
  const capacity = calls.indexOf(sql('ingestion.streaming-vector.capacity'));
  const ledger = calls.indexOf(sql('ingestion.intake.schema'));
  const ledgerCalls = calls.filter(text => text === sql('ingestion.intake.schema')).length;
  assert.equal(capacity, profile + 1);
  assert.equal(ledger, capacity + 1);
  assert.equal(ledgerCalls, 1);
  console.log(JSON.stringify({ profile, capacity, ledger, ledgerCalls, baselineExpectationIsStale: true }));
} finally {
  globals.ulpinPool = previous;
}
