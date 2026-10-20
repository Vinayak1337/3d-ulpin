import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { LargeUploadStatusSchema } from '@ulpin/contracts/usp';
import { localOperatorSubject } from '../principal';
import { LargeOriginalService } from './large-original';

process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'n04b-status-operator';
const caseId = '04b00000-0000-4000-8000-000000000001';
const jobId = '04b00000-0000-4000-8000-000000000002';
type Row = Record<string, any>;

/** One receipt row as the table stores it, left 'finalizing'; the profile and lease vary per case below. */
function receipt(n: number, profile: string, lease: Date | null, body: Row = {}): Row {
  return { id: `04b00000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`, case_id: caseId,
    operator_subject: localOperatorSubject(), revision: 7, case_revision: 3, state: 'finalizing',
    original_bytes: String(26_660_992), lease_expires_at: lease, expires_at: new Date(Date.now() + 3_600_000),
    body: { input: { filename: 'receipt.geojson', mediaType: 'application/octet-stream', sha256: 'a'.repeat(64),
      profile }, cleanupPending: true, lastError: null, ...body } };
}

/** The status read over rows in memory; any statement outside it fails the test. */
function statusPool(upload: Row, jobs: Row[]) {
  const statements: string[] = [];
  const result = (found: Row[]) => ({ rows: found, rowCount: found.length });
  const run = async (sql: string, values: unknown[] = []) => {
    statements.push(sql);
    if (/^(BEGIN|COMMIT|ROLLBACK|SET)/.test(sql)) return result([]);
    if (sql.startsWith('SELECT id,revision FROM cases WHERE id=$1')) return result([{ id: values[0], revision: 3 }]);
    if (sql.startsWith('SELECT * FROM usp_source_uploads WHERE id=$1 AND case_id=$2'))
      return result(upload.id === values[0] && upload.case_id === values[1] ? [upload] : []);
    if (sql.startsWith('SELECT * FROM usp_source_upload_parts WHERE upload_id=$1')) return result([]);
    if (sql.startsWith('SELECT status,error FROM jobs WHERE id=$1'))
      return result(jobs.filter(job => job.id === values[0]).map(({ status, error }) => ({ status, error })));
    throw new Error(`Statement outside this protocol: ${sql.slice(0, 80)}`);
  };
  const pool = { query: run, connect: async () => ({ query: run, release: () => undefined }) };
  return { statements, pool: pool as unknown as Pool };
}

async function read(upload: Row, jobs: Row[] = []) {
  const globals = globalThis as unknown as { ulpinPool?: Pool }, prior = globals.ulpinPool;
  const { statements, pool } = statusPool(upload, jobs);
  globals.ulpinPool = pool;
  try {
    const status = await new LargeOriginalService().read(caseId, upload.id);
    assert.deepEqual(LargeUploadStatusSchema.parse(status), status);
    return { status, jobReads: statements.filter(sql => sql.includes('FROM jobs')) };
  } finally {
    globals.ulpinPool = prior;
  }
}

test('a v1 receipt states its finalization lease expiry, and reads no job', async () => {
  const lease = new Date(Date.now() - 60_000);
  const { status, jobReads } = await read(receipt(1, 'large-original/1', lease));
  assert.equal(status.leaseExpiresAt, lease.toISOString());
  assert.equal(status.finalization, undefined);
  assert.equal(jobReads.length, 0);
  const unleased = await read(receipt(2, 'large-original/1', null));
  assert.equal(unleased.status.leaseExpiresAt, null);
});

test('a v2 receipt states its storage job status and error from one read by job id', async () => {
  const upload = receipt(3, 'large-original/2', null,
    { storageJobId: jobId, finalizationPhase: 'assembling', completedParts: 2 });
  const { status, jobReads } = await read(upload, [{ id: jobId, status: 'failed', error: 'SOURCE_STALE' }]);
  assert.equal(status.leaseExpiresAt, null);
  assert.deepEqual(status.finalization, { jobId, phase: 'assembling', completedParts: 2, jobStatus: 'failed',
    jobError: 'SOURCE_STALE' });
  assert.deepEqual(jobReads, ["SELECT status,error FROM jobs WHERE id=$1 AND operation='large-original-storage'"]);
  const missing = await read(upload);
  assert.deepEqual(missing.status.finalization, { jobId, phase: 'assembling', completedParts: 2 });
  const unqueued = await read(receipt(4, 'large-original/2', null), [{ id: jobId, status: 'queued', error: null }]);
  assert.equal(unqueued.status.finalization, undefined);
  assert.equal(unqueued.jobReads.length, 0);
});
