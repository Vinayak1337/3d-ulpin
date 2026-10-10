import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { fingerprint } from '../packages/server/src/modules/cases/domain';
import { ingestionBinding } from '../packages/server/src/modules/usp/ingestion/events';
import { AnyStreamingInputSchema, ChunkMappingInputSchema, StreamedProfileInputSchema } from
  '../packages/contracts/src/usp';
import { assertStreamingInputTx, streamingReadContextTx, streamingReaderSha } from
  '../packages/server/src/modules/usp/ingestion/streaming-vector';
import { assertChunkMappingInputTx, chunkMappingReadContextTx, chunkMappingConverterSha } from
  '../packages/server/src/modules/usp/ingestion/chunk-mapping';
import { assertStreamedProfileInputTx, streamedProfilerSha } from
  '../packages/server/src/modules/usp/ingestion/streamed-profile';

// SQL protocol controls, not invented originals or geometry and not native extraction qualification.
function fixture(caseId = randomUUID(), revision = 1) {
  const binding = ingestionBinding(caseId);
  const sourceId = randomUUID();
  const source = { id: sourceId, case_id: caseId, revision: 1, family_id: sourceId,
    sha256: fingerprint({ protocol: sourceId }), bytes: 1, object_key: 'protocol-original',
    profile: 'large-original-v1', inspection: { largeOriginal: { operatorSubject: binding.subject } } };
  const rawBase = { version: 'geojson-stream/2', jobId: randomUUID(), caseId, caseRevision: revision,
    sourceId, sourceRevision: 1, sourceFamilyId: sourceId, sourceSha256: source.sha256,
    sourceBytes: 1, objectKey: source.object_key, framing: 'feature-collection', subject: binding.subject,
    accessBinding: binding.access, readerSha256: streamingReaderSha() };
  const raw = AnyStreamingInputSchema.parse({ ...rawBase, inputFingerprint: fingerprint(rawBase) });
  const dependent = { caseId, caseRevision: revision, sourceId, sourceRevision: 1, sourceFamilyId: sourceId,
    sourceSha256: source.sha256, rawJobId: raw.jobId, rawInputFingerprint: fingerprint(raw),
    readerSha256: raw.readerSha256, subject: binding.subject, accessBinding: binding.access };
  const mapBase = { ...dependent, version: 'chunk-mapping/1', jobId: randomUUID(), route: 'proposal_only',
    recipeId: null, recipeRevision: null, planHash: null, schemaFingerprint: null, workspaceFingerprint: null,
    converterSha256: chunkMappingConverterSha() };
  const mapped = ChunkMappingInputSchema.parse({ ...mapBase, inputFingerprint: fingerprint(mapBase) });
  const profileBase = { ...dependent, version: 'streamed-profile/1', jobId: randomUUID(),
    profilerSha256: streamedProfilerSha() };
  const profile = StreamedProfileInputSchema.parse({ ...profileBase, inputFingerprint: fingerprint(profileBase) });
  return { raw, mapped, profile, source };
}

function database(f: ReturnType<typeof fixture>) {
  const state = { revision: f.raw.caseRevision, latest: 1, archived: false };
  const client = { async query(sql: string) {
    if (sql.includes('FROM cases')) return { rows: [{ id: f.raw.caseId, ...state }] };
    if (sql.includes('max(revision)')) return { rows: [{ revision: state.latest }] };
    if (sql.includes('FROM sources')) return { rows: [f.source] };
    if (sql.includes('FROM jobs')) return { rows: [{ payload: f.raw, input_fingerprint: fingerprint(f.raw) }] };
    if (sql.includes('FROM usp_mapping_recipes')) return { rows: [] };
    throw new Error(`Unexpected protocol SQL: ${sql}`);
  } } as unknown as PoolClient;
  return { state, client };
}

async function local(run: () => Promise<void>) {
  const prior = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'k14-protocol-control';
  try { await run(); }
  finally {
    if (prior === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
    else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = prior;
  }
}

async function authority(f: ReturnType<typeof fixture>, client: PoolClient) {
  await assertStreamingInputTx(client, f.raw);
  await assertChunkMappingInputTx(client, f.mapped);
  await assertStreamedProfileInputTx(client, f.profile);
}

async function readFreshness(f: ReturnType<typeof fixture>, client: PoolClient) {
  const raw = await streamingReadContextTx(client, f.raw,
    f.raw.caseId, f.raw.sourceId, f.raw.jobId, fingerprint(f.raw));
  const mapped = await chunkMappingReadContextTx(client, f.mapped,
    f.raw.caseId, f.raw.sourceId, f.mapped.jobId, fingerprint(f.mapped));
  assert.deepEqual(raw.freshness, { current: true, reasons: [] });
  assert.deepEqual(mapped.freshness, { current: true, reasons: [] });
}

test('sequential vector protocol receipts remain current before claim, at heartbeat and after completion', () =>
  local(async () => {
    const caseId = randomUUID();
    const jobs = [1, 2, 3, 4].map(revision => fixture(caseId, revision));
    for (const f of jobs) {
      const db = database(f);
      const before = fingerprint(f);
      db.state.revision = 4; // all later receipts have arrived before the claim callback
      await authority(f, db.client);
      db.state.revision = 5; // callback shared by heartbeat and completion
      await authority(f, db.client);
      await readFreshness(f, db.client);
      assert.equal(fingerprint(f), before);
    }
  }));

test('difficult protocol: dependent mapping checks two chunk boundaries separated by an unrelated receipt', () =>
  local(async () => {
    const f = fixture();
    const db = database(f);
    const enrolled = fingerprint(f);
    await authority(f, db.client); // chunk zero publication authority
    await readFreshness(f, db.client); // chunk zero retained read authority
    db.state.revision++;
    await authority(f, db.client); // chunk one / heartbeat / completion authority
    await readFreshness(f, db.client);
    assert.equal(fingerprint(f), enrolled);
  }));

test('streaming and both dependents preserve supersession, archive, reader and self-seal refusals', () =>
  local(async () => {
    const f = fixture();
    const db = database(f);
    db.state.latest = 2;
    const checks = [
      () => assertStreamingInputTx(db.client, f.raw),
      () => assertChunkMappingInputTx(db.client, f.mapped),
      () => assertStreamedProfileInputTx(db.client, f.profile),
    ];
    for (const check of checks) await assert.rejects(check, (e: any) => e.status === 409);
    const stale = await streamingReadContextTx(db.client, f.raw,
      f.raw.caseId, f.raw.sourceId, f.raw.jobId, fingerprint(f.raw));
    assert.deepEqual(stale.freshness, { current: false, reasons: ['source_superseded'] });
    db.state.latest = 1;
    db.state.archived = true;
    for (const check of checks) {
      await assert.rejects(check, (e: any) => e.code === 'STREAMING_CASE_ARCHIVED');
    }
    db.state.archived = false;
    const { inputFingerprint: _, ...base } = f.raw;
    f.raw.readerSha256 = '0'.repeat(64);
    f.raw.inputFingerprint = fingerprint({ ...base, readerSha256: f.raw.readerSha256 });
    const changed = await streamingReadContextTx(db.client, f.raw,
      f.raw.caseId, f.raw.sourceId, f.raw.jobId, fingerprint(f.raw));
    assert.deepEqual(changed.freshness, { current: false, reasons: ['reader_changed'] });
    for (const check of checks) await assert.rejects(check, (e: any) => e.status === 409);
    f.raw.inputFingerprint = '0'.repeat(64);
    await assert.rejects(() => assertStreamingInputTx(db.client, f.raw), (e: any) => e.status === 409);
  }));

test('manual-profile mapping explicitly stays strict while its raw stream survives', () => local(async () => {
  const f = fixture();
  const db = database(f);
  f.source.profile = 'geojson-manual-v1';
  (f.source.inspection as any).actor = f.raw.subject;
  db.state.revision++;
  await assertStreamingInputTx(db.client, f.raw);
  await assert.rejects(() => assertChunkMappingInputTx(db.client, f.mapped), (e: any) => e.status === 409);
}));
