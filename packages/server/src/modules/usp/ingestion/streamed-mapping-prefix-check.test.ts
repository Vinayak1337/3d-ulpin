import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { StreamedPrefixMappingPlanSchema, type StreamedProfileGeneration,
  type StreamingVectorRecord } from '@ulpin/contracts/usp';
import { normalizeMappedChunk } from './chunk-mapping-normalizer';
import { pairMappedFeatures } from './intake-package-cuts';
import { advanceStreamedInventory, emptyInventory } from './streamed-profile-inventory';
import { streamedGenerationHash } from './streamed-profile';
import { compileStreamedMapping, prefixLayoutMatchesSealed, prefixMappingFailure, prefixMappingUsedPathHeld,
  prefixSealCheckKey } from './streamed-mapping';
import { intakeLargeProjection, type IntakeLargeStore } from './intake-large';
import { readStreamingFeatures, sourceRecord } from './streaming-vector-reader';

const id = '10000000-0000-4000-8000-000000000001';
const hash = 'a'.repeat(64);
type Inventory = ReturnType<typeof emptyInventory>;

function profile(inventory: Inventory, sealed = false): StreamedProfileGeneration {
  const body: StreamedProfileGeneration = { ...inventory, version: 'streamed-profile/1', jobId: id, rawJobId: id,
    source: { sourceId: id, familyId: id, sourceRevision: 1, sourceSha256: hash, schemaFingerprint: hash },
    readerSha256: hash, profilerSha256: hash, generation: sealed ? 1725 : 0, generationHash: hash,
    previousHash: null, coverage: sealed ? 'sealed' : 'provisional', unknownRemainder: !sealed,
    rawChunkIndex: sealed ? null : 0, rawResultSha256: sealed ? null : hash, quarantineLocators: [],
    reference: { sourceCrs: 'EPSG:3857', evidence: 'test_only declared reference', unit: 'metre',
      globalPlacement: 'not_qualified' } };
  body.generationHash = streamedGenerationHash(body);
  body.source.schemaFingerprint = body.generationHash;
  return body;
}

function plan(prefix: StreamedProfileGeneration) {
  return StreamedPrefixMappingPlanSchema.parse({ version: 'streamed-prefix-mapping/1',
    scope: 'observed_prefix_and_later_compatible_features', mode: 'streamed_mapping', source: prefix.source,
    caseId: id, caseRevision: 1, rawJobId: id, profileJobId: id, profileGeneration: 0,
    profileHash: prefix.generationHash, kind: 'building', basis: 'officer_stated', semanticEvidence: [],
    prefix: { throughRawChunkIndex: 0, rawResultSha256: hash, recordsSeen: 100, accepted: 100 }, operations: [
      { target: 'feature.sourceKey', sourcePath: '/features/*/properties/OBJECTID',
        conversionId: 'literal_integer_identifier@1' },
      { target: 'feature.geometry', sourcePath: '/features/*/geometry', conversionId: 'geojson_geometry@1' }] });
}

function feature(index: number) {
  const polygon = [[[0, 0], [1, 0], [1, 1], [0, 0]]];
  // test_only generated collection: first 100 polygons, then 36 multipolygons and 11 raw quarantines.
  let geometry: { type: string; coordinates: unknown } | null = { type: 'Polygon', coordinates: polygon };
  if (index >= 100 && index < 136) geometry = { type: 'MultiPolygon', coordinates: [polygon] };
  if (index >= 136 && index < 147) geometry = null;
  return { type: 'Feature', properties: { OBJECTID: index + 1 }, geometry };
}

async function read(total: number, consume: (record: StreamingVectorRecord) => void) {
  function* collection() {
    yield '{"type":"FeatureCollection","features":[';
    for (let index = 0; index < total; index++) yield `${index ? ',' : ''}${JSON.stringify(feature(index))}`;
    yield ']}';
  }
  await readStreamingFeatures(Readable.from(collection()), 'feature-collection', async item => {
    consume(sourceRecord(item));
  });
}

test('run 4 shape: conversion-compatible MultiPolygons reach drafts; 11 quarantines do not change the layout',
  async () => {
    let inventory = emptyInventory(), prefix: StreamedProfileGeneration | undefined;
    const held: StreamingVectorRecord[] = [];
    await read(172409, record => {
      inventory = advanceStreamedInventory(inventory, [record]).inventory;
      if (inventory.recordsSeen === 100) prefix = profile(inventory);
      if (record.featureIndex >= 100 && record.featureIndex < 147) held.push(record);
    });
    const observed = prefix!, layout = plan(observed), sealed = profile(inventory, true);
    assert.deepEqual([sealed.recordsSeen, sealed.accepted, sealed.quarantined], [172409, 172398, 11]);
    assert.deepEqual(observed.geometryTypes, ['Polygon']);
    assert.deepEqual(sealed.geometryTypes, ['MultiPolygon', 'Polygon']);
    assert.equal(prefixLayoutMatchesSealed(layout, observed, sealed), true);
    assert(sealed.paths.every(path => path.unknown === 11), 'quarantine counts stay in the inventory');
    assert.doesNotThrow(() => compileStreamedMapping({ ...layout, version: 'streamed-mapping/1',
      scope: 'accepted_source_features', source: sealed.source, profileGeneration: sealed.generation,
      profileHash: sealed.generationHash }, sealed), 'the approved conversions still admit the accepted file');
    const mapped = normalizeMappedChunk(held, layout, observed, id, 1, []);
    assert.equal(prefixMappingUsedPathHeld(mapped.records), false, 'neither guard is a mapped identity failure');
    assert.equal(mapped.records.filter(record => record.disposition === 'quarantined').length, 11);
    assert.equal(mapped.records.filter(record => record.disposition === 'observed').length, 36);
    assert(mapped.records.every(record => !record.issueCodes.includes('SCHEMA_DRIFT_GEOMETRY')));
    const drafts = pairMappedFeatures(held, mapped.records, { after: -1, conflicts: new Set(), kind: 'building' });
    assert.equal(drafts.length, 36, 'all later compatible outlines reach the existing draft handoff');
    assert(drafts.every(record => record.raw.disposition === 'accepted'));
    for (const type of ['Point', 'LineString']) {
      const incompatible = structuredClone(held[0]);
      (incompatible.feature as { geometry: unknown }).geometry = { type,
        coordinates: type === 'Point' ? [0, 0] : [[0, 0], [1, 1]] };
      const changed = profile(advanceStreamedInventory(observed, [incompatible]).inventory, true);
      assert.equal(prefixLayoutMatchesSealed(layout, observed, changed), false, `${type} is not a building outline`);
      const refused = normalizeMappedChunk([incompatible], layout, observed, id, 1, []);
      assert.equal(refused.records[0].disposition, 'unresolved');
      assert(refused.records[0].issueCodes.includes('SCHEMA_DRIFT_GEOMETRY'));
      assert.deepEqual(prefixMappingFailure(refused.records, [incompatible]), {
        sourcePath: '/features/*/geometry', recordOrdinal: 101, geometryType: type });
      assert.throws(() => prefixMappingFailure(refused.records, [{ ...incompatible, rawSha256: 'b'.repeat(64) }]),
        { status: 409 }, 'failure words cannot use a different raw record');
    }
  });

test('an approved mixed prefix keeps set-aside points exactly as the base inventory-based normalizer', async () => {
  const records: StreamingVectorRecord[] = [];
  await read(100, record => records.push(record));
  (records[99].feature as { geometry: unknown }).geometry = { type: 'Point', coordinates: [0, 0] };
  const inventory = advanceStreamedInventory(emptyInventory(), records).inventory;
  const observed = profile(inventory), sealed = profile(inventory, true), layout = plan(observed);
  assert.equal(prefixLayoutMatchesSealed(layout, observed, sealed), true);
  const mapped = normalizeMappedChunk(records, layout, observed, id, 0, []);
  // Sealed layouts retain the base's inventory-based geometry check unchanged.
  const base = normalizeMappedChunk(records, { ...layout, version: 'streamed-mapping/1',
    scope: 'accepted_source_features', source: sealed.source, profileGeneration: sealed.generation,
    profileHash: sealed.generationHash }, sealed, id, 0, []);
  assert.deepEqual(mapped.records, base.records);
  assert.deepEqual(mapped.keys, base.keys);
  assert.deepEqual(mapped.records[99].issueCodes, ['GEOMETRY_KIND']);
  assert.equal(mapped.records[99].disposition, 'unresolved');
  assert.equal(prefixMappingFailure(mapped.records), undefined);
  assert.equal(pairMappedFeatures(records, mapped.records,
    { after: -1, conflicts: new Set(), kind: 'building' }).length, 99);
});

test('optional mapped name absences keep a matched seal; invalid text names its path and ordinal', async () => {
  const records: StreamingVectorRecord[] = [];
  await read(100, record => records.push(record));
  const inventory = advanceStreamedInventory(emptyInventory(), records).inventory;
  const observed = profile(inventory), layout = plan(observed);
  const mapped = normalizeMappedChunk(records, layout, observed, id, 0, []);
  const namePath = '/features/*/properties/NAME';
  // Exercise optional mapped-name observations independently of profile admission.
  mapped.records[0].name = { state: 'absent', value: null, sourcePath: namePath };
  mapped.records[1].name = { state: 'null', value: null, sourcePath: namePath };
  assert(mapped.records.every(record => record.disposition === 'observed'));
  assert.equal(prefixLayoutMatchesSealed(layout, observed, profile(inventory, true)), true);
  assert.equal(prefixMappingFailure(mapped.records), undefined);
  assert.equal(prefixMappingUsedPathHeld(mapped.records), false, 'ordinary optional-name blanks keep the seal matched');
  mapped.records[2].name = { state: 'unknown', value: null, sourcePath: namePath };
  mapped.records[2].disposition = 'unresolved';
  mapped.records[2].issueCodes = ['MAPPING_TEXT_INVALID'];
  assert.deepEqual(prefixMappingFailure(mapped.records), { sourcePath: namePath, recordOrdinal: 3 });
});

test('byte-zero replay preserves prefix generation hash; a different mapping job cannot reuse its seal key',
  async () => {
    const passes: StreamedProfileGeneration[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      let inventory = emptyInventory();
      await read(100, record => { inventory = advanceStreamedInventory(inventory, [record]).inventory; });
      passes.push(profile(inventory));
    }
    assert.equal(passes[0].generationHash, passes[1].generationHash);
    assert.equal(prefixSealCheckKey(hash, passes[0].generationHash, id),
      prefixSealCheckKey(hash, passes[1].generationHash, id));
    assert.notEqual(prefixSealCheckKey(hash, passes[0].generationHash, id),
      prefixSealCheckKey(hash, passes[0].generationHash, '10000000-0000-4000-8000-000000000002'));
  });

test('absent, null, fractional, text or unsafe OBJECTID still breaks the approved integer layout', async () => {
  const records: StreamingVectorRecord[] = [];
  await read(100, record => records.push(record));
  const observed = profile(advanceStreamedInventory(emptyInventory(), records).inventory), layout = plan(observed);
  for (const value of [undefined, null, 1.5, '101', Number.MAX_SAFE_INTEGER + 1]) {
    const later = structuredClone(records[0]);
    later.featureIndex = 100;
    const properties = (later.feature as { properties: Record<string, unknown> }).properties;
    if (value === undefined) delete properties.OBJECTID;
    else properties.OBJECTID = value;
    const sealed = profile(advanceStreamedInventory(observed, [later]).inventory, true);
    assert.equal(prefixLayoutMatchesSealed(layout, observed, sealed), false);
    assert(prefixMappingUsedPathHeld(normalizeMappedChunk([later], layout, observed, id, 1, []).records));
  }
});

for (const geometry of [false, true]) {
  test(`closure stores the first ${geometry ? 'geometry type' : 'field'} failure and names its record`, async () => {
    const records: StreamingVectorRecord[] = [];
    await read(100, record => records.push(record));
    const observed = profile(advanceStreamedInventory(emptyInventory(), records).inventory), layout = plan(observed);
    const later = [100, 101, 102].map(featureIndex => ({ ...structuredClone(records[0]), featureIndex }));
    Object.assign(later[0], { disposition: 'quarantined', feature: null, issueCode: 'MISSING_GEOMETRY' });
    for (const record of later.slice(1)) {
      const feature = record.feature as { geometry: unknown; properties: { OBJECTID: unknown } };
      if (geometry) feature.geometry = { type: 'Point', coordinates: [0, 0] };
      else feature.properties.OBJECTID = null;
    }
    const sealed = profile(advanceStreamedInventory(observed, later).inventory, true);
    const chunks = [later.slice(0, 1), later.slice(1)], reads: number[] = [], writes: string[] = [];
    const receipt = { id, revision: 2, state: 'approved', plan: layout, planHash: hash, authoredBy: 'test_only',
      authoredAt: '2026-10-25T00:00:00.000Z', approval: { subject: 'test_only', at: '2026-10-25T00:00:00.000Z',
        planHash: hash, provenance: 'server_configured_local_operator' } };
    const client = { query: async (sql: string, values: unknown[] = []) => {
      if (sql.startsWith('SELECT body')) return { rows: [{ body: receipt }] };
      if (sql.startsWith('SELECT * FROM usp_streaming_vector_slots'))
        return { rows: Array.from({ length: Number(values[3]) - Number(values[2]) }, (_, offset) => ({
          chunk_index: Number(values[2]) + offset, bytes: 1 })) };
      assert.match(sql, /^UPDATE sources SET inspection=/);
      writes.push(values[1] as string);
      return { rows: [] };
    } };
    const state = { key: hash, store: { reader: { job_id: id, sealed_chunks: chunks.length },
      mapping: { job_id: id }, recipe: { id } } };
    const response = (records: StreamingVectorRecord[]) => ({ current: true, sourceComplete: true,
      unknownRemainder: false, payload: { records } });
    const controls = { pinned: async (_input: unknown, _attempt: unknown,
      work: (client: unknown, state: unknown) => Promise<unknown>) => work(client, state),
    loadProvisionalStreamedProfileTx: async () => ({ profile: observed }), loadPrefixSealTx: async () => sealed,
    heartbeat: () => async () => {}, assertUspJobAttemptTx: async () => {},
    readPinnedRawChunk: async (_input: unknown, slot: { chunk_index: number }) => {
      reads.push(slot.chunk_index);
      return response(chunks[slot.chunk_index]);
    } };
    await compareInIsolation(controls);
    const check = JSON.parse(writes[0]);
    assert.deepEqual(reads, [0, 1], 'the raw check scans all identities but retains the first used-field failure');
    assert.equal(check.changed, true);
    assert.equal(check.key, prefixSealCheckKey(hash, sealed.generationHash, id));
    assert.deepEqual(check.failure, { sourcePath: geometry ? '/features/*/geometry'
      : '/features/*/properties/OBJECTID', recordOrdinal: 102, ...(geometry ? { geometryType: 'Point' } : {}) });
    const store: IntakeLargeStore = { reader: null, profile: null, mapping: null, recipe: null, parts: 0,
      unreviewed: 0, prefixFailure: check.failure };
    const words = intakeLargeProjection('question', { reader: null, profile: null, mapping: null,
      receiptVerified: false, recipeState: null, publishedPackages: 0, foldComplete: false, prefixCheck: 'changed' },
    store, { bytes: 1, crsWords: null }).limitReason;
    assert.match(words!, geometry ? /Geometry type Point at record 102/ : /OBJECTID at record 102/);
    writes.length = 0;
    controls.assertUspJobAttemptTx = async () => { throw new Error('test_only expired lease'); };
    await assert.rejects(compareInIsolation(controls), /test_only expired lease/);
    assert.equal(writes.length, 0, 'a post-read lease failure never publishes a preflight result');
  });
}

/** Execute the actual comparison body with only its pinned I/O boundaries replaced, as profile-worker tests do. */
async function compareInIsolation(controls: object) {
  const globals = globalThis as typeof globalThis & { s13iPrefix?: object }, previous = globals.s13iPrefix;
  const folder = mkdtempSync(join(tmpdir(), 'prefix-closure-')), target = `${folder}/comparison.ts`;
  const source = readFileSync(new URL('./intake-large-worker.ts', import.meta.url), 'utf8');
  const start = source.indexOf('async function comparePrefix('), end = source.indexOf('\nasync function step(', start);
  assert(start >= 0 && end > start);
  const mapping = new URL('./streamed-mapping.ts', import.meta.url).href;
  const errors = new URL('../../../infrastructure/errors.ts', import.meta.url).href;
  globals.s13iPrefix = controls;
  try {
    const contracts = import.meta.resolve('@ulpin/contracts/usp');
    writeFileSync(target, `import {StreamedMappingReceiptSchema} from '${contracts}';\n`
      + `import {prefixLayoutMatchesSealed,prefixMappingFailure,prefixSealCheckKey} from '${mapping}';\n`
      + `import {conflict} from '${errors}';\n`
      + `import {fingerprint} from '${new URL('../../cases/domain.ts', import.meta.url).href}';\n`
      + `import {checkIntakeLargeChunk} from '${new URL('./intake-large-worker.ts', import.meta.url).href}';\n`
      + 'const {pinned,heartbeat,loadProvisionalStreamedProfileTx,loadPrefixSealTx,'
      + 'readPinnedRawChunk,assertUspJobAttemptTx}'
      + '=globalThis.s13iPrefix;\nexport ' + source.slice(start, end));
    const worker = await import(pathToFileURL(target).href);
    await worker.comparePrefix({ caseId: id, sourceId: id }, {});
  } finally {
    globals.s13iPrefix = previous;
    unlinkSync(target);
    rmdirSync(folder);
  }
}
