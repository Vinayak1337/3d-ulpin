import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { Pool } from 'pg';
import ts from 'typescript';
import { AppError } from '../packages/server/src/infrastructure/errors';
import { safeWorkerCause } from '../packages/server/src/infrastructure/worker-failure';
import { sql } from '../packages/server/src/infrastructure/sql-loader';
import { recordUspJobFailure } from '../packages/server/src/modules/usp/jobs';
import { DISPATCH_LANES } from '../packages/server/src/modules/cases/dispatch-lanes';

const root = 'packages/server/src/';
const globals = globalThis as typeof globalThis & { ulpinPool?: any; s13g?: any };
const attempt = { jobId: 'test_only', number: 1, fence: 1, owner: 'test_only', inputSha256: 'test_only' };
const timeoutMessage = 'timeout exceeded when trying to connect';
const schema = { parse: (value: unknown) => value };
let isolatedId = 0;
/** Execute the actual module bodies with only their imported transports/domain prerequisites controlled. */
async function isolated(source: string, controls: Record<string, any>) {
  globals.s13g = controls;
  const js = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
  } }).outputText.replace(/^import \{([^}]+)\} from ["'][^"']+["'];/gm,
    (_, names) => `const {${names.replace(/\s+as\s+/g, ':')}} = globalThis.s13g;`);
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}#${isolatedId++}`);
}
function persistence() {
  const stored: any[] = [];
  let live = true;
  const client = { release() {}, query: async (text: string, values: any[] = []) => {
    if (text.includes('SET failure_cause=')) stored.push(values[2]);
    return { rows: [{ ...attempt, state: 'active', status: 'running', logical_state: 'running',
      input_sha256: attempt.inputSha256, lease_until: new Date(Date.now() + (live ? 60000 : -1)) }], rowCount: 1 };
  } };
  globals.ulpinPool = { connect: async () => client };
  return { stored, expire: () => { live = false; } };
}
class FakeClient extends EventEmitter {
  _queryable = true;
  connect(done: (error?: Error) => void) { queueMicrotask(done); }
  end(done?: () => void) { queueMicrotask(() => { this.emit('end'); done?.(); }); }
}
class TransportPool extends Pool {
  constructor(options: any) { super({ ...options, Client: FakeClient }); }
}

test('safe causes survive every generic catch, and real pg-pool pressure is not an attempt failure', async t => {
  const saved = { pool: globals.ulpinPool, controls: globals.s13g, entry: process.argv[1] };
  try {
    await t.test('redaction withholds SQL, parameters, URLs, paths and arbitrary secrets', async () => {
      const error = Object.assign(new TypeError(
        'SELECT secret FROM /private/file WHERE token=$1 parameters=[private] https://user:secret@host/ C:\\private'),
      { code: 'ECONNRESET', errno: -54, syscall: 'read' });
      assert.deepEqual(safeWorkerCause(error), {
        class: 'TypeError', code: 'ECONNRESET', errno: -54, syscall: 'read', message: 'Error detail withheld.',
      });
      assert.equal(safeWorkerCause(new AppError(503, 'UNCHANGED', 'officer words')), null);
      const state = persistence();
      await recordUspJobFailure(attempt as any, 'GENERIC_ERROR', error);
      assert.deepEqual(state.stored, [{ errorCode: 'GENERIC_ERROR', ...safeWorkerCause(error) }]);
      assert.equal(safeWorkerCause(Object.assign(new Error('private'), { code: '23505' }))?.code, '23505');
    });
    for (const [name, run, code] of [
      ['streaming-vector', 'runStreamingVectorJob', 'STREAMING_WORKER_ERROR'],
      ['streamed-profile', 'runStreamedProfileJob', 'STREAMED_PROFILE_WORKER_ERROR'],
      ['chunk-mapping', 'runChunkMappingJob', 'MAPPING_WORKER_ERROR'],
      ['intake-large', 'runIntakeLargeJob', 'INTAKE_LARGE_STEP_FAILED'],
      ['intake-zip-layers', 'runIntakeZipLayersJob', 'INTAKE_ZIP_LAYERS_FAILED'],
    ]) await t.test(`${name} keeps the safe cause on its exact fenced attempt`, async () => {
      const state = persistence(), error = new Error(timeoutMessage);
      const input = { jobId: attempt.jobId, stateKey: 'test_only', framing: 'sequence' };
      let injected = false;
      const query = async (text: string) => {
        const trigger = name === 'intake-large' ? text.includes('UPDATE jobs SET dispatched_at=')
          : name !== 'streaming-vector'
            && text.includes(`UPDATE usp_${name.replaceAll('-', '_')}_imports SET state='running'`);
        if (!injected && trigger) { injected = true; throw error; }
        if (text.includes('FROM usp_streaming_vector_slots')) return { rows: [], rowCount: 0 };
        return { rows: [{ payload: input, status: 'queued', state: 'completed', attempts: 1,
          next_publish_index: 0, next_raw_index: 0 }], rowCount: 0 };
      };
      const controls = new Proxy({ AppError, recordUspJobFailure, USP_JOB_LIMITS: { maxAttempts: 3 },
        query, transaction: (work: any) => work({ query }), claimUspJobAttempt: async () => attempt,
        AnyStreamingInputSchema: schema, StreamedProfileInputSchema: schema, ChunkMappingInputSchema: schema,
        IntakeLargeInputSchema: schema, IntakeZipLayersInputSchema: schema,
        StreamingVectorService: class {}, ChunkMappingService: class {}, StreamedProfileService: class {},
        AdaptiveMappingService: class {}, ManualIngestionService: class { retain() {} }, IntakeService: class {},
        LargeOriginalService: class {}, TabularChunkMapper: class {},
        largeStateKey: async () => ({ key: input.stateKey, item: {} }), intakeLargeAtRest: () => true,
        readStreamingRaw: async () => { throw error; }, fanOutZipLayers: async () => { throw error; },
      }, { get: (target, key) => key in target ? Reflect.get(target, key) : () => {} });
      const module = await isolated(await readFile(`${root}modules/usp/ingestion/${name}-worker.ts`, 'utf8'), controls);
      if (name.startsWith('intake-')) await assert.rejects(module[run](attempt.jobId), error);
      else await module[run](attempt.jobId);
      assert.deepEqual(state.stored, [{ errorCode: code, class: 'Error', message: timeoutMessage }]);
      state.expire();
      await assert.rejects(recordUspJobFailure(attempt as any, code, error));
      assert.equal(state.stored.length, 1, 'an expired fence cannot change diagnostics');
    });
    await t.test('additive migration is hash-loaded and wired through the existing ledger', async () => {
      const calls: string[] = [];
      const controls = new Proxy({ sql, transaction: async (work: any) => work({
        query: async (text: string, values: string[] = []) => {
          calls.push(text);
          return { rowCount: values[0] === 'usp_job_failure_cause_001' ? 0 : 1 };
        },
      }) }, { get: (target, key) => key in target ? Reflect.get(target, key) : async () => {} });
      const module = await isolated(await readFile(`${root}modules/usp/migrations.ts`, 'utf8'), controls);
      await module.migrateUsp();
      assert.equal(calls.filter(text => text === sql('usp.job-failure-cause.schema')).length, 1);
      assert.match(sql('usp.job-failure-cause.schema'), /ADD COLUMN IF NOT EXISTS failure_cause jsonb/);
    });
    await t.test('run-4 lane wave: baseline eight times out; dispatcher-sized pool serves every holder', async () => {
      // run4/jobs.json: all 203 jobs; simultaneous requests capped by each lane, not 203 concurrent jobs.
      const counts = { table: 8, vector: 79, stream: 27, teacher: 10, link: 4, other: 1,
        point: 55, raster: 11, model3d: 5, document: 3 };
      const holders = Object.entries(counts).reduce((sum, [lane, count]) =>
        sum + Math.min(count, DISPATCH_LANES[lane as keyof typeof DISPATCH_LANES].concurrency), 0);
      assert.equal(holders, 21);
      const baseline = execFileSync('git', ['show', '1710369c:packages/server/src/infrastructure/db.ts'],
        { encoding: 'utf8' });
      const current = process.env.S13G_BASELINE_DB === '1' ? baseline
        : await readFile(`${root}infrastructure/db.ts`, 'utf8');
      process.argv[1] = 'E:/test_only/scripts/dispatcher.ts';
      const outcomes: number[] = [];
      for (const source of [baseline, current]) {
        delete globals.ulpinPool;
        const module = await isolated(source, { Pool: TransportPool, AppError, DISPATCH_LANES, setTimeout: delay,
          settings: { databaseUrl: 'postgresql://127.0.0.1/test_only' } });
        const pool = module.pool();
        assert.equal(pool.options.connectionTimeoutMillis, 5000);
        assert.equal(pool.options.Client, FakeClient);
        pool.options.connectionTimeoutMillis = 50; // 1:100 time scale, real pg-pool queue implementation.
        const results = await Promise.allSettled(Array.from({ length: holders + 2 }, async () => {
          const client = await pool.connect();
          try { await delay(120); } finally { client.release(); }
        }));
        const errors = results.filter(result => result.status === 'rejected');
        outcomes.push(errors.length);
        await pool.end();
        for (const result of errors) {
          const state = persistence();
          await recordUspJobFailure(attempt as any, 'STREAMING_WORKER_ERROR', result.reason);
          assert.deepEqual(state.stored, [{
            errorCode: 'STREAMING_WORKER_ERROR', class: 'Error', message: timeoutMessage,
          }]);
        }
      }
      assert.deepEqual(outcomes, [15, 0]);
      t.diagnostic(`23 simultaneous acquisitions (21 lane holders + tick/heartbeat): failures ${outcomes}`);
      process.argv[1] = 'E:/test_only/apps/api/main.js';
      delete globals.ulpinPool;
      const api = await isolated(current, { Pool: TransportPool, AppError, DISPATCH_LANES,
        settings: { databaseUrl: 'postgresql://127.0.0.1/test_only' } });
      assert.equal(api.pool().options.max, 8);
      await api.closePool();
    });
    await t.test('dispatcher queue timeout waits before BEGIN; SQL and API errors are never replayed', async () => {
      process.argv[1] = 'E:/test_only/scripts/dispatcher.ts';
      let connects = 0, actions = 0, waits = 0;
      const client = { query: async () => ({ rows: [] }), release() {} };
      globals.ulpinPool = { connect: async () => {
        if (++connects === 1) throw new Error(timeoutMessage);
        return client;
      } };
      const module = await isolated(await readFile(`${root}infrastructure/db.ts`, 'utf8'), {
        AppError, setTimeout: async () => { waits++; },
      });
      await module.transaction(async () => { actions++; });
      assert.deepEqual({ connects, actions, waits }, { connects: 2, actions: 1, waits: 1 });
      await assert.rejects(module.transaction(async () => { actions++; throw new Error(timeoutMessage); }));
      assert.equal(actions, 2, 'a query error does not replay a transaction');
      const releases: unknown[] = [], socketError = new Error('Connection terminated unexpectedly');
      const raw = Object.assign(new EventEmitter(), {
        query: (_text: string, _values: unknown[], done: any) => queueMicrotask(() => {
          raw.emit('error', socketError);
          done(socketError);
        }), release: (error: unknown) => releases.push(error),
      });
      globals.ulpinPool = { connect: async () => raw };
      await assert.rejects(module.query('SELECT test_only'), socketError);
      assert.deepEqual(releases, [socketError], 'socket error and late callback release only once, discarding client');
      assert.equal(raw.listenerCount('error'), 0);
      process.argv[1] = 'E:/test_only/apps/api/main.js';
      globals.ulpinPool = { connect: async () => { throw new Error(timeoutMessage); } };
      await assert.rejects(module.transaction(async () => { actions++; }));
      assert.equal(waits, 1);
    });
  } finally {
    globals.ulpinPool = saved.pool;
    globals.s13g = saved.controls;
    process.argv[1] = saved.entry;
  }
});
