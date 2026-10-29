import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { fingerprint } from '../../cases/domain';
import { conflict } from '../../../infrastructure/errors';
import { assertPartPrefixSealCheck, partStageTimer, type ProvedAreaPartInput } from './proved-area-part';
import { prefixSealCheckKey } from './streamed-mapping';
import { sourceRecord } from './streaming-vector-reader';
import { advanceStreamedInventory, emptyInventory } from './streamed-profile-inventory';
import { checkIntakeLargeChunk } from './intake-large-worker';

const id = '55100000-0000-4000-8000-000000000001', hash = 'a'.repeat(64);
const text = readFileSync(new URL('./intake-large-worker.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const features = JSON.parse(readFileSync('fixtures/google-uttam/00-all-google-detections.geojson', 'utf8')).features;
const records = features.map((feature: any, index: number) => {
  const raw = Buffer.from(JSON.stringify(feature));
  return sourceRecord({ index, start: 0, end: raw.length, raw, feature, valueIssueCode: null });
});
const profile = { ...advanceStreamedInventory(emptyInventory(), records).inventory,
  version: 'streamed-profile/1', jobId: id, rawJobId: id,
  source: { sourceId: id, familyId: id, sourceRevision: 1, sourceSha256: hash, schemaFingerprint: hash },
  readerSha256: hash, profilerSha256: hash, generation: 1, generationHash: hash, previousHash: null,
  coverage: 'sealed', rawChunkIndex: null, rawResultSha256: null, unknownRemainder: false,
  quarantineLocators: [], reference: { sourceCrs: null, evidence: null, globalPlacement: 'not_qualified' } };
const plan = { version: 'streamed-mapping/1', mode: 'streamed_mapping', scope: 'accepted_source_features',
  caseId: id, caseRevision: 1, source: profile.source, rawJobId: id, profileJobId: id,
  profileGeneration: 1, profileHash: hash, kind: 'building', basis: 'officer_stated', semanticEvidence: [],
  operations: [
    { target: 'feature.sourceKey', sourcePath: '/features/*/properties/source_id',
      conversionId: 'literal_identifier@1' },
    { target: 'feature.geometry', sourcePath: '/features/*/geometry', conversionId: 'geojson_geometry@1' },
  ] };

function body(name: string) {
  const start = text.indexOf(`async function ${name}`), end = text.indexOf('\n}\n', start) + 3;
  assert(start >= 0 && end > start);
  return text.slice(start, end);
}

/** Real comparison, pins and normalizer; only SQL/storage and layout loading are offline boundaries. */
function fixture(change?: string) {
  let locked = false, active = 0, maximum = 0, reads = 0, expired = false, beats = 0, fences = 0;
  const modes: boolean[] = [], statements: string[] = [], completed: number[] = [];
  const checks: any[] = [], visited: number[] = [];
  const state = { store: { reader: { job_id: id, sealed_chunks: 17 }, profile: { hash },
    recipe: { id, revision: 1 }, mapping: { job_id: id } } };
  const slots = Array.from({ length: 17 }, (_, chunk_index) => ({ chunk_index, result_sha256: hash,
    object_key: `${id}/${chunk_index}`, object_sha256: hash, bytes: 1, published: true }));
  const client = { query: async (sql: string, values: any[] = []) => {
    statements.push(sql);
    if (sql.startsWith('SELECT body')) return { rows: [{ body: { plan, planHash: hash } }] };
    if (sql.startsWith('SELECT id FROM cases')) return { rows: [{ id }] };
    if (sql.includes('FROM usp_streaming_vector_slots')) {
      assert.match(sql, /chunk_index>=\$3 AND chunk_index<\$4/);
      assert.match(sql, /ORDER BY chunk_index FOR SHARE/);
      let rows = slots.slice(values[2], values[3]).filter(slot => slot.published).map(slot => ({ ...slot }));
      if (change === 'gap') rows = rows.slice(1);
      if (change === 'order') rows.reverse();
      return { rows };
    }
    assert.match(sql, /^UPDATE sources SET inspection=/);
    checks.push(JSON.parse(values[1]));
    return { rows: [] };
  } };
  const fence = async () => {
    statements.push('ATTEMPT_FENCE');
    fences++;
    if (expired) conflict('test_only expired lease');
  };
  const deps = { fingerprint, conflict, partStageTimer, checkIntakeLargeChunk: (check: any, raw: any[], i: number) => {
    visited.push(i);
    checkIntakeLargeChunk(check, raw, i);
  }, StreamedMappingReceiptSchema: { parse: (value: unknown) => value },
  loadSealedStreamedProfileTx: async () => ({ profile }), loadPrefixSealTx: async () => profile,
  prefixSealCheckKey,
  transaction: async (work: any) => {
    assert.equal(locked, false);
    locked = true;
    try { return await work(client); }
    finally { locked = false; }
  }, assertIntakeDraftTx: async (_client: unknown, _input: unknown, lockCase: boolean) => {
    modes.push(lockCase);
    statements.push(lockCase ? 'CASE_UPDATE' : 'CASE_KEY_SHARE');
  },
  assertUspJobAttemptTx: fence, largeStateKey: async () => state,
  heartbeat: () => async () => { beats++; },
  readPinnedRawChunk: async (_input: unknown, slot: any) => {
    assert.equal(locked, false);
    active++;
    maximum = Math.max(maximum, active);
    reads++;
    try {
      // Deliberately finish later source chunks first; key decisions must still follow source order.
      await new Promise(resolve => setTimeout(resolve, 8 - slot.chunk_index % 8));
      completed.push(slot.chunk_index);
      if (change === 'storage' && slot.chunk_index === 0) throw new Error('test_only GET failure');
      if (change === 'lease') expired = true;
      if (change === 'mapping') state.store.mapping.job_id = 'test_only_changed';
      if (change === 'reader') state.store.reader.job_id = 'test_only_changed';
      if (change === 'profile') state.store.profile.hash = 'b'.repeat(64);
      if (change === 'recipe') state.store.recipe.revision++;
      if (change === 'lateSlot' && slot.chunk_index === 8) slots[0].result_sha256 = 'b'.repeat(64);
      for (const field of ['result_sha256', 'object_key', 'object_sha256', 'bytes', 'published']) {
        if (change !== field || slot.chunk_index !== 0) continue;
        let value: string | number | boolean = 'changed';
        if (field === 'bytes') value = 2;
        if (field === 'published') value = false;
        Object.assign(slots[0], { [field]: value });
      }
      // Test-only duplicate injection: unchanged real source key/geometry, a later protocol position.
      const record = slot.chunk_index === 16 ? { ...records[0], featureIndex: 16 } : records[slot.chunk_index];
      return { payload: change === 'payload' ? null : { records: [record] } };
    } finally { active--; }
  } };
  const js = ts.transpileModule(body('pinned') + body('comparePrefix'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const run = new Function(...Object.keys(deps), `${js}; return comparePrefix;`)(...Object.values(deps));
  return { run: () => run({ sourceId: id, sourceRevision: 1 }, {}), checks, statements, modes, visited, completed,
    stats: () => ({ active, maximum, reads, beats, fences }) };
}

test('concurrent check keeps source order, seal shape and last-chunk duplicate exclusion', async () => {
  const f = fixture();
  await f.run();
  assert.deepEqual(f.visited, Array.from({ length: 17 }, (_, index) => index));
  assert.notDeepEqual(f.completed, f.visited);
  assert.deepEqual(f.checks, [{ key: prefixSealCheckKey(hash, hash, id), mappingJobId: id,
    changed: false, conflicts: [0, 16] }]);
  for (const featureIndex of [0, 16]) assert.throws(() => assertPartPrefixSealCheck({ layoutHash: hash,
    features: [{ featureIndex }] } as ProvedAreaPartInput, id, f.checks[0], hash, hash), /Both occurrences/);
  assert.deepEqual(f.stats(), { active: 0, maximum: 8, reads: 17, beats: 20, fences: 11 });
  assert.deepEqual(f.modes, [false, false, false, false, false, false, false, true]);
  assert.deepEqual(f.statements.slice(0, 3), ['CASE_KEY_SHARE',
    'SELECT id FROM cases WHERE id=$1 FOR SHARE', 'ATTEMPT_FENCE'], 'profile case SHARE precedes the job fence');
  assert.equal(f.statements.filter(sql => sql.includes('FROM usp_streaming_vector_slots')).length, 7,
    'one slot statement per pre/post group, plus the final full-inventory recheck');
});

for (const change of ['result_sha256', 'object_key', 'object_sha256', 'bytes', 'published', 'lateSlot',
  'reader', 'profile', 'recipe', 'mapping', 'lease', 'storage', 'payload', 'gap', 'order']) {
  test(`concurrent comparison refuses ${change} without seal publication or leftover reads`, async () => {
    const f = fixture(change);
    await assert.rejects(f.run());
    assert.deepEqual(f.checks, []);
    assert.equal(f.stats().active, 0, 'a failing read must drain the rest of its bounded group before returning');
    assert(f.stats().maximum <= 8);
    assert(f.stats().beats >= f.stats().reads, 'each completed or failed GET still pulses its heartbeat');
  });
}
