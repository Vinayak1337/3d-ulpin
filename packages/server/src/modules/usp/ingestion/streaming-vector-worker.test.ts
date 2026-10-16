import assert from 'node:assert/strict';
import test from 'node:test';
import type { PoolClient } from 'pg';
import type { AnyStreamingInput } from '@ulpin/contracts/usp';
import { AppError, conflict } from '../../../infrastructure/errors';
import { localOperatorSubject } from '../principal';
import { endImportTx, fencedOut } from './streaming-vector-worker';

const caseId = '30000000-0000-4000-8000-000000000001';
const sourceId = '30000000-0000-4000-8000-000000000002';
const jobId = '30000000-0000-4000-8000-000000000003';
process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'streaming-vector-protocol';
const input = { jobId, caseId, sourceId, sourceRevision: 1, subject: localOperatorSubject() } as AnyStreamingInput;
const marker = { index: 487, featureIndex: 48686, attempt: 1, fence: 1 };

/** Records every statement; the published watermark already stands at the sealed count. */
function recorder() {
  const statements: { sql: string; values: unknown[] }[] = [];
  const one = (row: unknown) => ({ rows: row ? [row] : [], rowCount: row ? 1 : 0 });
  const client = { query: async (sql: string, values: unknown[] = []) => {
    statements.push({ sql, values });
    if (sql.startsWith('SELECT next_publish_index')) return one({ next_publish_index: 487 });
    if (sql.startsWith('SELECT revision FROM cases')) return one({ revision: 3 });
    if (sql.startsWith('UPDATE usp_outbox_streams')) return one({ sequence: '1' });
    return one(null);
  } } as unknown as PoolClient;
  const find = (prefix: string) => statements.filter(statement => statement.sql.trimStart().startsWith(prefix));
  return { client, statements, find };
}

test('a failure after the seal ends the job failed once, with no slot past the seal and no retry', async () => {
  const sealed = recorder();
  await endImportTx(sealed.client, input, { records: 48686, sealed_chunks: 487, next_publish_index: 487 },
    'STREAMING_SOURCE_CRS', false, marker);
  assert.equal(sealed.find('INSERT INTO usp_streaming_vector_slots').length, 0);
  assert.equal(sealed.find('SELECT next_publish_index').length, 0, 'nothing is published past the seal');
  assert.deepEqual(sealed.find('UPDATE jobs').map(statement => statement.values), [[jobId, 'failed',
    'STREAMING_SOURCE_CRS']]);
  assert.deepEqual(sealed.find('UPDATE usp_streaming_vector_imports').map(statement => statement.values),
    [[jobId, 'failed', 'STREAMING_SOURCE_CRS', false]]);
  assert(!sealed.statements.some(statement => /status='queued'|logical_state='queued'/.test(statement.sql)));
  assert.equal(sealed.find('UPDATE usp_outbox_streams').length, 1, 'one failed event');
});

test('an unsealed failure still closes the published prefix with its ordered marker', async () => {
  const open = recorder();
  await endImportTx(open.client, input, { records: 48686, sealed_chunks: null, next_publish_index: 487 },
    'GEOJSON_JSON', false, marker);
  const [slot] = open.find('INSERT INTO usp_streaming_vector_slots');
  assert.deepEqual(slot.values.slice(0, 5), [jobId, 1, 487, 48686, 'GEOJSON_JSON']);
  assert.equal(open.find('SELECT next_publish_index').length, 1);
  assert.deepEqual(open.find('UPDATE usp_streaming_vector_imports').at(-1)!.values,
    [jobId, 'failed', 'GEOJSON_JSON', true]);
  await assert.rejects(endImportTx(recorder().client, input, { records: 48600, sealed_chunks: null,
    next_publish_index: 487 }, 'GEOJSON_JSON', false, marker), { status: 409, code: 'STALE_REVISION' });
  const stale = recorder();
  await endImportTx(stale.client, input, { records: 48686, sealed_chunks: null, next_publish_index: 487 },
    'STREAMING_CONTEXT_STALE', true, null);
  assert.equal(stale.find('INSERT INTO usp_streaming_vector_slots').length, 0);
  assert.deepEqual(stale.find('UPDATE jobs')[0].values, [jobId, 'stale', 'STREAMING_CONTEXT_STALE']);
  assert.equal(stale.find('UPDATE usp_outbox_streams').length, 0);
});

test('only a lost fence is swallowed; any other failure to end the job reaches the dispatcher', () => {
  assert.throws(() => conflict('This worker completion expired, changed inputs or was fenced.'),
    (error: unknown) => fencedOut(error));
  const check = Object.assign(new Error('new row violates check constraint'), { code: '23514' });
  for (const error of [check, new AppError(422, 'STREAMING_SOURCE_CRS', 'refused'),
    new AppError(409, 'STREAMING_REPLAY', 'other'), undefined]) assert.equal(fencedOut(error), false);
});
