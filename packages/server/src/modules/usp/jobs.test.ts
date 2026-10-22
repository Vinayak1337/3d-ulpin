import assert from 'node:assert/strict';
import test from 'node:test';
import { claimUspJobAttempt, heartbeatUspJobAttempt, USP_JOB_LIMITS } from './jobs';

const jobId = '30000000-0000-4000-8000-000000000001';
const start = Date.UTC(2026, 9, 22, 16, 56, 5);
type AttemptRow = {
  number: number;
  fence: number;
  owner: string;
  input_sha256: string;
  lease_until: Date;
  state: string;
};

/** Only the existing fenced authority is faked; clock advances exercise its real claim and renewal SQL. */
function store() {
  const job = { status: 'queued', attempts: 0, dispatched_at: null as Date | null };
  const meta = { logical_state: 'queued', input_sha256: 'a'.repeat(64) };
  const attempts: AttemptRow[] = [];
  const one = (row?: object) => ({ rows: row ? [row] : [], rowCount: row ? 1 : 0 });
  const query = async (sql: string, values: unknown[] = []) => {
    if (sql.startsWith('SELECT * FROM jobs')) return one(job);
    if (sql.startsWith('SELECT * FROM usp_job_metadata')) return one(meta);
    if (sql.startsWith('SELECT * FROM usp_job_attempts')) return one(attempts.at(-1));
    if (sql.startsWith('INSERT INTO usp_job_attempts')) {
      attempts.push({ number: Number(values[1]), fence: Number(values[2]), owner: String(values[3]),
        input_sha256: String(values[4]), lease_until: new Date(Date.now() + 180000), state: 'active' });
      return one(attempts.at(-1));
    }
    if (sql.startsWith('UPDATE usp_job_metadata')) meta.logical_state = 'running';
    if (sql.startsWith('UPDATE jobs')) {
      job.status = 'running';
      job.attempts = Number(values[1]);
      if (sql.includes('dispatched_at=COALESCE(dispatched_at,now())')) job.dispatched_at ??= new Date();
    }
    if (sql.startsWith('UPDATE usp_job_attempts SET lease_until')) {
      const row = attempts.find(attempt => attempt.number === values[1]);
      if (!row || row.state !== 'active' || row.lease_until.getTime() <= Date.now()
        || row.fence !== values[2] || row.owner !== values[3] || row.input_sha256 !== values[4]) return one();
      row.lease_until = new Date(Date.now() + 180000);
      return one(row);
    }
    return one();
  };
  const client = { query, release: () => {} };
  const pool = { query, connect: async () => client };
  return { job, meta, attempts, pool };
}

async function withStore(run: (state: ReturnType<typeof store>) => Promise<void>) {
  const globals = globalThis as typeof globalThis & { ulpinPool?: unknown };
  const previous = globals.ulpinPool;
  const state = store();
  globals.ulpinPool = state.pool;
  try {
    await run(state);
  } finally {
    if (previous === undefined) delete globals.ulpinPool;
    else globals.ulpinPool = previous;
  }
}

test('every fenced claim records first dispatch, including chained jobs and processor-backed readers', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: start });
  await withStore(async state => {
    const first = await claimUspJobAttempt(jobId, 'first');
    assert.equal(state.job.dispatched_at?.getTime(), start);
    assert.equal(first.number, 1);
    state.attempts[0].state = 'fenced';
    state.job.status = 'queued';
    state.meta.logical_state = 'queued';
    t.mock.timers.tick(156000);
    const second = await claimUspJobAttempt(jobId, 'second');
    assert.equal(second.number, 2);
    assert.equal(state.job.dispatched_at?.getTime(), start, 'a retry does not overwrite first claim time');
    await assert.rejects(heartbeatUspJobAttempt(first), { status: 409 });
  });
});

test('a 330 second read survives the unchanged 180 second lease with existing 30 second renewals', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: start });
  await withStore(async state => {
    let attempt = await claimUspJobAttempt(jobId, 'reader');
    for (let elapsed = 30; elapsed <= 330; elapsed += 30) {
      t.mock.timers.tick(USP_JOB_LIMITS.heartbeatSeconds * 1000);
      attempt = await heartbeatUspJobAttempt(attempt);
      assert.equal(new Date(attempt.leaseUntil).getTime(), start + (elapsed + 180) * 1000);
    }
    assert.equal(state.attempts.length, 1, 'duration alone does not require a retry or a longer lease');
    assert.equal(state.job.attempts, 1);
  });
});

test('a genuinely expired lease is not revived by a late heartbeat', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: start });
  await withStore(async state => {
    const attempt = await claimUspJobAttempt(jobId, 'reader');
    t.mock.timers.tick(USP_JOB_LIMITS.leaseSeconds * 1000);
    await assert.rejects(heartbeatUspJobAttempt(attempt), { status: 409 });
    assert.equal(state.attempts[0].lease_until.getTime(), start + 180000);
    const next = await claimUspJobAttempt(jobId, 'recovery');
    assert.equal(next.number, 2);
    assert.equal(state.job.dispatched_at?.getTime(), start);
  });
});
