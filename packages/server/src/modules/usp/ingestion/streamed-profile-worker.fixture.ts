import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { StreamedProfileGeneration, StreamingVectorRecord } from '@ulpin/contracts/usp';

const id = (n: number) => `53000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = 'a'.repeat(64);

/** Protocol-only SQL/storage fixture: real worker, inventory and attempt authority; no runtime or original writes. */
export function profileWorkerFixture(offset = 0) {
  const input = { version: 'streamed-profile/1', jobId: id(offset + 1), rawJobId: id(offset + 2),
    caseId: id(offset + 3), sourceId: id(offset + 4),
    caseRevision: 1, sourceRevision: 1, sourceFamilyId: id(offset + 4), sourceSha256: hash, rawInputFingerprint: hash,
    readerSha256: hash, profilerSha256: hash, subject: 'test_only', accessBinding: hash, inputFingerprint: hash };
  const job = { id: input.jobId, operation: 'streamed-profile', payload: input, status: 'queued', attempts: 0,
    dispatched_at: null as Date | null, next_attempt_at: new Date(), error: null as string | null };
  const meta = { logical_state: 'queued', input_sha256: hash };
  const state = { state: 'queued', next_raw_index: 0, updated_at: new Date(),
    sealed_generation: null as number | null };
  const raw = { state: 'running', sealed_chunks: 0, records: 0, accepted: 0, quarantined: 0,
    unknown_remainder: true, issue_code: null };
  const attempts: any[] = [], chunks: any[] = [], generations = new Map<number, StreamedProfileGeneration>();
  const reads: number[] = [], statements: string[] = [];
  let transactionTime = Date.now();
  const one = (row?: unknown) => ({ rows: row ? [row] : [], rowCount: row ? 1 : 0 });
  const query = async (sql: string, values: any[] = []) => {
    statements.push(sql);
    if (sql === 'BEGIN') transactionTime = Date.now();
    if (/^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE SAVEPOINT)/.test(sql)) return one();
    if (sql.startsWith('SELECT') && sql.includes('FROM jobs')) return one(job);
    if (sql.startsWith('SELECT') && sql.includes('FROM usp_job_metadata')) return one(meta);
    if (sql.startsWith('SELECT count(*)::int n FROM usp_job_attempts'))
      return one({ n: attempts.filter(row => row.state !== 'yielded').length });
    if (sql.startsWith('SELECT 1 FROM usp_job_attempts'))
      return one(attempts.find(row => row.state === 'active' && row.lease_until.getTime() > Date.now()));
    if (sql.startsWith('SELECT * FROM usp_job_attempts'))
      return one(values.length > 1 ? attempts.find(row => row.number === values[1]) : attempts.at(-1));
    if (sql.startsWith('INSERT INTO usp_job_attempts')) {
      const row = { number: values[1], fence: values[2], owner: values[3], input_sha256: values[4],
        lease_until: new Date(Date.now() + 180000), state: 'active' };
      attempts.push(row);
      return one(row);
    }
    if (sql.startsWith('UPDATE usp_job_attempts SET failure_cause=')) {
      const row = attempts.find(row => row.number === values[1]);
      if (row) row.failure_cause = values[2];
      return one();
    }
    if (sql.startsWith('UPDATE usp_job_attempts')) {
      const row = attempts.find(row => row.number === (values[2] ?? values[1])) ?? attempts.at(-1);
      if (row) row.state = /state='(\w+)'/.exec(sql)![1];
      return one();
    }
    if (sql.startsWith('UPDATE usp_job_metadata')) {
      meta.logical_state = /logical_state='(\w+)'/.exec(sql)![1];
      return one();
    }
    if (sql.startsWith('UPDATE jobs')) {
      const status = /status='(\w+)'/.exec(sql)?.[1];
      if (status) job.status = status;
      if (sql.includes('status=$2')) job.status = values[1];
      if (sql.includes('attempts=$2')) job.attempts = values[1];
      if (sql.includes('dispatched_at=COALESCE')) job.dispatched_at ??= new Date();
      if (sql.includes("interval '2 seconds'")) job.next_attempt_at = new Date(Date.now() + 2000);
      if (sql.includes('error=$3')) job.error = values[2];
      if (sql.includes('error=$2')) job.error = values[1];
      return one();
    }
    if (sql.startsWith('SELECT') && sql.includes('FROM usp_streamed_profile_imports'))
      return one({ ...state, expired: Date.now() - state.updated_at.getTime() >= Number(values[1]) });
    if (sql.startsWith('SELECT') && sql.includes('FROM usp_streaming_vector_imports')) return one(raw);
    if (sql.startsWith('SELECT') && sql.includes('FROM usp_streaming_vector_slots')) {
      const chunk = chunks[values[2]];
      return one(chunk && { chunk_index: values[2], result_sha256: hash, published: true, object_key: 'test_only' });
    }
    if (sql.startsWith('UPDATE usp_streamed_profile_imports')) {
      const status = /state='(\w+)'/.exec(sql)?.[1];
      if (status) state.state = status;
      if (sql.includes('state=$2')) state.state = values[1];
      if (sql.includes('next_raw_index=next_raw_index+1')) state.next_raw_index++;
      if (sql.includes('updated_at=now()')) state.updated_at = new Date(transactionTime);
      if (sql.includes('updated_at=clock_timestamp()')) state.updated_at = new Date();
      if (sql.includes('sealed_generation=$2')) state.sealed_generation = values[1];
      return one();
    }
    if (sql.startsWith('INSERT INTO usp_streamed_profile_generations')) {
      const body = values[4]?.coverage ? values[4] : values[2];
      assert.ok(!generations.has(body.generation), 'a resumed dispatch never republishes an immutable generation');
      generations.set(body.generation, body);
      return one();
    }
    if (sql.startsWith('UPDATE usp_outbox_streams')) return one({ sequence: '1' });
    if (sql.startsWith('INSERT INTO usp_outbox')) return one();
    assert.fail(`Unexpected profile fixture SQL: ${sql}`);
  };
  const controls = {
    assertStreamedProfileInputTx: async () => ({ ctx: { source: { profile: 'test_only', inspection: {} } } }),
    readStreamedGenerationTx: async (_client: unknown, _input: unknown, index: number) => generations.get(index),
    lockStreamingRowsTx: async () => {},
    StreamingVectorService: class {
      async chunk(_case: string, _source: string, _job: string, index: number) {
        reads.push(index);
        return chunks[index];
      }
    },
  };
  const publish = (records: StreamingVectorRecord[]) => {
    const index = chunks.length;
    chunks.push({ slot: { chunkIndex: index, resultSha256: hash, ref: { key: 'test_only' },
      firstFeatureIndex: raw.records, records: records.length }, payload: { records } });
    raw.sealed_chunks++;
    raw.records += records.length;
    raw.accepted += records.filter(row => row.disposition === 'accepted').length;
    raw.quarantined = raw.records - raw.accepted;
  };
  const pool = { query, connect: async () => ({ query, release() {} }) };
  return { input, job, meta, state, raw, attempts, generations, reads, statements, controls, publish, query, pool };
}

export async function loadProfileWorker(folder: string, fixture: ReturnType<typeof profileWorkerFixture>) {
  const globals = globalThis as typeof globalThis & { s13cProfile?: unknown };
  globals.s13cProfile = fixture.controls;
  const path = fileURLToPath(new URL('./streamed-profile-worker.ts', import.meta.url));
  let source = await readFile(path, 'utf8');
  source = source.replace("import {lockStreamingRowsTx} from './streaming-vector';",
    'const {StreamingVectorService,lockStreamingRowsTx} = globalThis.s13cProfile;');
  source = source.replace(/type RawChunkPin=[\s\S]+?(?=type RawChunk=)/,
    `const readPinnedRawChunk = (input, slot) => new StreamingVectorService().chunk(
      input.caseId, input.sourceId, input.rawJobId, slot.chunk_index);`);
  source = source.replace("import {appendCaseIngestionTx} from './events';",
    'const appendCaseIngestionTx = async () => {};');
  source = source.replace("import {queueIntakeLargeTx} from './intake-large';",
    'const queueIntakeLargeTx = async () => {};');
  source = source.replace('import {assertStreamedProfileInputTx,readStreamedGenerationTx,streamedGenerationHash}',
    'const {assertStreamedProfileInputTx,readStreamedGenerationTx} = globalThis.s13cProfile;\n'
      + 'import {streamedGenerationHash}');
  source = source.replaceAll("'@ulpin/contracts/usp'",
    JSON.stringify(fileURLToPath(import.meta.resolve('@ulpin/contracts/usp'))));
  source = source.replace(/(['"])(\.\.?\/[^'"]+)\1/g,
    (_match, _quote: string, specifier: string) => JSON.stringify(resolve(dirname(path), specifier)));
  const target = join(folder, `profile-worker-${fixture.input.jobId}.ts`);
  await writeFile(target, source);
  return import(pathToFileURL(target).href) as Promise<{ runStreamedProfileJob: (id: string) => Promise<void> }>;
}
