import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { StreamedPrefixMappingPlanSchema, type StreamedProfileGeneration,
  type StreamingVectorRecord } from '@ulpin/contracts/usp';
import { normalizeMappedChunk } from './chunk-mapping-normalizer';
import { pairMappedFeatures } from './intake-package-cuts';
import { advanceStreamedInventory, emptyInventory } from './streamed-profile-inventory';
import { streamedGenerationHash } from './streamed-profile';
import { compileStreamedMapping, prefixLayoutMatchesSealed, prefixMappingUsedPathHeld,
  prefixSealCheckKey } from './streamed-mapping';
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

test('run 4 shape: geometry-set equality fires first; quarantine unknown independently rejects a valid used layout',
  async () => {
    let inventory = emptyInventory(), prefix: StreamedProfileGeneration | undefined;
    const held: StreamingVectorRecord[] = [];
    await read(172409, record => {
      inventory = advanceStreamedInventory(inventory, [record]).inventory;
      if (inventory.recordsSeen === 100) prefix = profile(inventory);
      if (record.featureIndex === 100 || record.disposition === 'quarantined') held.push(record);
    });
    const observed = prefix!, layout = plan(observed), sealed = profile(inventory, true);
    assert.deepEqual([sealed.recordsSeen, sealed.accepted, sealed.quarantined], [172409, 172398, 11]);
    assert.deepEqual(observed.geometryTypes, ['Polygon']);
    assert.deepEqual(sealed.geometryTypes, ['MultiPolygon', 'Polygon']);
    assert.equal(prefixLayoutMatchesSealed(layout, observed, sealed), false, 'current geometry-set guard fires');
    const withoutUnknown = { ...sealed, paths: sealed.paths.map(path => ({ ...path, unknown: 0 })) };
    assert.equal(prefixLayoutMatchesSealed(layout, observed, withoutUnknown), false, 'not only quarantine unknown');
    const withoutNewGeometry = { ...sealed, geometryTypes: observed.geometryTypes };
    assert.equal(prefixLayoutMatchesSealed(layout, observed, withoutNewGeometry), false, 'unknown also fires');
    assert.equal(prefixLayoutMatchesSealed(layout, observed,
      { ...withoutUnknown, geometryTypes: observed.geometryTypes }), true, 'isolate both current guards');
    assert.doesNotThrow(() => compileStreamedMapping({ ...layout, version: 'streamed-mapping/1',
      scope: 'accepted_source_features', source: sealed.source, profileGeneration: sealed.generation,
      profileHash: sealed.generationHash }, sealed), 'the approved conversions still admit the accepted file');
    const mapped = normalizeMappedChunk(held, layout, observed, id, 1, []);
    assert.equal(prefixMappingUsedPathHeld(mapped.records), false, 'neither guard is a mapped identity failure');
    assert.equal(mapped.records.filter(record => record.disposition === 'quarantined').length, 11);
    assert(mapped.records[0].issueCodes.includes('SCHEMA_DRIFT_GEOMETRY'));
    assert.equal(mapped.records[0].disposition, 'unresolved');
    assert.equal(pairMappedFeatures(held, mapped.records, { after: -1, conflicts: new Set(), kind: 'building' }).length,
      0, 'fixing only the seal still leaves the later compatible geometry held by the normalizer');
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
