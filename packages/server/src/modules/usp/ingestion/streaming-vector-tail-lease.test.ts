import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import test, { type TestContext } from 'node:test';
import { AppError } from '../../../infrastructure/errors';
import { fingerprint } from '../../cases/domain';
import * as parser from './streaming-vector-reader';

const root = process.cwd();
const require = createRequire(`${root}/package.json`);
const { buildSync } = createRequire(require.resolve('tsx/package.json'))('esbuild');
const original = readFileSync('fixtures/google-uttam/00-all-google-detections.geojson');
// test_only replay of a public feature: 182 simulated seconds, no runtime or invented source geometry.
const line = Buffer.from(JSON.stringify(JSON.parse(original.toString()).features[0]) + '\n');
const bytes = Buffer.concat(Array.from({ length: 183 }, () => line));
const hash = createHash('sha256').update(bytes).digest('hex');
const id = '53000000-0000-4000-8000-000000000001';
const input = { version: 'geojson-stream/2', jobId: id, caseId: id, caseRevision: 0, sourceId: id,
  sourceRevision: 1, sourceFamilyId: id, sourceSha256: hash, sourceBytes: bytes.length,
  objectKey: 'test_only/replayed-public-feature', framing: 'geojson-lines', subject: 'test_only',
  accessBinding: hash, readerSha256: hash, inputFingerprint: hash };

function database() {
  const state = { state: 'running', next_publish_index: 0, records: 0, accepted: 0, quarantined: 0,
    source_revision: 1, input_sha256: hash, sealed_chunks: null, unknown_remainder: true, lines_beyond_limit: 0 };
  const slots = new Map<number, any>();
  const query = async (sql: string, values: any[] = []): Promise<any> => {
    let rows: any[] = [];
    if (sql.startsWith('SELECT * FROM jobs')) rows = [{ status: 'queued', payload: input }];
    else if (sql.startsWith('SELECT inspection')) rows = [{ inspection: {} }];
    else if (sql.includes('FROM usp_streaming_vector_imports')) rows = [state];
    else if (sql.startsWith("UPDATE usp_streaming_vector_imports SET state='running'")) rows = [state];
    else if (sql.includes('ST_IsValid(g)')) {
      rows = JSON.parse(values[0]).map(() => ({ valid: true, empty: false, area: 1, dimension: 2 }));
    } else if (sql.startsWith('SELECT * FROM usp_streaming_vector_slots')) {
      rows = slots.has(values[2]) ? [slots.get(values[2])] : [];
    } else if (sql.startsWith('SELECT count(*)::int n FROM usp_streaming_vector_slots')) rows = [{ n: slots.size }];
    else if (sql.startsWith('INSERT INTO usp_streaming_vector_slots')) {
      slots.set(values[2], { chunk_index: values[2], records: values[6], published: false });
    } else if (sql.startsWith('UPDATE usp_streaming_vector_slots SET published=true')) {
      slots.get(values[2]).published = true;
    } else if (sql.includes('SET records=records+$2')) {
      state.records += values[1];
      state.accepted += values[2];
      state.quarantined += values[3];
    } else if (sql.includes('SET next_publish_index=next_publish_index+1')) state.next_publish_index++;
    else if (sql.includes('SET sealed_chunks=$2')) {
      Object.assign(state, { sealed_chunks: values[1], unknown_remainder: false, lines_beyond_limit: values[2] });
    } else if (sql.startsWith('SELECT accepted,quarantined')) rows = [state];
    return { rows, rowCount: rows.length };
  };
  return { state, slots, query };
}

// Preserve the production algorithm, replacing external effects and lowering only the parser's existing limit seam.
function loadWorker(controls: Record<string, unknown>) {
  let source = readFileSync('packages/server/src/modules/usp/ingestion/streaming-vector-worker.ts', 'utf8');
  source = source.replace(/import \{([\s\S]*?)\} from '([^']+)';/g, (statement, names, path) => {
    if (path === 'node:crypto' || path === 'pg' || path === '@ulpin/contracts/usp') return statement;
    const identifiers = names.split(',').map((value: string) => value.trim()).filter(Boolean)
      .filter((value: string) => !value.startsWith('type '));
    return `const {${identifiers.join(',')}} = tailControls;`;
  });
  const built = buildSync({ stdin: { contents: source,
    resolveDir: `${root}/packages/server/src/modules/usp/ingestion`, sourcefile: 'streaming-vector-worker.ts',
    loader: 'ts' }, write: false, bundle: true, platform: 'node', format: 'cjs' });
  const loaded = { exports: {} as { runStreamingVectorJob: (id: string) => Promise<void> } };
  new Function('module', 'exports', 'require', 'tailControls', built.outputFiles[0].text)(
    loaded, loaded.exports, require, controls);
  return loaded.exports;
}

function authority(query: ReturnType<typeof database>['query'], epoch: number, supersedeAtMs: number) {
  let lease = epoch + 180000;
  const state = { heartbeats: 0, accepted: false, failure: undefined as unknown };
  const checkLease = async () => {
    if (Date.now() >= lease || Date.now() - epoch >= supersedeAtMs) {
      throw new AppError(409, 'STALE_REVISION', 'This worker lease expired or was fenced.');
    }
  };
  const effects = {
    claimUspJobAttempt: async () => ({ number: 1, fence: 1, inputSha256: hash }),
    assertUspJobAttemptTx: checkLease,
    heartbeatUspJobAttempt: async () => {
      await checkLease();
      state.heartbeats++;
      lease = Date.now() + 180000;
    },
    acceptUspJobAttempt: async (_attempt: any, _asset: any, verify: any, guard: any, publish: any) => {
      await checkLease();
      await guard({ query });
      await verify({ query }, { operation: 'streaming-vector' });
      await publish({ query });
      state.accepted = true;
    },
    recordUspJobFailure: async (_attempt: unknown, _code: string, error: unknown) => { state.failure = error; },
  };
  return { state, effects };
}

function replay(t: TestContext) {
  const state = { emitted: 0, closed: false };
  const read = async (_key: string, _bytes: number, _etag: unknown, consume: any) => {
    const chunks = async function* () {
      try {
        for (let n = 0; n < 183; n++) {
          if (n > 0) t.mock.timers.tick(1000);
          state.emitted++;
          yield line;
        }
      } finally { state.closed = true; }
    };
    const body = Readable.from(chunks(), { objectMode: false });
    try { return await consume(body, () => {}, () => {}); }
    finally { body.destroy(); }
  };
  return { state, read };
}

async function run(t: TestContext, limit: number, supersedeAtMs = Infinity) {
  const epoch = Date.now();
  const db = database();
  const attempt = authority(db.query, epoch, supersedeAtMs);
  const source = replay(t);
  let read: Awaited<ReturnType<typeof parser.readStreamingFeatures>> | undefined;
  const controls = {
    AppError, fingerprint, conflict: (words: string) => { throw new AppError(409, 'STALE_REVISION', words); },
    query: db.query, transaction: (work: any) => work({ query: db.query }),
    sha256: (value: Uint8Array) => createHash('sha256').update(value).digest('hex'),
    putOriginal: async () => {}, readObject: async () => { throw new Error('Unexpected object read'); },
    ...attempt.effects,
    appendCaseIngestionTx: async () => {}, assertStreamingInputTx: async () => {},
    lockStreamingRowsTx: async () => {},
    ...parser,
    readStreamingFeatures: async (...args: Parameters<typeof parser.readStreamingFeatures>) => {
      read = await parser.readStreamingFeatures(args[0], args[1], args[2], limit, args[4]);
      return read;
    },
    readStreamingRaw: source.read,
    validateStreamingTopology: async () => null, resolveStreamedReference: async () => ({}),
    streamedSequenceReference: () => ({}), writeSealedMapReceiptTx: async () => {},
    queueIntakeLargeTx: async () => {}, writeIntakeLargeReadTx: async () => {},
    AREA_PROCESSOR_OPERATION: 'AREA_PROCESSOR_OPERATION', readTableWindows: async () => {},
    isWindowedTable: () => false, writeTableWindowTx: async () => {}, queueFinishedTableEvidenceTx: async () => {},
  };
  await loadWorker(controls).runStreamingVectorJob(id);
  return { ...attempt.state, ...source.state, elapsedMs: Date.now() - epoch, read, state: db.state };
}

test('line-tail draining retains the live worker lease until final acceptance', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 24) });
  const baseline = await run(t, 500000);
  const limited = await run(t, 1);
  assert.equal(baseline.accepted, true);
  assert.equal(limited.accepted, true, 'a progressing unread tail must not expire its reader attempt');
  assert.equal(limited.elapsedMs, 182000);
  assert.equal(limited.heartbeats, baseline.heartbeats);
  assert.equal(limited.heartbeats, 6);
  assert.equal(limited.read?.features, 1);
  assert.equal(limited.read?.linesBeyondLimit, 182);
  assert.equal(limited.read?.bytes, bytes.length);
  assert.equal(limited.read?.sha256, hash);
  assert.equal(limited.read?.sha256, baseline.read?.sha256);
  assert.equal(limited.state.sealed_chunks, 1);
  assert.equal(limited.state.lines_beyond_limit, 182);
  assert.equal(limited.state.unknown_remainder, false);
  assert.equal(limited.closed, true);
});

test('a superseded attempt stops during the tail with the existing stale words and cannot seal', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 24) });
  const stopped = await run(t, 1, 60000);
  assert.equal(stopped.accepted, false);
  assert.equal(stopped.heartbeats, 1);
  assert(stopped.failure instanceof AppError);
  assert.equal(stopped.failure.code, 'STALE_REVISION');
  assert.equal(stopped.failure.message, 'This worker lease expired or was fenced.');
  assert(stopped.emitted < 183, 'the old attempt must not finish draining the source');
  assert(stopped.elapsedMs < 180000);
  assert.equal(stopped.closed, true);
  assert.equal(stopped.read, undefined);
  assert.equal(stopped.state.sealed_chunks, null);
  assert.equal(stopped.state.records, 0);
  assert.equal(stopped.state.unknown_remainder, true);
});
