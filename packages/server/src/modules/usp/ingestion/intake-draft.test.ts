import assert from 'node:assert/strict';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { SourceProfileSchema, AdaptiveMappingResponseSchema, type MappingReceipt } from '@ulpin/contracts/usp';
import { ingestionBinding } from './events';
import { intakeSourcePin, type IntakeSourceRow } from './intake-context';
import { IntakeDraftInputSchema, intakeDraftKey, intakeDraftLimit, queueIntakeDraftTx,
  assertIntakeDraftTx, type DraftItem } from './intake-draft';
import { alreadyInArea, intakeDestination, officerQuestion, proposeIntakeLayout,
  lookupIntakeMemory } from './intake-draft-worker';
import type { MapArea } from '@ulpin/contracts';
import { AppError } from '../../../infrastructure/errors';
import { registerUspJobInputTx } from '../jobs';
import { fingerprint } from '../../cases/domain';
import { IntakePageImageInputSchema, labelPageImageTx, settlePageImageTx } from './intake-page-image';

process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'ca0-protocol-operator';
const caseId = '10000000-0000-4000-8000-000000000001';
const sourceId = '10000000-0000-4000-8000-000000000002';
const binding = ingestionBinding(caseId);
const hash = 'a'.repeat(64);
const profile = SourceProfileSchema.parse({ version: 'manual-geojson/1',
  source: { sourceId, familyId: sourceId, sourceRevision: 1, sourceSha256: hash, schemaFingerprint: hash },
  caseId, workspaceRevision: 0, workspaceFingerprint: hash, format: 'geojson', featureCount: 1,
  crs: { value: 'EPSG:4326', evidence: 'Protocol fixture', unit: 'degree' }, geometryTypes: ['Polygon'],
  paths: [
    { path: '/features/*/properties/id', types: ['string'], values: 1, explicitNull: 0, absent: 0,
      literalIdEligible: true, literalTextEligible: true },
    { path: '/features/*/geometry', types: ['object'], values: 1, explicitNull: 0, absent: 0,
      literalIdEligible: false, literalTextEligible: false },
  ], limitations: [],
});
const operations = [
  { target: 'building.sourceKey', sourcePath: '/features/*/properties/id', conversionId: 'literal_identifier@1' },
  { target: 'building.geometry', sourcePath: '/features/*/geometry', conversionId: 'geojson_polygon@1' },
] as const;
const plan = { version: profile.version, mode: 'manual_mapping' as const, source: profile.source, caseId,
  workspaceRevision: 0, workspaceFingerprint: hash, operations: [...operations] };
const remembered: MappingReceipt = { id: caseId, revision: 3, state: 'executed', plan,
  destination: { kind: 'new_area', name: 'Protocol control', namespace: 'Protocol control' }, planHash: hash,
  authoredBy: binding.subject, authoredAt: '2026-01-01T00:00:00.000Z',
  approval: { subject: binding.subject, at: '2026-01-01T00:00:00.000Z', planHash: hash,
    provenance: 'server_configured_local_operator' },
  execution: { packageId: caseId, sourceRevisionId: sourceId, subject: binding.subject,
    at: '2026-01-01T00:00:00.000Z' },
};

function source(): IntakeSourceRow {
  return { id: sourceId, case_id: caseId, family_id: sourceId, revision: 1, name: 'Protocol control',
    profile: 'geojson-manual-v1', bytes: 100, sha256: hash, object_key: 'protocol-control', status: 'needs_input',
    inspection: { actor: binding.subject, manualProfile: profile } };
}
function item(): DraftItem {
  return { item_id: sourceId, source_id: sourceId, case_id: caseId, parent_item_id: null,
    state: 'probed', placement: 'undecided', family: 'vector', plan_ref: null,
    card: { crs: { state: 'stated' } } as DraftItem['card'] };
}
function input() {
  return IntakeDraftInputSchema.parse({ version: 'intake-draft/1', jobId: intakeDraftKey(sourceId, 0, 'job'),
    caseId, itemId: sourceId, caseRevision: 0, sourceId, sourceRevision: 1, sourceSha256: hash,
    sourcePin: intakeSourcePin(source(), binding), recipeRevision: 0,
    subject: binding.subject, accessSha256: binding.access });
}
type Protocol = {
  src: IntakeSourceRow;
  tray: DraftItem;
  jobs: any[];
  state: { recipeRevision: number; events: number; projection: Record<string, any> };
};
function protocolRead(sql: string, values: any[], fixture: Protocol): any[] | null {
  const { src, tray, jobs, state } = fixture;
  if (sql.startsWith('SELECT * FROM usp_intake_items')) return [tray];
  if (sql.startsWith('SELECT id,revision,archived FROM cases')) return [{ id: caseId, revision: 0, archived: false }];
  if (sql.startsWith('SELECT * FROM sources')) return [src];
  if (sql.startsWith('SELECT max(revision)')) return [{ revision: src.revision }];
  if (sql.startsWith('SELECT revision FROM usp_mapping_recipes'))
    return state.recipeRevision ? [{ revision: state.recipeRevision }] : [];
  if (sql.startsWith('SELECT * FROM usp_job_metadata') || sql.startsWith('SELECT pg_advisory')) return [];
  if (sql.startsWith('SELECT state,placement,plan_ref')) return [state.projection];
  if (sql.startsWith('SELECT item_id AS')) return [{ itemId: sourceId, state: tray.state,
    family: 'vector', format: 'geojson', sizeClass: 'S', wave: 1, pinnedByOfficer: false }];
  if (sql.startsWith('SELECT revision FROM cases')) return [{ revision: 0 }];
  if (sql.startsWith('SELECT status FROM jobs WHERE source_id')) return jobs;
  if (sql.includes('FROM jobs') && sql.includes('status IN'))
    return jobs.filter(job => ['queued', 'running'].includes(job.status));
  if (sql.startsWith('SELECT id,status FROM jobs WHERE source_id'))
    return jobs.filter(job => job.operation === 'intake-native-derivative');
  if (sql.startsWith('SELECT id,payload FROM jobs') || sql.startsWith('SELECT * FROM jobs'))
    return jobs.filter(row => row.id === values[0]);
  return null;
}
function protocolWrite(sql: string, values: any[], fixture: Protocol): any[] | null {
  const { tray, jobs, state } = fixture;
  if (sql.startsWith('INSERT INTO jobs')) {
    jobs.push({ id: values[0], status: 'queued', case_id: values[1], source_id: values[2],
      operation: /VALUES\(\$1,\$2,\$3,'([a-z-]+)'/.exec(sql)![1],
      case_revision: values[3], input_fingerprint: values[4], payload: values[5] });
    return [];
  }
  if (sql.startsWith('UPDATE usp_intake_items SET state=')) {
    state.projection = { state: values[2], placement: values[3], plan_ref: values[4],
      records_seen: values[5], limit_reason: values[6] };
    tray.state = values[2];
    tray.placement = values[3];
    return [];
  }
  if (sql.startsWith('UPDATE usp_outbox_streams')) return [{ sequence: '1' }];
  if (sql.startsWith('INSERT INTO usp_outbox(')) {
    state.events++;
    return [];
  }
  if (sql.startsWith('INSERT INTO usp_outbox_streams') || sql.startsWith('INSERT INTO usp_job_metadata')) return [];
  return null;
}
function protocol() {
  const fixture: Protocol = { src: source(), tray: item(), jobs: [], state: { recipeRevision: 0, events: 0,
    projection: { state: 'probed', placement: 'undecided', plan_ref: null, records_seen: 0, limit_reason: null } } };
  const statements: string[] = [];
  const client = { query: async (sql: string, values: any[]) => {
    statements.push(sql);
    const rows = protocolRead(sql, values, fixture) ?? protocolWrite(sql, values, fixture);
    if (!rows) throw new Error(`Unexpected protocol SQL: ${sql}`);
    return { rows, rowCount: rows.length };
  } } as unknown as PoolClient;
  return { client, statements, ...fixture };
}

test('deterministic keys replay and distinguish proposal, approval revision and execution', () => {
  assert.equal(intakeDraftKey(sourceId, 2, 'execute'), intakeDraftKey(sourceId, 2, 'execute'));
  assert.notEqual(intakeDraftKey(sourceId, 0, 'job'), intakeDraftKey(sourceId, 2, 'job'));
  assert.notEqual(intakeDraftKey(sourceId, 2, 'job'), intakeDraftKey(sourceId, 2, 'execute'));
});
test('repeated enqueue enrolls one existing job authority input', async () => {
  const fixture = protocol();
  const first = await queueIntakeDraftTx(fixture.client, fixture.src);
  assert.equal(await queueIntakeDraftTx(fixture.client, fixture.src), first);
  assert.equal(fixture.jobs.length, 1);
  assert.equal(fixture.statements.filter(sql => sql.startsWith('INSERT INTO usp_job_metadata')).length, 1);
});
test('approval during an active proposal retains one job, then its next revision can enroll', async () => {
  const fixture = protocol();
  const first = await queueIntakeDraftTx(fixture.client, fixture.src);
  fixture.state.recipeRevision = 2;
  assert.equal(await queueIntakeDraftTx(fixture.client, fixture.src), first);
  assert.equal(fixture.jobs.length, 1);
  fixture.jobs[0].status = 'succeeded';
  assert.notEqual(await queueIntakeDraftTx(fixture.client, fixture.src), first);
  assert.equal(fixture.jobs.length, 2);
});
test('unsupported large vector writes one limit reason/event and never enrolls another reader', async () => {
  const fixture = protocol();
  fixture.src.profile = 'large-original-v1';
  fixture.src.bytes = 16777217;
  const card = { ...fixture.tray.card, family: 'vector' } as NonNullable<DraftItem['card']>;
  assert.equal(await queueIntakeDraftTx(fixture.client, fixture.src, card), null);
  assert.equal(fixture.state.projection.placement, 'needs_answer');
  assert.match(fixture.state.projection.limit_reason, /16777216.*16777217/);
  assert.equal(fixture.state.events, 1);
  await queueIntakeDraftTx(fixture.client, fixture.src, card);
  assert.equal(fixture.state.events, 1);
  assert.equal(fixture.jobs.length, 0);
});
test('a repeated probe leaves a proposed recipe waiting, without enrolling another job', async () => {
  const fixture = protocol();
  fixture.tray.state = 'planned';
  fixture.tray.plan_ref = { recipeId: caseId, recipeRevision: 1, recipeState: 'proposed', origin: 'memory' };
  const card = { ...fixture.tray.card, family: 'vector' } as NonNullable<DraftItem['card']>;
  assert.equal(await queueIntakeDraftTx(fixture.client, fixture.src, card), null);
  assert.equal(fixture.tray.state, 'planned');
  assert.equal(fixture.tray.plan_ref.recipeState, 'proposed');
  assert.equal(fixture.jobs.length, 0);
});
test('unregistered and child items do not enqueue', async () => {
  const fixture = protocol();
  fixture.tray.parent_item_id = caseId;
  assert.equal(await queueIntakeDraftTx(fixture.client, fixture.src), null);
  assert.equal(fixture.jobs.length, 0);
});
test('read items and other formats do not enqueue', async () => {
  const fixture = protocol();
  fixture.tray.state = 'read';
  assert.equal(await queueIntakeDraftTx(fixture.client, fixture.src), null);
  fixture.src.profile = 'large-original-v1';
  assert.equal(await queueIntakeDraftTx(fixture.client, fixture.src), null);
  assert.equal(fixture.jobs.length, 0);
});
for (const [name, modify] of [
  ['bytes', (src: IntakeSourceRow) => { src.bytes = 16777217; }],
  ['features', (src: IntakeSourceRow) => { src.inspection!.manualProfile.featureCount = 2001; }],
  ['unknown count', (src: IntakeSourceRow) => { delete src.inspection!.manualProfile.featureCount; }],
  ['large original', (src: IntakeSourceRow) => { src.profile = 'large-original-v1'; }],
] as const) {
  test(`draft scope refuses ${name} without another reader`, () => {
    const src = structuredClone(source());
    modify(src);
    assert(intakeDraftLimit(item(), src));
  });
}
// SH2: a GeoPackage, or a ZIP its card names a shapefile set in, is converted by its own job, at any size.
for (const [name, format, card] of [
  ['GeoPackage', 'GeoPackage', { format: 'geopackage', family: 'vector', crs: { state: 'stated' } }],
  ['shapefile ZIP', 'shapefile ZIP', { format: 'zip', family: 'archive', members: [{ format: 'shapefile' }] }],
] as const) {
  test(`a ${name} queues one conversion job and says its layers are being converted`, async () => {
    const fixture = protocol();
    fixture.src.profile = 'large-original-v1';
    fixture.src.bytes = 40 * 1024 * 1024;
    fixture.src.inspection = {};
    fixture.tray.family = card.family;
    fixture.tray.card = card as unknown as DraftItem['card'];
    const jobId = await queueIntakeDraftTx(fixture.client, fixture.src, fixture.tray.card!);
    assert.deepEqual(fixture.jobs.map(job => [job.id, job.operation, job.payload.version]),
      [[jobId, 'intake-native-derivative', 'intake-native-derivative/1']]);
    assert.deepEqual(fixture.state.projection, { state: 'reading', placement: 'undecided', plan_ref: null,
      records_seen: 0, limit_reason: `The layers of this ${format} are being converted to GeoJSON, each to be `
        + 'taken in as its own file.' });
    assert.equal(await queueIntakeDraftTx(fixture.client, fixture.src, fixture.tray.card!), jobId);
    fixture.jobs[0].status = 'completed';
    assert.equal(await queueIntakeDraftTx(fixture.client, fixture.src, fixture.tray.card!), null);
    fixture.jobs[0].status = 'failed';
    const again = await queueIntakeDraftTx(fixture.client, fixture.src, fixture.tray.card!);
    assert.equal(fixture.jobs.length, 2);
    assert.notEqual(again, jobId, 'A failed conversion is queued again under a new id.');
  });
}

function zipFixture(members: { name: string; format: string; refusalCode?: string }[]) {
  const fixture = protocol();
  fixture.src.profile = 'zip-manual-v1';
  fixture.src.inspection = {};
  fixture.tray.family = 'archive';
  fixture.tray.card = { format: 'zip', family: 'archive', crs: { state: 'not_applicable' },
    members: members.map(member => ({ refusalCode: null, ...member })) } as DraftItem['card'];
  return fixture;
}

test('a ZIP of map layers settles its own item with words naming each layer and what was not taken in', async () => {
  const fixture = zipFixture([{ name: 'layers/', format: 'unknown' },
    { name: 'layers/roads.geojson', format: 'geojson' }, { name: 'layers/blocks.geojson', format: 'geojson' },
    { name: 'register.csv', format: 'csv' }, { name: 'README.md', format: 'unknown' }]);
  const expected = '2 map layers in this ZIP are taken in as their own files: layers/roads.geojson, '
    + 'layers/blocks.geojson. Not taken in: register.csv (not a map layer), README.md (not a map layer).';
  assert.equal(intakeDraftLimit(fixture.tray, fixture.src), expected);
  assert.equal(await queueIntakeDraftTx(fixture.client, fixture.src, fixture.tray.card!), null);
  assert.deepEqual(fixture.state.projection, { state: 'read', placement: 'undecided', plan_ref: null,
    records_seen: 0, limit_reason: expected });
  assert.equal(fixture.state.events, 1);
  await queueIntakeDraftTx(fixture.client, fixture.src, fixture.tray.card!);
  assert.equal(fixture.state.events, 1, 'A settled ZIP item is not written again.');
  assert.equal(fixture.jobs.length, 0);
});

test('a ZIP with no map layer says so and lists its members with their reasons, long lists counted', async () => {
  const fixture = zipFixture([{ name: 'plan.pdf', format: 'pdf' },
    { name: 'roads.geojson', format: 'geojson', refusalCode: 'ZIP_ENCRYPTED_MEMBER' }]);
  const expected = 'This ZIP holds no map layer this batch can take in. '
    + 'Its members: plan.pdf (not a map layer), roads.geojson (ZIP_ENCRYPTED_MEMBER).';
  await queueIntakeDraftTx(fixture.client, fixture.src, fixture.tray.card!);
  assert.equal(fixture.state.projection.limit_reason, expected);
  assert.notEqual(fixture.state.projection.placement, 'needs_answer');
  const many = zipFixture(Array.from({ length: 300 }, (_, at) => ({ name: `sheets/page-${at}.pdf`, format: 'pdf' })));
  const words = intakeDraftLimit(many.tray, many.src)!;
  assert.match(words, /^This ZIP holds no map layer.*sheets\/page-0\.pdf \(not a map layer\).* and \d+ more\.$/);
  assert(words.length <= 2000);
});

test('a KML refusal distinguishes its native inspection route from an unbuilt map-package adapter', async () => {
  const fixture = protocol();
  fixture.src.profile = 'kml-native-v1';
  fixture.src.inspection = {};
  fixture.tray.card = { format: 'kml', family: 'vector', crs: { state: 'absent' } } as DraftItem['card'];
  const expected = 'This KML/KMZ has a native-inspection route at POST /api/v1/ingestion/cases/:caseId/kml '
    + 'within 16 MiB; no area-import adapter or intake recipe drafts its map package or card.';
  assert.equal(intakeDraftLimit(fixture.tray, fixture.src), expected);
  await queueIntakeDraftTx(fixture.client, fixture.src, fixture.tray.card!);
  assert.equal(fixture.state.projection.limit_reason, expected);
  assert.equal(fixture.state.projection.placement, 'needs_answer');
  assert.equal(fixture.jobs.length, 0);
});

test('oversized GeoJSON names retention only and does not promise a larger direct import', async () => {
  const fixture = protocol();
  fixture.src.profile = 'large-original-v1';
  fixture.src.bytes = 16777217;
  fixture.src.inspection = {};
  fixture.tray.card = { format: 'geojson', family: 'vector', crs: { state: 'absent' } } as DraftItem['card'];
  const expected = 'This GeoJSON original has 16777217 bytes, above the 16777216-byte intake drafting '
    + 'and POST /api/v1/import-packages bound; /api/v1/ingestion/cases/:caseId/uploads can retain it, '
    + 'but no package or card is drafted from this oversized original.';
  assert.equal(intakeDraftLimit(fixture.tray, fixture.src), expected);
  // Within the reader's ceiling the file goes to its own chain of large-file steps instead of this sentence.
  const handed: string[] = [];
  const query = fixture.client.query.bind(fixture.client);
  fixture.client.query = (async (sql: string, values: any[]) => {
    if (!sql.startsWith('SELECT item_id,case_id,state,placement')) return query(sql, values);
    handed.push(sql);
    return { rows: [], rowCount: 0 };
  }) as typeof fixture.client.query;
  assert.equal(await queueIntakeDraftTx(fixture.client, fixture.src, fixture.tray.card!), null);
  assert.equal(handed.length, 1);
  assert.equal(fixture.state.projection.limit_reason, null);
  assert.equal(fixture.jobs.length, 0);
});

const kept = ' No reader in a batch takes this kind of file yet, so it is not on the map; '
  + 'the original is kept with its SHA-256.';
for (const [format, family, bytes, expected] of [
  ['pdf', 'document', 3355443, `Kept as a PDF document (3.2 MB).${kept}`],
  ['tiff', 'raster', 512, `Kept as a TIFF raster (512 bytes).${kept}`],
  ['laz', 'point_cloud', 7516192768, `Kept as a LAZ point cloud (7 GB).${kept}`],
  ['ifc', 'model3d', 421888, `Kept as an IFC 3D model (412 KB).${kept}`],
  ['unknown', 'unknown', 421888, 'Kept (412 KB); its kind was not recognised from its first and last bytes.'],
] as const) {
  test(`a probed ${format} no batch reader takes rests not understood in words naming what the probe saw`,
    async () => {
      const fixture = protocol();
      fixture.src.profile = 'large-original-v1';
      fixture.src.bytes = bytes;
      fixture.src.inspection = {};
      fixture.tray.family = family;
      fixture.tray.card = { format, family, crs: { state: 'not_applicable' } } as DraftItem['card'];
      assert.equal(await queueIntakeDraftTx(fixture.client, fixture.src, fixture.tray.card!), null);
      assert.deepEqual({ ...fixture.state.projection }, { state: 'probed', placement: 'not_understood', plan_ref: null,
        records_seen: 0, limit_reason: expected });
      assert.equal(fixture.state.events, 1);
      await queueIntakeDraftTx(fixture.client, fixture.src, fixture.tray.card!);
      assert.equal(fixture.state.events, 1, 'An unchanged kept item is not written again.');
      // A new probe clears the words of an unasked item; the next settlement writes the same words once.
      fixture.state.projection.limit_reason = null;
      await queueIntakeDraftTx(fixture.client, fixture.src, fixture.tray.card!);
      assert.equal(fixture.state.projection.limit_reason, expected);
      assert.equal(fixture.state.events, 2);
      assert.equal(fixture.jobs.length, 0);
    });
}

test('a kept item a later reader placed, and a table outside a large original, are left as they are', async () => {
  const placed = protocol();
  placed.tray.family = 'document';
  placed.tray.placement = 'attached';
  placed.tray.card = { format: 'pdf', family: 'document' } as DraftItem['card'];
  await queueIntakeDraftTx(placed.client, placed.src, placed.tray.card!);
  const table = protocol();
  table.src.profile = 'document-original-v1';
  table.tray.family = 'table';
  table.tray.card = { format: 'csv', family: 'table' } as DraftItem['card'];
  await queueIntakeDraftTx(table.client, table.src, table.tray.card!);
  for (const fixture of [placed, table]) {
    assert.equal(fixture.state.projection.placement, 'undecided');
    assert.equal(fixture.state.events, 0);
  }
});

test('draft scope refuses a missing or conflicting CRS', () => {
  const tray = item();
  tray.card = null;
  assert.match(intakeDraftLimit(tray, source())!, /nonconflicting/);
});
test('changed source hash fails stale before any publication or recipe mutation', async () => {
  const fixture = protocol();
  const pin = input();
  fixture.src.sha256 = 'b'.repeat(64);
  await assert.rejects(assertIntakeDraftTx(fixture.client, pin), { code: 'STALE_REVISION' });
  assert(fixture.statements.every(sql => sql.startsWith('SELECT')));
});
test('registration refuses a wrong source manifest using the operation-specific scope code', async () => {
  const fixture = protocol();
  await queueIntakeDraftTx(fixture.client, fixture.src);
  await assert.rejects(registerUspJobInputTx(fixture.client, fixture.jobs[0].id,
    { kind: 'intake', workspaceId: caseId, version: 1 }, caseId, fingerprint(fixture.jobs[0].payload)),
  { code: 'INTAKE_DRAFT_INPUT_SCOPE', status: 422 });
});
test('remembered operations are repinned to the new source and carry no approval', async () => {
  const next = structuredClone(profile);
  next.source.sourceId = caseId;
  next.source.sourceSha256 = 'b'.repeat(64);
  const proposal = await proposeIntakeLayout(next, remembered, caseId, async () => {
    throw new Error('Teacher must not be called for an exact approved layout.');
  });
  assert.equal(proposal?.origin, 'memory');
  assert.deepEqual(proposal?.plan.source, next.source);
  assert(!('approval' in proposal!.plan));
  assert.equal(remembered.plan.source.sourceId, sourceId);
});
test('layout memory retains the approved height field, unit and meaning without transferring approval', async () => {
  const next = structuredClone(profile);
  next.paths.push({ path: '/features/*/properties/height_ft', types: ['number'], values: 1,
    explicitNull: 0, absent: 0, literalIdEligible: false, literalTextEligible: false });
  const height = { heightField: 'height_ft', heightUnit: 'ft' as const, heightMeaning: 'Fixture height above ground' };
  const saved = { ...remembered, plan: { ...remembered.plan, ...height } };
  const proposal = await proposeIntakeLayout(next, saved, caseId, async () => {
    throw new Error('An approved matching layout must not request a teacher.');
  });
  assert.equal(proposal?.plan.heightField, height.heightField);
  assert.equal(proposal?.plan.heightUnit, height.heightUnit);
  assert.equal(proposal?.plan.heightMeaning, height.heightMeaning);
  assert(!('approval' in proposal!.plan));
});
test('layout memory keeps the officer stated kind, with generic targets and no prior approval', async () => {
  const next = { ...profile, geometryTypes: ['LineString'] };
  const saved = { ...remembered, plan: { ...remembered.plan, kind: 'road' as const, operations: [
    { target: 'feature.sourceKey' as const, sourcePath: '/features/*/properties/id',
      conversionId: 'literal_identifier@1' as const },
    { target: 'feature.geometry' as const, sourcePath: '/features/*/geometry',
      conversionId: 'geojson_geometry@1' as const },
  ] } };
  const proposal = await proposeIntakeLayout(next, saved, caseId, async () => {
    throw new Error('Matching approved memory must not ask a teacher.');
  });
  assert.equal(proposal?.plan.kind, 'road');
  assert.deepEqual(proposal?.plan.operations, saved.plan.operations);
  assert(!('approval' in proposal!.plan));
});
test('unapproved and different-schema memory falls back only to the permitted existing proposer', async () => {
  let calls = 0;
  const teacher = async () => {
    calls++;
    return AdaptiveMappingResponseSchema.parse({ version: 'adaptive-geojson-proposal/1', requestKey: caseId,
      source: profile.source, workspaceRevision: 0, workspaceFingerprint: hash,
      status: 'disabled', code: 'MODEL_DISABLED',
      plan: null, validationErrors: [], call: null, validation: 'mechanics_only', reviewRequired: true });
  };
  assert.equal(await proposeIntakeLayout(profile, { ...remembered, state: 'proposed', approval: null }, caseId,
    teacher), null);
  assert.equal(calls, 1);
  const different = structuredClone(remembered);
  different.plan.source.schemaFingerprint = 'b'.repeat(64);
  assert.equal(await proposeIntakeLayout(profile, different, caseId, teacher), null);
  assert.equal(calls, 2);
});

test('a bound batch proposes its site area; an unbound batch proposes a new area', () => {
  const gis = { suggestedTitle: 'Hydrography', suggestedNamespace: 'hydrography' };
  assert.deepEqual(intakeDestination(gis, null), { kind: 'new_area', name: 'Hydrography', namespace: 'hydrography' });
  const reference = { analysisCrs: 'EPSG:32618', origin: [583000, 4507000] };
  const area = { id: caseId, siteId: sourceId, name: 'Buildings', revision: 2, reference, extent: null,
    geographicExtent: null, administrativeUnits: [] } as unknown as MapArea;
  assert.deepEqual(intakeDestination(gis, area), { kind: 'existing_area', areaId: caseId, expectedAreaRevision: 2,
    referenceFingerprint: fingerprint(reference), name: 'Hydrography', namespace: 'hydrography' });
});

test('an area the normalizer refuses becomes the officer question in its words; outages do not', () => {
  const refused = 'Features exceed 50 km from the retained area origin; select the matching map area.';
  assert.equal(officerQuestion(new AppError(422, 'AREA_PROCESSING', refused)), refused);
  const uncovered = 'The selected analysis CRS does not cover this area; use its appropriate UTM zone and hemisphere.';
  assert.equal(officerQuestion(new AppError(422, 'AREA_PROCESSING', uncovered)), uncovered);
  assert.equal(officerQuestion(new AppError(403, 'AREA_SOURCE_DENIED', 'other')),
    "Use an area of this batch's site or place the file in a separate intake batch.");
  assert.equal(officerQuestion(new AppError(503, 'AREA_PROCESSING', 'unavailable')), null);
  assert.equal(officerQuestion(new Error('timeout')), null);
});

test('a file whose bytes already made an area rests read with the refusal; the other refusals stay questions', () => {
  const words = 'This file is already the source of the area “buildings original”. '
    + 'Open that area; nothing new is prepared from a second copy.';
  const areaId = '10000000-0000-4000-8000-000000000009';
  const refusal = new AppError(409, 'SOURCE_ALREADY_IN_AREA', words, { areaId });
  assert.equal(officerQuestion(refusal), null);
  assert.deepEqual(alreadyInArea(refusal),
    { state: 'read', placement: 'undecided', planRef: { existingAreaId: areaId }, limitReason: words });
  assert.equal(alreadyInArea(new AppError(409, 'SOURCE_ALREADY_IN_AREA', words))?.planRef, null);
  for (const other of [new AppError(403, 'AREA_SOURCE_DENIED', 'other'), new AppError(422, 'AREA_PROCESSING', words)]) {
    assert.equal(alreadyInArea(other), null);
    assert.notEqual(officerQuestion(other), null);
  }
});

function storedInventory() {
  const { source, caseId: _case, workspaceRevision: _revision, workspaceFingerprint: _workspace, ...fields } = profile;
  return { ...fields, schemaFingerprint: source.schemaFingerprint };
}
function broaderProfile() {
  const next = structuredClone(profile);
  next.source.schemaFingerprint = 'b'.repeat(64);
  next.paths.push({ path: '/features/*/properties/extra', types: ['string'], values: 1,
    explicitNull: 0, absent: 0, literalIdEligible: false, literalTextEligible: true });
  return next;
}

test('exact remembered layout takes priority without inspecting contained-source candidates', async () => {
  let calls = 0;
  const result = await lookupIntakeMemory(profile, binding.subject, async (sql, values) => {
    calls++;
    assert.match(sql, /LIMIT 1/);
    assert.deepEqual(values, [binding.subject, profile.source.schemaFingerprint]);
    return [{ body: remembered }];
  });
  assert.equal(result?.id, remembered.id);
  assert.equal(calls, 1);
});

test('contained old profile permits more columns, repins operations, and never carries approval to a plan', async () => {
  const next = broaderProfile();
  const result = await lookupIntakeMemory(next, binding.subject, async (sql, values) => {
    if (values.length === 2) return [];
    assert.match(sql, /LIMIT 50/);
    assert.match(sql, /LEFT JOIN sources/);
    assert.deepEqual(values, [binding.subject]);
    return [{ body: remembered, manual_profile: storedInventory() }];
  });
  assert(result);
  const proposal = await proposeIntakeLayout(next, result, caseId, async () => {
    throw new Error('Contained approved memory must not request a provider.');
  });
  assert.equal(proposal?.origin, 'memory');
  assert.deepEqual(proposal?.plan.source, next.source);
  assert(!('approval' in proposal!.plan));
  assert.equal(remembered.plan.source.schemaFingerprint, hash);
});

test('memory refuses missing/changed old columns, changed CRS/types, unreadable source, and other officer', async () => {
  const next = broaderProfile();
  const inventory = storedInventory();
  const scenarios = [
    { current: { ...next, paths: next.paths.filter(path => !path.path.endsWith('/id')) }, old: inventory },
    { current: { ...next, paths: next.paths.map(path => path.path.endsWith('/id')
      ? { ...path, types: ['number'] as ('number')[] } : path) }, old: inventory },
    { current: { ...next, crs: { ...next.crs, unit: 'metre' } }, old: inventory },
    { current: { ...next, geometryTypes: ['MultiPolygon'] }, old: inventory },
    { current: next, old: null },
    { current: next, old: { ...inventory, version: 'unreadable' } },
  ];
  for (const scenario of scenarios) {
    const result = await lookupIntakeMemory(scenario.current, binding.subject, async (_sql, values) =>
      values.length === 2 ? [] : [{ body: remembered, manual_profile: scenario.old }]);
    assert.equal(result, null);
  }
  const other = { ...remembered, approval: { ...remembered.approval!, subject: 'another-officer' } };
  assert.equal(await lookupIntakeMemory(next, binding.subject, async (_sql, values) =>
    values.length === 2 ? [] : [{ body: other, manual_profile: inventory }]), null);
  next.paths.find(path => path.path.endsWith('/id'))!.literalIdEligible = false;
  assert.equal(await lookupIntakeMemory(next, binding.subject, async (_sql, values) =>
    values.length === 2 ? [] : [{ body: remembered, manual_profile: inventory }]), null);
});

test('contained-source lookup examines only the 50 newest, not a usable 51st receipt', async () => {
  const next = broaderProfile();
  const unusable = { body: remembered, manual_profile: null };
  const result = await lookupIntakeMemory(next, binding.subject, async (_sql, values) => values.length === 2 ? []
    : [...Array.from({ length: 50 }, () => unusable), { body: remembered, manual_profile: storedInventory() }]);
  assert.equal(result, null);
});

test('G23: a page image enrols its own first read once, says it is being read, then asks what it shows', async () => {
  const fixture = protocol();
  fixture.src.profile = 'large-original-v1';
  fixture.src.inspection = {};
  fixture.tray.family = 'image';
  fixture.tray.card = { format: 'jpeg', family: 'image', crs: { state: 'absent' } } as DraftItem['card'];
  const jobId = await queueIntakeDraftTx(fixture.client, fixture.src, fixture.tray.card!);
  assert.equal(fixture.jobs.length, 1);
  assert.equal(fixture.jobs[0].id, jobId);
  assert.equal(IntakePageImageInputSchema.parse(fixture.jobs[0].payload).sourceSha256, hash);
  assert.deepEqual({ ...fixture.state.projection }, { state: 'reading', placement: 'undecided', plan_ref: null,
    records_seen: 0, limit_reason: 'This page image is being read: its size, bands, orientation and a preview.' });
  assert.equal(await queueIntakeDraftTx(fixture.client, fixture.src, fixture.tray.card!), null);
  assert.equal(fixture.jobs.length, 1, 'No second read is queued while one waits.');
  const read = { version: 'page-image-read/1' as const, format: 'jpeg' as const, width: 4032, height: 3024,
    bands: 3, bitDepth: 8, orientation: null, captureTime: null, locationStated: false, dpi: null, preview: null,
    previewLimit: 'it could not be decoded for a preview', label: null };
  await settlePageImageTx(fixture.client, caseId, sourceId, read);
  assert.equal(fixture.state.projection.state, 'read');
  assert.equal(fixture.state.projection.placement, 'needs_answer');
  assert.match(fixture.state.projection.limit_reason, /^A 4,032 x 3,024 JPEG image, no location stated\. /);
  const labelled = await labelPageImageTx(fixture.client, caseId, sourceId, 'plan', '2026-10-21T00:00:00.000Z');
  assert.deepEqual(labelled.label, { value: 'plan', state: 'candidate', answeredAt: '2026-10-21T00:00:00.000Z' });
  assert.equal(fixture.state.projection.placement, 'undecided');
  assert.deepEqual(fixture.state.projection.plan_ref.pageImage, labelled);
  // A later probe keeps the read: nothing is queued again and the answered words stand.
  fixture.tray.plan_ref = fixture.state.projection.plan_ref;
  assert.equal(await queueIntakeDraftTx(fixture.client, fixture.src, fixture.tray.card!), null);
  assert.equal(fixture.jobs.length, 1);
  assert.match(fixture.state.projection.limit_reason, /The officer said it shows a plan; this is a candidate label/);
});
