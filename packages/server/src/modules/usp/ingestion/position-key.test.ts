import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readSync } from 'node:fs';
import { Readable } from 'node:stream';
import test from 'node:test';
import type { GisInspection } from '@ulpin/contracts';
import { IntakeKeyProfileInputSchema, MappingPlanSchema, SourceProfileSchema, StreamedMappingPlanSchema,
  StreamedPrefixMappingPlanSchema, type StreamingVectorRecord } from '@ulpin/contracts/usp';
import { sha256 } from '../../../infrastructure/storage';
import { candidateKeyHashes, normalizeMappedChunk } from './chunk-mapping-normalizer';
import { provePartFeature } from './proved-area-part';
import { compileMapping, inspectedProfile } from './registry';
import { compileStreamedMapping, prefixLayoutMatchesSealed } from './streamed-mapping';
import { advanceStreamedInventory, emptyInventory } from './streamed-profile-inventory';
import { readStreamingFeatures, sourceRecord } from './streaming-vector-reader';

const id = '10000000-0000-4000-8000-000000000001';
const hash = 'b'.repeat(64);
const source = { sourceId: id, familyId: id, sourceRevision: 1, sourceSha256: hash, schemaFingerprint: hash };
const key = { target: 'feature.sourceKey', sourcePath: '/features/*/geometry', conversionId: 'feature_position@1' };
const geometry = { target: 'feature.geometry', sourcePath: '/features/*/geometry', conversionId: 'geojson_geometry@1' };
// test_only protocol geometry: no identifying attribute, not operational building records.
const features = [0, 1].map(offset => ({ type: 'Feature', properties: { height: 3.5 + offset }, geometry: {
  type: 'Polygon', coordinates: [[[77 + offset * .001, 28], [77.0001 + offset * .001, 28],
    [77.0001 + offset * .001, 28.0001], [77 + offset * .001, 28]]],
} }));
const bytes = Buffer.from(JSON.stringify({ type: 'FeatureCollection', features }));
const planInput = { version: 'manual-geojson/1', mode: 'manual_mapping', source, caseId: id,
  workspaceRevision: 0, workspaceFingerprint: hash, kind: 'building', operations: [key, geometry] };
const streamedInput = { version: 'streamed-mapping/1', scope: 'accepted_source_features', mode: 'streamed_mapping',
  source, caseId: id, caseRevision: 0, rawJobId: id, profileJobId: id, profileGeneration: 0, profileHash: hash,
  kind: 'building', operations: [key, geometry], basis: 'officer_stated', semanticEvidence: [] };

async function read(bytes: Buffer, framing: 'feature-collection' | 'geojson-lines') {
  const records: StreamingVectorRecord[] = [];
  await readStreamingFeatures(Readable.from([bytes]), framing, async item => { records.push(sourceRecord(item)); });
  return records;
}
function streamedProfile(records: StreamingVectorRecord[]) {
  return { version: 'streamed-profile/1' as const, jobId: id, rawJobId: id, source,
    readerSha256: hash, profilerSha256: hash, generation: 0, generationHash: hash, previousHash: null,
    coverage: 'sealed' as const, rawChunkIndex: null, rawResultSha256: null, unknownRemainder: false,
    ...advanceStreamedInventory(emptyInventory(), records).inventory, quarantineLocators: [],
    reference: { sourceCrs: 'EPSG:4326', evidence: 'RFC 7946', unit: 'degree',
      globalPlacement: 'not_qualified' as const } };
}
function normalize(data: object, mapping: object, sourcePositions?: number[]): {
  features: { sourceKey: string; sourceFeatureIndex: number }[];
} {
  const code = 'import sys,json;sys.path.insert(0,"services/geo");from geo.area import normalize_area;'
    + 'print(json.dumps(normalize_area(json.load(sys.stdin))))';
  const result = spawnSync('E:/BhuAayam-data/task-data/lv0/python/Scripts/python.exe', ['-B', '-c', code], {
    encoding: 'utf8', timeout: 30000, input: JSON.stringify({ format: 'geojson', data, mapping, sourcePositions }),
    env: { ...process.env, PROJ_NETWORK: 'OFF', PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('position conversion is accepted only for the feature source key and the retained geometry path', () => {
  assert(MappingPlanSchema.safeParse(planInput).success);
  assert(StreamedMappingPlanSchema.safeParse(streamedInput).success);
  for (const target of ['feature.name', 'feature.geometry', 'building.sourceKey']) {
    const operations = [key, geometry, { ...key, target }];
    assert.equal(MappingPlanSchema.safeParse({ ...planInput, operations }).success, false);
    assert.equal(StreamedMappingPlanSchema.safeParse({ ...streamedInput, operations }).success, false);
  }
  const operations = [{ ...key, sourcePath: '/features/*/properties/height' }, geometry];
  assert.equal(MappingPlanSchema.safeParse({ ...planInput, operations }).success, false);
  assert.equal(StreamedMappingPlanSchema.safeParse({ ...streamedInput, operations }).success, false);
  assert.equal(IntakeKeyProfileInputSchema.shape.map.safeParse({ anchorItemId: id, sourcePath: key.sourcePath })
    .success, false, 'Exact-key linking remains field-only.');
});

test('retained no-field GeoJSON uses original feature locators, including Python normalization', async () => {
  const plan = MappingPlanSchema.parse(planInput);
  const { schemaFingerprint: _fingerprint, ...inventory } = inspectedProfile(bytes, {
    format: 'geojson', sourceSha256: sha256(bytes), featureCount: 2, sourceCrs: 'EPSG:4326',
    crsEvidence: 'RFC 7946', geometryTypes: ['Polygon'], fields: [{ name: 'height' }],
  } as GisInspection);
  const profile = SourceProfileSchema.parse({ ...inventory, source, caseId: id,
    workspaceRevision: 0, workspaceFingerprint: hash });
  assert(profile.paths.every(path => !path.literalIdEligible && !path.integerIdEligible));
  const records = await read(bytes, 'feature-collection');
  const result = normalizeMappedChunk(records, plan, profile, id, 0, []);
  assert.deepEqual(result.records.map(row => row.sourceKey.value), ['position:1', 'position:2']);
  assert.deepEqual(result.records.map(row => row.sourceKey.value),
    records.map(row => `position:${row.featureIndex + 1}`));
  const before = sha256(bytes);
  const normalized = normalize(JSON.parse(bytes.toString()), compileMapping(plan, profile));
  assert.equal(sha256(bytes), before, 'Normalization does not alter original bytes.');
  assert.deepEqual(normalized.features.map(row => row.sourceKey), ['position:1', 'position:2']);
  assert.deepEqual(normalized.features.map(row => row.sourceFeatureIndex), [0, 1]);
});

test('newline keys follow line locators across chunks; blank lines and proved cuts do not renumber', async () => {
  const plan = StreamedMappingPlanSchema.parse(streamedInput);
  for (const separator of ['\n', '\n\n']) {
    const original = Buffer.from(features.map(row => JSON.stringify(row)).join(separator) + '\n');
    const records = await read(original, 'geojson-lines');
    const profile = streamedProfile(records);
    assert.deepEqual(compileStreamedMapping(plan, profile), {
      kind: 'building', geometryRole: 'unknown', sourceKeyConversion: 'feature_position@1',
    });
    const expected = records.map(row => `position:${row.sequencePosition!.number}`);
    assert.deepEqual(expected, separator === '\n' ? ['position:1', 'position:2'] : ['position:1', 'position:3']);
    assert.deepEqual(candidateKeyHashes(records, plan), expected.map(sha256));
    const first = normalizeMappedChunk(records.slice(0, 1), plan, profile, id, 0, []);
    const second = normalizeMappedChunk(records.slice(1), plan, profile, id, 1, first.keys.map(row => ({
      source_key_sha256: row.hash, source_key: row.value, first_feature_index: row.firstIndex,
    })));
    assert.deepEqual([...first.records, ...second.records].map(row => row.sourceKey.value), expected);
    assert(second.records.every(row => row.disposition === 'observed'));
    const record = records[1];
    const proved = await provePartFeature(record, original.subarray(record.byteStart, record.byteEnd), original.length);
    const position = proved.position;
    assert.equal(position, record.sequencePosition!.number);
    const normalized = normalize({ type: 'FeatureCollection', features: [proved.feature] },
      compileStreamedMapping(plan, profile), [position]);
    assert.equal(normalized.features[0].sourceKey, expected[1]);
  }
});

test('the practice-kit India GeoJSONL prefix maps unchanged vendor predictions by line position', async t => {
  const path = 'E:/BhuAayam-data/datasets/practice-kit-20261024/microsoft/india-123133321.geojsonl';
  if (!existsSync(path)) return t.skip('The public test_only practice payload is unavailable.');
  // Bounded mechanical comparison only; this 2,224,797-feature file still exceeds the product's feature ceiling.
  const file = openSync(path, 'r'), buffer = Buffer.alloc(65536);
  let count: number;
  try { count = readSync(file, buffer, 0, buffer.length, 0); }
  finally { closeSync(file); }
  const prefix = Buffer.from(buffer.subarray(0, count).toString('utf8').split('\n').slice(0, 2).join('\n') + '\n');
  const before = sha256(prefix), records = await read(prefix, 'geojson-lines');
  assert.equal(records.length, 2);
  const plan = StreamedMappingPlanSchema.parse(streamedInput), profile = streamedProfile(records);
  const mapped = normalizeMappedChunk(records, plan, profile, id, 0, []);
  assert.deepEqual(mapped.records.map(row => row.sourceKey.value), ['position:1', 'position:2']);
  assert(mapped.records.every(row => row.disposition === 'observed'));
  // The first two real rows are far apart; each original-position cut uses the bounded local adapter separately.
  for (const record of records) {
    const normalized = normalize({ type: 'FeatureCollection', features: [record.feature] },
      compileStreamedMapping(plan, profile), [record.sequencePosition!.number]);
    assert.equal(normalized.features[0].sourceKey, `position:${record.sequencePosition!.number}`);
  }
  assert.equal(sha256(prefix), before);
});

test('position prefix closure and non-line proved cuts keep global positions', async () => {
  const records = await read(bytes, 'feature-collection');
  const sealed = streamedProfile(records);
  const prefix = { ...streamedProfile(records.slice(0, 1)), coverage: 'provisional' as const,
    unknownRemainder: true, rawChunkIndex: 0, rawResultSha256: hash };
  const plan = StreamedPrefixMappingPlanSchema.parse({ ...streamedInput, version: 'streamed-prefix-mapping/1',
    scope: 'observed_prefix_and_later_compatible_features',
    prefix: { throughRawChunkIndex: 0, rawResultSha256: hash, recordsSeen: 1, accepted: 1 } });
  assert(prefixLayoutMatchesSealed(plan, prefix, sealed));
  const record = records[1];
  const proved = await provePartFeature(record, bytes.subarray(record.byteStart, record.byteEnd), bytes.length);
  assert.equal(proved.position, 2);
});
