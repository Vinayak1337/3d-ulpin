import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import type { PoolClient } from 'pg';
import { AppError, conflict, notFound } from '../../../infrastructure/errors';
import { fingerprint } from '../../cases/domain';
import { ChunkMappingService } from './chunk-mapping';
import { intakeSourceTx } from './intake-context';
import { sealedMapReceipt } from './streamed-map-receipt';
import { prefixSealCheckKey } from './streamed-mapping';
import { assertPartPrefixSealCheck, partStageTimer, type ProvedAreaPartInput } from './proved-area-part';
import { draftIntakePartTx, IntakeMappingCutPending } from './intake-part-draft';
import { isRetainedMapOriginal } from './retained-map-original';
import { localOperatorSubject } from '../principal';

const id = '54200000-0000-4000-8000-000000000001', hash = 'a'.repeat(64);
process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'intake-large-protocol';

/** Execute the complete draft source: only processor/persistence boundaries are replaced, never admission. */
function loadDraft(boundaries: Record<string, unknown>) {
  const text = readFileSync(new URL('./intake-part-draft.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022 } }).outputText.replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/^export /gm, '');
  const deps = { AppError, conflict, notFound, fingerprint, ChunkMappingService, intakeSourceTx,
    assertPartPrefixSealCheck, partStageTimer, isRetainedMapOriginal, ...boundaries };
  return new Function(...Object.keys(deps), `${js}; return { draftIntakePartTx, IntakeMappingCutPending };`)
    (...Object.values(deps));
}

function fixture() {
  const feature = JSON.parse(readFileSync('fixtures/google-uttam/00-all-google-detections.geojson', 'utf8'))
    .features[0];
  const bytes = Buffer.from(JSON.stringify(feature));
  const source = { id, case_id: id, revision: 1, bytes: 1234, sha256: hash, object_key: 'test_only',
    profile: 'large-original-v1', inspection: { largeOriginal: { uploadId: id,
      operatorSubject: localOperatorSubject(), objectEtag: 'test_only', verifiedSha256: hash, verifiedBytes: 1234,
      conversion: 'unsupported', bundleCompleteness: 'single_original_only_archive_dependencies_not_assessed',
      provenance: { issuer: 'Protocol only', originalUrl: 'https://example.invalid/test_only',
        acquiredAt: '2026-10-11T00:00:00.000Z', permissionReference: 'Protocol only', limitations: [],
        state: 'caller_declared' } }, streamedMapReceipt: sealedMapReceipt({ sourceId: id, sourceRevision: 1,
      sourceSha256: hash, sourceBytes: 1234, jobId: id,
      framing: 'feature-collection', version: 'geojson-stream/2' } as any,
    { bytes: 1234, sha256: hash, features: 2, metadata: { type: 'FeatureCollection' } },
    [{ chunk_index: 0, first_feature_index: 0, last_feature_index: 1, records: 2, accepted: 2,
      quarantined: 0, published: true, result_sha256: hash }]) } };
  const check = { key: prefixSealCheckKey(hash, hash, id), changed: false, mappingJobId: id,
    conflicts: [] as number[] };
  const mapped = { source_id: id, source_revision: 1, raw_parts: 1, raw_records: 2,
    raw_unknown: false, raw_state: 'completed', state: 'running', sealed_chunks: null as number | null,
    unknown_remainder: true, next_publish_index: 1, records: 1, seal_check: check,
    payload: { sourceSha256: hash, planHash: hash, route: 'approved_recipe', rawJobId: id } };
  const current = { plan_hash: hash, sealed_hash: hash };
  const record = { featureIndex: 0, disposition: 'observed', sourceKey: { state: 'known' },
    geometryRef: { rawJobId: id, chunkIndex: 0 } };
  const chunk = { current: true, sourceComplete: false, unknownRemainder: true, payload: { records: [record] } };
  const writes: string[] = [], conflicts: { first_feature_index: number; later_feature_index: number }[] = [];
  const client = { query: async (sql: string) => {
    if (sql.startsWith('SELECT case_id')) return { rows: [{ case_id: id }] };
    if (sql.startsWith('SELECT id,revision,archived')) return { rows: [{ id, revision: 1 }] };
    if (sql.startsWith('SELECT * FROM sources')) return { rows: [source] };
    if (sql.startsWith('SELECT pg_advisory') || sql.startsWith('UPDATE jobs SET dispatched_at'))
      return { rows: [] };
    if (sql.startsWith('SELECT * FROM usp_intake_items')) return { rows: [{ source_id: id, case_id: id }] };
    if (sql.startsWith('SELECT m.*')) {
      assert.match(sql, /FOR SHARE OF m,j,r,s/);
      return { rows: [mapped] };
    }
    if (sql.startsWith('SELECT r.body')) {
      assert.match(sql, /FOR SHARE OF r,p,g/);
      return { rows: [current] };
    }
    if (sql.startsWith('SELECT first_feature_index')) return { rows: conflicts };
    if (sql.startsWith('SELECT locator')) return { rows: [] };
    throw new Error(sql);
  } };
  const loaded = loadDraft({
    unfinishedIntakePackagesTx: async () => 0,
    ingestProvedAreaPart: async () => { writes.push('ingest'); return { features: [feature] }; },
    publishIntakePartTx: async (...args: any[]) => { writes.push('publish'); assert.equal(args[5].recordsSeen, 2); },
    createIntakeTargetsTx: async () => { writes.push('targets'); },
    ChunkMappingService: class { async chunk() { return chunk; } },
  });
  const input = { sourceId: id, sourceRevision: 1, sourceSha256: hash, layoutHash: hash, cutIndex: 0,
    readerVersion: 'geojson-stream/2', features: [{ featureIndex: 0, rawChunkIndex: 0, rawBytes: bytes }] };
  return { ...loaded, run: () => loaded.draftIntakePartTx(client, id, id, input),
    client, input, mapped, check, current, chunk, record, conflicts, writes };
}

test('the exported draft reaches the real processor only after open admission, and classifies an early cut',
  async context => {
    const f = fixture(), processorReached = new Error('test_only processor boundary');
    context.mock.method(ChunkMappingService.prototype, 'chunk', async () => f.chunk as any);
    const client = { query: async (sql: string) => {
      if (sql.startsWith('SELECT case_id FROM sources')) throw processorReached;
      if (sql.startsWith('SELECT count(*)::int n FROM usp_intake_parts part')) return { rows: [{ n: 0 }] };
      return f.client.query(sql);
    } } as PoolClient;
    const run = () => draftIntakePartTx(client, id, id, f.input as ProvedAreaPartInput);
    await assert.rejects(run(), (error: unknown) => error === processorReached);
    f.mapped.next_publish_index = 0;
    await assert.rejects(run(), IntakeMappingCutPending);
    assert.deepEqual(f.writes, []);
  });

test('real draft gate cuts a published open mapping after the whole-file key check', async () => {
  for (const state of ['queued', 'running']) {
    const f = fixture();
    f.mapped.state = state;
    await f.run();
    assert.deepEqual(f.writes, ['ingest', 'publish', 'targets']);
    assert.equal(f.chunk.sourceComplete, false, 'freshness does not require whole-mapping closure');
  }
});

test('real draft gate refuses an unpublished cut without writing a package', async () => {
  const f = fixture();
  f.input.features[0].rawChunkIndex = 1;
  await assert.rejects(f.run(), (error: any) => error instanceof f.IntakeMappingCutPending);
  assert.deepEqual(f.writes, []);
});

for (const origin of ['check', 'mapping'] as const) {
  test(`real draft gate excludes a duplicate index from ${origin}`, async () => {
    const f = fixture();
    if (origin === 'check') f.check.conflicts.push(0);
    else f.conflicts.push({ first_feature_index: 0, later_feature_index: 2001 });
    await assert.rejects(f.run(), /Both occurrences/);
    assert.deepEqual(f.writes, []);
  });
}

for (const changed of ['changed', 'key', 'plan', 'profile', 'job', 'source', 'revision', 'sha', 'route',
  'failed', 'rawOpen', 'rawUnsealed', 'rawUnknown', 'staleChunk', 'unobserved', 'unknownKey',
  'geometryJob', 'geometryChunk'] as const) {
  test(`real open gate retains the ${changed} fence`, async () => {
    const f = fixture();
    if (changed === 'changed') f.check.changed = true;
    if (changed === 'key') f.check.key = 'b'.repeat(64);
    if (changed === 'plan') f.current.plan_hash = 'b'.repeat(64);
    if (changed === 'profile') f.current.sealed_hash = 'b'.repeat(64);
    if (changed === 'job') f.check.mappingJobId = 'test_only_other';
    if (changed === 'source') f.mapped.source_id = 'test_only_other';
    if (changed === 'revision') f.mapped.source_revision++;
    if (changed === 'sha') f.mapped.payload.sourceSha256 = 'b'.repeat(64);
    if (changed === 'route') f.mapped.payload.route = 'proposal_only';
    if (changed === 'failed') f.mapped.state = 'failed';
    if (changed === 'rawOpen') f.mapped.raw_state = 'running';
    if (changed === 'rawUnsealed') (f.mapped as any).raw_parts = null;
    if (changed === 'rawUnknown') f.mapped.raw_unknown = true;
    if (changed === 'staleChunk') f.chunk.current = false;
    if (changed === 'unobserved') f.record.disposition = 'quarantined';
    if (changed === 'unknownKey') f.record.sourceKey.state = 'unknown';
    if (changed === 'geometryJob') f.record.geometryRef.rawJobId = 'test_only_other';
    if (changed === 'geometryChunk') f.record.geometryRef.chunkIndex = 1;
    await assert.rejects(f.run(), (error: any) => error.code === 'STALE_REVISION'
      && !(error instanceof f.IntakeMappingCutPending));
    assert.deepEqual(f.writes, []);
  });
}

test('sealed admission still needs exact closure and does not require a prefix check', async () => {
  const f = fixture();
  Object.assign(f.mapped, { state: 'completed', unknown_remainder: false, sealed_chunks: 1, records: 2,
    seal_check: undefined });
  await f.run();
  f.mapped.records = 1;
  await assert.rejects(f.run(), /has not closed/);
});

test('an early cut completes its step without failure/retry; a publication wake drafts through the real gate',
  async () => {
    const f = fixture();
    f.mapped.next_publish_index = 0;
    const text = readFileSync(new URL('./intake-large-worker.ts', import.meta.url), 'utf8');
    const start = text.indexOf('async function step('), end = text.indexOf('\n/**', start);
    const js = ts.transpileModule(text.slice(start, end), {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    let completed = 0;
    const publications: boolean[] = [];
    const row = { state: 'preparing' }, jobs = ['running'];
    const deps = { pinned: async (_input: unknown, _attempt: unknown, work: any) => work(f.client,
      { item: row, store: { unreviewed: 0 } }),
    intakeLargeStepCurrent: () => true, intakeLargeAtRest: () => false, retiredFileAreaWords: async () => null,
    intakeLargePhase: () => 'draft', intakeLargeRows: () => ({}), INTAKE_UNFINISHED_PACKAGE_LIMIT: 8,
    draft: async () => { await f.run(); }, IntakeMappingCutPending: f.IntakeMappingCutPending,
    complete: async (_input: unknown, _attempt: unknown, publish: boolean) => {
      completed++;
      publications.push(publish);
      jobs[jobs.length - 1] = 'succeeded';
    } };
    const step = new Function(...Object.keys(deps), `${js}; return step;`)(...Object.values(deps));
    // Only successful completion exists here: any unhandled refusal fails the test, just as it enters fail().
    await step({}, {});
    assert.equal(completed, 1);
    assert.equal(row.state, 'preparing');
    assert.deepEqual(f.writes, []);
    f.mapped.next_publish_index = 1;
    jobs.push('running'); // queueIntakeLargeTx's publication-watermark wake is covered by its own tests.
    await step({}, {});
    assert.deepEqual(jobs, ['succeeded', 'succeeded']);
    assert.deepEqual(publications, [false, true], 'the early refusal leaves the preparing row untouched');
    assert.deepEqual(f.writes, ['ingest', 'publish', 'targets']);
    f.check.changed = true;
    await assert.rejects(step({}, {}), /has not passed/);
    assert.equal(completed, 2, 'other stale causes must still reach failure handling');
  });
