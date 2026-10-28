import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import type { PoolClient } from 'pg';
import { StreamedPrefixMappingPlanSchema, StreamedProfileLocatorSchema, STREAMING_VECTOR_LIMITS as limits,
  type StreamedProfileGeneration, type StreamingVectorRecord } from '@ulpin/contracts/usp';
import { intakeLargeFailureReason, intakeLargeHoldsReason, intakeLargeNumbers, intakeLargePhase,
  intakeLargePartRefusal, INTAKE_LARGE_LAYOUT_QUESTION, intakeLargeProjection, intakeLargeEnd, writeIntakeLargeReadTx,
  intakeLargeAtRest,
  type IntakeLargeRows, type IntakeLargeStore
} from './intake-large';
import { intakeItem, writeIntakeLargeTx, type IntakeLargeState } from './intake-ledger';
import { queueIntakeDraftTx } from './intake-draft';
import type { IntakeSourceRow } from './intake-context';
import type { IntakeCard } from '@ulpin/contracts/usp';
import { claimUspJobAttempt } from '../jobs';
import { AppError } from '../../../infrastructure/errors';
import { Readable } from 'node:stream';
import { readStreamingFeatures, sourceRecord } from './streaming-vector-reader';
import { advanceStreamedInventory, emptyInventory } from './streamed-profile-inventory';
import { normalizeMappedChunk } from './chunk-mapping-normalizer';
import { prefixLayoutMatchesSealed } from './streamed-mapping';
import { pairMappedFeatures } from './intake-package-cuts';
import { StreamingPartWriter } from './streaming-vector-worker';

const caseId = '10000000-0000-4000-8000-000000000001';
const itemId = '10000000-0000-4000-8000-000000000002';
process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'intake-large-protocol';

function rows(): IntakeLargeRows {
  return { reader: null, profile: null, mapping: null, receiptVerified: false,
    recipeState: null, publishedPackages: 0, foldComplete: false };
}
function sealedRows(): IntakeLargeRows {
  return { ...rows(), reader: { state: 'completed', issue_code: null, records: 4500,
    next_publish_index: 45, sealed_chunks: 45, unknown_remainder: false },
  profile: { state: 'sealed', sealed_generation: 45, issue_code: null }, receiptVerified: true };
}

test('five GeoJSON chunks ask on the first prefix, map while open, and draft only after a matching seal', async () => {
  const hash = 'a'.repeat(64), state = rows();
  // test_only collection, not operational records or identifiers.
  const features = [1, 2, 3, 4, 5].map(id => ({ type: 'Feature', id, properties: {},
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] } }));
  const read: StreamingVectorRecord[] = [];
  let inventory = emptyInventory(), prefix: StreamedProfileGeneration | undefined;
  let plan: ReturnType<typeof StreamedPrefixMappingPlanSchema.parse> | undefined, questions = 0;
  state.reader = { state: 'running', issue_code: null, next_publish_index: 0, records: 0,
    sealed_chunks: null, unknown_remainder: true };
  const store: IntakeLargeStore = { reader: null, profile: null, recipe: null, mapping: null, parts: 0, unreviewed: 0 };
  const makeProfile = (sealed: boolean): StreamedProfileGeneration => ({ ...inventory,
    version: 'streamed-profile/1', jobId: itemId, rawJobId: itemId,
    source: { sourceId: itemId, familyId: itemId, sourceRevision: 1, sourceSha256: hash, schemaFingerprint: hash },
    generation: sealed ? 5 : 0, generationHash: hash, previousHash: null, readerSha256: hash, profilerSha256: hash,
    coverage: sealed ? 'sealed' : 'provisional', unknownRemainder: !sealed,
    rawChunkIndex: sealed ? null : 0, rawResultSha256: sealed ? null : hash, quarantineLocators: [],
    reference: { sourceCrs: null, evidence: null, globalPlacement: 'not_qualified' } });
  const parts = new StreamingPartWriter(
    async (index, records) => {
      const record = records[0];
      read.push(record);
      inventory = advanceStreamedInventory(inventory, [record]).inventory;
      state.reader!.next_publish_index++;
      state.reader!.records++;
      if (!prefix) {
        prefix = makeProfile(false);
        state.profile = { state: 'running', issue_code: null, sealed_generation: null, layout_profile: {
          generation: 0, generationHash: hash, coverage: 'provisional', recordsSeen: 1, accepted: 1 } };
        store.profile = { ...state.profile, job_id: itemId };
        assert.equal(intakeLargePhase(state), 'question');
        questions++;
        const projection = intakeLargeProjection('question', state, store, { bytes: 1, crsWords: null });
        const listed = intakeItem({ item_id: itemId, source_id: itemId, case_id: caseId, parent_item_id: null,
          member_path: null, name: 'test_only.geojson', family: 'vector', format: 'geojson', size_bytes: null,
          size_class: null, wave: 1, state: projection.state, placement: projection.placement, card: null,
          card_sha256: null, probe_version: null, plan_ref: projection.planRef, streamed_profile_job_id: itemId,
          parts_planned: null, parts_done: 1, records_seen: 1, limit_reason: projection.limitReason,
          pinned_by_officer: false, created_at: new Date(0), updated_at: new Date(0) });
        assert.equal(listed.placement, 'needs_answer');
        assert.equal(listed.layoutQuestion, true);
        assert.deepEqual(listed.layoutProfile, state.profile.layout_profile);
        plan = StreamedPrefixMappingPlanSchema.parse({ version: 'streamed-prefix-mapping/1',
          scope: 'observed_prefix_and_later_compatible_features', mode: 'streamed_mapping', source: prefix.source,
          caseId, caseRevision: 0, rawJobId: itemId, profileJobId: itemId, profileGeneration: 0, profileHash: hash,
          prefix: { throughRawChunkIndex: 0, rawResultSha256: hash, recordsSeen: 1, accepted: 1 },
          kind: 'parcel', basis: 'officer_stated', semanticEvidence: [], operations: [
            { target: 'feature.sourceKey', sourcePath: '/features/*/id', conversionId: 'literal_integer_identifier@1' },
            { target: 'feature.geometry', sourcePath: '/features/*/geometry', conversionId: 'geojson_geometry@1' }] });
        state.recipeState = 'approved';
        state.prefixRecipe = true;
      }
      assert.equal(intakeLargePhase(state), 'map', 'not drafting while the reader remains open');
      assert.equal(normalizeMappedChunk([record], plan!, prefix, itemId, index, []).records[0].disposition,
        'observed');
      assert.equal(store.parts, 0);
    });
  await readStreamingFeatures(Readable.from([JSON.stringify({ type: 'FeatureCollection', features })]),
    'feature-collection', item => parts.add(sourceRecord(item), 1));
  assert.equal(parts.index, 5);
  Object.assign(state.reader, { state: 'completed', sealed_chunks: 5, unknown_remainder: false });
  Object.assign(state.profile!, { state: 'sealed', sealed_generation: 5 });
  state.receiptVerified = true;
  state.mapping = { ...state.reader! };
  assert.equal(intakeLargePhase(state), 'compare');
  assert(prefixLayoutMatchesSealed(plan!, prefix!, makeProfile(true)));
  state.prefixCheck = 'matched';
  assert.equal(intakeLargePhase(state), 'draft');
  assert.equal(questions, 1, 'matching paths do not ask a second question');
  const repeated = read.map((record, index) => index === 4 ? { ...record,
    feature: { ...record.feature!, id: 1 } } : record);
  const reservations: { source_key_sha256: string; source_key: string; first_feature_index: number }[] = [];
  const mapped = repeated.map((record, index) => {
    const chunk = normalizeMappedChunk([record], plan!, prefix!, itemId, index, reservations);
    reservations.push(...chunk.keys.filter(key => key.laterIndex === null).map(key => ({
      source_key_sha256: key.hash, source_key: key.value, first_feature_index: key.firstIndex })));
    return chunk;
  });
  const conflicts = new Set(mapped.flatMap(chunk => chunk.keys).filter(key => key.laterIndex !== null)
    .flatMap(key => [key.firstIndex, key.laterIndex!]));
  assert.deepEqual([...conflicts], [0, 4]);
  assert.deepEqual(pairMappedFeatures(repeated, mapped.flatMap(chunk => chunk.records),
    { after: -1, conflicts, kind: 'parcel' })
    .map(item => item.raw.featureIndex), [1, 2, 3], 'both occurrences stay out before any part is cut');
  for (const change of [{ types: ['string'] as const }, { absent: 1, values: 4 }]) {
    const sealed = makeProfile(true);
    sealed.paths = sealed.paths.map(path => path.path.endsWith('/id') ? { ...path, ...change,
      types: change.types ? [...change.types] : path.types } : path);
    assert.equal(prefixLayoutMatchesSealed(plan!, prefix!, sealed), false);
    state.prefixCheck = 'changed';
    assert.equal(intakeLargePhase(state), 'question');
    store.profile = { ...state.profile!, job_id: itemId, layout_profile: {
      generation: 5, generationHash: hash, coverage: 'sealed', recordsSeen: 5, accepted: 5 } };
    const again = intakeLargeProjection('question', state, store, { bytes: 1, crsWords: null });
    assert.equal(again.placement, 'needs_answer');
    assert.match(again.limitReason!, /Nothing was drafted.*complete file/);
    assert.equal((again.planRef!.layoutProfile as { coverage: string }).coverage, 'sealed');
  }
});

const sequenceOriginal = readFileSync('fixtures/google-uttam/00-all-google-detections.geojson');
const sequenceFeatures = JSON.parse(sequenceOriginal.toString()).features;

for (const framing of ['geojson-lines', 'geojson-seq-rs', 'feature-collection'] as const) {
  test(`${framing} end words name only retained sequence positions; collection words stay unchanged`, async () => {
    // test_only: real public outlines with a bare geometry and deliberately broken JSON, not registry records.
    const values = [sequenceFeatures[0], sequenceFeatures[0].geometry, sequenceFeatures[1],
      sequenceFeatures[2], sequenceFeatures[3]];
    const text = framing === 'feature-collection' ? JSON.stringify({ type: 'FeatureCollection', features: values })
      : values.map((value, index) => `${framing === 'geojson-seq-rs' ? '\x1e' : ''}`
        + `${index === 3 ? '{broken' : JSON.stringify(value)}\n`).join('');
    const records: StreamingVectorRecord[] = [];
    await readStreamingFeatures(Readable.from([text]), framing, async item => { records.push(sourceRecord(item)); });
    const { inventory, quarantineLocators } = advanceStreamedInventory(emptyInventory(), records);
    const retained = quarantineLocators.map(locator => StreamedProfileLocatorSchema.parse(
      JSON.parse(JSON.stringify(locator))));
    const positions = retained.flatMap(locator => locator.sequencePosition ? [locator.sequencePosition] : []);
    const collection = framing === 'feature-collection';
    assert.equal(inventory.quarantined, collection ? 1 : 2);
    assert.deepEqual(positions, collection ? [] : [2, 4].map(number => ({
      kind: framing === 'geojson-lines' ? 'line' : 'record', number })));
    if (collection) assert.equal(Object.hasOwn(retained[0], 'sequencePosition'), false);
    const end = intakeLargeEnd({ recordsRead: inventory.recordsSeen, accepted: inventory.accepted,
      packages: 1, readerRejected: inventory.quarantined, readerRejectedPositions: positions,
      duplicates: 0, oversized: 0 }, null);
    const words = collection ? '1 not accepted by the reader.'
      : `2 not accepted by the reader (${framing === 'geojson-lines' ? 'lines' : 'records'} 2 and 4).`;
    assert.equal(end.limitReason, `5 records read; ${inventory.accepted} in 1 packages. ${words}`);
    assert.deepEqual(readFileSync('fixtures/google-uttam/00-all-google-detections.geojson'), sequenceOriginal);
  });
}

test('seven bad NDJSON lines name only the first five retained positions in read order', async () => {
  const records: StreamingVectorRecord[] = [];
  await readStreamingFeatures(Readable.from([Array(7).fill('{broken\n').join('')]), 'geojson-lines',
    async item => { records.push(sourceRecord(item)); });
  const { inventory, quarantineLocators } = advanceStreamedInventory(emptyInventory(), records);
  const positions = quarantineLocators.flatMap(locator => locator.sequencePosition ? [locator.sequencePosition] : [])
    .slice(0, 5);
  assert.equal(positions.length, 5);
  assert.equal(intakeLargeHoldsReason({ recordsRead: inventory.recordsSeen, accepted: 0, packages: 0,
    readerRejected: inventory.quarantined, readerRejectedPositions: positions, duplicates: 0, oversized: 0 }),
  '7 records read; 0 in 0 packages. 7 not accepted by the reader (first at lines 1, 2, 3, 4 and 5).');
  for (const position of [{ kind: 'line', number: 0 }, { kind: 'record', number: 1.5 },
    { kind: 'feature', number: 1 }]) {
    assert.equal(StreamedProfileLocatorSchema.safeParse({ ...quarantineLocators[0],
      sequencePosition: position }).success, false);
  }
});

test('a reader that seals before an answer asks only over the sealed generation, even after a prefix proposal', () => {
  const state = sealedRows();
  state.profile!.layout_profile = { generation: 45, generationHash: 'a'.repeat(64), coverage: 'sealed',
    recordsSeen: 4500, accepted: 4500 };
  for (const recipeState of [null, 'proposed']) {
    Object.assign(state, { recipeState, prefixRecipe: recipeState !== null });
    assert.equal(intakeLargePhase(state), 'question');
    const store: IntakeLargeStore = { reader: null, profile: { ...state.profile!, job_id: itemId },
      recipe: null, mapping: null, parts: 0, unreviewed: 0 };
    const question = intakeLargeProjection('question', state, store, { bytes: 1, crsWords: null });
    assert.deepEqual(question.planRef, { layoutProfile: state.profile!.layout_profile });
  }
});

test('the existing job authority refuses completed-job wake-up and a fourth lifetime claim', async () => {
  const globals = globalThis as typeof globalThis & { ulpinPool?: unknown };
  const previous = globals.ulpinPool;
  let writes = 0;
  try {
    for (const state of ['succeeded', 'queued']) {
      const connection = { release: () => {}, query: async (sql: string) => {
        if (sql.startsWith('SELECT * FROM jobs')) return { rows: [{ id: itemId, status: 'queued' }] };
        if (sql.startsWith('SELECT * FROM usp_job_metadata')) return { rows: [{ logical_state: state }] };
        if (sql.startsWith('SELECT * FROM usp_job_attempts')) return { rows: [{ number: 3, fence: 3,
          state: 'accepted', lease_until: new Date(0) }] };
        if (!['BEGIN', 'ROLLBACK'].includes(sql)) writes++;
        return { rows: [] };
      } };
      globals.ulpinPool = { connect: async () => connection };
      await assert.rejects(() => claimUspJobAttempt(itemId, 'intake-large-protocol'), (error: unknown) => {
        assert(error instanceof AppError);
        if (state === 'succeeded') assert.equal(error.status, 409);
        else assert.equal(error.code, 'USP_JOB_ATTEMPTS');
        return true;
      });
    }
    assert.equal(writes, 0);
  } finally {
    if (previous === undefined) delete globals.ulpinPool;
    else globals.ulpinPool = previous;
  }
});

test('stored rows classify start, read, question, proposed layout, map, draft and end', () => {
  const state = rows();
  assert.equal(intakeLargePhase(state), 'start');
  state.reader = { state: 'running', issue_code: null, records: 100,
    next_publish_index: 1, sealed_chunks: null, unknown_remainder: true };
  assert.equal(intakeLargePhase(state), 'read');
  Object.assign(state, sealedRows());
  assert.equal(intakeLargePhase(state), 'question');
  assert.equal(INTAKE_LARGE_LAYOUT_QUESTION, 'No approved layout matches this file. '
    + 'An officer states what each feature is and which field identifies it.');
  state.recipeState = 'proposed';
  assert.equal(intakeLargePhase(state), 'layout');
  state.recipeState = 'approved';
  assert.equal(intakeLargePhase(state), 'map');
  state.mapping = { ...state.reader! };
  assert.equal(intakeLargePhase(state), 'draft');
  state.foldComplete = true;
  assert.equal(intakeLargePhase(state), 'end');
  assert.equal(intakeLargePhase(JSON.parse(JSON.stringify(state))), 'end');
});

test('no receipt, open profile or incomplete mapping never grants drafting', () => {
  const state = sealedRows();
  state.recipeState = 'approved';
  state.mapping = { ...state.reader! };
  state.receiptVerified = false;
  assert.equal(intakeLargePhase(state), 'read');
  state.receiptVerified = true;
  state.reader!.next_publish_index = 44;
  assert.equal(intakeLargePhase(state), 'read');
  state.reader!.next_publish_index = 45;
  state.profile!.sealed_generation = 44;
  assert.equal(intakeLargePhase(state), 'read');
  state.profile!.sealed_generation = 45;
  state.profile!.state = 'running';
  assert.equal(intakeLargePhase(state), 'read');
  state.profile!.state = 'sealed';
  for (const change of [{ unknown_remainder: true }, { sealed_chunks: null },
    { next_publish_index: 44 }, { records: 4499 }]) {
    state.mapping = { ...state.reader!, ...change };
    assert.equal(intakeLargePhase(state), 'map');
  }
});

test('a terminal reader, profile or mapping is a refusal even beside completed rows', () => {
  for (const name of ['reader', 'profile', 'mapping'] as const) {
    const state = sealedRows();
    state.recipeState = 'approved';
    state.mapping = { ...state.reader! };
    state[name]!.state = 'failed';
    assert.equal(intakeLargePhase(state), 'failure');
    state[name]!.state = 'stale';
    assert.equal(intakeLargePhase(state), 'failure');
  }
});

test('only compare and draft project preparing, with published packages rather than raw parts', () => {
  const state = { ...sealedRows(), publishedPackages: 2 };
  state.mapping = { ...state.reader! };
  const store: IntakeLargeStore = { reader: null, profile: null, recipe: null, mapping: null,
    parts: 2, unreviewed: 0 };
  for (const phase of ['start', 'read', 'map', 'compare', 'draft'] as const) {
    const projected = intakeLargeProjection(phase, state, store, { bytes: 1, crsWords: null });
    const preparing = phase === 'compare' || phase === 'draft';
    assert.equal(projected.state, preparing ? 'preparing' : 'reading');
    assert.equal(projected.partsDone, preparing ? 2 : 45);
    assert.equal(projected.recordsSeen, 4500);
  }
});

test('phase counters mean raw parts, mapped parts and finally package cuts, not attempts', () => {
  const state = sealedRows();
  assert.deepEqual(intakeLargeNumbers('read', state), { partsPlanned: null, partsDone: 45, recordsSeen: 4500 });
  state.mapping = { ...state.reader!, state: 'running', next_publish_index: 12 };
  assert.deepEqual(intakeLargeNumbers('map', state), { partsPlanned: 45, partsDone: 12, recordsSeen: 4500 });
  assert.deepEqual(intakeLargeNumbers('failure', state), { partsPlanned: 45, partsDone: 12, recordsSeen: 4500 });
  state.publishedPackages = 2;
  assert.deepEqual(intakeLargeNumbers('draft', state), { partsPlanned: null, partsDone: 2, recordsSeen: 4500 });
  state.publishedPackages = 3;
  assert.deepEqual(intakeLargeNumbers('end', state), { partsPlanned: 3, partsDone: 3, recordsSeen: 4500 });
});

test('CRS, size and feature ceiling refusals use literal metadata and the existing limits', () => {
  const words = 'The file\'s crs member declares {"type":"name","properties":{"name":"EPSG:99999"}}; its name is not a '
    + 'recognized coordinate reference system.';
  assert.equal(intakeLargeFailureReason('STREAMING_SOURCE_CRS', 1, words), 'The file\'s crs member declares '
    + '{"type":"name","properties":{"name":"EPSG:99999"}}; its name is not a recognized coordinate reference system; '
    + 'nothing was prepared from it.');
  assert.equal(intakeLargeFailureReason('STREAMING_SOURCE_CRS', 1),
    'The coordinate system this file declares could not be resolved; nothing was prepared from it.');
  assert.equal(intakeLargeFailureReason('STREAMING_SOURCE_BUDGET', limits.sourceBytes + 1024 ** 2),
    'This file is 1025 MiB. A map file is read in parts up to 1024 MiB for now; '
    + 'nothing was prepared from it.');
  assert.equal(intakeLargeFailureReason('STREAMING_INDEX', 1),
    'This file has more than 500000 features, '
    + 'the most a map file may have for now; nothing was prepared from it.');
});

test('a missing or different root type has its own refusal without changing existing framing words', () => {
  assert.equal(intakeLargeFailureReason('GEOJSON_COLLECTION_TYPE', 1),
    'This file is missing a root type of FeatureCollection or declares a different root type; '
    + 'nothing was prepared from it.');
  assert.equal(intakeLargeFailureReason('GEOJSON_CONTAINER', 1),
    'This file does not contain one complete GeoJSON feature collection in the required order; '
    + 'nothing was prepared from it.');
});

test('known terminal failures and an unenumerated infrastructure failure never expose codes or hashes', () => {
  const codes = ['GEOJSON_JSON', 'GEOJSON_CONTAINER', 'GEOJSON_SEQUENCE', 'GEOJSON_METADATA',
    'GEOJSON_METADATA_BUDGET', 'GEOJSON_NESTING_BUDGET', 'GEOJSON_UNIT_BUDGET', 'STREAMING_CHUNK_BUDGET',
    'STREAMING_EMPTY_SOURCE', 'STREAMING_REPLAY_MISMATCH', 'STREAMING_FEATURE_INDEX', 'STREAMING_SOURCE_INTEGRITY',
    'SOURCE_INTEGRITY', 'STREAMING_CHUNK_INTEGRITY', 'STORAGE_TIMEOUT', 'STREAMING_CONTEXT_STALE',
    'STREAMING_ATTEMPTS_EXHAUSTED', 'STREAMING_WORKER_ERROR', 'AREA_PROCESSOR_OPERATION', 'STREAMED_PROFILE_BODY_BUDGET',
    'STREAMED_PROFILE_PATH_BUDGET', 'STREAMED_PROFILE_GEOMETRY_BUDGET', 'STREAMED_PROFILE_QUARANTINE_BUDGET',
    'STREAMED_PROFILE_COUNTS', 'STREAMED_PROFILE_INTEGRITY', 'STREAMED_PROFILE_CONTEXT_STALE',
    'STREAMED_PROFILE_ATTEMPTS', 'STREAMED_PROFILE_SOURCE_WAIT', 'STREAMED_PROFILE_WORKER_ERROR', 'RAW_STREAM_FAILED',
    'MAPPING_CHUNK_BUDGET', 'MAPPING_CONTEXT_STALE', 'MAPPING_ATTEMPTS_EXHAUSTED', 'MAPPING_SOURCE_WAIT',
    'MAPPING_WORKER_ERROR', 'STREAMED_MAPPING_GEOMETRY', 'STREAMED_MAPPING_PATH', 'STREAMED_MAPPING_FIELD',
    'STREAMED_MAPPING_OPERATION', 'STREAMED_MAPPING_COVERAGE', 'STREAMED_MAPPING_PROVENANCE',
    'STREAMED_MAPPING_SEMANTICS', 'DB_UNKNOWN_FAILURE', '__proto__', 'toString'];
  for (const code of codes) {
    const sentence = intakeLargeFailureReason(code, 1);
    assert(!sentence.includes(code));
    assert.doesNotMatch(sentence, /[A-Z]+_[A-Z_]+|[a-f0-9]{64}|job|worker/);
    assert(sentence.endsWith('; nothing was prepared from it.'));
  }
});

test('an identifier written with a decimal point rests the row at its part in plain words', () => {
  const sentence = intakeLargePartRefusal(new AppError(422, 'PART_INTEGER_IDENTIFIER', 'Not read.'));
  assert.equal(sentence, 'The identifier field holds a value written with a decimal point. '
    + 'This file must write whole-number identifiers as digits only; nothing more was prepared from it.');
  assert.doesNotMatch(sentence!, /[A-Z]+_[A-Z_]+|job|worker/);
  for (const code of ['PART_CUT_BOUND', 'STALE_REVISION', '__proto__', 'toString'])
    assert.equal(intakeLargePartRefusal(new AppError(409, code, 'Changed.')), null);
});

test('the map service refusing a part for what the file holds rests the row at once in its words', () => {
  const words = 'Feature 7 has a position of 4 numbers; a position takes two coordinates and may add a height, '
    + 'and a fourth (M) value is unsupported and will not be dropped.';
  const sentence = intakeLargePartRefusal(new AppError(422, 'AREA_PROCESSING', words));
  assert.equal(sentence, `A part of this file could not be read as a map: ${words.slice(0, -1)}; `
    + 'nothing more was prepared from it.');
  assert.doesNotMatch(sentence!, /[A-Z]+_[A-Z_]+|job|worker/);
  assert.equal(intakeLargePartRefusal(new AppError(422, 'GIS_ALL_GEOMETRIES_REJECTED', 'No geometries.')),
    'No feature in a part of this file has an outline that can be read; nothing more was prepared from it.');
});

test('a processor without the drafting operation rests the row at once in the stored update words', () => {
  const missing = new AppError(503, 'AREA_PROCESSOR_OPERATION',
    'The area processor in use does not offer the build-prisms operation.');
  const sentence = intakeLargePartRefusal(missing);
  assert.equal(sentence, 'The map processor in use cannot do a step this file needs. It must be updated '
    + 'before this file can be read; nothing more was prepared from it.');
  assert.doesNotMatch(sentence!, /[A-Z]+_[A-Z_]+|build-prisms|job|worker/);
});

test('a fault of the map service is retried: an unavailable service, a timeout or an unknown error', () => {
  const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  for (const error of [new AppError(503, 'AREA_PROCESSING', 'The area processor could not complete this operation.'),
    timeout, new TypeError('fetch failed'), new AppError(413, 'AREA_RESULT_LIMIT', 'Too large.'), 'text'])
    assert.equal(intakeLargePartRefusal(error), null);
});

test('a counted line tail ends read_to_limit on the map with the same words in the stored item', async () => {
  const lines = sequenceFeatures.slice(0, 11).map((feature: unknown) => JSON.stringify(feature));
  lines.splice(2, 0, '');
  const closed = await readStreamingFeatures(Readable.from([lines.join('\n') + '\n']), 'geojson-lines',
    async () => {}, 5);
  const state = sealedRows();
  Object.assign(state.reader!, { records: closed.features, lines_beyond_limit: closed.linesBeyondLimit,
    sealed_chunks: 1, next_publish_index: 1 });
  Object.assign(state.profile!, { sealed_generation: 1 });
  state.recipeState = 'approved';
  state.mapping = { ...state.reader! };
  assert.equal(intakeLargePhase(state), 'draft', 'the parsed prefix can reach package drafting');
  const end = intakeLargeEnd({ recordsRead: state.reader!.records,
    linesBeyondLimit: state.reader!.lines_beyond_limit, accepted: 5, packages: 1,
    readerRejected: 0, duplicates: 0, oversized: 0 }, null);
  assert.equal(end.state, 'read_to_limit');
  assert.equal(end.placement, 'on_map');
  assert.equal(end.limitReason, '5 of 11 features read; the rest is kept, not read.');
  assert(intakeLargeAtRest(end));
  const store = ledger({ ...end, state: 'preparing', limitReason: null });
  await writeIntakeLargeTx(store.client, caseId, itemId, end);
  assert.deepEqual(store.state(), end);
  const none = intakeLargeEnd({ recordsRead: 5, linesBeyondLimit: 6, accepted: 0, packages: 0,
    readerRejected: 5, duplicates: 0, oversized: 0 }, null);
  assert.equal(none.state, 'read_to_limit');
  assert.equal(none.placement, 'not_understood');
  assert.match(none.limitReason!, /^5 of 11 features read; the rest is kept, not read\./);
  assert.match(none.limitReason!, /5 not accepted by the reader\./);
});

test('hold summaries use only nonzero clauses and no illustrative count', () => {
  const counts = { recordsRead: 10, accepted: 10, packages: 1, readerRejected: 0, duplicates: 0, oversized: 0 };
  assert.equal(intakeLargeHoldsReason(counts), null);
  assert.equal(intakeLargeHoldsReason({ ...counts, accepted: 9, readerRejected: 1 }),
    '10 records read; 9 in 1 packages. 1 not accepted by the reader.');
  assert.equal(intakeLargeHoldsReason({ ...counts, accepted: 8, duplicates: 2 }),
    '10 records read; 8 in 1 packages. 2 share an identifier with another record and are held.');
  assert.equal(intakeLargeHoldsReason({ ...counts, accepted: 9, oversized: 1 }),
    '10 records read; 9 in 1 packages. 1 are larger than a package can hold and are held.');
  assert.equal(intakeLargeHoldsReason({ ...counts, accepted: 6, readerRejected: 1, duplicates: 2, oversized: 1 }),
    '10 records read; 6 in 1 packages. 1 not accepted by the reader. '
    + '2 share an identifier with another record and are held. 1 are larger than a package can hold and are held.');
});

test('features held for their extent are counted apart, each with its own reason', () => {
  const counts = { recordsRead: 10, accepted: 6, packages: 2, readerRejected: 0, duplicates: 0, oversized: 0 };
  assert.equal(intakeLargeHoldsReason({ ...counts, wide: 1, outside: 3 }),
    '10 records read; 6 in 2 packages. 1 are wider than one map area (50 km or 1 degree across) and are held. '
    + '3 lie outside the 50 km map area this batch places features in and are held.');
  // A position that could not be measured is its own hold, never told as wider than a map area.
  const unmeasured = intakeLargeHoldsReason({ ...counts, accepted: 8, unmeasured: 2 });
  assert.equal(unmeasured, '10 records read; 8 in 2 packages. 2 have a position that could not be measured and are '
    + 'held.');
  assert.doesNotMatch(unmeasured!, /wider than one map area/);
});

function ledger(initial: IntakeLargeState) {
  let row = { ...initial };
  let events = 0;
  const client = { query: async (sql: string, values: unknown[]) => {
    if (sql.startsWith('SELECT * FROM usp_intake_items')) return { rows: [{ item_id: itemId,
      source_id: itemId, case_id: caseId, parent_item_id: null, family: 'vector', state: row.state,
      plan_ref: row.planRef, card: { format: 'geojson' } }] };
    if (sql.startsWith('SELECT state,placement')) return { rows: [{ state: row.state, placement: row.placement,
      plan_ref: row.planRef, records_seen: row.recordsSeen, limit_reason: row.limitReason }] };
    if (sql.startsWith('SELECT parts_planned')) return { rows: [{ parts_planned: row.partsPlanned,
      parts_done: row.partsDone }] };
    if (sql.startsWith('UPDATE usp_intake_items SET parts_planned')) {
      row.partsPlanned = values[2] as number | null;
      row.partsDone = values[3] as number;
    } else if (sql.startsWith('UPDATE usp_intake_items SET state')) row = { ...row,
      state: values[2] as IntakeLargeState['state'], placement: values[3] as IntakeLargeState['placement'],
      planRef: values[4] as IntakeLargeState['planRef'], recordsSeen: values[5] as number,
      limitReason: values[6] as string | null };
    else if (sql.startsWith('SELECT item_id AS')) return { rows: [{ itemId, state: row.state,
      family: 'vector', format: 'geojson', sizeClass: 'M', wave: 1, pinnedByOfficer: false }] };
    else if (sql.startsWith('SELECT revision')) return { rows: [{ revision: 1 }] };
    else if (sql.startsWith('UPDATE usp_outbox_streams')) return { rows: [{ sequence: String(++events) }] };
    else if (!sql.startsWith('INSERT INTO usp_outbox')) throw new Error(sql);
    return { rows: [] };
  } } as unknown as PoolClient;
  return { client, state: () => row, events: () => events };
}

test('a retained large GeoJSON above the reader ceiling rests with its size in officer words', async () => {
  const initial: IntakeLargeState = { state: 'probed', placement: 'undecided', planRef: null,
    recordsSeen: 0, limitReason: null, partsDone: 0, partsPlanned: null };
  const fixture = ledger(initial);
  const source: IntakeSourceRow = { id: itemId, case_id: caseId, family_id: itemId, revision: 1,
    name: 'Protocol control', profile: 'large-original-v1', bytes: 1025 * 1024 ** 2,
    sha256: 'a'.repeat(64), object_key: 'protocol-control', status: 'needs_input', inspection: {} };
  const card = { family: 'vector', format: 'geojson' } as IntakeCard;
  assert.equal(await queueIntakeDraftTx(fixture.client, source, card), null);
  assert.equal(fixture.state().placement, 'not_understood');
  assert.equal(fixture.state().limitReason, intakeLargeFailureReason('STREAMING_SOURCE_BUDGET', Number(source.bytes)));
  assert.equal(fixture.events(), 1);
  assert.equal(await queueIntakeDraftTx(fixture.client, source, card), null);
  assert.equal(fixture.events(), 1);
});

test('counter and state publication emits one event; replay and counter-only changes stay bounded', async () => {
  const initial: IntakeLargeState = { state: 'reading', placement: 'undecided', planRef: null,
    recordsSeen: 0, limitReason: null, partsDone: 0, partsPlanned: null };
  const fixture = ledger(initial);
  const next = { ...initial, partsDone: 1, recordsSeen: 100 };
  await writeIntakeLargeTx(fixture.client, caseId, itemId, next);
  assert.deepEqual(fixture.state(), next);
  assert.equal(fixture.events(), 1);
  await writeIntakeLargeTx(fixture.client, caseId, itemId, next);
  assert.equal(fixture.events(), 1);
  await writeIntakeLargeTx(fixture.client, caseId, itemId, { ...next, partsPlanned: 45 });
  assert.equal(fixture.events(), 2);
  await writeIntakeLargeTx(fixture.client, caseId, itemId, { ...next, partsPlanned: 45,
    state: 'failed_part', placement: 'not_understood', limitReason: intakeLargeFailureReason('GEOJSON_JSON', 1) });
  assert.equal(fixture.events(), 3);
  assert.equal(fixture.state().placement, 'not_understood');
});

/** The stored rows a reading item's state key reads, over the ledger fixture's own row and events. */
function readingStore(initial: IntakeLargeState, reader: Record<string, unknown>) {
  const fixture = ledger(initial);
  const write = fixture.client.query as unknown as (sql: string, values: unknown[]) => Promise<unknown>;
  const client = { query: async (sql: string, values: unknown[]) => {
    const one = (row: unknown) => ({ rows: [row] });
    if (sql.startsWith('SELECT item_id,case_id')) return one({ item_id: itemId, case_id: caseId,
      state: fixture.state().state, placement: fixture.state().placement, card: { family: 'vector', format: 'geojson' },
      plan_ref: null });
    if (sql.startsWith('SELECT id,revision,bytes')) return one({ id: itemId, revision: 1, bytes: 26660992,
      profile: 'large-original-v1', sha256: 'a'.repeat(64), object_key: 'protocol', inspection: {} });
    if (sql.includes('FROM usp_streaming_vector_imports')) return one(reader);
    if (sql.includes('FROM usp_streamed_profile_imports')) return one({ job_id: itemId, state: 'running',
      issue_code: null, sealed_generation: null });
    if (sql.startsWith('SELECT id,revision,state,body')) return { rows: [] };
    if (sql.startsWith('SELECT COALESCE(max((result')) return one({ generation: 0 });
    if (sql.includes('count(*)')) return one({ n: 0 });
    return write(sql, values);
  } } as unknown as PoolClient;
  return { ...fixture, client };
}

test('a reader publishing parts shows its stored counts on the row; a stopped or failed reader writes nothing', async () => {
  const initial: IntakeLargeState = { state: 'reading', placement: 'undecided', planRef: null,
    recordsSeen: 300, limitReason: null, partsDone: 3, partsPlanned: null };
  const running = { job_id: itemId, state: 'running', issue_code: null, next_publish_index: 423, records: 42247,
    quarantined: 438, sealed_chunks: null, unknown_remainder: true };
  const reading = readingStore(initial, running);
  await writeIntakeLargeReadTx(reading.client, itemId);
  assert.deepEqual(reading.state(), { ...initial, recordsSeen: 42247, partsDone: 423 });
  assert.equal(reading.events(), 1);
  await writeIntakeLargeReadTx(reading.client, itemId);
  assert.equal(reading.events(), 1, 'unchanged counts publish nothing');
  const failed = readingStore(initial, { ...running, state: 'failed', issue_code: 'AREA_PROCESSOR_OPERATION' });
  await writeIntakeLargeReadTx(failed.client, itemId);
  assert.deepEqual(failed.state(), initial, 'the step writes the failure with its words');
  const rested = readingStore({ ...initial, state: 'failed_part', placement: 'not_understood' }, running);
  await writeIntakeLargeReadTx(rested.client, itemId);
  assert.equal(rested.events(), 0);
});
