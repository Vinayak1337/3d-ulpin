import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { CHUNK_MAPPING_LIMITS as limits, itemPendingKinds, type ChunkMappingPayload } from '@ulpin/contracts/usp';
import { DispatchReservations, DISPATCH_LANES } from '../../cases/dispatch-lanes';
import { claimUspJobAttempt } from '../jobs';
import { loadMappingWorker, loadTabularPublisher, mappingWorkerFixture } from './chunk-mapping-worker.fixture';

const epoch = Date.UTC(2026, 9, 25);
async function withWorker(windowed: boolean,
  run: (fixture: ReturnType<typeof mappingWorkerFixture>, worker: () => Promise<void>) => Promise<void>) {
  const globals = globalThis as typeof globalThis & { ulpinPool?: unknown; s13hMapping?: unknown };
  const saved = { pool: globals.ulpinPool, controls: globals.s13hMapping,
    subject: process.env.ULPIN_LOCAL_OPERATOR_SUBJECT };
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'test_only';
  const folder = await mkdtemp(join(tmpdir(), 'mapping-worker-'));
  const fixture = mappingWorkerFixture(0, windowed);
  globals.ulpinPool = fixture.pool;
  try {
    const worker = await loadMappingWorker(folder, fixture);
    await run(fixture, () => worker.runChunkMappingJob(fixture.input.jobId));
  } finally {
    globals.ulpinPool = saved.pool;
    globals.s13hMapping = saved.controls;
    if (saved.subject === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
    else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = saved.subject;
    for (const file of await readdir(folder)) await rm(join(folder, file));
    await rmdir(folder);
  }
}

test('four admitted mappings remain bounded by two simultaneous table-lane workers', () => {
  assert.equal(limits.active, 4);
  assert.equal(DISPATCH_LANES.table.concurrency, 2);
});

test('an existing live mapping lease is never requeued or claimed twice', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: epoch });
  await withWorker(false, async (fixture, worker) => {
    await claimUspJobAttempt(fixture.input.jobId, 'test_only');
    await worker();
    assert.equal(fixture.attempts.length, 1);
    assert.equal(fixture.attempts[0].state, 'active');
    assert.equal(fixture.job.status, 'running');
  });
});

test('source integrity failure keeps the claimed quarantine marker and consumes no raw part', async () => {
  await withWorker(false, async (fixture, worker) => {
    fixture.publish();
    Object.assign(fixture.raw, { state: 'failed', issue_code: 'STREAMING_SOURCE_INTEGRITY' });
    await worker();
    assert.equal(fixture.job.status, 'failed');
    assert.equal(fixture.job.error, 'STREAMING_SOURCE_INTEGRITY');
    assert.equal(fixture.attempts.length, 1);
    assert.ok(fixture.statements.some(sql => sql.startsWith('INSERT INTO usp_chunk_mapping_slots')));
    assert.deepEqual(fixture.reads, []);
  });
});

test('pre-claim mapping waits still reassert the pinned source context', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: epoch });
  await withWorker(false, async (fixture, worker) => {
    fixture.controls.stale = true;
    await worker();
    assert.equal(fixture.job.status, 'stale');
    assert.equal(fixture.attempts.length, 0);
  });
});

test('a resumed table-window proposal finishes after its sample without waiting for another raw window', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: epoch });
  await withWorker(true, async (fixture, worker) => {
    Object.assign(fixture.input, { route: 'proposal_only', recipeId: null, recipeRevision: null, planHash: null });
    fixture.publish();
    fixture.state.next_raw_index = 1;
    await worker();
    assert.equal(fixture.job.status, 'succeeded');
    assert.equal(fixture.state.state, 'needs_input');
    assert.equal(fixture.attempts.length, 1);
  });
});

for (const source of ['rule', 'unanswered'] as const) {
  test(`a durable first table proposal from ${source} updates the words and pending action`, async () => {
    await withWorker(false, async (fixture, worker) => {
      const folder = await mkdtemp(join(tmpdir(), 'table-meanings-'));
      const baseline = process.env.S4_13_BASELINE === '1';
      try {
        const { publishTabularMappingTx } = await loadTabularPublisher(folder, baseline);
        Object.assign(fixture.input, { route: 'proposal_only', recipeId: null, recipeRevision: null, planHash: null });
        fixture.publish();
        fixture.state.state = 'running';
        const attempt = await claimUspJobAttempt(fixture.input.jobId, 'test_only');
        // Routing transport double only; no assertion about a real column's meaning or any registry truth.
        const payload = { chunkIndex: 0, mapping: { rows: [], fieldSources: [{ source }], metrics: {
          kind: 'mapping.chunk', jobId: fixture.input.jobId, chunkIndex: 0, layout: 'new', teacherCalls: 0,
          memoryHits: 0, ruleFields: Number(source === 'rule'), studentFields: 0, teacherFields: 0,
          unansweredFields: Number(source === 'unanswered'), needsInput: 1, latencyMs: 0, learnerVersion: null,
        } } } as unknown as ChunkMappingPayload;
        await publishTabularMappingTx({ query: fixture.query }, fixture.input, attempt,
          { payload, bytes: 1, hash: fixture.input.sourceSha256, key: 'test_only' }, 0, fixture.input.sourceSha256);
        assert.equal(fixture.intake.state, 'read');
        assert.equal(fixture.intake.placement, 'needs_answer');
        if (source === 'rule') assert.equal(fixture.intake.limit_reason,
          'The table is read. Its field meanings are ready for your review; '
            + 'nothing is recorded until you confirm it.');
        else assert.match(fixture.intake.limit_reason, /No proposer.*Open the table/);
        const item = { itemId: fixture.input.sourceId, name: 'test_only.csv', sourceId: fixture.input.sourceId,
          parentItemId: null, family: 'table', state: 'read', placement: fixture.intake.placement, plan: null,
          layoutQuestion: false, limitReason: fixture.intake.limit_reason,
          card: { family: 'table', format: 'csv', sheets: [] } } as Parameters<typeof itemPendingKinds>[0];
        assert.deepEqual(itemPendingKinds(item, [item]), [{ kind: 'table_placement' }]);
        const words = fixture.intake.limit_reason;
        fixture.attempts.at(-1).state = 'yielded';
        fixture.job.status = 'queued';
        fixture.raw.state = 'completed';
        fixture.raw.unknown_remainder = false;
        fixture.raw.records = 1;
        await worker();
        assert.equal(fixture.job.status, 'succeeded');
        assert.equal(fixture.intake.limit_reason, words, 'completion preserves the published answer');
        assert(!fixture.statements.some(sql => /INSERT INTO registry_|UPDATE sources/.test(sql)));
      } finally {
        for (const file of await readdir(folder)) await rm(join(folder, file));
        await rmdir(folder);
      }
    });
  });
}

test('a completed table with no proposed meanings asks the officer instead of proposing forever', async () => {
  await withWorker(false, async (fixture, worker) => {
    Object.assign(fixture.input, { route: 'proposal_only', recipeId: null, recipeRevision: null, planHash: null });
    fixture.raw.state = 'completed';
    fixture.raw.unknown_remainder = false;
    await worker();
    assert.equal(fixture.job.status, 'succeeded');
    assert.equal(fixture.intake.placement, 'needs_answer');
    assert.match(fixture.intake.limit_reason, /No proposer.*Open the table.*state.*meanings/);
    assert.doesNotMatch(fixture.intake.limit_reason, /being proposed|ready for your review/);
  });
});

for (const windowed of [false, true]) {
  test(`a failed table proposal ${windowed ? 'window' : 'slot'} offers manual meanings with its code`, async t => {
    t.mock.timers.enable({ apis: ['Date'], now: epoch });
    await withWorker(windowed, async (fixture, worker) => {
      Object.assign(fixture.input, { route: 'proposal_only', recipeId: null, recipeRevision: null, planHash: null });
      fixture.job.dispatched_at = new Date(epoch - limits.readMs);
      fixture.state.updated_at = new Date(epoch - limits.readMs);
      await worker();
      assert.equal(fixture.job.status, 'failed');
      assert.equal(fixture.intake.placement, 'needs_answer');
      assert.match(fixture.intake.limit_reason, /proposing.*failed.*MAPPING_SOURCE_WAIT.*Open the table/i);
      assert.doesNotMatch(fixture.intake.limit_reason, /being proposed|ready for your review/);
    });
  });

  test(`mapping ${windowed ? 'windows' : 'slots'} requeue without a claim and return memory/heap/lane`, async t => {
    t.mock.timers.enable({ apis: ['Date'], now: epoch });
    await withWorker(windowed, async (fixture, worker) => {
      const held = new DispatchReservations();
      const job = { id: fixture.input.jobId, operation: 'chunk-mapping', created_at: new Date() };
      assert.ok(held.admit(job, 256, [], Date.now(), 0, 256));
      await worker().finally(() => held.release(job.id));
      assert.equal(fixture.job.status, 'queued');
      assert.equal(fixture.job.next_attempt_at.getTime(), epoch + 2000);
      assert.equal(fixture.attempts.length, 0);
      assert.ok(fixture.statements.some(sql => sql.includes(windowed
        ? 'FROM usp_table_windows' : 'FROM usp_streaming_vector_slots')));
      assert.deepEqual(held.heldJobIds(), []);
      assert.ok(held.admit({ ...job, id: 'next' }, 256, [], Date.now(), 0, 256));
    });
  });

  test(`mapping ${windowed ? 'windows' : 'slots'} drain bursts, yield beyond three attempts and seal once`, async t => {
    t.mock.timers.enable({ apis: ['Date'], now: epoch });
    await withWorker(windowed, async (fixture, worker) => {
      for (let burst = 0; burst < 5; burst++) {
        fixture.publish();
        fixture.publish();
        await worker();
        assert.equal(fixture.state.next_raw_index, (burst + 1) * 2);
        assert.equal(fixture.attempts.at(-1)?.state, 'yielded');
        assert.equal(fixture.job.attempts, 1);
        t.mock.timers.tick(2000);
      }
      fixture.raw.state = 'completed_with_rejections';
      fixture.raw.unknown_remainder = false;
      await worker();
      assert.equal(fixture.job.status, 'succeeded');
      assert.equal(fixture.state.state, 'completed');
      assert.equal(fixture.attempts.at(-1)?.state, 'accepted');
      assert.equal(fixture.state.next_raw_index, 10);
    });
  });

  test(`mapping ${windowed ? 'windows' : 'slots'} keep a durable 12-minute deadline across dispatches`, async t => {
    t.mock.timers.enable({ apis: ['Date'], now: epoch });
    await withWorker(windowed, async (fixture, worker) => {
      fixture.state.updated_at = new Date(epoch - limits.readMs);
      await worker();
      assert.equal(fixture.state.updated_at.getTime(), epoch, 'first entry, not enqueue, starts the clock');
      for (let turn = 0; turn < 5; turn++) {
        t.mock.timers.tick(2000);
        await worker();
        assert.equal(fixture.state.updated_at.getTime(), epoch);
      }
      t.mock.timers.tick(limits.readMs - 10001);
      fixture.publish();
      await worker();
      const publishedAt = fixture.state.updated_at.getTime();
      t.mock.timers.tick(limits.readMs - 1);
      await worker();
      assert.equal(fixture.job.status, 'queued');
      assert.equal(fixture.state.updated_at.getTime(), publishedAt);
      t.mock.timers.tick(1);
      await worker();
      assert.equal(fixture.job.status, 'failed');
      assert.equal(fixture.job.error, 'MAPPING_SOURCE_WAIT');
      assert.equal(fixture.attempts.length, 1);
    });
  });
}
