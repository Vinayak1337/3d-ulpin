import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { fingerprint } from '../../cases/domain';
import { assertUspJobAttemptTx, USP_JOB_LIMITS } from '../jobs';
import { sourceRecord } from './streaming-vector-reader';
import { advanceStreamedInventory, emptyInventory } from './streamed-profile-inventory';
import { checkIntakeLargeChunk } from './intake-large-worker';

const text = readFileSync(new URL('./intake-large-worker.ts', import.meta.url), 'utf8');
const id = '54200000-0000-4000-8000-000000000001', hash = 'a'.repeat(64);
const original = readFileSync('fixtures/google-uttam/00-all-google-detections.geojson');
const features = JSON.parse(original.toString()).features.slice(0, 8);
assert.equal(features.length, 8);
const records: ReturnType<typeof sourceRecord>[] = features.map((feature: any, index: number) => {
  const raw = Buffer.from(JSON.stringify(feature));
  return sourceRecord({ index, start: 0, end: raw.length, raw, feature, valueIssueCode: null });
});
const profile = { ...advanceStreamedInventory(emptyInventory(), records).inventory,
  version: 'streamed-profile/1', jobId: id, rawJobId: id,
  source: { sourceId: id, familyId: id, sourceRevision: 1, sourceSha256: hash, schemaFingerprint: hash },
  readerSha256: hash, profilerSha256: hash, generation: 8, generationHash: hash, previousHash: null,
  coverage: 'sealed', rawChunkIndex: null, rawResultSha256: null, unknownRemainder: false,
  quarantineLocators: [], reference: { sourceCrs: null, evidence: null, globalPlacement: 'not_qualified' } };
const plan = { version: 'streamed-mapping/1', mode: 'streamed_mapping', scope: 'accepted_source_features',
  caseId: id, caseRevision: 1, source: profile.source, rawJobId: id, profileJobId: id,
  profileGeneration: 8, profileHash: hash, kind: 'building', basis: 'officer_stated', semanticEvidence: [],
  operations: [
    { target: 'feature.sourceKey', sourcePath: '/features/*/geometry', conversionId: 'feature_position@1' },
    { target: 'feature.geometry', sourcePath: '/features/*/geometry', conversionId: 'geojson_geometry@1' },
  ] };
const slice = (name: string, next: string) => text.slice(text.indexOf(`async function ${name}(`),
  text.indexOf(next, text.indexOf(`async function ${name}(`)));
const heartbeat = text.slice(text.indexOf('function heartbeat('), text.indexOf('/** Follow only committed'));

async function run(batch: number, ranges = false) {
  let now = 0, leaseUntil = 180000, beats = 0, reads = 0, stored = false;
  const savedNow = Date.now;
  Date.now = () => now;
  const attempt = { jobId: id, number: 1, fence: 1, owner: 'test_only', inputSha256: hash,
    leaseUntil: new Date(leaseUntil).toISOString() };
  const chunks = batch === 8 && !ranges ? 64 : 8;
  const state = { store: { reader: { job_id: id, sealed_chunks: chunks }, profile: {}, recipe: {},
    mapping: { job_id: id } } };
  const client = { query: async (sql: string, values: any[] = []) => {
    if (sql.startsWith('SELECT body')) return { rows: [{ body: { plan, planHash: hash } }] };
    if (sql.includes('FROM usp_streaming_vector_slots')) return { rows: Array.from(
      { length: values[3] - values[2] }, (_, offset) => ({ index: values[2] + offset,
        chunk_index: values[2] + offset, result_sha256: hash, object_key: id, object_sha256: hash, bytes: 1 })) };
    if (sql.startsWith('SELECT status FROM jobs')) return { rows: [{ status: 'running' }] };
    if (sql.includes('FROM usp_job_metadata'))
      return { rows: [{ logical_state: 'running', input_sha256: hash }] };
    if (sql.includes('FROM usp_job_attempts')) return { rows: [{ state: 'active', fence: 1,
      owner: 'test_only', input_sha256: hash, lease_until: new Date(leaseUntil) }] };
    if (sql.startsWith('UPDATE sources')) { stored = true; return { rows: [] }; }
    throw new Error(sql);
  } };
  const deps = { fingerprint, StreamedMappingReceiptSchema: { parse: (value: any) => value },
    loadProvisionalStreamedProfileTx: async () => ({ profile }),
    loadSealedStreamedProfileTx: async () => ({ profile }), loadPrefixSealTx: async () => profile,
    prefixLayoutMatchesSealed: () => true, prefixSealCheckKey: () => hash,
    pinned: async (_input: unknown, _attempt: unknown, work: any) => {
      await assertUspJobAttemptTx(client as any, attempt);
      return work(client, state);
    }, readPinnedRawChunk: async (_input: unknown, slot: any) => {
      const started = now;
      await Promise.resolve(); // Concurrent reads spend one 23 s wave, not eight serial 23 s intervals.
      now = Math.max(now, started + 23000); reads++;
      return { payload: { records: [records[slot.index % records.length]] } };
    }, readObjectRange: async () => { now += 23000; reads++; return Buffer.from('test_only'); },
    readRawFeatureRanges: async function* (_ranges: unknown, read: Function) {
      for (let index = 0; index < 8; index++)
        yield { range: { featureIndex: index }, bytes: await read(0, 9) };
    }, RANGE_MS: 30000,
    checkIntakeLargeChunk, assertUspJobAttemptTx, USP_JOB_LIMITS,
    heartbeatUspJobAttempt: async () => {
      await assertUspJobAttemptTx(client as any, attempt);
      beats++; leaseUntil = now + 180000;
    }, assertIntakeDraftTx: async () => {}, query: async () => ({ rows: [] }),
    conflict: (message: string) => { throw new Error(message); } };
  let source = (ranges ? slice('rawFeatures', '\nfunction countHeld(')
    : slice('comparePrefix', '\nasync function step(')) + heartbeat;
  if (batch === 1) source = source.replaceAll('first += 8', 'first += 1').replaceAll('first + 8', 'first + 1');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const execute = new Function(...Object.keys(deps), `${js}; return ${ranges ? 'rawFeatures' : 'comparePrefix'};`)
    (...Object.values(deps));
  let error: unknown;
  try {
    const input = { sourceId: id, caseId: id, sourceRevision: 1 };
    if (ranges) {
      const beat = new Function(...Object.keys(deps), `${js}; return heartbeat;`)(...Object.values(deps));
      await execute({ objectKey: id, sourceBytes: 9 }, { features: records.map(record => ({ raw: record,
        mapped: { geometryRef: { chunkIndex: 0 } } })) }, () => {}, beat(input, attempt));
      await assertUspJobAttemptTx(client as any, attempt);
      stored = true;
    } else await execute(input, attempt);
  }
  catch (value) { error = value; }
  finally { Date.now = savedNow; }
  return { stored, reads, beats, simulatedMs: now, error: error instanceof Error ? error.message : null };
}

test('baseline: one-part lock interval preserves a progressing whole-file check', async () => {
  const result = await run(1);
  assert.deepEqual(result, { stored: true, reads: 8, beats: 4, simulatedMs: 184000, error: null });
});

for (const ranges of [false, true]) {
  test(`${ranges ? 'cut range pre-read' : 'whole-file check'} renews through 184 s of 23 s reads`, async () => {
    const result = await run(8, ranges);
    assert.deepEqual(result, { stored: true, reads: ranges ? 8 : 64, beats: 4, simulatedMs: 184000, error: null });
  });
}
