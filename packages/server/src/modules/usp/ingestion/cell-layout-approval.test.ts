import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import type { PoolClient } from 'pg';
import type { GisInspection } from '@ulpin/contracts';
import { CELL_DERIVATIVE_RULE, StreamedMappingReceiptSchema, MappingReceiptSchema, IntakeItemPlanSchema,
  type MappingReceipt, type StreamedProfileGeneration, type StreamedMappingReceipt,
  type StreamingVectorRecord } from '@ulpin/contracts/usp';
import { fingerprint } from '../../cases/domain';
import { sha256 } from '../../../infrastructure/storage';
import { cellFileChunks, cellProfileContains } from './intake-cell-files';
import { carryCellLayoutTx, cellPlanTx, publishTx } from './intake-large-worker';
import { carriedApprovalTx, cellParentLayoutTx } from './service';
import { intakeLargeProjection } from './intake-large';
import { readStreamingFeatures, sourceRecord } from './streaming-vector-reader';
import { advanceStreamedInventory, emptyInventory } from './streamed-profile-inventory';
import { normalizeMappedChunk } from './chunk-mapping-normalizer';
import { inspectedProfile } from './registry';
import { ModelGateway } from '../../model-gateway/gateway';

process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'cell-layout-protocol';
const subject = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
const id = (n: number) => `36000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = 'a'.repeat(64), at = '2026-10-26T00:00:00.000Z';

async function inventory(bytes: Buffer, sourceId = id(1)) {
  const records: StreamingVectorRecord[] = [];
  await readStreamingFeatures(Readable.from([bytes]), 'feature-collection', async item => {
    records.push(sourceRecord(item));
  });
  const profile: StreamedProfileGeneration = { ...advanceStreamedInventory(emptyInventory(), records).inventory,
    version: 'streamed-profile/1', jobId: id(3), rawJobId: id(4),
    source: { sourceId, familyId: sourceId, sourceRevision: 1, sourceSha256: sha256(bytes), schemaFingerprint: hash },
    generation: 1, generationHash: hash, previousHash: hash, readerSha256: hash, profilerSha256: hash,
    coverage: 'sealed', unknownRemainder: false, rawChunkIndex: null, rawResultSha256: null,
    quarantineLocators: [], reference: { sourceCrs: 'EPSG:4326', unit: 'degree',
      evidence: 'Test-only retained declaration', globalPlacement: 'not_qualified' } };
  return { profile, records };
}

function store(profile: StreamedProfileGeneration, key: string, prefix = true) {
  const plan = { version: prefix ? 'streamed-prefix-mapping/1' : 'streamed-mapping/1',
    scope: prefix ? 'observed_prefix_and_later_compatible_features' : 'accepted_source_features',
    ...(prefix ? { prefix: { throughRawChunkIndex: 1, rawResultSha256: hash,
      recordsSeen: profile.recordsSeen, accepted: profile.accepted } } : {}),
    mode: 'streamed_mapping', source: profile.source, caseId: id(2), caseRevision: 0,
    rawJobId: profile.rawJobId, profileJobId: profile.jobId, profileGeneration: 1, profileHash: hash,
    kind: 'building', basis: 'officer_stated', semanticEvidence: [], operations: [
      { target: 'feature.sourceKey', sourcePath: key, conversionId: 'literal_identifier@1' },
      { target: 'feature.geometry', sourcePath: '/features/*/geometry', conversionId: 'geojson_geometry@1' }] };
  const parent = StreamedMappingReceiptSchema.parse({ id: id(5), revision: 2, state: 'approved', plan,
    planHash: fingerprint(plan), authoredBy: subject, authoredAt: at,
    approval: { subject, at, planHash: fingerprint(plan), provenance: 'server_configured_local_operator' } });
  const source = { id: id(1), case_id: id(2), revision: 1, sha256: profile.source.sourceSha256,
    inspection: {} as Record<string, unknown> };
  const lineage = { version: 'cell-derivative/1', parentSourceId: id(1), parentSourceRevision: 1,
    parentSha256: source.sha256, parentItemId: id(1), parentName: 'test-only.geojson',
    cellKey: 'utm-32618-e1-n1-l1-b1', rule: CELL_DERIVATIVE_RULE, features: 1,
    members: { key: `large-originals/${id(6)}/${hash}`, sha256: hash, bytes: 1,
      format: 'cell-feature-ranges-jsonl/1' } };
  const recipes = new Map<string, StreamedMappingReceipt | MappingReceipt>([[parent.id, parent]]);
  const operations = new Map<string, unknown>();
  const children = new Map<string, { inspection: { cellDerivative: typeof lineage } }>();
  function rows(sql: string, values: any[]): any[] {
    if (sql.startsWith('SELECT s.*,r.body')) {
      const body = recipes.get(parent.id)!;
      return source.id === values[0] && source.revision === values[1] && source.sha256 === values[2]
        && body.state === 'approved' ? [{ ...source, body }] : [];
    }
    if (sql.includes('FROM usp_streamed_profile_imports p')) return [{ body: profile }];
    if (sql.startsWith('SELECT inspection FROM sources'))
      return children.has(values[0]) ? [children.get(values[0])] : [];
    if (sql.startsWith('SELECT body FROM usp_mapping_recipes')) {
      const body = recipes.get(values[0]);
      return body && (!values[1] || body.plan.caseId === values[1]) && body.state === 'approved' ? [{ body }] : [];
    }
    if (sql.startsWith('SELECT 1 FROM usp_mapping_recipes'))
      return [...recipes.values()].filter(body => body.plan.source.sourceId === values[0]).map(() => ({}));
    if (sql.startsWith('SELECT result FROM operations')) {
      const result = operations.get(`${values[0]}:${values[1]}`);
      return result ? [{ result }] : [];
    }
    if (sql.startsWith('INSERT INTO usp_mapping_recipes')) {
      recipes.set(values[0], values[3]);
      return [];
    }
    if (sql.startsWith('UPDATE usp_mapping_recipes')) {
      recipes.set(values[0], values[3]);
      return [];
    }
    if (sql.startsWith('INSERT INTO operations')) {
      operations.set(`${values[0]}:${values[1]}`, values[3]);
      return [];
    }
    if (sql.startsWith('SELECT revision FROM cases')) return [{ revision: 0 }];
    if (sql.startsWith('UPDATE usp_outbox_streams')) return [{ sequence: '1' }];
    if (sql.startsWith('INSERT INTO usp_mapping_recipe_revisions') || sql.startsWith('INSERT INTO usp_outbox'))
      return [];
    throw new Error(`Unexpected cell carry SQL: ${sql}`);
  }
  const client = { query: async (sql: string, values: any[]) => {
    const result = rows(sql, values);
    return { rows: result, rowCount: result.length };
  } } as unknown as PoolClient;
  function child(n: number) {
    const input = { caseId: id(n + 1), sourceId: id(n), caseRevision: 0, subject };
    const src = { inspection: { cellDerivative: structuredClone(lineage) } };
    children.set(input.sourceId, src);
    const current = structuredClone(profile);
    current.source = { ...current.source, sourceId: input.sourceId, familyId: input.sourceId,
      sourceSha256: String(n).slice(0, 1).repeat(64) };
    current.jobId = id(n + 2);
    current.rawJobId = id(n + 3);
    return { input, src, current };
  }
  return { client, parent, recipes, source, child, operations };
}

const bytes = readFileSync('fixtures/real-area/original.geojson');
const key = '/features/*/properties/doitt_id';

test('a prefix answer with a key carries to two cell files, without a layout question or proposal call', async t => {
  const gateway = t.mock.method(ModelGateway.prototype, 'propose', async () => {
    throw new Error('A carried cell must not request another interpretation.');
  });
  const { profile, records } = await inventory(bytes);
  const fixture = store(profile, key);
  const before = fingerprint(fixture.parent);
  for (const n of [10, 20]) {
    const { input, src, current } = fixture.child(n);
    const ranges = records.filter((_, index) => index % 2 === n / 10 - 1);
    const chunks: Uint8Array[] = [];
    for await (const chunk of cellFileChunks({ key: src.inspection.cellDerivative.cellKey, ranges },
      { crs: JSON.parse(bytes.toString()).crs }, async (start, end) => bytes.subarray(start, end))) chunks.push(chunk);
    const derived = await inventory(Buffer.concat(chunks), input.sourceId);
    Object.assign(current, derived.profile, { jobId: current.jobId, rawJobId: current.rawJobId });
    assert.equal(await carryCellLayoutTx(fixture.client, input, src, current), true);
    const receipt = StreamedMappingReceiptSchema.parse([...fixture.recipes.values()]
      .find(body => body.plan.source.sourceId === input.sourceId));
    assert.equal(receipt.state, 'approved');
    assert.equal(receipt.revision, 2);
    assert.deepEqual(receipt.plan.operations, fixture.parent.plan.operations);
    assert.equal(receipt.approval!.at, fixture.parent.approval!.at);
    assert.equal(receipt.approval!.planHash, receipt.planHash);
    const state = { store: { recipe: receipt }, source: src };
    const planRef = await cellPlanTx(fixture.client, state);
    const listed = IntakeItemPlanSchema.parse(planRef);
    assert.equal(listed.origin, 'parent_file');
    assert.equal(listed.parentSourceId, profile.source.sourceId);
    assert.equal(IntakeItemPlanSchema.safeParse({ ...listed, parentSourceId: undefined }).success, false);
    assert.equal('layoutQuestion' in planRef!, false);
    const mapped = normalizeMappedChunk(derived.records, receipt.plan, current, current.jobId, 0, []);
    assert(mapped.records.every(record => record.disposition === 'observed'));
    assert.equal(await carryCellLayoutTx(fixture.client, input, src, current), false, 'No second proposal.');
  }
  assert.equal(fingerprint(fixture.recipes.get(fixture.parent.id)), before);
  assert.equal(sha256(bytes), profile.source.sourceSha256);
  assert.equal(fixture.operations.size, 2);
  assert.equal(gateway.mock.callCount(), 0);
});

test('a cell with a held parent press keeps reading its full profile without showing a prefix question', async () => {
  const { profile } = await inventory(bytes);
  const fixture = store(profile, key), { input, src } = fixture.child(10);
  let projection: Record<string, any> = { state: 'reading', placement: 'undecided', plan_ref: null,
    records_seen: 0, limit_reason: null };
  const query = fixture.client.query.bind(fixture.client);
  fixture.client.query = (async (sql: string, values: any[]) => {
    if (sql.startsWith('SELECT state,placement,plan_ref')) return { rows: [projection], rowCount: 1 };
    if (sql.startsWith('SELECT parts_planned,parts_done'))
      return { rows: [{ parts_planned: null, parts_done: 0 }], rowCount: 1 };
    if (sql.startsWith('UPDATE usp_intake_items SET parts_planned')) return { rows: [], rowCount: 0 };
    if (sql.startsWith('UPDATE usp_intake_items SET state=')) {
      projection = { state: values[2], placement: values[3], plan_ref: values[4],
        records_seen: values[5], limit_reason: values[6] };
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('SELECT item_id AS')) return { rows: [{ itemId: input.sourceId, state: projection.state,
      family: 'vector', format: 'geojson', sizeClass: 'S', wave: 1, pinnedByOfficer: false }], rowCount: 1 };
    return query(sql, values);
  }) as typeof fixture.client.query;
  const state: Parameters<typeof publishTx>[2] = { key: hash, retries: 0,
    source: { id: input.sourceId, revision: 1, bytes: bytes.length, sha256: hash,
      profile: 'large-original-v1', object_key: 'test-only-cell', inspection: src.inspection },
    item: { item_id: input.sourceId, case_id: input.caseId, state: 'reading', placement: 'undecided',
      card: null, plan_ref: null },
    store: { reader: { job_id: id(90), state: 'running', issue_code: null, next_publish_index: 1,
      records: 1, quarantined: 0, sealed_chunks: null, unknown_remainder: true },
    profile: { job_id: id(91), state: 'running', issue_code: null, sealed_generation: null,
      layout_profile: { generation: 0, generationHash: hash, coverage: 'provisional', recordsSeen: 1, accepted: 1 } },
    recipe: null, mapping: null, parts: 0, unreviewed: 0 } };
  await publishTx(fixture.client, { ...input, itemId: input.sourceId }, state);
  assert.equal(projection.state, 'reading');
  assert.equal(projection.placement, 'undecided');
  assert.equal(projection.plan_ref, null);
  src.inspection.cellDerivative.parentSourceRevision++;
  await publishTx(fixture.client, { ...input, itemId: input.sourceId }, state);
  assert.equal(projection.placement, 'needs_answer');
  state.source.inspection = {};
  state.store.prefixCheck = 'changed';
  state.store.recipe = { id: fixture.parent.id, revision: 2, state: 'approved',
    plan_version: 'streamed-prefix-mapping/1' };
  await publishTx(fixture.client, { ...input, itemId: input.sourceId }, state);
  assert.equal(projection.placement, 'needs_answer');
  assert.equal(Object.hasOwn(projection.plan_ref ?? {}, 'recipeId'), false,
    'The parent keeps its complete-profile question.');
});

test('a cell with fewer geometry types and null-only HGTSOURCE carries with origin parent_file', async () => {
  // Profile-only control for the reported Halifax run 6 shape; no source features are changed.
  const { profile } = await inventory(bytes);
  profile.geometryTypes = ['MultiPolygon', 'Polygon'];
  const path = '/features/*/properties/HGTSOURCE';
  profile.paths.push({ ...profile.paths[0], path, types: ['string'] });
  for (const prefix of [true, false]) {
    const fixture = store(profile, key, prefix), { input, src, current } = fixture.child(10);
    const before = fingerprint(fixture.parent);
    current.geometryTypes = ['Polygon'];
    current.paths.find(item => item.path === path)!.types = [];
    assert(cellProfileContains(current, profile));
    assert.equal(await carryCellLayoutTx(fixture.client, input, src, current), true);
    const receipt = StreamedMappingReceiptSchema.parse([...fixture.recipes.values()]
      .find(body => body.plan.source.sourceId === input.sourceId));
    assert.equal(receipt.state, 'approved');
    assert.deepEqual(receipt.plan.operations, fixture.parent.plan.operations);
    const plan = IntakeItemPlanSchema.parse(await cellPlanTx(fixture.client,
      { store: { recipe: receipt }, source: src }));
    assert.equal(plan.origin, 'parent_file');
    assert.equal(plan.parentSourceId, profile.source.sourceId);
    assert.equal(fingerprint(fixture.recipes.get(fixture.parent.id)), before);
  }
});

test('a child path with a nonempty subset of its parent types carries', async () => {
  const { profile } = await inventory(bytes);
  const path = profile.paths.find(item => item.path.endsWith('/height_roof'))!;
  path.types = ['number', 'string'];
  const fixture = store(profile, key), { input, src, current } = fixture.child(10);
  current.paths.find(item => item.path === path.path)!.types = ['number'];
  assert.equal(await carryCellLayoutTx(fixture.client, input, src, current), true);
});

test('a wrong parent pin, new path or type, CRS, unit or geometry still asks', async t => {
  const { profile } = await inventory(bytes);
  for (const change of ['source', 'revision', 'hash', 'column', 'empty_column', 'type', 'crs', 'unit',
    'geometry', 'no_lineage']) await t.test(change, async () => {
    const fixture = store(profile, key), { input, src, current } = fixture.child(10);
    if (change === 'source') src.inspection.cellDerivative.parentSourceId = id(99);
    if (change === 'revision') src.inspection.cellDerivative.parentSourceRevision++;
    if (change === 'hash') src.inspection.cellDerivative.parentSha256 = 'b'.repeat(64);
    if (change === 'column' || change === 'empty_column') current.paths.push({ ...current.paths[0],
      path: '/features/*/properties/extra', types: change === 'empty_column' ? [] : ['string'] });
    if (change === 'type') current.paths.find(path => path.path.endsWith('/height_roof'))!.types.push('boolean');
    if (change === 'crs') current.reference.sourceCrs = 'EPSG:3857';
    if (change === 'unit') current.reference.unit = 'metre';
    if (change === 'geometry') current.geometryTypes.push('Point');
    if (change === 'no_lineage') src.inspection = {} as typeof src.inspection;
    assert.equal(await carryCellLayoutTx(fixture.client, input, src, current), false, change);
    assert.equal(fixture.recipes.size, 1);
    const projection = intakeLargeProjection('question', { reader: null, profile: null, mapping: null,
      recipeState: null, receiptVerified: true, publishedPackages: 0, foldComplete: false },
    { reader: null, profile: null, recipe: null, mapping: null, parts: 0, unreviewed: 0 },
    { bytes: bytes.length, crsWords: null });
    assert.equal(projection.placement, 'needs_answer');
    assert.match(projection.limitReason!, /An officer states/);
  });
});

test('a withdrawn or replaced press and changed lineage refuse with the existing RECIPE_APPROVAL words', async () => {
  const { profile } = await inventory(bytes);
  for (const change of ['withdrawn', 'replaced', 'superseded', 'lineage']) {
    const fixture = store(profile, key, false), { input, src, current } = fixture.child(10);
    assert.equal(await carryCellLayoutTx(fixture.client, input, src, current), true);
    const receipt = StreamedMappingReceiptSchema.parse([...fixture.recipes.values()]
      .find(body => body.plan.source.sourceId === input.sourceId));
    if (change === 'withdrawn') fixture.recipes.set(fixture.parent.id,
      { ...fixture.parent, revision: 3, state: 'proposed', approval: null });
    if (change === 'replaced') fixture.recipes.set(fixture.parent.id, { ...fixture.parent,
      approval: { ...fixture.parent.approval!, at: '2026-10-27T00:00:00.000Z' } });
    if (change === 'superseded') fixture.source.revision++;
    if (change === 'lineage') src.inspection.cellDerivative.parentSourceRevision++;
    await assert.rejects(carriedApprovalTx(fixture.client, receipt), { code: 'RECIPE_APPROVAL', message:
      'The layout approval this file was drafted with is no longer current; approve this file\'s layout.' });
  }
});

test('a parent path missing from its child carries, never an unrelated file or another operator', async () => {
  const { profile } = await inventory(bytes);
  const fixture = store(profile, key), { input, src, current } = fixture.child(10);
  current.paths = current.paths.filter(path => !path.path.endsWith('/height_roof'));
  assert(cellProfileContains(current, profile));
  assert.equal(await carryCellLayoutTx(fixture.client, input, src, current), true);
  assert.equal(await cellParentLayoutTx(fixture.client, src, 'another-operator', current), null);
  const difficult = await inventory(readFileSync('fixtures/google-uttam/00-all-google-detections.geojson'));
  assert.equal(cellProfileContains(difficult.profile, profile), false);
});

test('a manual receipt supplies the same layout to its own streamed cell, not an unrelated original', async () => {
  const { profile } = await inventory(bytes);
  const fixture = store(profile, key), { input, src, current } = fixture.child(10);
  const manualProfile = inspectedProfile(bytes, { format: 'geojson', sourceSha256: sha256(bytes),
    featureCount: profile.accepted, sourceCrs: 'EPSG:4326', crsEvidence: 'Test-only declaration',
    geometryTypes: profile.geometryTypes,
    fields: Object.keys(JSON.parse(bytes.toString()).features[0].properties).map(name => ({ name })),
  } as GisInspection);
  const plan = { version: 'manual-geojson/1', mode: 'manual_mapping',
    source: { ...profile.source, schemaFingerprint: manualProfile.schemaFingerprint },
    caseId: id(2), workspaceRevision: 0, workspaceFingerprint: hash,
    kind: 'building', operations: fixture.parent.plan.operations };
  const destination = { kind: 'new_area', name: 'Test-only layout', namespace: 'test-only-layout' };
  const planHash = fingerprint({ plan, destination });
  const parent = MappingReceiptSchema.parse({ ...fixture.parent, plan, destination, planHash, execution: null,
    approval: { ...fixture.parent.approval, planHash } });
  fixture.recipes.set(parent.id, parent);
  fixture.source.inspection.manualProfile = manualProfile;
  assert.equal(await carryCellLayoutTx(fixture.client, input, src, current), true);
  const receipt = StreamedMappingReceiptSchema.parse([...fixture.recipes.values()]
    .find(body => body.plan.source.sourceId === input.sourceId));
  assert.deepEqual(receipt.plan.operations, parent.plan.operations);
  assert.equal((await carriedApprovalTx(fixture.client, receipt))?.sourceId, parent.plan.source.sourceId);
});
