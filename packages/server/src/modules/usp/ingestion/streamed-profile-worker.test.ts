import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, rmdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { STREAMED_PROFILE_LIMITS as limits, type StreamingVectorRecord } from '@ulpin/contracts/usp';
import { DispatchReservations, DISPATCH_LANES } from '../../cases/dispatch-lanes';
import { readStreamingFeatures, sourceRecord } from './streaming-vector-reader';
import { loadProfileWorker, profileWorkerFixture } from './streamed-profile-worker.fixture';

const epoch = Date.UTC(2026, 9, 24);
// test_only malformed raw records exercise quarantine continuity without inventing geometry or publisher facts.
const record = (index: number) => sourceRecord({ index, start: index * 5, end: index * 5 + 4,
  feature: null, raw: Buffer.from('null'), valueIssueCode: null });
async function withWorker(run: (fixture: ReturnType<typeof profileWorkerFixture>, worker: () => Promise<void>) =>
  Promise<void>) {
  const globals = globalThis as typeof globalThis & { ulpinPool?: unknown; s13cProfile?: unknown };
  const saved = { pool: globals.ulpinPool, controls: globals.s13cProfile };
  const folder = await mkdtemp(join(tmpdir(), 'profile-worker-'));
  const fixture = profileWorkerFixture();
  globals.ulpinPool = fixture.pool;
  try {
    const worker = await loadProfileWorker(folder, fixture);
    await run(fixture, () => worker.runStreamedProfileJob(fixture.input.jobId));
  } finally {
    globals.ulpinPool = saved.pool;
    globals.s13cProfile = saved.controls;
    for (const file of await readdir(folder)) await rm(join(folder, file));
    await rmdir(folder);
  }
}

test('profile admission never exceeds stream lane concurrency', () => {
  assert.equal(limits.active, 4);
  assert.ok(limits.active <= DISPATCH_LANES.stream.concurrency);
});

test('a no-chunk profile requeues before claiming and returns every dispatcher reservation', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: epoch });
  await withWorker(async (fixture, worker) => {
    const reservations = new DispatchReservations();
    const job = { id: fixture.input.jobId, operation: 'streamed-profile', created_at: new Date() };
    assert.ok(reservations.admit(job, 512, [], Date.now(), 0, 512));
    await worker().finally(() => reservations.release(job.id));
    assert.equal(fixture.job.status, 'queued');
    assert.equal(fixture.job.next_attempt_at.getTime(), epoch + 2000);
    assert.equal(fixture.attempts.length, 0);
    assert.deepEqual(reservations.heldJobIds(), []);
    assert.ok(reservations.admit({ ...job, id: 'next' }, 512, [], Date.now(), 0, 512),
      'the full 512 MiB memory/heap and stream slot are free');
  });
});

test('each dispatch drains ready chunks, yields, resumes next_raw_index and finally seals', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: epoch });
  await withWorker(async (fixture, worker) => {
    for (let burst = 0; burst < 5; burst++) {
      fixture.publish([record(burst * 2)]);
      fixture.publish([record(burst * 2 + 1)]);
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
    assert.equal(fixture.state.state, 'sealed');
    assert.equal(fixture.state.sealed_generation, 10);
    assert.equal(fixture.generations.size, 11);
    assert.equal(fixture.generations.get(10)?.coverage, 'sealed');
    assert.deepEqual(fixture.reads, Array.from({ length: 10 }, (_, index) => index));
  });
});

test('a line read at its ceiling seals a profile of only the five parsed features', async () => {
  const original = readFileSync('fixtures/google-uttam/00-all-google-detections.geojson');
  const features = JSON.parse(original.toString()).features.slice(0, 11);
  await withWorker(async (fixture, worker) => {
    const lines = features.map((feature: unknown) => JSON.stringify(feature));
    lines.splice(2, 0, '');
    const records: StreamingVectorRecord[] = [];
    const closed = await readStreamingFeatures(Readable.from([lines.join('\n') + '\n']), 'geojson-lines',
      async item => { records.push(sourceRecord(item)); }, 5);
    fixture.publish(records);
    Object.assign(fixture.raw, { state: 'completed', unknown_remainder: false,
      lines_beyond_limit: closed.linesBeyondLimit });
    await worker();
    assert.equal(fixture.job.status, 'succeeded');
    assert.equal(fixture.state.state, 'sealed');
    assert.equal(fixture.state.sealed_generation, 1);
    assert.equal(fixture.generations.get(1)?.coverage, 'sealed');
    assert.equal(fixture.generations.get(1)?.recordsSeen, 5);
    assert.equal(fixture.generations.get(1)?.accepted, 5);
    assert.equal(closed.linesBeyondLimit, 6);
  });
});

test('profile publication passes raw index 4098 and reaches the current 5000-part ceiling', async () => {
  await withWorker(async (fixture, worker) => {
    for (let index = 0; index < 5000; index++) fixture.publish([record(index)]);
    fixture.raw.state = 'completed_with_rejections';
    fixture.raw.unknown_remainder = false;
    await worker();
    assert.equal(fixture.job.status, 'succeeded');
    assert.equal(fixture.state.next_raw_index, 5000);
    assert.equal(fixture.generations.get(4098)?.recordsSeen, 4099);
    assert.equal(fixture.generations.get(5000)?.coverage, 'sealed');
    assert.equal(fixture.generations.get(5000)?.recordsSeen, 5000);
  });
});

test('three processing failures still terminate after more than three successful yields', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: epoch });
  await withWorker(async (fixture, worker) => {
    for (let index = 0; index < 4; index++) {
      fixture.publish([record(index)]);
      await worker();
      t.mock.timers.tick(2000);
    }
    fixture.publish([record(4)]);
    t.mock.method(fixture.controls.StreamingVectorService.prototype, 'chunk', async () => {
      throw new Error('test_only storage failure');
    });
    for (let index = 1; index <= 3; index++) {
      await worker();
      assert.equal(fixture.job.status, index < 3 ? 'queued' : 'failed');
      assert.equal(fixture.job.attempts, index);
      assert.deepEqual(fixture.attempts.at(-1)?.failure_cause, {
        errorCode: 'STREAMED_PROFILE_WORKER_ERROR', class: 'Error', message: 'test_only storage failure',
      });
      t.mock.timers.tick(2000);
    }
    assert.equal(fixture.job.error, 'STREAMED_PROFILE_WORKER_ERROR');
    assert.equal(fixture.state.next_raw_index, 4);
  });
});

test('the source-wait deadline survives requeues and starts at first dispatch, not enqueue', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: epoch });
  await withWorker(async (fixture, worker) => {
    fixture.state.updated_at = new Date(epoch - limits.waitMs);
    await worker();
    assert.equal(fixture.job.status, 'queued');
    for (let dispatch = 0; dispatch < 10; dispatch++) {
      t.mock.timers.tick(2000);
      await worker();
      assert.equal(fixture.state.updated_at.getTime(), epoch);
    }
    t.mock.timers.tick(limits.waitMs - 20000);
    await worker();
    assert.equal(fixture.job.status, 'failed');
    assert.equal(fixture.job.error, 'STREAMED_PROFILE_SOURCE_WAIT');
    assert.equal(fixture.attempts.length, 0);
  });
});

test('publication resets the durable no-chunk deadline, but a later dispatch does not', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: epoch });
  await withWorker(async (fixture, worker) => {
    await worker();
    t.mock.timers.tick(limits.waitMs - 1);
    fixture.publish([record(0)]);
    await worker();
    const publishedAt = fixture.state.updated_at.getTime();
    t.mock.timers.tick(limits.waitMs - 1);
    await worker();
    assert.equal(fixture.job.status, 'queued');
    assert.equal(fixture.state.updated_at.getTime(), publishedAt);
    t.mock.timers.tick(1);
    await worker();
    assert.equal(fixture.job.error, 'STREAMED_PROFILE_SOURCE_WAIT');
    assert.equal(fixture.attempts.length, 1);
  });
});
