import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { AppError } from '../../infrastructure/errors';
import { claimUspJobAttempt, heartbeatUspJobAttempt, recordUspJobFailure,
  yieldUspJobAttempt, USP_JOB_LIMITS } from './jobs';

const jobId = '30000000-0000-4000-8000-000000000001';
const start = Date.UTC(2026, 9, 22, 16, 56, 5);
type AttemptRow = {
  number: number;
  fence: number;
  owner: string;
  input_sha256: string;
  lease_until: Date;
  state: string;
  failure_cause?: unknown;
};

/** Only the existing fenced authority is faked; clock advances exercise its real claim and renewal SQL. */
function store() {
  const job = { operation: 'streaming-vector', status: 'queued', attempts: 0, dispatched_at: null as Date | null };
  const meta = { logical_state: 'queued', input_sha256: 'a'.repeat(64) };
  const attempts: AttemptRow[] = [];
  const one = (row?: object) => ({ rows: row ? [row] : [], rowCount: row ? 1 : 0 });
  const query = async (sql: string, values: unknown[] = []) => {
    if (/^SELECT (\*|status|operation) FROM jobs/.test(sql)) return one(job);
    if (sql.startsWith('SELECT * FROM usp_job_metadata')) return one(meta);
    if (sql.startsWith('SELECT count(*)::int n FROM usp_job_attempts'))
      return one({ n: attempts.filter(row => row.state !== 'yielded').length });
    if (sql.startsWith('SELECT * FROM usp_job_attempts'))
      return one(values.length > 1 ? attempts.find(row => row.number === values[1]) : attempts.at(-1));
    if (sql.startsWith('INSERT INTO usp_job_attempts')) {
      attempts.push({ number: Number(values[1]), fence: Number(values[2]), owner: String(values[3]),
        input_sha256: String(values[4]), lease_until: new Date(Date.now() + 180000), state: 'active' });
      return one(attempts.at(-1));
    }
    if (sql.startsWith('UPDATE usp_job_attempts SET failure_cause='))
      attempts.find(row => row.number === values[1])!.failure_cause = values[2];
    if (sql.startsWith("UPDATE usp_job_attempts SET state='yielded'"))
      attempts.find(row => row.number === values[1])!.state = 'yielded';
    if (sql.startsWith('UPDATE usp_job_metadata'))
      meta.logical_state = sql.includes("logical_state='queued'") ? 'queued' : 'running';
    if (sql.startsWith('UPDATE jobs')) {
      job.status = sql.includes("status='queued'") ? 'queued' : 'running';
      if (values.length > 1) job.attempts = Number(values[1]);
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

test('Zod failure causes retain only issue paths and codes, never source values or messages', async () => {
  await withStore(async state => {
    const attempt = await claimUspJobAttempt(jobId, 'test_only');
    const parsed = z.object({ framing: z.enum(['feature-collection']),
      rows: z.array(z.object({ count: z.number() })) }).safeParse({
      framing: 'test_only_private_text', rows: [{ count: 'test_only_private_text' }] });
    assert.equal(parsed.success, false);
    if (parsed.success) return;
    await recordUspJobFailure(attempt, 'INTAKE_LARGE_STEP_FAILED', parsed.error);
    assert.deepEqual(state.attempts[0].failure_cause, {
      errorCode: 'INTAKE_LARGE_STEP_FAILED', class: 'ZodError', message: 'Error detail withheld.', zodIssues: [
        { path: ['framing'], code: 'invalid_value' }, { path: ['rows', 0, 'count'], code: 'invalid_type' },
      ],
    });
    assert.doesNotMatch(JSON.stringify(state.attempts[0].failure_cause), /test_only_private_text|expected|received/);
  });
});

test('ordinary failure diagnostics retain the error name and at most 300 message characters, never the stack', async () => {
  await withStore(async state => {
    const attempt = await claimUspJobAttempt(jobId, 'test_only');
    const error = new TypeError('test_only failure '.repeat(30));
    error.name = 'ProfileFailure';
    error.stack = 'test_only stack must not be stored';
    Object.assign(error, { detail: 'test_only source detail must not be stored' });
    await recordUspJobFailure(attempt, 'STEP_FAILED', error);
    assert.deepEqual(state.attempts[0].failure_cause, {
      errorCode: 'STEP_FAILED', class: 'ProfileFailure', message: error.message.slice(0, 300),
    });
    assert.equal((state.attempts[0].failure_cause as { message: string }).message.length, 300);
    assert.doesNotMatch(JSON.stringify(state.attempts[0].failure_cause), /stack|source detail/);
    error.name = 'x'.repeat(100);
    await recordUspJobFailure(attempt, 'STEP_FAILED', error);
    assert.equal((state.attempts[0].failure_cause as { class: string }).class.length, 80);
  });
});

test('application refusals keep existing diagnostics unchanged and a stale fence cannot overwrite a cause', async () => {
  await withStore(async state => {
    const attempt = await claimUspJobAttempt(jobId, 'test_only');
    await recordUspJobFailure(attempt, 'STEP_FAILED', new AppError(422, 'STEP_FAILED', 'test_only refusal'));
    assert.equal(state.attempts[0].failure_cause, undefined);
    await recordUspJobFailure(attempt, 'STEP_FAILED', new Error('test_only original cause'));
    const cause = state.attempts[0].failure_cause;
    state.attempts[0].state = 'fenced';
    await recordUspJobFailure(attempt, 'STEP_FAILED', new Error('test_only late cause'));
    assert.deepEqual(state.attempts[0].failure_cause, cause);
  });
});

test('Zod failure diagnostics bound issue counts and field path lengths', async () => {
  await withStore(async state => {
    const attempt = await claimUspJobAttempt(jobId, 'test_only');
    const error = new z.ZodError(Array.from({ length: 25 }, () => ({ code: 'custom',
      path: Array(40).fill('x'.repeat(200)), message: 'test_only_private_text' })));
    await recordUspJobFailure(attempt, 'STEP_FAILED', error);
    const cause = state.attempts[0].failure_cause as { zodIssues: { path: string[]; code: string }[] };
    assert.equal(cause.zodIssues.length, 20);
    assert.ok(cause.zodIssues.every(issue => issue.path.length === 32
      && issue.path.every(part => part.length === 128) && issue.code === 'custom'));
    assert.doesNotMatch(JSON.stringify(cause), /test_only_private_text/);
  });
});

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

test('yielded profile attempts preserve monotonic fences without spending the three-attempt limit', async () => {
  await withStore(async state => {
    state.job.operation = 'streamed-profile';
    for (let index = 1; index <= 6; index++) {
      const attempt = await claimUspJobAttempt(jobId, `dispatch-${index}`);
      assert.equal(attempt.number, index);
      assert.equal(attempt.fence, index);
      assert.equal(state.job.attempts, 1);
      await yieldUspJobAttempt(attempt);
      assert.equal(state.attempts.at(-1)?.state, 'yielded');
      assert.equal(state.job.status, 'queued');
      assert.equal(state.meta.logical_state, 'queued');
    }
  });
});

test('three failed profile attempts still exhaust the limit after successful yields', async () => {
  await withStore(async state => {
    state.job.operation = 'streamed-profile';
    await yieldUspJobAttempt(await claimUspJobAttempt(jobId, 'yield'));
    for (let index = 1; index <= 3; index++) {
      await claimUspJobAttempt(jobId, `failure-${index}`);
      assert.equal(state.job.attempts, index);
      state.attempts.at(-1)!.state = 'fenced';
    }
    await assert.rejects(claimUspJobAttempt(jobId, 'fourth-failure'), { code: 'USP_JOB_ATTEMPTS' });
  });
});

test('only a live, exact profile fence can yield', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: start });
  await withStore(async state => {
    const other = await claimUspJobAttempt(jobId, 'other-operation');
    await assert.rejects(yieldUspJobAttempt(other), { code: 'USP_JOB_OPERATION' });
    state.job.operation = 'streamed-profile';
    await assert.rejects(yieldUspJobAttempt({ ...other, fence: other.fence + 1 }), { status: 409 });
    await assert.rejects(yieldUspJobAttempt({ ...other, owner: 'not-the-owner' }), { status: 409 });
    await assert.rejects(yieldUspJobAttempt({ ...other, inputSha256: 'b'.repeat(64) }), { status: 409 });
    state.attempts[0].state = 'fenced';
    await assert.rejects(yieldUspJobAttempt(other), { status: 409 });
    const current = await claimUspJobAttempt(jobId, 'current');
    await assert.rejects(yieldUspJobAttempt(other), { status: 409 });
    t.mock.timers.tick(USP_JOB_LIMITS.leaseSeconds * 1000);
    await assert.rejects(yieldUspJobAttempt(current), { status: 409 });
    assert.equal(state.attempts.at(-1)?.state, 'active');
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
