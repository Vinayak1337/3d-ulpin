import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { S3Client } from '@aws-sdk/client-s3';
import { fingerprint } from '../../cases/domain';
import { settings } from '../../../infrastructure/config';
import { AppError, conflict } from '../../../infrastructure/errors';
import { sha256 } from '../../../infrastructure/storage';
import { ingestionBinding } from './events';
import { StreamingVectorService, streamingReaderSha } from './streaming-vector';
import { ChunkMappingService, chunkMappingConverterSha } from './chunk-mapping';
import { pairMappedFeatures } from './intake-package-cuts';
import { INTAKE_LARGE_STOPPED } from './intake-large';

function worker(controls: Record<string, unknown>) {
  const source = readFileSync(new URL('./intake-large-worker.ts', import.meta.url), 'utf8');
  const start = source.includes('class SealedChunkCodeChanged')
    ? 'class SealedChunkCodeChanged' : 'async function pairedChunk';
  const body = [start, 'async function fail'].map(name => source.slice(source.indexOf(name)).split('\n/**')[0]);
  const js = ts.transpileModule(body.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(controls), `${js}; return { pairedChunk, fail };`)(...Object.values(controls));
}

test('a moved reader stops once with an indexed retryable cause and keeps every sealed integrity refusal', {
  skip: !process.env.S13X_PGLITE_MODULE,
}, async t => {
  const subject = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'sealed-pair-protocol';
  t.after(() => {
    if (subject === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
    else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = subject;
  });
  const { PGlite } = await import(process.env.S13X_PGLITE_MODULE!);
  const db = new PGlite();
  t.after(() => db.close());
  const caseId = randomUUID(), sourceId = randomUUID(), rawId = randomUUID(), mappedId = randomUUID();
  const binding = ingestionBinding(caseId), sourceHash = sha256('test_only SQL protocol, no original');
  const seal = <T extends Record<string, unknown>>(base: T) => ({ ...base, inputFingerprint: fingerprint(base) });
  const raw = seal({ version: 'geojson-stream/2', jobId: rawId, caseId, caseRevision: 1, sourceId,
    sourceRevision: 1, sourceFamilyId: sourceId, sourceSha256: sourceHash, sourceBytes: 1,
    objectKey: 'unopened-protocol-original', framing: 'feature-collection', subject: binding.subject,
    accessBinding: binding.access, readerSha256: '0'.repeat(64) });
  const mapped = seal({ version: 'chunk-mapping/1', jobId: mappedId, caseId, caseRevision: 1, sourceId,
    sourceRevision: 1, sourceFamilyId: sourceId, sourceSha256: sourceHash, rawJobId: rawId,
    rawInputFingerprint: fingerprint(raw), readerSha256: raw.readerSha256, subject: binding.subject,
    accessBinding: binding.access, route: 'approved_recipe', recipeId: randomUUID(), recipeRevision: 1,
    planHash: null, schemaFingerprint: null, workspaceFingerprint: null, converterSha256: '1'.repeat(64) });
  const rawPayload = { version: raw.version, jobId: rawId, sourceId, sourceRevision: 1,
    sourceSha256: sourceHash, chunkIndex: 1553, records: [] };
  const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));
  const rawHash = sha256(bytes(rawPayload));
  const mappedPayload = { ...rawPayload, version: mapped.version, jobId: mappedId, rawJobId: rawId,
    rawResultSha256: rawHash, schemaFingerprint: null, recipeRevision: 1,
    converterSha256: mapped.converterSha256 };
  await db.exec(`CREATE TABLE cases(id uuid,revision int,archived bool);
    CREATE TABLE sources(id uuid,case_id uuid,revision int,family_id uuid,sha256 text,bytes int,
      object_key text,profile text,inspection jsonb);
    CREATE TABLE jobs(id uuid,case_id uuid,source_id uuid,operation text,payload jsonb,input_fingerprint text,
      status text,error text,completed_at timestamptz,next_attempt_at timestamptz);
    CREATE TABLE usp_job_attempts(job_id uuid,number int,state text,failure_cause jsonb);
    CREATE TABLE usp_job_metadata(job_id uuid,logical_state text,version int);
    CREATE TABLE usp_streaming_vector_imports(job_id uuid,state text,unknown_remainder bool,sealed_chunks int,
      issue_code text);
    CREATE TABLE usp_chunk_mapping_imports(LIKE usp_streaming_vector_imports);
    CREATE TABLE usp_streaming_vector_slots(job_id uuid,source_revision int,chunk_index int,status text,
      published bool,first_feature_index int,last_feature_index int,records int,accepted int,quarantined int,
      bytes int,object_key text,object_sha256 text,issue_code text,result_sha256 text,attempt int,fence int);
    CREATE TABLE usp_chunk_mapping_slots(LIKE usp_streaming_vector_slots,raw_result_sha256 text,
      schema_fingerprint text,schema_drift bool,normalized int,unresolved int);`);
  await db.query('INSERT INTO cases VALUES($1,1,false)', [caseId]);
  await db.query("INSERT INTO sources VALUES($1,$2,1,$1,$3,1,$4,'large-original-v1',$5)",
    [sourceId, caseId, sourceHash, raw.objectKey, { largeOriginal: { operatorSubject: binding.subject } }]);
  for (const [input, operation] of [[raw, 'streaming-vector'], [mapped, 'chunk-mapping']] as const) {
    await db.query('INSERT INTO jobs VALUES($1,$2,$3,$4,$5,$6,\'succeeded\',null,null,null)',
      [input.jobId, caseId, sourceId, operation, input, fingerprint(input)]);
    const table = operation === 'streaming-vector' ? 'usp_streaming_vector' : 'usp_chunk_mapping';
    await db.query(`INSERT INTO ${table}_imports VALUES($1,'completed',false,1554,null)`, [input.jobId]);
    const payload = operation === 'streaming-vector' ? rawPayload : mappedPayload;
    const hash = sha256(bytes(payload));
    await db.query(`INSERT INTO ${table}_slots(job_id,source_revision,chunk_index,status,published,
      first_feature_index,last_feature_index,records,accepted,quarantined,bytes,object_key,object_sha256,
      result_sha256,attempt,fence) VALUES($1,1,1553,'ready',true,0,null,0,0,0,$2,$3,$4,$4,1,1)`,
    [input.jobId, bytes(payload).length, operation, hash]);
  }
  await db.query(`UPDATE usp_chunk_mapping_slots SET raw_result_sha256=$1,schema_drift=false,
    normalized=0,unresolved=0`, [rawHash]);
  const globals = globalThis as any, prior = globals.ulpinPool;
  const client = { query: async (sql: string, args: unknown[]) => {
    const result = await db.query(sql, args);
    return { ...result, rowCount: result.rows.length };
  }, release() {} };
  globals.ulpinPool = { connect: async () => client };
  t.after(() => { globals.ulpinPool = prior; });
  for (const key of ['s3Endpoint', 's3Region', 's3Bucket', 's3AccessKey', 's3SecretKey'] as const) {
    t.mock.getter(settings, key, () => key === 's3Endpoint' ? 'http://127.0.0.1:1' : 'protocol');
  }
  let corrupt = false;
  t.mock.method(S3Client.prototype, 'send', async (command: any) => ({ Body: {
    transformToByteArray: async () => corrupt ? bytes({}) : bytes(command.input.Key === 'streaming-vector'
      ? rawPayload : mappedPayload),
  } }));
  const reader = new StreamingVectorService(), mapper = new ChunkMappingService();
  const input = { caseId, sourceId, jobId: rawId };
  const fold = { readerJobId: rawId, mappingJobId: mappedId, after: -1, conflicts: new Set(),
    chunkReadMs: 0, chunkReads: 0 };
  let stopped: unknown;
  const { pairedChunk: paired, fail } = worker({ reader, mapper, conflict, pairMappedFeatures, AppError,
    USP_JOB_LIMITS: { maxAttempts: 3 }, INTAKE_LARGE_STOPPED,
    intakeLargePartRefusal: () => null, transaction: (work: any) => work(client),
    lockSourceCaseDestinationTx: async () => {}, assertUspJobAttemptTx: async () => {},
    stopItemTx: async (_client: unknown, _input: unknown, reason: unknown) => { stopped = reason; },
  });
  const read = () => paired(input, fold, 1553);
  assert.notEqual(raw.readerSha256, streamingReaderSha());
  assert.notEqual(mapped.converterSha256, chunkMappingConverterSha());
  let refused: unknown;
  try { await read(); } catch (error) { refused = error; }
  assert(refused instanceof AppError);
  await db.query("INSERT INTO usp_job_attempts VALUES($1,1,'active',null)", [rawId]);
  await db.query("INSERT INTO usp_job_metadata VALUES($1,'running',1)", [rawId]);
  await fail(input, { number: 1 }, refused);
  assert.equal((await db.query('SELECT status FROM jobs WHERE id=$1', [rawId])).rows[0].status, 'failed');
  assert.equal(stopped, INTAKE_LARGE_STOPPED, 'the terminal reason remains eligible for officer retry');
  const cause = (await db.query('SELECT failure_cause FROM usp_job_attempts')).rows[0].failure_cause;
  assert.equal(cause.errorCode, 'STALE_REVISION');
  assert.equal(cause.message, refused.message);
  assert.match(cause.message, /1553.*raw.current, mapped.current.*reader_changed.*converter_changed/);
  assert.equal((await reader.chunk(caseId, sourceId, rawId, 1553)).current, false,
    'the deployed reader pin is still checked');
  corrupt = true;
  await assert.rejects(read, (e: any) => e.code === 'STREAMING_CHUNK_INTEGRITY');
  corrupt = false;
  await db.query('UPDATE usp_chunk_mapping_slots SET raw_result_sha256=$1', ['2'.repeat(64)]);
  await assert.rejects(read, (e: any) => e.code === 'MAPPING_CHUNK_INTEGRITY');
  await db.query('UPDATE usp_chunk_mapping_slots SET raw_result_sha256=$1', [rawHash]);
  await db.exec('UPDATE usp_streaming_vector_imports SET unknown_remainder=true');
  await assert.rejects(read, /1553.*raw.unknownRemainder/);
  await fail(input, { number: 1 }, new AppError(409, 'STALE_REVISION', 'A transient revision race.'));
  assert.equal((await db.query('SELECT status FROM jobs WHERE id=$1', [rawId])).rows[0].status, 'queued');
});

test('sealed-part conflicts name the index and all six failing conditions without source values', async () => {
  const unavailable = { current: false, sourceComplete: false, unknownRemainder: true, payload: null, reasons: [] };
  const { pairedChunk } = worker({ reader: { chunk: async () => unavailable },
    mapper: { chunk: async () => unavailable }, AppError, conflict });
  await assert.rejects(() => pairedChunk({}, {}, 1553), (error: any) => {
    assert.equal(error.code, 'STALE_REVISION');
    assert.match(error.message, /Sealed chunk 1553 unavailable: raw.current, raw.sourceComplete, /);
    assert.match(error.message, /raw.unknownRemainder, raw.payload, mapped.current, mapped.payload;/);
    return true;
  });
});
