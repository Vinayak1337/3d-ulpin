import assert from 'node:assert/strict';
import test from 'node:test';
import { cancelUspJob, claimUspJobAttempt } from '../jobs';
import { mappingWorkerFixture } from './chunk-mapping-worker.fixture';

/** Cancellation protocol only: no original, provider, registry or runtime I/O. */
async function withCancellation(run: (fixture: ReturnType<typeof cancellationFixture>) => Promise<void>) {
  const globals = globalThis as typeof globalThis & { ulpinPool?: unknown };
  const saved = globals.ulpinPool;
  const savedSubject = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'test_only';
  const fixture = cancellationFixture();
  globals.ulpinPool = fixture.pool;
  try {
    await run(fixture);
  } finally {
    if (saved === undefined) delete globals.ulpinPool;
    else globals.ulpinPool = saved;
    if (savedSubject === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
    else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = savedSubject;
  }
}

function cancellationFixture() {
  const base = mappingWorkerFixture();
  Object.assign(base.input, { route: 'proposal_only', recipeId: null, recipeRevision: null, planHash: null });
  const meta = { ...base.meta, version: 1 };
  const guards = { newerJob: false, approved: false, sourceChanged: false, failItemWrite: false };
  const trace: string[] = [];
  let snapshot: string;
  const query = async (sql: string, values: any[] = []) => {
    trace.push(sql);
    if (sql === 'BEGIN') snapshot = JSON.stringify({ job: base.job, meta, intake: base.intake });
    if (sql === 'ROLLBACK') {
      const prior = JSON.parse(snapshot);
      Object.assign(base.job, prior.job);
      Object.assign(meta, prior.meta);
      Object.assign(base.intake, prior.intake);
    }
    if (sql.startsWith('SELECT * FROM usp_job_metadata')) return { rows: [meta], rowCount: 1 };
    if (sql.startsWith('UPDATE usp_job_metadata')) {
      meta.logical_state = /logical_state='(\w+)'/.exec(sql)![1];
      meta.version++;
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('SELECT id FROM cases') || sql.startsWith('SELECT id FROM sources'))
      return { rows: [{ id: values.at(-1) }], rowCount: 1 };
    if (sql.startsWith('SELECT i.item_id')) {
      assert.match(sql, /r.state IN \('approved','executed'\)/);
      assert.match(sql, /newer.created_at>\(SELECT created_at FROM jobs WHERE id=\$6\)/);
      assert.match(sql, /s.revision=\$3 AND s.sha256=\$4/);
      assert.equal(values[5], base.input.jobId);
      const eligible = !guards.newerJob && !guards.approved && !guards.sourceChanged;
      return { rows: eligible ? [base.intake] : [], rowCount: Number(eligible) };
    }
    if (sql.startsWith('UPDATE usp_intake_items SET state=') && guards.failItemWrite)
      throw new Error('test_only item write failure');
    return base.query(sql, values);
  };
  return { ...base, meta, guards, trace,
    pool: { query, connect: async () => ({ query, release() {} }) },
    cancel: () => cancelUspJob(base.input.jobId, meta.version) };
}

for (const running of [false, true]) {
  test(`cancelling a ${running ? 'running' : 'queued'} table meanings job asks the officer atomically`, async () => {
    await withCancellation(async fixture => {
      if (running) await claimUspJobAttempt(fixture.input.jobId, 'test_only');
      fixture.trace.length = 0;
      await fixture.cancel();
      assert.equal(fixture.meta.logical_state, 'cancelled');
      assert.equal(fixture.job.status, 'failed');
      if (running) assert.equal(fixture.attempts.at(-1)?.state, 'fenced');
      assert.equal(fixture.intake.state, 'read');
      assert.equal(fixture.intake.placement, 'needs_answer');
      assert.equal(fixture.intake.limit_reason,
        'The table is read, but proposing its field meanings failed (JOB_CANCELLED). '
          + 'Open the table to state the meanings yourself; nothing is recorded until you confirm it.');
      const sourceLock = fixture.trace.findIndex(sql => sql.startsWith('SELECT id FROM sources'));
      const jobLock = fixture.trace.findIndex(sql => sql.includes('FROM jobs') && sql.includes('FOR UPDATE'));
      const cancelled = fixture.trace.findIndex(sql => sql.startsWith('UPDATE jobs'));
      const itemWrite = fixture.trace.findIndex(sql => sql.startsWith('UPDATE usp_intake_items SET state='));
      assert.ok(sourceLock >= 0 && sourceLock < jobLock, 'case/source locks precede the job lock');
      assert.ok(cancelled < itemWrite && itemWrite < fixture.trace.lastIndexOf('COMMIT'));
      assert.equal(fixture.trace.filter(sql => sql === 'BEGIN').length, 1);
      assert(!fixture.trace.some(sql => /INSERT INTO registry_|UPDATE sources/.test(sql)));
    });
  });
}

for (const operation of ['non-tabular', 'streamed-profile']) {
  test(`cancelling ${operation} changes no intake item`, async () => {
    await withCancellation(async fixture => {
      if (operation === 'non-tabular') delete fixture.input.tabular;
      else fixture.job.operation = operation;
      const before = { ...fixture.intake };
      await fixture.cancel();
      assert.equal(fixture.meta.logical_state, 'cancelled');
      assert.deepEqual(fixture.intake, before);
      assert(!fixture.trace.some(sql => sql.includes('usp_intake_items')));
    });
  });
}

for (const guard of ['newerJob', 'approved', 'sourceChanged'] as const) {
  test(`cancellation leaves the table untouched when ${guard}`, async () => {
    await withCancellation(async fixture => {
      fixture.guards[guard] = true;
      const before = { ...fixture.intake };
      await fixture.cancel();
      assert.equal(fixture.meta.logical_state, 'cancelled');
      assert.ok(fixture.trace.some(sql => sql.startsWith('SELECT i.item_id')));
      assert.deepEqual(fixture.intake, before);
    });
  });
}

for (const placement of ['placed', 'kept_only', 'not_understood']) {
  test(`cancellation preserves officer placement ${placement}`, async () => {
    await withCancellation(async fixture => {
      fixture.intake.placement = placement;
      const before = { ...fixture.intake };
      await fixture.cancel();
      assert.deepEqual(fixture.intake, before);
    });
  });
}

test('cancellation preserves an officer plan and ignores an approved-recipe mapping', async () => {
  await withCancellation(async fixture => {
    Object.assign(fixture.intake, { plan_ref: { test_only: true } });
    const before = { ...fixture.intake };
    await fixture.cancel();
    assert.deepEqual(fixture.intake, before);
  });
  await withCancellation(async fixture => {
    Object.assign(fixture.input, { route: 'approved_recipe', recipeId: fixture.input.caseId,
      recipeRevision: 1, planHash: fixture.input.sourceSha256 });
    const before = { ...fixture.intake };
    await fixture.cancel();
    assert.deepEqual(fixture.intake, before);
  });
});

test('stale cancellation versions and accepted results cannot settle table words', async () => {
  await withCancellation(async fixture => {
    const before = { ...fixture.intake };
    await assert.rejects(cancelUspJob(fixture.input.jobId, 0), { status: 409 });
    fixture.meta.logical_state = 'succeeded';
    await assert.rejects(fixture.cancel(), { status: 409 });
    assert.deepEqual(fixture.intake, before);
    assert(!fixture.trace.some(sql => sql.startsWith('SELECT i.item_id')));
  });
});

test('a failed item write rolls cancellation back instead of leaving proposing words on a cancelled job', async () => {
  await withCancellation(async fixture => {
    fixture.guards.failItemWrite = true;
    const before = { ...fixture.intake };
    await assert.rejects(fixture.cancel(), /test_only item write failure/);
    assert.equal(fixture.meta.logical_state, 'queued');
    assert.equal(fixture.job.status, 'queued');
    assert.deepEqual(fixture.intake, before);
    assert.equal(fixture.trace.at(-1), 'ROLLBACK');
    assert(!fixture.trace.includes('COMMIT'));
  });
});
