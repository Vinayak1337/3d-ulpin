import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as large from './intake-large';
import { StreamingVectorService, streamingReaderSha } from './streaming-vector';
import { StreamedProfileService } from './streamed-profile';
import { chunkMappingConverterSha } from './chunk-mapping';
import { readIntakeReadPreview } from './intake-read-preview';
import { fingerprint } from '../../cases/domain';
import { localOperatorSubject } from '../principal';

function workerFunctions(names: string[], controls: Record<string, unknown>) {
  const source = readFileSync(new URL('./intake-large-worker.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const body = names.map(name => source.slice(source.indexOf(`async function ${name}`))
    .split('\n}\n')[0] + '\n}');
  const js = ts.transpileModule(body.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(controls), `${js}; return { ${names.join(',')} };`)(...Object.values(controls));
}

for (const moved of ['reader', 'converter']) test(`${moved}_changed retry selects a fresh retained read`, {
  skip: !process.env.S13X_PGLITE_MODULE,
}, async t => {
  const previousSubject = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'reread-protocol';
  t.after(() => {
    if (previousSubject === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
    else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = previousSubject;
  });
  const { PGlite } = await import(process.env.S13X_PGLITE_MODULE!);
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`CREATE TABLE cases(id uuid PRIMARY KEY,revision int,archived bool);
    CREATE TABLE sources(id uuid PRIMARY KEY,case_id uuid,family_id uuid,revision int,name text,profile text,
      mime_type text,bytes int,sha256 text,object_key text,status text,inspection jsonb);
    CREATE TABLE jobs(id uuid PRIMARY KEY,case_id uuid,source_id uuid,operation text,case_revision int,
      input_fingerprint text,payload jsonb,status text DEFAULT 'queued');
    CREATE TABLE operations(case_id uuid,operation_key text,kind text,payload_hash text,result jsonb,
      PRIMARY KEY(case_id,operation_key,kind));
    CREATE TABLE usp_job_metadata(job_id uuid,input_manifest_id uuid,input_sha256 text,scope jsonb);
    CREATE TABLE usp_outbox_streams(stream_id text PRIMARY KEY,last_sequence bigint DEFAULT 0);
    CREATE TABLE usp_outbox(stream_id text,sequence bigint,body jsonb);
    CREATE TABLE usp_mapping_recipes(id uuid,source_id uuid,revision int,state text,body jsonb);
    CREATE TABLE usp_intake_items(item_id uuid,source_id uuid,case_id uuid,parent_item_id uuid,
      state text,placement text,card jsonb,plan_ref jsonb,records_seen int DEFAULT 0,parts_planned int,
      parts_done int DEFAULT 0,limit_reason text,family text,format text,size_class text,wave int,
      pinned_by_officer bool,updated_at timestamptz);
    CREATE TABLE usp_intake_parts(item_id uuid,part_index int,locator jsonb,counts jsonb,state text,result_ref jsonb);
    CREATE TABLE import_packages(id uuid,state text,review_current bool);`);
  for (const file of ['streaming-vector', 'streamed-profile', 'chunk-mapping']) {
    await db.exec(readFileSync(new URL(`../../../../../../database/sql/95-ingestion/${file}.sql`,
      import.meta.url), 'utf8'));
  }
  const caseId = randomUUID(), itemId = randomUUID(), sourceId = randomUUID();
  const oldReader = randomUUID(), oldProfile = randomUUID(), oldMapping = randomUUID(), hash = 'a'.repeat(64);
  const source = { id: sourceId, revision: 1, bytes: 1, profile: 'large-original-v1', sha256: hash,
    object_key: 'unopened-test-only-original', inspection: { largeOriginal: { uploadId: sourceId,
      operatorSubject: localOperatorSubject(), objectEtag: 'test_only', verifiedSha256: hash, verifiedBytes: 1,
      conversion: 'unsupported', bundleCompleteness: 'single_original_only_archive_dependencies_not_assessed',
      provenance: { origin: 'not_stated', acquiredAt: '2026-10-25T00:00:00.000Z', state: 'not_stated' } } } };
  await db.query('INSERT INTO cases VALUES($1,1,false)', [caseId]);
  await db.query(`INSERT INTO sources VALUES($1,$2,$1,1,'test_only.geojson','large-original-v1',
    'application/octet-stream',1,$3,$4,'received',$5)`,
  [sourceId, caseId, hash, source.object_key, source.inspection]);
  await db.query(`INSERT INTO usp_intake_items(item_id,source_id,case_id,state,placement,card,limit_reason,
    family,format,size_class,wave,pinned_by_officer) VALUES($1,$2,$3,'failed_part','not_understood',$4,$5,
    'vector','geojson','S',1,false)`, [itemId, sourceId, caseId,
    { family: 'vector', format: 'geojson', crs: { state: 'absent', code: null } }, large.INTAKE_LARGE_STOPPED]);
  for (const [id, kind, step] of [[oldReader, 'streaming-vector', 'reader'],
    [oldProfile, 'streamed-profile', 'profile'], [oldMapping, 'chunk-mapping', 'mapping']] as const) {
    await db.query('INSERT INTO jobs VALUES($1,$2,$3,$4,1,$5,$6,\'succeeded\')', [id, caseId, sourceId,
      kind, hash, { readerSha256: moved === 'reader' ? hash : streamingReaderSha(),
        converterSha256: moved === 'converter' ? hash : chunkMappingConverterSha() }]);
    await db.query('INSERT INTO operations VALUES($1,$2,$3,$4,$5)', [caseId,
      `${kind}:${large.intakeLargeRequestKey(itemId, step, step === 'mapping' ? 2 : 0)}`, kind, hash, { jobId: id }]);
  }
  await db.query(`INSERT INTO usp_streaming_vector_imports(job_id,case_id,source_id,source_revision,
    input_sha256,state,next_publish_index,sealed_chunks,records,accepted,unknown_remainder)
    VALUES($1,$2,$3,1,$4,'completed',1,1,1,1,false)`, [oldReader, caseId, sourceId, hash]);
  await db.query(`INSERT INTO usp_streamed_profile_imports(job_id,raw_job_id,case_id,source_id,
    source_revision,input_sha256,state,sealed_generation) VALUES($1,$2,$3,$4,1,$5,'sealed',1)`,
  [oldProfile, oldReader, caseId, sourceId, hash]);
  await db.query(`INSERT INTO usp_chunk_mapping_imports(job_id,raw_job_id,case_id,source_id,
    source_revision,input_sha256,state) VALUES($1,$2,$3,$4,1,$5,'completed')`,
  [oldMapping, oldReader, caseId, sourceId, hash]);
  await db.query('INSERT INTO usp_mapping_recipes VALUES($1,$2,2,\'approved\',$3)', [randomUUID(), sourceId,
    { planHash: hash, plan: { version: 'streamed-prefix-mapping/1', rawJobId: oldReader,
      profileJobId: oldProfile, profileGeneration: 0, profileHash: hash } }]);
  await db.query(`INSERT INTO usp_intake_parts VALUES($1,7,$2,$3,'published','{}')`, [itemId,
    { mappingJobId: oldMapping, featureIndices: [99] }, { accepted: 1, held: 5 }]);
  const client = { query: async (sql: string, args: unknown[]) => {
    const result = await db.query(sql, args);
    return { ...result, rowCount: result.affectedRows ?? result.rows.length };
  }, release() {} };
  const globals = globalThis as any, previous = globals.ulpinPool;
  globals.ulpinPool = { connect: async () => client };
  t.after(() => { globals.ulpinPool = previous; });
  const snapshot = async () => (await db.query(`SELECT j.*,to_jsonb(r) raw,to_jsonb(p) profile,to_jsonb(m) mapping
    FROM jobs j LEFT JOIN usp_streaming_vector_imports r ON r.job_id=j.id
    LEFT JOIN usp_streamed_profile_imports p ON p.job_id=j.id
    LEFT JOIN usp_chunk_mapping_imports m ON m.job_id=j.id WHERE j.id=ANY($1::uuid[]) ORDER BY j.id`,
  [[oldReader, oldProfile, oldMapping]])).rows;
  const before = await snapshot(), request = { requestKey: randomUUID() };
  const result = await large.retryIntakeLargeItem(caseId, itemId, request);
  assert.deepEqual(await large.retryIntakeLargeItem(caseId, itemId, request), result);
  const state = () => large.largeStateKey(client as any, sourceId);
  assert.equal((await state())!.store.reader, null, 'retry must abandon the obsolete reader authority');
  assert.equal((await db.query('SELECT state FROM usp_intake_items')).rows[0].state, 'reading');
  const reader = new StreamingVectorService(), profiler = new StreamedProfileService();
  const { startReaders } = workerFunctions(['startReaders'], { reader, profiler,
    caseRevision: async () => 1, intakeGeojsonFraming: () => 'feature-collection',
    intakeLargeRequestKey: large.intakeLargeRequestKey });
  const input = { caseId, itemId, sourceId, sourceRevision: 1, sourceSha256: hash };
  await startReaders(input, undefined, await state());
  const fresh = (await state())!;
  assert.notEqual(fresh.store.reader!.job_id, oldReader);
  assert.notEqual(fresh.store.profile!.job_id, oldProfile);
  assert.equal(fresh.store.recipe, null, 'old exact-profile approval must ask again, never transfer by field shape');
  assert.equal(fresh.store.parts, 0, 'old drafts are history, not the new fold progress');
  const newPayload = (await db.query('SELECT payload FROM jobs WHERE id=$1', [fresh.store.reader!.job_id]))
    .rows[0].payload;
  assert.equal(newPayload.objectKey, source.object_key);
  assert.equal(newPayload.readerSha256, streamingReaderSha());
  assert.equal(newPayload.sourceSha256, hash);
  let previewReader: string | undefined;
  await assert.rejects(() => readIntakeReadPreview(caseId, itemId, {}, {
    transaction: async (work: any) => work(client), reader: {
      status: async (_case: string, _source: string, id: string) => {
        previewReader = id;
        return { sourceRevision: 1, sourceSha256: hash, framing: 'feature-collection', nextPublishIndex: 0 } as any;
      }, chunk: async () => assert.fail('no old or new chunk is opened'),
    },
  } as any), /no published reader parts/);
  assert.equal(previewReader, fresh.store.reader!.job_id);
  assert.deepEqual(await snapshot(), before, 'the old jobs and imports stay byte-for-byte intact');
  assert.equal((await db.query('SELECT count(*)::int n FROM usp_intake_parts')).rows[0].n, 1);
  const newRaw = fresh.store.reader!.job_id, newProfile = fresh.store.profile!.job_id;
  const plan = { rawJobId: newRaw, profileJobId: newProfile, profileGeneration: 0, profileHash: hash };
  let mappingRequest: any;
  const { startMapping } = workerFunctions(['startMapping'], {
    pinned: async (_input: unknown, _attempt: unknown, work: any) => work(client, fresh),
    publishTx: async () => {}, caseRevision: async () => 1, intakeLargeRequestKey: large.intakeLargeRequestKey,
    mapper: { enqueue: async (_case: string, _source: string, request: unknown) => { mappingRequest = request; } },
  });
  // A later officer answer must name the new exact profile; the old receipt remains in history.
  await db.query('UPDATE usp_mapping_recipes SET body=$1', [{ planHash: hash, plan }]);
  await db.query(`INSERT INTO usp_streamed_profile_generations(job_id,generation,raw_chunk_index,
    raw_result_sha256,body,body_sha256,sealed,attempt,fence) VALUES($1,0,0,$2,$3,$2,false,1,1)`,
  [newProfile, hash, { generationHash: hash }]);
  assert((await state())!.store.recipe, 'an exact matching profile retains its approved recipe');
  await db.query('UPDATE usp_streamed_profile_generations SET body=$1', [{ generationHash: 'b'.repeat(64) }]);
  assert.equal((await state())!.store.recipe, null, 'a different profile hash asks again');
  fresh.store.recipe = { id: (await db.query('SELECT id FROM usp_mapping_recipes')).rows[0].id,
    revision: 4, state: 'approved' };
  await startMapping(input, undefined, fresh);
  assert.equal(mappingRequest.rawJobId, newRaw);
  assert.equal(mappingRequest.profileJobId, newProfile);
  assert.equal(mappingRequest.requestKey, large.intakeLargeRequestKey(itemId, 'mapping', 4, 1));
  assert.notEqual(mappingRequest.requestKey, large.intakeLargeRequestKey(itemId, 'mapping', 4));
  fresh.store.mapping = { ...fresh.store.reader!, job_id: randomUUID() };
  fresh.source.inspection!.streamedMapReceipt = { collectionMetadata: {} };
  const { foldContext } = workerFunctions(['foldContext'], {
    largeDestination: async () => ({}), sourceName: async () => 'test_only.geojson', intakeCaseArea: async () => null,
    pinned: async (_input: unknown, _attempt: unknown, work: any) => work(client, fresh),
    publishTx: async () => {}, destinationFrameTx: async () => null, intakeLargeCutKey: large.intakeLargeCutKey,
  });
  const fold = await foldContext(input, {});
  assert.equal(fold.after, -1, 'old locators never become the new read cursor');
  assert.equal(fold.held.held, 0, 'old held counts are not carried into the new fold');
  assert.equal(fold.parts, 8, 'new cuts append after history without colliding with its indexes');
  assert.equal(fingerprint(before), fingerprint(await snapshot()));
});
