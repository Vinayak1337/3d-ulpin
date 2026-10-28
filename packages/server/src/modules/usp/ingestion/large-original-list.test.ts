import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { LargeUploadListSchema } from '@ulpin/contracts/usp';
import { localOperatorSubject } from '../principal';
import { LargeOriginalService } from './large-original';
import { AppError } from '../../../infrastructure/errors';

process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'n04-list-operator';
const caseId = '04000000-0000-4000-8000-000000000001';
const otherCase = '04000000-0000-4000-8000-000000000099';
const hour = 60 * 60 * 1000;
type Row = Record<string, any>;

/** One receipt row as the table stores it; the profile, operator and timing vary per case below. */
function receipt(n: number, state: string, profile: string, expiresIn: number, more: Row = {}): Row {
  return { id: `04000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`, case_id: caseId,
    operator_subject: localOperatorSubject(), revision: n + 1, case_revision: 3, state,
    original_bytes: String(26_660_992),
    body: { input: { filename: `receipt-${n}.geojson`, sha256: String(n % 10).repeat(64), profile } },
    lease_expires_at: null, expires_at: new Date(Date.now() + expiresIn),
    created_at: new Date(Date.UTC(2026, 9, 21, n)), ...more };
}

/** The listing statement over rows in memory; the slot predicate is the one the quota counts, read from the SQL. */
function listPool(rows: Row[], parts: Row[]) {
  const statements: string[] = [];
  const result = (found: Row[]) => ({ rows: found, rowCount: found.length });
  const held = (row: Row) => ['receiving', 'finalizing', 'aborting'].includes(row.state)
    && (row.expires_at > new Date() || row.lease_expires_at > new Date()
      || row.state !== 'receiving' && row.body.input.profile === 'large-original/2');
  const run = async (sql: string, values: unknown[] = []) => {
    statements.push(sql);
    if (/^(BEGIN|COMMIT|ROLLBACK|SET)/.test(sql)) return result([]);
    if (sql.startsWith('SELECT id,revision FROM cases WHERE id=$1')) return result([{ id: values[0], revision: 3 }]);
    if (sql.includes('FROM usp_source_uploads u WHERE u.case_id=$1 AND u.operator_subject=$2')) {
      return result(rows.filter(row => row.case_id === values[0] && row.operator_subject === values[1] && held(row))
        .sort((a, b) => b.created_at - a.created_at).slice(0, 20)
        .map(row => ({ ...row, received_parts: parts.filter(p => p.upload_id === row.id && p.state === 'received')
          .length })));
    }
    throw new Error(`Statement outside this protocol: ${sql.slice(0, 80)}`);
  };
  const pool = { query: run, connect: async () => ({ query: run, release: () => undefined }) };
  return { statements, pool: pool as unknown as Pool };
}

test('transient list failures are typed and retryable; unknown and typed failures keep their identity', async () => {
  const globals = globalThis as unknown as { ulpinPool?: Pool }, prior = globals.ulpinPool;
  const typed = new AppError(403, 'UPLOAD_OPERATOR', 'Forbidden');
  const errors = ['40P01', '40001', '55P03', '57014', '53300', '57P01', '08006', '23503']
    .map(code => Object.assign(new Error('Private SQL and parameters'), { code })).concat(typed);
  try {
    for (const failure of errors) {
      for (const at of ['connect', 'case', 'list'] as const) {
        let reads = 0;
        let released = false;
        globals.ulpinPool = { connect: async () => {
          if (at === 'connect') throw failure;
          return { query: async (sql: string) => {
            if (/FROM cases/.test(sql)) {
              reads++;
              if (at === 'case') throw failure;
              return { rows: [{ id: caseId, revision: 3 }] };
            }
            if (/FROM usp_source_uploads/.test(sql)) {
              reads++;
              throw failure;
            }
            return { rows: [] };
          }, release: () => { released = true; } };
        } } as unknown as Pool;
        await assert.rejects(new LargeOriginalService().list(caseId), error => {
          if (failure === typed || failure.code === '23503') return error === failure;
          assert.ok(error instanceof AppError);
          assert.equal(error.status, 503);
          assert.equal(error.code, 'DB_UNAVAILABLE');
          assert.deepEqual(error.details, { retryable: true });
          assert.match(error.message, /Refresh the batch/);
          assert.ok(!error.message.includes('Private'));
          return true;
        });
        assert.equal(reads, { connect: 0, case: 1, list: 2 }[at]);
        assert.equal(released, at !== 'connect');
      }
    }
  } finally { globals.ulpinPool = prior; }
});

for (const profile of ['large-original/1', 'large-original/2']) {
  test(`an idle ${profile} receipt remains listed for Resume and Cancel until its expiry`, async () => {
    const idle = receipt(1, 'receiving', profile, hour, { created_at: new Date(Date.now() - hour) });
    const { pool } = listPool([idle], []);
    const globals = globalThis as unknown as { ulpinPool?: Pool }, prior = globals.ulpinPool;
    globals.ulpinPool = pool;
    try {
      assert.deepEqual((await new LargeOriginalService().list(caseId)).uploads.map(row => row.id), [idle.id]);
    } finally { globals.ulpinPool = prior; }
  });
}

test('the list names only this operator\'s unfinished receipts in the case, newest first', async () => {
  const open = receipt(1, 'receiving', 'large-original/1', hour);
  const finalizing = receipt(4, 'finalizing', 'large-original/2', -hour);
  const cancelling = receipt(6, 'aborting', 'large-original/2', -hour);
  const rows = [open, finalizing, cancelling,
    receipt(2, 'receiving', 'large-original/2', -hour),
    receipt(3, 'aborted', 'large-original/1', hour),
    receipt(5, 'retained', 'large-original/1', hour),
    receipt(7, 'receiving', 'large-original/1', hour, { operator_subject: 'another-local-operator' }),
    receipt(8, 'receiving', 'large-original/1', hour, { case_id: otherCase })];
  const parts = [1, 2].map(n => ({ upload_id: open.id, part_number: n, state: 'received' }))
    .concat({ upload_id: open.id, part_number: 3, state: 'failed' });
  const globals = globalThis as unknown as { ulpinPool?: Pool }, prior = globals.ulpinPool;
  const { statements, pool } = listPool(rows, parts);
  globals.ulpinPool = pool;
  try {
    const listed = await new LargeOriginalService().list(caseId);
    assert.deepEqual(LargeUploadListSchema.parse(listed), listed);
    assert.deepEqual(listed.uploads.map(entry => entry.id), [cancelling.id, finalizing.id, open.id]);
    assert.deepEqual(listed.uploads[2], { id: open.id, filename: 'receipt-1.geojson', bytes: 26_660_992,
      sha256: '1'.repeat(64), profile: 'large-original/1', state: 'receiving', receivedParts: 2, partCount: 4,
      expiresAt: open.expires_at.toISOString(), revision: 2, currentCaseRevision: 3 });
    assert.equal(listed.uploads[1]?.profile, 'large-original/2');
    assert.ok(statements.includes('BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY'));
    assert.ok(!statements.some(statement => /FOR UPDATE/.test(statement)));
    const sql = statements.find(statement => statement.includes('usp_source_uploads u'))!;
    assert.match(sql, /u\.state IN\('receiving','finalizing','aborting'\) AND \(u\.expires_at>now\(\)\s+OR /);
    assert.match(sql, /ORDER BY u\.created_at DESC LIMIT 20/);
  } finally {
    globals.ulpinPool = prior;
  }
});
