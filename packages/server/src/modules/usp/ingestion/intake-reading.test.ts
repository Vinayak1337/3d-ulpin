import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import test from 'node:test';
import { zipSync, strToU8 } from 'fflate';
import type { PoolClient } from 'pg';
import { INTAKE_FORMAT_NAMES, IntakeReadingSchema, ChunkMappingPayloadSchema,
  DXFResultSchema, IFCSummarySchema, type DocumentResult, type MappingPlan, type MappingReceipt }
  from '@ulpin/contracts/usp';
import { fingerprint } from '../../cases/domain';
import { dxfSummary } from './dxf-processor';
import { citygmlSummary } from './citygml-processor';
import { gltfSummary } from './gltf-processor';
import { objSummary } from './obj-processor';
import realIfc from '../../../../../../docs/evidence/gf1/ifc2/real-structures.json';
import { ModelGateway } from '../../model-gateway/gateway';
import { inspectedProfile } from './registry';
import { profileTabularChunk } from './chunk-mapping-agent';
import { manualTeacherPlan } from './mapping-teacher';
import { IntakeService } from './intake-service';
import { ingestionBinding } from './events';
import { profileColumnFile } from './column-profile';
import { INTAKE_FORMAT_NAMES as browserFormatNames } from '@ulpin/contracts/upload-reader-limits';
import { intakeItem } from './intake-ledger';
import { probeOriginal } from './intake-probe';
import { readingOf, type ReadingFacts, type ReadingRow } from './intake-reading';

const fixtures = [
  ['fixtures/real-nyc/original.geojson', 'GeoJSON map layer', 'features?'],
  ['fixtures/real-area/original.geojson', 'GeoJSON map layer', 'features?'],
  ['fixtures/usp/D4/reference-area-gurugram-59-63a/lgd-gurugram.csv', 'CSV table', 'profiled columns'],
  ['fixtures/usp/D8-messy-india/dev/d1b/mi-d19-01.xlsx', 'XLSX table', 'sheets'],
];
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const probe = (bytes: Uint8Array, name: string) =>
  probeOriginal(async (start, end) => bytes.subarray(start, end), bytes.length, name);

for (const [path, kind, count] of fixtures) test(`reading stored facts from ${path}`, async () => {
  const bytes = readFileSync(path);
  const before = digest(bytes);
  const card = await probe(bytes, basename(path));
  const original = structuredClone(card);
  const row: ReadingRow = { state: 'probed', placement: 'needs_answer', size_bytes: bytes.length,
    plan_ref: { layoutQuestion: card.family === 'vector' } };
  const reading = readingOf(row, card);
  assert.deepEqual(IntakeReadingSchema.parse(reading), reading);
  assert.ok(reading.what.words.includes(kind), reading.what.words);
  assert.match(reading.what.words, new RegExp(`\\d+ ${count}`));
  assert.ok(reading.drawing.words.length);
  assert.doesNotMatch(`${reading.what.words} ${reading.drawing.words}`, /Not known/i);
  assert.equal(reading.what.basis, 'reader');
  assert.deepEqual(reading.links, []);
  if (card.family === 'table') {
    assert.equal(reading.fields.length, card.columns.length);
    assert.ok(reading.fields.every(field => /Not known/.test(field.words)));
  }
  for (const [noun, value] of Object.entries(card.counts)) {
    if (value !== null) {
      const words = `${value} ${value === 1 ? noun.slice(0, -1) : noun}`;
      assert.ok(reading.holds.some(entry => entry.words === words));
    }
  }
  assert.ok(reading.question);
  if (card.family === 'vector') {
    assert.equal(reading.drawing.as, 'outlines');
    assert.match(reading.drawing.words, /after the layer layout/);
    assert.match(readingOf({ ...row, placement: 'on_map' }, card).drawing.words, /on the map/);
    const answered = readingOf({ ...row, plan_ref: { recipeState: 'approved' } }, card);
    assert.match(answered.drawing.words, /confirmed layer layout/);
    assert.equal(answered.question, null);
  } else {
    assert.equal(reading.drawing.as, 'kept');
    assert.match(reading.drawing.words, /not drawn until/);
    const placed = readingOf({ ...row, placement: 'on_map' }, card);
    assert.equal(placed.drawing.as, 'features');
    assert.equal(placed.question, null);
  }
  assert.deepEqual(card, original);
  assert.equal(digest(readFileSync(path)), before, 'original bytes remain unchanged');
});

test('all recognised formats have shared plain names; unlisted tokens are left out of what', () => {
  const formats = ['7z', 'bigtiff', 'citygml', 'cityjson', 'csv', 'dbf', 'dwg', 'dxf', 'e57', 'flatgeobuf',
    'geojson', 'geojson-seq', 'geopackage', 'glb', 'gltf', 'gml', 'ifc', 'jpeg', 'kml', 'ndjson', 'obj',
    'parquet', 'pdf', 'ply', 'png', 'rar', 'shapefile', 'sqlite', 'tiff', 'tsv', 'xls', 'zip', 'xlsx',
    'ods', 'kmz', 'las', 'laz', 'geotiff', 'geoparquet', 'shapefile_zip'];
  assert.ok(Object.isFrozen(INTAKE_FORMAT_NAMES));
  assert.equal(browserFormatNames, INTAKE_FORMAT_NAMES);
  for (const format of formats) {
    assert.ok(Object.hasOwn(INTAKE_FORMAT_NAMES, format), format);
    const name = INTAKE_FORMAT_NAMES[format];
    assert.ok(name.trim().length, format);
    const words = readingOf({ format, family: 'unknown' }, null).what.words;
    assert.ok(words.includes(name), words);
    assert.doesNotMatch(words, /\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+\b/);
  }
  for (const format of ['UNLISTED-FORMAT', 'shapefile-index', 'toString']) {
    assert.equal(readingOf({ format, family: 'table' }, null).what.words, 'table.');
  }
});

test('one feature, row, page, member, point and band use singular nouns', async () => {
  const card = await probe(Buffer.from('{"type":"FeatureCollection","features":[]}'), 'empty.geojson');
  // Count grammar protocol control, not a dataset assertion.
  card.counts = { features: 1, rows: 1, pages: 1, members: 1, points: 1, bands: 1 };
  const reading = readingOf({}, card);
  for (const noun of ['feature', 'row', 'page', 'member', 'point', 'band']) {
    assert.ok(reading.what.words.includes(`1 ${noun}`));
    assert.ok(reading.holds.some(entry => entry.words === `1 ${noun}`));
    assert.doesNotMatch(reading.what.words, new RegExp(`\\b1 ${noun}s\\b`));
  }
});

test('unknown counts stay omitted; a known zero is retained and item what uses the same assembler', async () => {
  const card = await probe(readFileSync(fixtures[2][0]), 'lgd-gurugram.csv');
  const reading = readingOf({}, card);
  assert.equal(card.counts.rows, null);
  assert.ok(!reading.holds.some(entry => /\brows\b/.test(entry.words)));
  assert.doesNotMatch(reading.what.words, /0 rows/);
  const empty = await probe(Buffer.from('{"type":"FeatureCollection","features":[]}'), 'empty.geojson');
  assert.ok(readingOf({}, empty).holds.some(entry => entry.words === '0 features'));
  // Protocol identity and timestamps only, not a dataset record.
  const id = '10000000-0000-4000-8000-000000000001';
  const row = { item_id: id, case_id: id, source_id: id, parent_item_id: null, member_path: null,
    name: 'lgd-gurugram.csv', family: card.family, format: card.format, size_bytes: 239, size_class: 'S',
    wave: 3, state: 'probed', placement: 'undecided', card, card_sha256: null, probe_version: card.version,
    plan_ref: null, parts_planned: null, parts_done: 0, records_seen: 0, limit_reason: null,
    pinned_by_officer: false, created_at: new Date(0), updated_at: new Date(0) };
  assert.equal(intakeItem(row).what, readingOf(row, card).what.words);
  // Mixed-geometry protocol control: one observed polygon must not label every feature an outline.
  empty.geometryTypes = ['Polygon', 'Point'];
  assert.equal(readingOf({}, empty).drawing.as, 'features');
  const refused = readingOf({ placement: 'needs_answer', limit_reason: 'This reader cannot read this layer.' }, empty);
  assert.equal(refused.drawing.as, 'kept');
  assert.equal(refused.question, null);
  empty.layers = [{ name: 'protocol layer', count: null }, { name: 'empty protocol layer', count: 0 }];
  const layers = readingOf({}, empty).holds.map(entry => entry.words);
  assert.ok(layers.includes('Layer: protocol layer.'));
  assert.ok(layers.includes('Layer: empty protocol layer (0 records).'));
});

test('unrecognised bytes and unprobed items are kept with their reason, without inventing a kind', async () => {
  const bytes = Buffer.from([0, 1, 2, 3]); // Unknown-signature protocol control.
  const card = await probe(bytes, 'unrecognised.bin');
  const reason = 'Kept; its kind was not recognised from its first and last bytes.';
  const reading = readingOf({ size_bytes: bytes.length, limit_reason: reason }, card);
  assert.match(reading.what.words, /kind was not recognised/);
  assert.equal(reading.drawing.as, 'kept');
  assert.equal(reading.drawing.words, reason);
  assert.equal(reading.question, null);
  const pending = readingOf({ size_bytes: null }, null);
  assert.deepEqual(pending.holds, []);
  assert.doesNotMatch(pending.what.words, /0 bytes|UNKNOWN/);
});

test('a ZIP describes members without claiming copies and a layer CRS question follows stored answers', async () => {
  const card = await probe(zipSync({ 'rows.csv': strToU8('key,value\n') }), 'bundle.zip');
  assert.match(readingOf({}, card).drawing.words, /waiting to be taken out/);
  assert.doesNotMatch(readingOf({}, card).drawing.words, /CSV taken out as their own items:/);
  const nativeLayers = { unstated: ['layer'], answers: [] as { layer: string }[] };
  assert.match(readingOf({ plan_ref: { nativeLayers } }, card).question!, /coordinate system.*layer/);
  nativeLayers.answers.push({ layer: 'layer' });
  assert.equal(readingOf({ plan_ref: { nativeLayers } }, card).question, null);
  const malformed = JSON.parse('{"plan_ref":{"nativeLayers":{"unstated":"unreadable"}}}');
  assert.equal(readingOf(malformed, card).question, null, 'an unknown stored projection does not break the reading');
});

test('NYC stored paths use rules, retain unstated height and never dispatch the gateway', async t => {
  let calls = 0;
  t.mock.method(ModelGateway.prototype, 'propose', async () => {
    calls++;
    throw new Error('No teacher on reads.');
  });
  const bytes = readFileSync(fixtures[0][0]);
  const json = JSON.parse(bytes.toString());
  const card = await probe(bytes, 'original.geojson');
  const profile = inspectedProfile(bytes, { format: 'geojson', sourceSha256: digest(bytes),
    featureCount: json.features.length, sourceCrs: 'OGC:CRS84', crsEvidence: json.crs.properties.name,
    crsUnit: 'degree', geometryTypes: card.geometryTypes, fields: Object.keys(json.features[0].properties)
      .map(name => ({ name })) } as Parameters<typeof inspectedProfile>[1]);
  const row = { name: 'NYC footprints.geojson', placement: 'needs_answer' };
  const facts: ReadingFacts = { profile };
  const before = structuredClone(facts);
  const reading = readingOf(row, card, facts);
  const field = (name: string) => reading.fields.find(field => field.field === `/features/*/properties/${name}`)!;
  assert.match(field('bin').words, /^Building source key\./);
  assert.match(field('name').words, /^Building name\./);
  assert.equal(field('bin').basis, 'rule');
  assert.equal(field('name').basis, 'rule');
  assert.match(field('height_roof').words, /^Not known\./);
  assert.equal(reading.drawing.as, 'building');
  assert.equal(reading.drawing.basis, 'rule');
  assert.deepEqual(IntakeReadingSchema.parse(reading), reading);
  assert.deepEqual(facts, before);
  // Recipe pins and approval below are protocol controls; source meanings are those of this real file.
  const id = '10000000-0000-4000-8000-000000000001', hash = digest(bytes);
  const plan: MappingPlan = { version: 'manual-geojson/1', mode: 'manual_mapping', caseId: id,
    workspaceRevision: 0, workspaceFingerprint: hash, kind: 'building', source: { sourceId: id,
      familyId: id, sourceRevision: 1, sourceSha256: hash, schemaFingerprint: profile.schemaFingerprint },
    operations: [{ sourcePath: '/features/*/properties/bin', target: 'feature.sourceKey',
      conversionId: 'literal_identifier@1' }, { sourcePath: '/features/*/properties/name', target: 'feature.name',
      conversionId: 'literal_text@1' }, { sourcePath: '/features/*/geometry', target: 'feature.geometry',
      conversionId: 'geojson_geometry@1' }] };
  const proposal = readingOf(row, card, { profile, proposal: { plan, origin: 'teacher' } });
  assert.equal(proposal.fields.find(field => field.field.endsWith('/bin'))!.basis, 'sarvam');
  assert.equal(proposal.drawing.basis, 'sarvam');
  const recipe: MappingReceipt = { id, revision: 1, state: 'approved', plan, planHash: hash,
    destination: { kind: 'new_area', name: 'Protocol control', namespace: 'Protocol control' },
    authoredBy: 'protocol-control', authoredAt: new Date(0).toISOString(), execution: null,
    approval: { subject: 'protocol-control', at: new Date(0).toISOString(), planHash: hash,
      provenance: 'server_configured_local_operator' } };
  const approved = readingOf(row, card, { profile, recipe, proposal: { plan, origin: 'teacher' } });
  for (const name of ['bin', 'name']) {
    assert.equal(approved.fields.find(field => field.field.endsWith(`/${name}`))!.basis, 'officer');
  }
  assert.equal(approved.drawing.basis, 'officer');
  const height = readingOf(row, card, { profile, recipe: { ...recipe, plan: { ...plan,
    heightField: 'height_roof', heightUnit: 'ft', heightMeaning: 'Protocol-only officer height decision' } } });
  const heightField = height.fields.find(field => field.field.endsWith('/height_roof'))!;
  assert.equal(heightField.basis, 'officer');
  assert.match(heightField.words, /Source height in ft/);
  assert.doesNotMatch(heightField.words, /metres/);
  const incomplete = readingOf(row, card, { profile, recipe: { ...recipe,
    plan: { ...plan, heightField: 'height_roof' } } });
  assert.match(incomplete.fields.find(field => field.field.endsWith('/height_roof'))!.words, /^Not known\./);
  const previous = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'reading-protocol-control';
  t.after(() => {
    if (previous === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
    else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = previous;
  });
  const binding = ingestionBinding(id);
  let storedRecipe: unknown = recipe;
  const client = { query: async (sql: string) => {
    if (sql.includes('FROM cases')) return { rows: [{ id, archived: false }] };
    if (sql.startsWith('SELECT i.*')) return { rows: [{ source_id: id, card, ...row }] };
    if (sql.startsWith('SELECT s.inspection')) return { rows: [{ profile, recipe: storedRecipe,
      proposal: { plan, origin: 'teacher' } }] };
    if (sql.includes('FROM sources')) return { rows: [{ id, revision: 1, case_id: id,
      profile: 'geojson-manual-v1', bytes: bytes.length, sha256: hash, object_key: 'protocol-control',
      inspection: { actor: binding.subject } }] };
    throw new Error(`Unexpected reading SQL: ${sql}`);
  } } as unknown as PoolClient;
  const service = new IntakeService({ transaction: async action => action(client),
    read: async () => { throw new Error('Original byte reads are forbidden.'); },
    object: async () => { throw new Error('No derivative is needed for map fields.'); } });
  assert.equal((await service.reading(id, id)).fields.find(field => field.field.endsWith('/bin'))!.basis, 'officer');
  storedRecipe = { ...recipe, plan: { ...plan, source: { ...plan.source, sourceRevision: 2 } } };
  assert.equal((await service.reading(id, id)).fields.find(field => field.field.endsWith('/bin'))!.basis, 'sarvam');
  assert.equal(calls, 0);
});

test('stored LGD first-chunk provenance is per column, not the plan-wide method', async t => {
  const path = fixtures[2][0], { profile: source, rows } = profileColumnFile(path);
  const headers = source.columns.map(column => column.name);
  const { profile } = profileTabularChunk({ jobId: '10000000-0000-4000-8000-000000000001', chunkIndex: 0,
    sourceRef: 'test_only:lgd-gurugram.csv', headers, rows: rows.map(row => headers.map(header => row[header])) });
  const plan = manualTeacherPlan(profile, 'MAPPING_REVIEW_REQUIRED').plan;
  // Provenance protocol control over real columns: no asserted meanings or values are fabricated.
  const sources = ['memory', 'rule', 'student', 'teacher', 'officer', 'unanswered'] as const;
  const mapping = { profile, plan, fieldSources: profile.columns.map((column, index) => ({
    sourceField: column.name, source: sources[index % sources.length], method: 'protocol-control' })) };
  const card = await probe(readFileSync(path), basename(path));
  const reading = readingOf({}, card, { mapping });
  assert.deepEqual(reading.fields.map(field => field.basis),
    ['memory', 'rule', 'reader', 'sarvam', 'officer', 'reader', 'memory', 'rule']);
  assert.deepEqual(reading.fields.map(field => field.field), profile.columns.map(column => column.name));
  assert.ok(reading.fields.every(field => /^Not known\./.test(field.words)));
  assert.deepEqual(IntakeReadingSchema.parse(reading), reading);
  // Stored payload and receipt pins are protocol controls over the unchanged real file.
  const id = '10000000-0000-4000-8000-000000000001', original = readFileSync(path), hash = digest(original);
  const payload = ChunkMappingPayloadSchema.parse({ version: 'chunk-mapping/1', jobId: id, rawJobId: id,
    sourceId: id, sourceRevision: 1, sourceSha256: hash, chunkIndex: 0, rawResultSha256: hash,
    schemaFingerprint: profile.layoutFingerprint, recipeRevision: null, converterSha256: hash, records: [],
    tabular: { selection: { format: 'csv', sheet: 'csv', table: null, headerRows: [1] }, sourceBytes: original.length,
      admission: { kind: 'case_original', origin: 'officer_supplied', issuer: null,
        licence: 'unconfirmed', containsPersonalData: 'unknown' } },
    mapping: { ...mapping, questions: [], sourceRows: [], rows: [], metrics: { kind: 'mapping.chunk', jobId: id,
      chunkIndex: 0, layout: 'new', teacherCalls: 0, memoryHits: 0, studentFields: 0, teacherFields: 0,
      needsInput: profile.columns.length, latencyMs: 0, learnerVersion: null } } });
  const bytes = Buffer.from(JSON.stringify(payload));
  const previous = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'reading-protocol-control';
  t.after(() => {
    if (previous === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
    else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = previous;
  });
  const binding = ingestionBinding(id);
  let objectHash = digest(bytes), objects = 0;
  const client = { query: async (sql: string) => {
    if (sql.includes('FROM cases')) return { rows: [{ id, archived: false }] };
    if (sql.startsWith('SELECT i.*')) return { rows: [{ source_id: id, card }] };
    if (sql.startsWith('SELECT s.inspection')) return { rows: [{ object_key: 'protocol-proposal',
      object_sha256: objectHash, bytes: bytes.length }] };
    if (sql.includes('FROM sources')) return { rows: [{ id, revision: 1, case_id: id,
      profile: 'tabular-manual-v1', bytes: original.length, sha256: hash, object_key: 'protocol-original',
      inspection: { actor: binding.subject } }] };
    throw new Error(`Unexpected reading SQL: ${sql}`);
  } } as unknown as PoolClient;
  const service = new IntakeService({ transaction: async action => action(client),
    read: async () => { throw new Error('No original byte reads.'); }, object: async key => {
      assert.equal(key, 'protocol-proposal');
      objects++;
      return bytes;
    } });
  assert.deepEqual((await service.reading(id, id)).fields, reading.fields);
  assert.equal(objects, 1);
  objectHash = '0'.repeat(64);
  await assert.rejects(service.reading(id, id), { code: 'INTAKE_READING_INTEGRITY' });
});

test('kind name words obey the same geometry acceptance as the layout question', async () => {
  const card = await probe(readFileSync(fixtures[0][0]), 'original.geojson');
  for (const [name, kind] of [['building', 'building'], ['footprint', 'building'], ['parcel', 'parcel'],
    ['plot', 'parcel'], ['road', 'road'], ['park', 'public_land']]) {
    assert.equal(readingOf({ name }, card).drawing.as, kind);
    assert.equal(readingOf({ name }, { ...card, geometryTypes: ['LineString'] }).drawing.as,
      kind === 'road' ? 'road' : 'lines');
    assert.equal(readingOf({ name }, { ...card, geometryTypes: [] }).drawing.as, 'features');
    assert.equal(readingOf({ name }, { ...card, geometryTypes: ['Polygon', 'Point'] }).drawing.as, kind);
  }
  assert.equal(readingOf({ name: 'building parcels' }, card).drawing.as, 'outlines');
  assert.equal(readingOf({ name: 'roadmap' }, card).drawing.as, 'outlines');
});

const nativeRoot = 'E:/BhuAayam-data/task-data/desktop-';
const savedReadings = [
  ['dxf', 'dxf-native/runs/declared-final/drawing.json', 'dxf-native/sources/1_polylines.dxf', dxfSummary],
  ['dxf', 'dxf-native/runs/absent-final/drawing.json', 'dxf-native/sources/ASCII_R12.dxf', dxfSummary],
  ['citygml', 'citygml-native/run-02-lod2/projection.json',
    'citygml-native/originals/Building_and_garage_LOD2-EPSG25832.gml', citygmlSummary],
  ['citygml', 'citygml-native/run-02-local/projection.json',
    'citygml-native/originals/Building_LOD1-LocalEngineeringCRS.gml', citygmlSummary],
  ['glb', 'gltf-native/final-glb/gltf.json', 'gltf-native/originals/Box.glb', gltfSummary],
  ['gltf', 'gltf-native/final-external-gltf/gltf.json', 'gltf-native/originals/Box.gltf', gltfSummary],
  ['obj', 'obj-native/complete-run01/obj.json', 'obj-native/no_material.obj', objSummary],
] as const;
for (const [, saved, original, summarise] of savedReadings) {
  test(`${original}: reading uses the saved native run, not a new reader`, { skip: !existsSync(nativeRoot + saved) },
    async () => {
      const raw = readFileSync(nativeRoot + saved), value = JSON.parse(raw.toString());
      const pins = { sourceSha256: value.sourceSha256 ?? value.source.sha256,
        sourceBytes: value.sourceBytes ?? value.source.bytes, sceneIndex: null, readerSha256: '0'.repeat(64) };
      const summary = summarise(raw, pins as never);
      const bytes = readFileSync(nativeRoot + original), card = await probe(bytes, basename(original));
      const facts = { native: summary }, before = structuredClone(facts);
      const reading = IntakeReadingSchema.parse(readingOf({}, card, facts));
      assert.match(reading.drawing.words, /Kept as evidence, not placed/);
      assert.doesNotMatch(reading.what.words + reading.drawing.words, /Not known/);
      assert.ok(reading.holds.some(entry => /vertical reference: not stated/i.test(entry.words)));
      if (summary.schemaVersion === 'dxf-native-inspection/1') assert.ok(reading.holds.some(entry =>
        entry.words.includes(`${summary.projectedEntityCount} projected entities`)));
      assert.deepEqual(facts, before);
      assert.equal(digest(readFileSync(nativeRoot + original)), digest(bytes), 'original bytes remain unchanged');
    });
}

test('IFC structure counts and types come from the retained run; an unread structure is never zero', () => {
  const house = realIfc.files['ifc2x3-building-architecture.ifc'], facts = house.retainedNativeFacts;
  const count = (type: string) => house.structure.nodes.filter(node => node.entityType === type).length;
  const summary = IFCSummarySchema.parse({ schemaVersion: 'ulpin-native-ifc/1', sourceSha256: house.sha256,
    sourceBytes: house.bytes, schema: facts.schema, entityCount: facts.sourceEntities,
    recordCount: facts.projectedRecords, buildingCount: count('IfcBuilding'), storeyCount: count('IfcBuildingStorey'),
    spaceCount: count('IfcSpace'), georeferenceState: facts.georeferenceState, inspectionFrame: 'source_local',
    metadataOnly: true, geometry: 'unsupported', globalPlacement: 'not_qualified', unitConversionApplied: false,
    storeysAreLegalUnits: false, rights: 'not_assessed', structure: house.structure });
  const reading = readingOf({ format: 'ifc', family: 'model3d' }, null, { ifc: summary });
  assert.ok(reading.holds.some(entry => /1 storey and 2 spaces/.test(entry.words)));
  assert.ok(reading.holds.some(entry => /Structure object types:.*IfcBuildingStorey/.test(entry.words)));
  const unread = readingOf({}, null, { ifc: { ...summary, structure: undefined } });
  assert.match(unread.holds[0].words, /no structure scan/);
  assert.doesNotMatch(unread.holds.map(entry => entry.words).join(' '), /0 storeys|0 spaces/);
});

test('PDF page and OCR lines use only stored page locators and native no-text warnings', () => {
  // The Magnolia native reading's page structure, also used by intake-pdf-batch.test.ts.
  const native = { format: 'pdf', status: 'extracted', warnings: [3, 4, 5, 6].map(page =>
    `PDF page ${page} has no native text; image interpretation/OCR remains unresolved.`),
  parts: [1, 2].map(page => ({ locator: { page } })) } as DocumentResult['native'];
  const reading = readingOf({}, null, { document: native });
  assert.ok(reading.holds.some(entry => /6 pages read/.test(entry.words)));
  assert.ok(reading.holds.some(entry => /4 pages need OCR: pages 3–6/.test(entry.words)));
  const empty = readingOf({}, null, { document: { ...native, parts: [], warnings: [], status: 'tool_error' } });
  assert.ok(empty.holds.every(entry => /not stated/.test(entry.words)));
  assert.doesNotMatch(empty.holds.map(entry => entry.words).join(' '), /0 pages/);
});

test('stored surface header states points, pixels, bands and references without a probe guess', () => {
  const header = { operation: 'point-batch', size: [314034], crsStated: true, authority: 'EPSG:2263',
    vertical: { status: 'unknown', name: null } };
  // Header protocol control; no new assertion about the source file's point count or CRS.
  const reading = readingOf({ plan_ref: { header } }, null);
  assert.deepEqual(reading.holds.map(entry => entry.words), ['314034 points.',
    'Coordinate system stated: EPSG:2263.', 'Vertical reference: not stated.']);
  const raster = readingOf({ plan_ref: { header: { ...header, operation: 'raster-window', size: [100, 200, 3],
    vertical: { status: 'known', name: 'literal source vertical reference' } } } }, null);
  assert.ok(raster.holds.some(entry => entry.words === 'Bands: 3.'));
  assert.ok(raster.holds.some(entry => /height: 200 pixels/.test(entry.words)));
  assert.ok(raster.holds.some(entry => /Vertical reference stated: literal source/.test(entry.words)));
  const omitted = readingOf({}, null, { omissions: [{ layer: 'source layer', notWritten: 7 }] });
  assert.match(omitted.holds[0].words, /Layer source layer: 7 features left out/);
});

test('reading route reads one accepted receipt, never an original, reader, model or write', async t => {
  const saved = nativeRoot + savedReadings[0][1];
  if (!existsSync(saved)) return t.skip('saved DXF run is absent');
  const raw = readFileSync(saved), native = JSON.parse(raw.toString());
  const id = '10000000-0000-4000-8000-000000000001', hash = '0'.repeat(64);
  const previous = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'reading-protocol-control';
  t.after(() => {
    if (previous === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
    else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = previous;
  });
  const binding = ingestionBinding(id);
  const input = { version: 'dxf-native/1', jobId: id, caseId: id, caseRevision: 0,
    caseContextSha256: fingerprint({ frame: null, context: null, siteId: null }),
    sourceId: id, sourceFamilyId: id, sourceRevision: 1, sourceSha256: native.sourceSha256,
    sourceBytes: native.sourceBytes, objectKey: 'protocol-original', subject: binding.subject,
    accessSha256: binding.access, readerSha256: hash, selection: 'complete_bounded_source',
    tools: { platform: 'windows-x86_64', pythonSha256: hash, profileSha256: hash, readerSha256: hash,
      supervisorSha256: hash, dependencyLockSha256: hash, codeSha256: hash } };
  const result = DXFResultSchema.parse({ version: input.version, input, summary: dxfSummary(raw, input as never),
    artifact: { key: 'protocol-artifact', sha256: digest(raw), bytes: raw.length,
      mediaType: 'application/json', profile: 'dxf-native-inspection/1' }, createdAt: new Date(0).toISOString() });
  const bytes = Buffer.from(JSON.stringify(result));
  let objects = 0, sourceRevision = 1, caseRevision = 0, resultHash = digest(bytes);
  const fullCard = await probe(readFileSync(nativeRoot + savedReadings[0][2]), '1_polylines.dxf');
  const client = { query: async (sql: string) => {
    assert.match(sql, /^SELECT /, 'reading cannot write');
    if (sql.includes('FROM cases')) return { rows: [{ id, archived: false, revision: caseRevision }] };
    if (sql.startsWith('SELECT i.*')) return { rows: [{ source_id: id, plan_ref: { nativeReaderJobId: id },
      card: fullCard }] };
    if (sql.includes('FROM jobs')) {
      assert.match(sql, /a.state='accepted'/);
      return { rows: [{ id, payload: input, input_sha256: fingerprint(input), frame: null, context: null,
        site_id: null, result_ref: { sha256: resultHash } }] };
    }
    if (sql.includes('FROM sources')) return { rows: [{ id, case_id: id, revision: sourceRevision,
      profile: 'dxf-native-v1', sha256: native.sourceSha256, bytes: native.sourceBytes,
      object_key: input.objectKey, inspection: { dxfOriginal: { version: input.version, subject: binding.subject,
        accessSha256: binding.access, sha256: native.sourceSha256, bytes: native.sourceBytes,
        receivedAt: new Date(0).toISOString(), lineageState: 'caller_declared', lineage: { issuer: null,
          originalUrl: null, acquiredAt: null, permissionReference: null, geography: null, limitations: [] } } } }] };
    throw new Error(`Unexpected reading SQL: ${sql}`);
  } } as unknown as PoolClient;
  const forbidden = t.mock.fn(async () => { throw new Error('No original, reader or model on a reading.'); });
  t.mock.method(ModelGateway.prototype, 'propose', forbidden);
  const service = new IntakeService({ transaction: async action => action(client), read: forbidden,
    probe: forbidden, planModel: forbidden, object: async key => {
      assert.equal(key, `dxf-native/${id}/${resultHash}.json`);
      objects++;
      return bytes;
    } });
  assert.match((await service.reading(id, id)).drawing.words, /Kept as evidence, not placed/);
  assert.equal(objects, 1);
  caseRevision = 1;
  await service.reading(id, id);
  assert.equal(objects, 2, 'an unrelated case edit does not hide stored source facts');
  sourceRevision = 2;
  await service.reading(id, id);
  assert.equal(objects, 2, 'stale source pins never open the receipt');
  sourceRevision = 1;
  resultHash = hash;
  await assert.rejects(service.reading(id, id), { code: 'INTAKE_READING_INTEGRITY' });
  assert.equal(forbidden.mock.callCount(), 0);
});

const pack = 'E:/BhuAayam-data/task-data/nyc-10013-multimodal/upload';
for (const [file, as, words] of [['nyc-10013-ortho-2018.tif', 'raster_overlay', /Raster overlay/],
  ['nyc-10013-lidar-2017.laz', 'points', /Points/]] as const) {
  const path = `${pack}/${file}`;
  const skip = !existsSync(path) && 'the data drive inputs are not present';
  test(`surface reading from ${file}`, { skip }, async () => {
    const bytes = readFileSync(path);
    const card = await probe(bytes, file);
    const reading = readingOf({ size_bytes: bytes.length }, card);
    assert.deepEqual(IntakeReadingSchema.parse(reading), reading);
    assert.equal(reading.drawing.as, as);
    assert.match(reading.drawing.words, words);
    assert.doesNotMatch(`${reading.what.words} ${reading.drawing.words}`, /Not known/i);
    assert.ok(reading.holds.some(entry => /Extent|Raster width/.test(entry.words)));
    if (as === 'points') {
      assert.ok(reading.holds.some(entry => /Point scale/.test(entry.words)));
      assert.ok(reading.holds.some(entry => entry.words === `Point format: ${card.point!.format}.`));
    }
    if (card.formatVersion) {
      assert.ok(reading.holds.some(entry => entry.words === `Format version: ${card.formatVersion}.`));
    }
  });
}
