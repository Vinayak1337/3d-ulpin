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

test('grouped profile publication retains scalar generation hashes with a malformed member', async () => {
  const original = JSON.parse(readFileSync('fixtures/google-uttam/00-all-google-detections.geojson', 'utf8'));
  const text = [original.features[0], null, original.features[1]].map(value => JSON.stringify(value)).join('\n');
  const records: StreamingVectorRecord[] = [];
  await readStreamingFeatures(Readable.from([text + '\n']), 'geojson-lines', async item => {
    records.push(sourceRecord(item));
  });
  await withWorker(async (fixture, worker) => {
    fixture.publish(records);
    fixture.raw.state = 'completed_with_rejections';
    fixture.raw.unknown_remainder = false;
    await worker();
    assert.equal(fixture.job.status, 'succeeded');
    assert.equal(fixture.generations.get(0)?.generationHash,
      '1055f83e7d34d9b821c69336a65b40c86e1dc15c129816ebaec8b563fbbea7ee');
    assert.equal(fixture.generations.get(1)?.generationHash,
      'b87c4398a80a652f61b4cabd1914cde8016b9a33dec80923d40183d9c1ae2563');
    assert.equal(fixture.generations.get(1)?.accepted, 2);
    assert.equal(fixture.generations.get(1)?.quarantined, 1);
    assert.deepEqual(fixture.generations.get(1)?.quarantineLocators.map(row => row.issueCode),
      [records[1].issueCode]);
  });
});

test('a failed generation preserves its committed prefix and retries without skipping neighbours', async t => {
  await withWorker(async (fixture, worker) => {
    fixture.publish([record(0)]);
    fixture.publish([record(1)]);
    fixture.publish([record(2)]);
    fixture.raw.state = 'completed_with_rejections';
    fixture.raw.unknown_remainder = false;
    let fail = true, aborted = false;
    t.mock.method(fixture.pool, 'connect', async () => ({ release() {},
      query: async (sql: string, values: any[] = []) => {
        if (aborted) assert.equal(sql, 'ROLLBACK');
        if (sql === 'ROLLBACK') aborted = false;
        if (sql.startsWith('INSERT INTO usp_streamed_profile_generations') && values[1] === 1 && fail) {
          fail = false;
          aborted = true;
          throw Object.assign(new Error('test_only malformed generation member'), { code: '22023' });
        }
        return fixture.query(sql, values);
      },
    }));
    await worker();
    assert.equal(fixture.job.status, 'queued');
    assert.equal(fixture.state.next_raw_index, 1);
    assert.deepEqual([...fixture.generations.keys()], [0]);
    assert.ok(fixture.statements.includes('ROLLBACK'));
    await worker();
    assert.equal(fixture.job.status, 'succeeded');
    assert.deepEqual([...fixture.generations.keys()], [0, 1, 2, 3]);
    assert.deepEqual(fixture.reads, [0, 1, 1, 2]);
  });
});

test('source integrity failure before dispatch terminates the profile without reading its chunks', async () => {
  await withWorker(async (fixture, worker) => {
    fixture.publish([record(0)]);
    Object.assign(fixture.raw, { state: 'failed', issue_code: 'STREAMING_SOURCE_INTEGRITY' });
    await worker();
    assert.equal(fixture.job.status, 'failed');
    assert.equal(fixture.job.error, 'STREAMING_SOURCE_INTEGRITY');
    assert.equal(fixture.generations.size, 0);
    assert.deepEqual(fixture.reads, []);
  });
});

test('a lease that expires during a grouped raw read cannot publish that part', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: epoch });
  await withWorker(async (fixture, worker) => {
    fixture.publish([record(0)]);
    const prototype = fixture.controls.StreamingVectorService.prototype, chunk = prototype.chunk;
    t.mock.method(prototype, 'chunk', async (...args: Parameters<typeof chunk>) => {
      const result = await chunk(...args);
      t.mock.timers.tick(180001);
      return result;
    });
    await worker();
    assert.equal(fixture.state.next_raw_index, 0);
    assert.equal(fixture.generations.size, 0);
  });
});

test('the publication clock records the part write, not the start of its grouped transaction', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: epoch });
  await withWorker(async (fixture, worker) => {
    fixture.publish([record(0)]);
    const prototype = fixture.controls.StreamingVectorService.prototype, chunk = prototype.chunk;
    t.mock.method(prototype, 'chunk', async (...args: Parameters<typeof chunk>) => {
      const result = await chunk(...args);
      t.mock.timers.tick(5000);
      return result;
    });
    await worker();
    assert.equal(fixture.state.updated_at.getTime(), epoch + 5000);
  });
});

test('one profile transaction publishes only one already-prepared part', async () => {
  await withWorker(async (fixture, worker) => {
    for (let index = 0; index < 17; index++) fixture.publish([record(index)]);
    fixture.raw.state = 'completed_with_rejections';
    fixture.raw.unknown_remainder = false;
    await worker();
    let parts = 0;
    const batches: number[] = [];
    for (const sql of fixture.statements) {
      if (sql === 'BEGIN') parts = 0;
      if (sql.startsWith('INSERT INTO usp_streamed_profile_generations')) parts++;
      if (sql === 'COMMIT' && parts) batches.push(parts);
    }
    assert.deepEqual(batches, Array(18).fill(1));
  });
});

test('a final source receipt arriving during storage does not stale the observed prefix', async t => {
  await withWorker(async (fixture, worker) => {
    fixture.publish([record(0)]);
    fixture.controls.source.profile = 'large-original-v1';
    const prototype = fixture.controls.StreamingVectorService.prototype, chunk = prototype.chunk;
    t.mock.method(prototype, 'chunk', async (...args: Parameters<typeof chunk>) => {
      const result = await chunk(...args);
      fixture.controls.source.inspection = { streamedMapReceipt: {
        reference: { evidence: 'test_only', coordinateUnit: 'unknown' },
      } };
      fixture.raw.state = 'completed_with_rejections';
      fixture.raw.unknown_remainder = false;
      return result;
    });
    await worker();
    assert.equal(fixture.job.status, 'succeeded');
    assert.equal(fixture.generations.get(0)?.reference.evidence, null);
    assert.equal(fixture.generations.get(1)?.reference.evidence, 'test_only');
  });
});

test('raw storage runs between committed scopes; a changed slot cannot publish', async t => {
  await withWorker(async (fixture, worker) => {
    fixture.publish([record(0)]);
    let active = false, reads = 0;
    t.mock.method(fixture.pool, 'connect', async () => ({ release() {},
      query: async (sql: string, values: any[] = []) => {
        if (sql === 'BEGIN') active = true;
        if (sql === 'COMMIT' || sql === 'ROLLBACK') active = false;
        const result = await fixture.query(sql, values);
        if (reads && sql.includes('FROM usp_streaming_vector_slots'))
          (result.rows[0] as Record<string, unknown>).object_sha256 = 'b'.repeat(64);
        return result;
      },
    }));
    const prototype = fixture.controls.StreamingVectorService.prototype, chunk = prototype.chunk;
    t.mock.method(prototype, 'chunk', async (...args: Parameters<typeof chunk>) => {
      assert.equal(active, false, 'storage must not retain even a read transaction');
      await new Promise(resolve => setTimeout(resolve, 20));
      reads++;
      return chunk(...args);
    });
    await worker();
    assert.equal(reads, 1);
    assert.equal(fixture.generations.size, 0);
    assert.equal(fixture.state.next_raw_index, 0);
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
