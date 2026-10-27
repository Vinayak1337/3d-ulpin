import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { AppError } from '../../../infrastructure/errors';
import type { UspJobAttempt } from '../jobs';
import { failPointBatchJob } from './point-batch-worker';

// Protocol-only terminal bookkeeping; invalid payload prevents private source/event I/O.
test('point fences atomically keep safe causes and never overwrite prior diagnostics', async () => {
  const globals = globalThis as unknown as { ulpinPool?: Pool };
  const pool = globals.ulpinPool;
  const own = new AppError(422, 'POINT_SOURCE_INTEGRITY', 'The retained point source differs from its pins.');
  const transport = Object.assign(new Error('private path, key and record value'), { code: 'ETIMEDOUT' });
  const processor = new AppError(502, 'AREA_PROCESSING', 'private processor record value');
  const attempt: UspJobAttempt = { jobId: 'test-only', number: 1, fence: 1, owner: 'test-only',
    inputSha256: 'test-only', leaseUntil: new Date(Date.now() + 180000).toISOString() };
  try {
    const errors = [own, transport, processor, undefined];
    for (const error of errors) for (const prior of [null, { message: 'Earlier cause.' }]) {
      const row = { ...attempt, input_sha256: attempt.inputSha256, state: 'active', failure_cause: prior };
      let committed = false, fenced = false;
      const query = async (sql: string, args: any[] = []) => {
        let rows: unknown[] = [];
        if (sql === 'COMMIT') {
          assert.ok(fenced);
          committed = true;
        } else if (['BEGIN', 'ROLLBACK'].includes(sql)) { /* transaction control */ }
        else if (sql.startsWith('SELECT set_config')) rows = [{ deadline_live: true }];
        else if (sql.includes('FROM jobs')) rows = [{ status: 'running', payload: {} }];
        else if (sql.includes('FROM usp_job_metadata'))
          rows = [{ logical_state: 'running', input_sha256: attempt.inputSha256 }];
        else if (sql.includes('FROM usp_job_attempts')) rows = [row];
        else if (sql.includes('FROM usp_intake_parts')) rows = [];
        else if (sql.startsWith('UPDATE usp_job_attempts')) {
          assert.match(sql, /failure_cause=COALESCE\(failure_cause,\$2\)/);
          row.failure_cause ??= args[1];
          row.state = 'fenced';
          fenced = true;
        } else assert.ok(sql.startsWith('UPDATE jobs') || sql.startsWith('UPDATE usp_job_metadata'), sql);
        return { rows, rowCount: rows.length };
      };
      globals.ulpinPool = { query, connect: async () => ({ query, release() {} }) } as never;
      await failPointBatchJob(attempt.jobId, 'POINT_PROCESSING_FAILED', attempt, undefined, error);
      assert.ok(committed);
      if (prior) assert.deepEqual(row.failure_cause, prior);
      else {
        const cause = row.failure_cause as any;
        assert.equal(cause.message, error === own ? own.message : 'Error detail withheld.');
        if (error) assert.equal(error instanceof AppError ? cause.errorCode : cause.code, error.code);
        else assert.equal(cause.errorCode, 'POINT_PROCESSING_FAILED');
        assert.doesNotMatch(JSON.stringify(cause), /private|stack|path|key/);
      }
    }
  } finally {
    globals.ulpinPool = pool;
  }
});
