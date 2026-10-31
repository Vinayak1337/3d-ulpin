import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { settings } from '../../../infrastructure/config';
import { AdaptiveMappingService } from './adaptive-mapping-service';
import type { PoolClient } from 'pg';
import { SourceProfileSchema, AdaptiveMappingRequestSchema, AdaptiveMappingResponseSchema,
  itemPendingKinds, type ChunkMappingInput, type MappingReceipt } from '@ulpin/contracts/usp';
import { ingestionBinding } from './events';
import { intakeSourcePin, type IntakeSourceRow } from './intake-context';
import { IntakeDraftInputSchema, intakeDraftKey, intakeDraftLimit, queueIntakeDraftTx,
  assertIntakeDraftTx, certainTableSelection, queueBatchWorkbookTx, type DraftItem } from './intake-draft';
import { alreadyInArea, intakeDestination, officerQuestion, proposeIntakeLayout,
  lookupIntakeMemory, runIntakeDraftJob } from './intake-draft-worker';
import { intakeItem } from './intake-ledger';
import type { MapArea } from '@ulpin/contracts';
import { AppError } from '../../../infrastructure/errors';
import { registerUspJobInputTx, USP_JOB_LIMITS } from '../jobs';
import { fingerprint } from '../../cases/domain';
import { IntakePageImageInputSchema, labelPageImageTx, settlePageImageTx } from './intake-page-image';
import { probeOriginal } from './intake-probe';
import { prepareIntakeTable } from './intake-table-auto';
import { StreamingVectorService, streamingReaderSha } from './streaming-vector';
import { ChunkMappingService } from './chunk-mapping';
import { settleTableMeaningsTx } from './chunk-mapping-tabular';
import { ManualIngestionService } from './service';
import { NativeDerivativeLineageSchema } from './intake-native-derivative';
import { inspectedProfile } from './registry';
import { sha256 } from '../../../infrastructure/storage';
import { ModelGateway } from '../../model-gateway/gateway';
import { ReplayAdapter } from '../../model-gateway/adapter';
import { hash as gatewayHash } from '../../model-gateway/config';
import type { PgModelCallLedger } from '../../model-gateway/ledger';
import { readingOf } from './intake-reading';
import { profileGisAttributes } from './column-profile';
import { proposeMappingRules } from './mapping-rules';
import { xlsxWorkbook } from '../../../../../../tests/fixtures/ods-control';

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
    inspection: { actor: binding.subject, manualProfile: storedInventory() } };
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
  state: { recipeRevision: number; revision: number; operations: Map<string, any>;
    events: number; projection: Record<string, any>; attempt?: Record<string, any>; registered?: Set<string>;
    receipt?: MappingReceipt };
};
function protocolRead(sql: string, values: any[], fixture: Protocol): any[] | null {
  const { src, tray, jobs, state } = fixture;
  if (sql.startsWith('SELECT * FROM usp_intake_items')) return [tray];
  if (sql.startsWith('SELECT i.item_id')) return src.revision === values[2] && src.sha256 === values[3]
    && fingerprint(src.inspection?.manualProfile?.tabular) === fingerprint(JSON.parse(values[4])) ? [tray] : [];
  if (sql.includes('FROM operations') && sql.includes('LEFT JOIN jobs'))
    return values[1].flatMap((key: string) => {
      const receipt = state.operations.get(key);
      return receipt ? [{ ...receipt, payload: jobs.find(job => job.id === receipt.result.jobId)?.payload }] : [];
    });
  if (sql.includes('FROM operations')) return state.operations.has(values[1]) ? [state.operations.get(values[1])] : [];
  if (sql.startsWith('SELECT id,revision FROM cases') || sql.startsWith('SELECT id FROM cases'))
    return [{ id: caseId, revision: state.revision }];
  if (sql.includes('FROM registry_case_feature_mappings') || sql.includes('FROM import_packages')) return [];
  if (sql.startsWith('SELECT id,family_id,revision,sha256 FROM sources')) return [src];
  if (sql.startsWith('SELECT id,revision,archived FROM cases'))
    return [{ id: caseId, revision: state.revision, archived: false }];
  if (sql.startsWith('SELECT * FROM sources')) return [src];
  if (sql.startsWith('SELECT max(revision)')) return [{ revision: src.revision }];
  if (sql.startsWith('SELECT revision FROM usp_mapping_recipes'))
    return state.recipeRevision ? [{ revision: state.recipeRevision }] : [];
  if (sql.startsWith('SELECT * FROM usp_job_metadata')) {
    const job = jobs.find(job => job.id === values[0]);
    return job && state.registered?.has(job.id) ? [{ logical_state: job.status, input_sha256: job.input_fingerprint,
      input_manifest_id: job.source_id }] : [];
  }
  if (sql.startsWith('SELECT 1 FROM usp_job_attempts') || sql.startsWith('SELECT job_id FROM usp_job_metadata'))
    return [];
  if (sql.startsWith('SELECT * FROM usp_job_attempts')) return state.attempt ? [state.attempt] : [];
  if (sql.startsWith('SELECT body FROM usp_mapping_recipes WHERE source_id='))
    return state.receipt ? [{ body: state.receipt }] : [];
  if (sql.startsWith('SELECT state FROM usp_mapping_recipes WHERE source_id='))
    return state.receipt ? [{ state: state.receipt.state }] : [];
  if (sql.startsWith('SELECT a.id FROM cases') || sql.includes('FROM usp_mapping_recipes')
    || sql.startsWith('SELECT pg_advisory')) return [];
  if (sql.startsWith('SELECT state,placement,plan_ref')) return [state.projection];
  if (sql.startsWith('SELECT item_id AS')) return [{ itemId: sourceId, state: tray.state,
    family: 'vector', format: 'geojson', sizeClass: 'S', wave: 1, pinnedByOfficer: false }];
  if (sql.startsWith('SELECT c.revision,r.revision AS recipe_revision')) return [{ revision: state.revision,
    recipe_revision: state.receipt?.revision, recipe_state: state.receipt?.state }];
  if (sql.startsWith('SELECT revision FROM cases')) return [{ revision: state.revision }];
  if (sql.startsWith('SELECT status FROM jobs WHERE source_id')) return jobs;
  if (sql.startsWith("SELECT id FROM jobs WHERE source_id=$1 AND operation='intake-large'"))
    return jobs.filter(job => job.source_id === values[0] && job.operation === 'intake-large');
  if (sql.startsWith('SELECT count(*)::int AS count FROM jobs')) return [{ count: jobs.length }];
  if (sql.includes('FROM jobs') && sql.includes('status IN'))
    return jobs.filter(job => ['queued', 'running'].includes(job.status)
      && (!sql.includes("payload->>'workbookHeaderPin'=$2") || job.payload.workbookHeaderPin === values[1]));
  if (sql.startsWith('SELECT id,status,payload FROM jobs WHERE source_id'))
    return jobs.filter(job => job.operation === 'intake-native-derivative');
  if (sql.startsWith('SELECT id,payload FROM jobs') || sql.startsWith('SELECT * FROM jobs')
    || sql.startsWith('SELECT status FROM jobs WHERE id='))
    return jobs.filter(row => row.id === values[0]);
  return null;
}
function protocolWrite(sql: string, values: any[], fixture: Protocol): any[] | null {
  const { src, tray, jobs, state } = fixture;
  if (sql.startsWith('UPDATE jobs SET next_attempt_at=')) {
    const job = jobs.find(job => job.id === values[0]);
    job.attempts = (job.attempts ?? 0) + (values[2] ? 1 : 0);
    job.error = values[1];
    return [job];
  }
  if (/^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)/.test(sql)) return [];
  if (sql.startsWith('UPDATE sources SET inspection=')) {
    Object.assign(src.inspection!, JSON.parse(values[1]));
    return [];
  }
  if (sql.startsWith('UPDATE cases SET revision=')) {
    state.revision++;
    return [];
  }
  if (sql.startsWith('INSERT INTO operations')) {
    state.operations.set(values[1], { payload_hash: values[2], result: values[3] });
    return [];
  }
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
  return protocolJobWrite(sql, values, fixture);
}
function protocolJobWrite(sql: string, values: any[], { jobs, state }: Protocol): any[] | null {
  if (sql.startsWith('INSERT INTO usp_job_attempts')) {
    state.attempt = { number: values[1], fence: values[2], owner: values[3], input_sha256: values[4],
      state: 'active', lease_until: new Date(Date.now() + 180000).toISOString() };
    return [state.attempt];
  }
  if (sql.startsWith('UPDATE usp_job_attempts SET state=')) {
    state.attempt!.state = /SET state='([^']+)'/.exec(sql)![1];
    return [];
  }
  if (sql.startsWith('UPDATE jobs SET status=')) {
    Object.assign(jobs.find(job => job.id === values[0]), {
      status: /SET status='([^']+)'/.exec(sql)?.[1] ?? values[1], error: values[2],
    });
    return [];
  }
  if (sql.startsWith('INSERT INTO usp_job_metadata')) {
    (state.registered ??= new Set()).add(values[0]);
    return [];
  }
  if (sql.startsWith('INSERT INTO usp_outbox_streams') || sql.startsWith('UPDATE usp_job_metadata')) return [];
  return null;
}
function protocol() {
  const fixture: Protocol = { src: source(), tray: item(), jobs: [],
    state: { recipeRevision: 0, revision: 0, operations: new Map(), events: 0,
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
        + 'taken in as its own file. Layers enter the map path once the whole conversion ends.' });
    assert.equal(await queueIntakeDraftTx(fixture.client, fixture.src, fixture.tray.card!), jobId);
    fixture.jobs[0].status = 'succeeded';
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
  const expected = '4 members. 4 files waiting to be taken out as their own items: layers/roads.geojson, '
    + 'layers/blocks.geojson, register.csv, README.md.';
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
  const expected = '2 members. 1 file waiting to be taken out as their own items: plan.pdf. '
    + '1 file kept, not read: roads.geojson (inside archive; ZIP_ENCRYPTED_MEMBER).';
  await queueIntakeDraftTx(fixture.client, fixture.src, fixture.tray.card!);
  assert.equal(fixture.state.projection.limit_reason, expected);
  assert.notEqual(fixture.state.projection.placement, 'needs_answer');
  const many = zipFixture(Array.from({ length: 300 }, (_, at) => ({ name: `sheets/page-${at}.pdf`, format: 'pdf' })));
  const words = intakeDraftLimit(many.tray, many.src)!;
  assert.match(words, /^300 members\. 300 files waiting.*sheets\/page-0\.pdf.* and \d+ more\.$/);
  assert(words.length <= 2000);
});

test('a KML or KMZ card is converted into GeoJSON layers by its own job, never asked a question', async () => {
  for (const format of ['kml', 'kmz']) {
    const fixture = protocol();
    fixture.tray.card = { format, family: 'vector', crs: { state: 'absent' } } as DraftItem['card'];
    await queueIntakeDraftTx(fixture.client, fixture.src, fixture.tray.card!);
    assert.deepEqual(fixture.jobs.map(job => job.operation), ['intake-native-derivative']);
    assert.deepEqual([fixture.state.projection.state, fixture.state.projection.placement], ['reading', 'undecided']);
  }
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

test('a kept batch CSV names its table reader instead of claiming no batch reader exists', async () => {
  const fixture = protocol();
  fixture.src.profile = 'large-original-v1';
  fixture.src.bytes = 87352;
  fixture.src.inspection = {};
  fixture.tray.family = 'table';
  fixture.tray.card = { format: 'csv', family: 'table', crs: { state: 'not_applicable' } } as DraftItem['card'];
  await queueIntakeDraftTx(fixture.client, fixture.src, fixture.tray.card!);
  assert.equal(fixture.state.projection.limit_reason, 'Kept as a CSV table (85 KB). '
    + 'Read it as a table with "Open the table"; the original is kept with its SHA-256.');
  assert.equal(fixture.jobs.length, 0);
});

test('plain Parquet remains kept as a table and never queues a native derivative', async () => {
  const fixture = protocol();
  fixture.src.profile = 'large-original-v1';
  fixture.src.inspection = {};
  fixture.tray.family = 'table';
  fixture.tray.card = { format: 'parquet', family: 'table' } as DraftItem['card'];
  assert.equal(await queueIntakeDraftTx(fixture.client, fixture.src, fixture.tray.card!), null);
  assert.match(fixture.state.projection.limit_reason, /Kept as a Parquet table/);
  assert.equal(fixture.jobs.length, 0);
});

for (const [format, expected] of [
  ['xlsx', 'Reading each visible worksheet and choosing candidate header rows. '
    + 'Nothing is recorded until you confirm it.'],
  ['ods', 'Reading each visible worksheet and choosing candidate header rows. '
    + 'Nothing is recorded until you confirm it.'],
  ['xls', 'Excel 97-2003 workbook (85 KB). It is kept as evidence; this version does not read its cells. Save it as '
    + 'XLSX or ODS and add that file to place its rows on the map.'],
] as const) {
  test(`a batch ${format} chooses the workbook reader, or explains the legacy refusal`, async () => {
    const fixture = protocol();
    fixture.src.profile = 'large-original-v1';
    fixture.src.bytes = 87352;
    fixture.src.inspection = {};
    fixture.tray.family = 'table';
    fixture.tray.card = { format, family: 'table', crs: { state: 'not_applicable' } } as DraftItem['card'];
    await queueIntakeDraftTx(fixture.client, fixture.src, fixture.tray.card!);
    assert.equal(fixture.state.projection.limit_reason, expected);
  });
}

async function tableProtocol(bytes: Buffer, name: string) {
  const fixture = protocol();
  Object.assign(fixture.src, { profile: 'large-original-v1', bytes: bytes.length, sha256: sha256(bytes), name,
    inspection: { largeOriginal: { uploadId: sourceId, operatorSubject: binding.subject, objectEtag: 'etag',
      verifiedSha256: sha256(bytes), verifiedBytes: bytes.length, conversion: 'unsupported',
      bundleCompleteness: 'single_original_only_archive_dependencies_not_assessed',
      provenance: { origin: 'not_stated', acquiredAt: '2026-10-20T00:00:00.000Z', state: 'not_stated' } } } });
  fixture.tray.family = 'table';
  fixture.tray.card = await probeOriginal(async (start, end) => bytes.subarray(start, end), bytes.length, name);
  return fixture;
}

async function tableCommands(fixture: Awaited<ReturnType<typeof tableProtocol>>, bytes: Buffer,
  run: () => Promise<void>) {
  const globals = globalThis as any;
  const previous = globals.ulpinPool;
  globals.ulpinPool = { query: fixture.client.query.bind(fixture.client),
    connect: async () => ({ query: fixture.client.query.bind(fixture.client), release() {} }) };
  const require = createRequire(new URL('../../../../package.json', import.meta.url));
  const { S3Client } = require('@aws-sdk/client-s3');
  for (const key of ['s3Endpoint', 's3Region', 's3Bucket', 's3AccessKey', 's3SecretKey'] as const)
    mock.getter(settings, key, () => key === 's3Endpoint' ? 'http://127.0.0.1:1' : 'table-protocol');
  mock.method(S3Client.prototype, 'send', async () => ({ Body: Readable.from([bytes]),
    ContentLength: bytes.length, ETag: 'etag' }));
  try {
    await run();
  } finally {
    globals.ulpinPool = previous;
    mock.restoreAll();
  }
}

for (const header of [
  ['key', '', '', '', '', 'value', '', '', '', '', 'note', '', '', '', ''],
  ['', 'key', 'value', 'note', 'a', 'b', 'c'],
]) test(`a CSV with ${header.length} columns and empty header cells drafts and reads automatically`, async () => {
  // Synthetic layout controls only; the first cell of each row is a numeric index, not an identifier claim.
  const cells = header.map((_, index) => String(index + 1));
  const bytes = Buffer.from(`${header.join(',')}\r\n${cells.join(',')}\r\n`);
  const fixture = await tableProtocol(bytes, 'empty-header-control.csv');
  const names = header.map((name, index) => name || `column_${index + 1}`);
  assert.deepEqual(fixture.tray.card!.columns.map(column => column.name), names);
  assert.ok(certainTableSelection(fixture.tray.card!));
  assert.ok(await queueIntakeDraftTx(fixture.client, fixture.src, fixture.tray.card!));
  const input = IntakeDraftInputSchema.parse(fixture.jobs[0].payload);
  await tableCommands(fixture, bytes, async () => {
    const calls: string[] = [];
    for (const [service, kind] of [[StreamingVectorService, 'streaming-vector'],
      [ChunkMappingService, 'chunk-mapping']] as const) {
      mock.method(service.prototype, 'enqueue', async () => {
        calls.push(kind);
        return { jobId: intakeDraftKey(sourceId, 0, kind) };
      });
    }
    assert.equal(await prepareIntakeTable(input), true);
    const profile = fixture.src.inspection!.manualProfile;
    assert.equal(profile.version, 'manual-tabular/1');
    assert.deepEqual(profile.headers, names);
    assert.equal(profile.records, 1);
    assert.deepEqual(profile.profile.columns.map((column: { name: string }) => column.name),
      names.map((name, index) => `${index + 1}|${name}`));
    assert.deepEqual(calls, ['streaming-vector', 'chunk-mapping']);
    assert.equal(fixture.src.sha256, sha256(bytes));
    assert.equal(fixture.src.bytes, bytes.length);
    assert(!fixture.statements.some(sql => /INSERT INTO.*(?:request|recipe|approval|registry)/.test(sql)));
  });
});

test('lgd-gurugram reads once and queues both pinned proposal commands without an officer request', async () => {
  const bytes = readFileSync('fixtures/usp/D4/reference-area-gurugram-59-63a/lgd-gurugram.csv');
  const fixture = await tableProtocol(bytes, 'lgd-gurugram.csv');
  const jobId = await queueIntakeDraftTx(fixture.client, fixture.src, fixture.tray.card!);
  assert.equal(fixture.jobs.length, 1);
  assert.match(fixture.state.projection.limit_reason, /table is being read/);
  const input = IntakeDraftInputSchema.parse(fixture.jobs[0].payload);
  assert.equal(input.sourcePin, intakeSourcePin(fixture.src, binding));
  await tableCommands(fixture, bytes, async () => {
    const calls: any[] = [];
    let occupied = true;
    for (const [service, kind] of [[StreamingVectorService, 'streaming-vector'],
      [ChunkMappingService, 'chunk-mapping']] as const) {
      mock.method(service.prototype, 'enqueue', async (caseValue: string, sourceValue: string, request: any) => {
        if (kind === 'chunk-mapping' && occupied) throw new AppError(429, 'MAPPING_CAPACITY', 'Protocol busy slot.');
        const id = intakeDraftKey(sourceId, 0, kind);
        calls.push({ kind, caseValue, sourceValue, request });
        fixture.state.operations.set(`${kind}:${request.requestKey}`, { result: { jobId: id } });
        fixture.jobs.push({ id, payload: { readerSha256: streamingReaderSha(), tabular: request.tabular,
          rawJobId: request.rawJobId } });
        return { jobId: id };
      });
    }
    fixture.state.revision++; // Another file arrives after enrolment, before this read.
    assert.equal(await prepareIntakeTable(input), false);
    assert.equal(calls.length, 1);
    occupied = false;
    assert.equal(await prepareIntakeTable(input), true);
    assert.equal(fixture.src.inspection!.manualProfile.version, 'manual-tabular/1');
    assert.equal(fixture.src.sha256, sha256(bytes));
    assert.equal(fixture.src.bytes, bytes.length);
    assert.equal(fixture.src.inspection!.manualProfile.tabular.admission.containsPersonalData, 'unknown');
    assert.deepEqual(calls.map(call => call.kind), ['streaming-vector', 'chunk-mapping']);
    for (const call of calls) {
      assert.equal(call.caseValue, caseId);
      assert.equal(call.sourceValue, sourceId);
      assert.equal(call.request.expectedSourceRevision, input.sourceRevision);
      assert.equal(call.request.sourceSha256, input.sourceSha256);
      assert.equal(call.request.expectedCaseRevision, fixture.state.revision);
      assert.deepEqual(call.request.tabular, fixture.src.inspection!.manualProfile.tabular);
    }
    assert.equal(calls[1].request.rawJobId, intakeDraftKey(sourceId, 0, 'streaming-vector'));
    fixture.state.revision++;
    assert.equal(await prepareIntakeTable(input), true);
    assert.equal(await queueIntakeDraftTx(fixture.client, fixture.src, fixture.tray.card!), null);
    assert.equal(fixture.jobs.length, 3);
    assert.equal(calls.length, 2);
    assert.equal(fixture.statements.filter(sql => sql.startsWith('UPDATE sources SET inspection=')).length, 1);
    assert(!fixture.statements.some(sql => /INSERT INTO.*(?:request|recipe|approval)/.test(sql)));
    fixture.src.sha256 = 'b'.repeat(64);
    await assert.rejects(prepareIntakeTable(input), { code: 'INTAKE_SOURCE_INTEGRITY' });
    fixture.src.sha256 = input.sourceSha256;
    fixture.src.inspection!.largeOriginal.operatorSubject = 'another-protocol-context';
    await assert.rejects(prepareIntakeTable(input), { code: 'INTAKE_SOURCE_DENIED' });
    assert.equal(calls.length, 2);
  });
  assert(jobId);
});

for (const meanings of ['ready', 'unavailable', { failed: 'MAPPING_SOURCE_WAIT' }] as const) {
  test(`a read table leaves proposing for ${JSON.stringify(meanings)} with one pending action`, async () => {
    const bytes = readFileSync('fixtures/usp/D4/reference-area-gurugram-59-63a/lgd-gurugram.csv');
    const fixture = await tableProtocol(bytes, 'lgd-gurugram.csv');
    const jobId = await queueIntakeDraftTx(fixture.client, fixture.src, fixture.tray.card!);
    await tableCommands(fixture, bytes, async () => {
      mock.method(StreamingVectorService.prototype, 'enqueue', async () => ({ jobId: sourceId }));
      mock.method(ChunkMappingService.prototype, 'enqueue', async () => ({ jobId: caseId }));
      await runIntakeDraftJob(jobId!);
      assert.equal(fixture.state.projection.state, 'read');
      assert.match(fixture.state.projection.limit_reason, /being proposed/);
      const input = { ...fixture.jobs[0].payload, route: 'proposal_only',
        tabular: fixture.src.inspection!.manualProfile.tabular } as ChunkMappingInput;
      await settleTableMeaningsTx(fixture.client, input, meanings);
      const row = fixture.state.projection;
      assert.equal(row.state, 'read');
      assert.equal(row.placement, 'needs_answer');
      assert.doesNotMatch(row.limit_reason, /being proposed/);
      if (meanings === 'ready') assert.equal(row.limit_reason,
        'The table is read. Its field meanings are ready for your review; '
          + 'nothing is recorded until you confirm it.');
      else if (meanings === 'unavailable') assert.match(row.limit_reason, /No proposer.*state the meanings yourself/);
      else assert.match(row.limit_reason, /failed \(MAPPING_SOURCE_WAIT\).*state the meanings yourself/);
      const item: Parameters<typeof itemPendingKinds>[0] = { itemId: sourceId, sourceId,
        name: fixture.src.name, parentItemId: null, family: 'table', state: 'read', placement: 'needs_answer',
        plan: null, layoutQuestion: false, limitReason: row.limit_reason, card: fixture.tray.card! };
      assert.deepEqual(itemPendingKinds(item, [item]), [{ kind: 'table_placement' }]);
      const events = fixture.state.events;
      await settleTableMeaningsTx(fixture.client, input, meanings);
      assert.equal(fixture.state.events, events, 'An unchanged completion publishes no second tray event.');
      assert.equal(fixture.src.sha256, sha256(bytes));
      assert(!fixture.statements.some(sql => /INSERT INTO registry_/.test(sql)));
    });
  });
}

for (const obsolete of ['reader', 'tabular', 'current'] as const) {
  test(`saved raw ${obsolete} pins choose a current read instead of silently waiting`, async () => {
    const bytes = readFileSync('fixtures/usp/D4/reference-area-gurugram-59-63a/lgd-gurugram.csv');
    const fixture = await tableProtocol(bytes, 'lgd-gurugram.csv');
    await queueIntakeDraftTx(fixture.client, fixture.src, fixture.tray.card!);
    const input = IntakeDraftInputSchema.parse(fixture.jobs[0].payload);
    await tableCommands(fixture, bytes, async () => {
      const profile = await new ManualIngestionService().tableFromOriginal(caseId, sourceId, {
        requestKey: intakeDraftKey(sourceId, 0, 'table-read'), expectedWorkspaceRevision: 0,
        selection: input.tableSelection,
      }, input);
      assert.equal(profile.version, 'manual-tabular/1');
      const tabular = fixture.src.inspection!.manualProfile.tabular;
      const oldId = intakeDraftKey(sourceId, 0, 'obsolete-raw');
      fixture.jobs.push({ id: oldId, payload: { readerSha256: obsolete === 'reader' ? '0'.repeat(64)
        : streamingReaderSha(), tabular: obsolete === 'tabular' ? null : tabular } });
      const oldKey = intakeDraftKey(sourceId, 0, 'table-streaming-vector');
      fixture.state.operations.set(`streaming-vector:${oldKey}`, { result: { jobId: oldId } });
      let rereads = 0;
      mock.method(StreamingVectorService.prototype, 'enqueue', async (_case: string, _source: string, request: any) => {
        rereads++;
        assert.notEqual(request.requestKey, oldKey);
        assert.deepEqual(request.tabular, tabular);
        return { jobId: sourceId };
      });
      mock.method(ChunkMappingService.prototype, 'enqueue', async (_case: string, _source: string, request: any) => {
        if (request.rawJobId === oldId && obsolete !== 'current')
          throw new AppError(409, 'STALE_REVISION', 'Obsolete saved raw pins.');
        return { jobId: caseId };
      });
      assert.equal(await prepareIntakeTable(input), true);
      assert.equal(rereads, obsolete === 'current' ? 0 : 1);
    });
  });
}

for (const cause of ['STREAMING_CAPACITY', 'STALE_REVISION']) {
  const bounded = cause === 'STALE_REVISION';
  test(`temporary ${cause} waits ${bounded ? 'end with a cause at the job limit' : 'never end on capacity'}, not by age`, async () => {
    const bytes = readFileSync('fixtures/usp/D4/reference-area-gurugram-59-63a/lgd-gurugram.csv');
    const fixture = await tableProtocol(bytes, 'lgd-gurugram.csv');
    await queueIntakeDraftTx(fixture.client, fixture.src, fixture.tray.card!);
    const input = IntakeDraftInputSchema.parse(fixture.jobs[0].payload);
    await tableCommands(fixture, bytes, async () => {
      let occupied = true;
      mock.method(StreamingVectorService.prototype, 'enqueue', async () => {
        if (occupied) throw new AppError(429, cause, 'Temporary admission refusal.');
        return { jobId: sourceId };
      });
      mock.method(ChunkMappingService.prototype, 'enqueue', async () => ({ jobId: caseId }));
      fixture.jobs[0].created_at = '2000-01-01T00:00:00Z';
      assert.equal(await prepareIntakeTable(input), false);
      occupied = false;
      fixture.state.revision++;
      assert.equal(await prepareIntakeTable(input), true);
      occupied = true;
      fixture.jobs[0].attempts = 0;
      for (let index = 1; index < USP_JOB_LIMITS.maxAttempts; index++)
        assert.equal(await prepareIntakeTable(input), false);
      assert.equal(fixture.jobs[0].error, cause);
      await runIntakeDraftJob(input.jobId);
      if (!bounded) {
        assert.notEqual(fixture.jobs[0].status, 'failed');
        assert.equal(fixture.jobs[0].attempts, 0);
        assert.equal(fixture.jobs[0].error, cause);
        return;
      }
      assert.equal(fixture.jobs[0].status, 'failed');
      assert.equal(fixture.jobs[0].error, `TABLE_ADMISSION_${cause}_EXHAUSTED`);
      assert.equal(fixture.state.attempt, undefined, 'admission failures claim no fenced attempt');
    });
  });
}

test('newer table work or a changed selection ends only the old job with a cause', async () => {
  for (const newer of ['approved', 'recipe', 'selection'] as const) {
    const bytes = readFileSync('fixtures/usp/D4/reference-area-gurugram-59-63a/lgd-gurugram.csv');
    const fixture = await tableProtocol(bytes, 'lgd-gurugram.csv');
    await queueIntakeDraftTx(fixture.client, fixture.src, fixture.tray.card!);
    const input = IntakeDraftInputSchema.parse(fixture.jobs[0].payload);
    await tableCommands(fixture, bytes, async () => {
      await new ManualIngestionService().tableFromOriginal(caseId, sourceId, {
        requestKey: intakeDraftKey(sourceId, 0, 'table-read'), expectedWorkspaceRevision: 0,
        selection: input.tableSelection,
      }, input);
      if (newer === 'approved') {
        fixture.tray.plan_ref = { recipeId: caseId, recipeRevision: 1, recipeState: 'approved' };
        fixture.state.receipt = remembered;
      } else if (newer === 'recipe') fixture.state.receipt = remembered;
      else fixture.src.inspection!.manualProfile.tabular.selection.headerRows = [2];
      mock.method(StreamingVectorService.prototype, 'enqueue', async () => {
        assert.fail('Superseded table work must not admit another raw read.');
      });
      const before = fingerprint({ tray: fixture.tray, receipt: fixture.state.receipt });
      assert.equal(await prepareIntakeTable(input), false);
      assert.equal(fixture.jobs[0].status, 'stale');
      assert.equal(fixture.jobs[0].error, 'TABLE_DRAFT_SUPERSEDED');
      assert.equal(fingerprint({ tray: fixture.tray, receipt: fixture.state.receipt }), before);
    });
  }
});

test('a streamed table read waits without spending an attempt or admitting a mapper before its profile', async () => {
  const bytes = readFileSync('fixtures/usp/D4/reference-area-gurugram-59-63a/lgd-gurugram.csv');
  const fixture = await tableProtocol(bytes, 'lgd-gurugram.csv');
  await queueIntakeDraftTx(fixture.client, fixture.src, fixture.tray.card!);
  const input = IntakeDraftInputSchema.parse(fixture.jobs[0].payload);
  await tableCommands(fixture, bytes, async () => {
    mock.method(ManualIngestionService.prototype, 'tableFromOriginal', async () => ({ version: 'table-profile/1',
      jobId: sourceId, caseId, sourceId, sourceRevision: 1, status: 'running', issueCode: null, message: null }));
    assert.equal(await prepareIntakeTable(input), false);
    assert(fixture.statements.some(sql => sql.startsWith('UPDATE jobs SET next_attempt_at=')));
    assert(!fixture.statements.some(sql => /(?:INSERT INTO|UPDATE) usp_job_attempts/.test(sql)));
    assert.equal(fixture.jobs.length, 1);
    assert.equal(fixture.src.inspection!.manualProfile, undefined);
  });
});

test('a real two-sheet workbook queues its sheet layout reader instead of asking which sheet', async () => {
  const manifest = JSON.parse(readFileSync('docs/evidence/usp/native-xlsx/sources.json', 'utf8'));
  const original = manifest.sources.find((entry: any) => entry.id === 'dfe-discharge-coefficient-calculator');
  const bytes = readFileSync(original.privateOriginal);
  assert.equal(sha256(bytes), original.sha256);
  const fixture = await tableProtocol(bytes, 'Discharge_coefficient_calculator.xlsx');
  assert.equal(fixture.tray.card!.sheets.length, 2);
  assert(await queueIntakeDraftTx(fixture.client, fixture.src, fixture.tray.card!));
  assert.equal(fixture.state.projection.state, 'reading');
  assert.equal(fixture.state.projection.placement, 'undecided');
  assert.match(fixture.state.projection.limit_reason, /each visible worksheet/);
  assert.equal(fixture.jobs.length, 1);
  assert.equal(fixture.jobs[0].payload.workbook, true);
});

test('changing a header back to an earlier choice queues new work, not a completed job', async () => {
  const fixture = protocol();
  fixture.src.profile = 'large-original-v1';
  const ids: (string | null)[] = [];
  for (const header of [1, 2, 1]) {
    fixture.src.inspection!.workbookHeaders = { First: header };
    fixture.state.revision++;
    const id = await queueBatchWorkbookTx(fixture.client, fixture.src, true);
    ids.push(id);
    fixture.jobs.find(job => job.id === id).status = 'succeeded';
  }
  assert.equal(new Set(ids).size, 3);
  assert.equal(fixture.jobs.length, 3);
  fixture.jobs.at(-1).status = 'failed';
  fixture.tray.state = 'probed';
  const retry = await queueBatchWorkbookTx(fixture.client, fixture.src);
  assert(!ids.includes(retry), 'A stopped job gets a fresh generation when enrolled again');
  assert.equal(fixture.jobs.length, 4);
  assert.equal(fixture.src.sha256, hash);
});

test('an officer changes a workbook header through Read as a table without replacing its bytes', {
  skip: !existsSync(process.env.ULPIN_PROFILE_PYTHON ?? 'E:/BhuAayam-data/ml/venv-k3a-geo/Scripts/python.exe'),
}, async t => {
  const previous = process.env.ULPIN_PROFILE_PYTHON;
  process.env.ULPIN_PROFILE_PYTHON ??= 'E:/BhuAayam-data/ml/venv-k3a-geo/Scripts/python.exe';
  t.after(() => {
    if (previous === undefined) delete process.env.ULPIN_PROFILE_PYTHON;
    else process.env.ULPIN_PROFILE_PYTHON = previous;
  });
  const bytes = xlsxWorkbook('Register', [['title', 'second', 'third'], ['key', 'name', 'count'],
    ['a', 'first', '1'], ['b', 'second', '2']]).bytes;
  const fixture = await tableProtocol(bytes, 'test.xlsx');
  await tableCommands(fixture, bytes, async () => {
    const manual = new ManualIngestionService();
    const selection = { format: 'xlsx' as const, sheet: 'Register', table: null, headerRows: [1] };
    await manual.tableFromOriginal(caseId, sourceId, { requestKey: intakeDraftKey(sourceId, 0, 'first-header'),
      expectedWorkspaceRevision: 0, selection });
    const changed = await manual.tableFromOriginal(caseId, sourceId, {
      requestKey: intakeDraftKey(sourceId, 0, 'changed-header'), expectedWorkspaceRevision: fixture.state.revision,
      selection: { ...selection, headerRows: [2] } });
    assert.equal(changed.version, 'manual-tabular/1');
    assert.deepEqual(fixture.src.inspection!.manualProfile.headers, ['key', 'name', 'count']);
    assert.equal(fixture.src.inspection!.manualProfile.records, 2);
    assert.deepEqual(fixture.src.inspection!.manualProfile.tabular.selection.headerRows, [2]);
    assert.equal(fixture.src.sha256, sha256(bytes));
    assert(!fixture.statements.some(sql => /INSERT INTO registry_|approval/.test(sql)));
  });
});

test('delimited first rows stay automatic; workbooks wait for their actual header reader', async () => {
  const fixture = await tableProtocol(Buffer.from('code\tname\ncontrol\tlayout control\n'), 'layout-control.tsv');
  const card = fixture.tray.card!;
  assert.deepEqual(certainTableSelection(card), { format: 'csv', sheet: 'csv', table: null, headerRows: [1],
    delimiter: '\t', encoding: card.encoding });
  assert.equal(certainTableSelection({ ...card, encoding: null }), null);
  assert.equal(certainTableSelection({ ...card, delimiter: null }), null);
  for (const format of ['xlsx', 'ods']) {
    const workbook = { ...card, format, sheets: [{ name: 'Layout control', count: null }], limits: [] };
    assert.equal(certainTableSelection(workbook), null);
    assert.equal(certainTableSelection({ ...workbook, limits: ['Sheet inventory cut; more may follow.'] }), null);
    assert.equal(certainTableSelection({ ...workbook, encrypted: true }), null);
  }
});

test('a batch DOCX child, placed item or reviewed plan never queues an automatic document read', async () => {
  for (const blocked of ['child', 'placed', 'plan']) {
    const fixture = protocol();
    fixture.tray.family = 'document';
    fixture.tray.card = { format: 'docx', family: 'document' } as DraftItem['card'];
    if (blocked === 'child') fixture.tray.parent_item_id = caseId;
    if (blocked === 'placed') fixture.tray.placement = 'attached';
    if (blocked === 'plan') fixture.tray.plan_ref = { recipeId: caseId };
    assert.equal(await queueIntakeDraftTx(fixture.client, fixture.src, fixture.tray.card!), null);
    assert.equal(fixture.jobs.length, 0);
    assert.equal(fixture.state.events, 0);
  }
});

const kept = ' No reader in a batch takes this kind of file yet, so it is not on the map; '
  + 'the original is kept with its SHA-256.';
for (const [format, family, bytes, expected] of [
  ['docx', 'document', 16777217, 'Kept as a Word document (16 MB). The Word document reader in a batch reads '
    + 'a Word document of at most 16 MB, so this one is not read; the original is kept with its SHA-256.'],
  ['tiff', 'raster', 512, `Kept as a TIFF raster (512 bytes).${kept}`],
  ['laz', 'point_cloud', 7516192768, `Kept as a LAZ point cloud (7 GB).${kept}`],
  ['unknown', 'unknown', 421888, 'Kept (412 KB); its kind was not recognised from its first and last bytes.'],
  ['gzip', 'archive', 512, 'Compressed (gzip): kept, not read.'],
] as const) {
  test(`a probed ${format} without batch reading rests not understood in words naming what the probe saw`,
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
test('remembered operations are repinned to the new source and carry no approval', async t => {
  t.mock.getter(settings, 'teacherCaseOriginals', () => 'off');
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
test('a case GeoJSON with the switch off asks the officer without calling adaptive.propose', async t => {
  t.mock.getter(settings, 'teacherCaseOriginals', () => 'off');
  const teacher = t.mock.method(AdaptiveMappingService.prototype, 'propose', async () => {
    throw new Error('A refused original must never call the adaptive service.');
  });
  assert.equal(await proposeIntakeLayout(profile, null, caseId), null);
  const fixture = protocol();
  const jobId = await queueIntakeDraftTx(fixture.client, fixture.src);
  const globals = globalThis as any;
  const previous = globals.ulpinPool;
  globals.ulpinPool = { query: fixture.client.query.bind(fixture.client),
    connect: async () => ({ query: fixture.client.query.bind(fixture.client), release() {} }) };
  try {
    await runIntakeDraftJob(jobId!);
  } finally {
    globals.ulpinPool = previous;
  }
  const published = intakeItem({ ...fixture.tray, ...fixture.state.projection, card: null,
    name: 'case-original.geojson', format: 'geojson', size_bytes: null, size_class: null, wave: 1,
    member_path: null, card_sha256: null, probe_version: null, parts_planned: null, parts_done: 0,
    pinned_by_officer: false, created_at: new Date(), updated_at: new Date() });
  assert.equal(published.state, 'probed');
  assert.equal(published.placement, 'needs_answer');
  assert.equal(published.layoutQuestion, true);
  assert.equal(published.plan, null);
  assert.equal(fixture.jobs[0].status, 'succeeded');
  assert.equal(fixture.state.attempt!.state, 'accepted');
  assert(!fixture.statements.some(sql => sql.startsWith('INSERT INTO usp_mapping_recipes')));
  assert.equal(teacher.mock.callCount(), 0);
});

test('masked_profile permits one adaptive case GeoJSON proposal without transferring approval', async t => {
  t.mock.getter(settings, 'teacherCaseOriginals', () => 'masked_profile');
  const teacher = t.mock.method(AdaptiveMappingService.prototype, 'propose', async () =>
    AdaptiveMappingResponseSchema.parse({ version: 'adaptive-geojson-proposal/1', requestKey: caseId,
      source: profile.source, workspaceRevision: 0, workspaceFingerprint: hash,
      status: 'proposed', code: null, plan, validationErrors: [], call: null,
      validation: 'mechanics_only', reviewRequired: true }));
  const proposed = await proposeIntakeLayout(profile, null, caseId);
  assert.equal(teacher.mock.callCount(), 1);
  assert.equal(proposed?.origin, 'teacher');
  assert.deepEqual(proposed?.plan, plan);
  assert(!('approval' in proposed!.plan));
});

test('unapproved and different-schema memory falls back only to the permitted existing proposer', async t => {
  t.mock.getter(settings, 'teacherCaseOriginals', () => 'masked_profile');
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

for (const format of ['geojson', 'ndjson', 'geojson-seq']) {
  test(`a retained ${format} queues the streaming path without bounded preparation`, async () => {
    const fixture = protocol();
    fixture.src.profile = 'large-original-v1';
    fixture.src.bytes = 50000;
    fixture.src.inspection = {};
    fixture.tray.card = { format, family: 'vector', counts: { features: 2500 } } as DraftItem['card'];
    let streamed = 0;
    const query = fixture.client.query.bind(fixture.client);
    fixture.client.query = (async (sql: string, values: any[]) => {
      if (!sql.startsWith('SELECT item_id,case_id,state,placement')) return query(sql, values);
      streamed++;
      return { rows: [], rowCount: 0 };
    }) as typeof fixture.client.query;
    await queueIntakeDraftTx(fixture.client, fixture.src, fixture.tray.card!);
    assert.equal(streamed, 1);
    assert.equal(fixture.state.projection.limit_reason, null);
  });
}

test('a small retained GeoJSON with its bounded receipt queues the same draft authority as a manual original',
  async () => {
    const fixture = protocol();
    fixture.src.profile = 'large-original-v1';
    fixture.src.inspection!.gis = { sourceSha256: hash };
    fixture.src.inspection!.largeOriginal = { verifiedSha256: hash, verifiedBytes: Number(fixture.src.bytes) };
    fixture.tray.card = { format: 'geojson', family: 'vector', crs: { state: 'stated' },
      counts: { features: 1 } } as DraftItem['card'];
    const jobId = await queueIntakeDraftTx(fixture.client, fixture.src, fixture.tray.card!);
    assert.equal(fixture.jobs.length, 1);
    assert.equal(fixture.jobs[0].id, jobId);
    assert.equal(fixture.jobs[0].operation, 'intake-draft');
  });

test('a small pinned CityGML layer authors and executes a draft without asking for its layout', async () => {
  const bytes = Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature',
    properties: { 'gml:id': 'test_only-source-id' }, geometry: { type: 'Polygon',
      coordinates: [[[77, 28], [77.001, 28], [77.001, 28.001], [77, 28]]] } }] }));
  const fixture = await tableProtocol(bytes, 'test_only-outlines.geojson');
  fixture.tray.family = 'vector';
  fixture.src.inspection!.manualProfile = inspectedProfile(bytes, { format: 'geojson', sourceSha256: sha256(bytes),
    featureCount: 1, sourceCrs: 'EPSG:4326', crsEvidence: 'test_only', geometryTypes: ['Polygon'],
    fields: [{ name: 'gml:id' }] } as any);
  fixture.src.inspection!.actor = binding.subject;
  fixture.src.inspection!.gis = { sourceSha256: fixture.src.sha256,
    suggestedTitle: 'test_only', suggestedNamespace: 'test_only' };
  const sidecar = { objectKey: `native-derivatives/${hash}/0/sidecar-${hash}`, bytes: 1, sha256: hash };
  fixture.src.inspection!.nativeDerivative = NativeDerivativeLineageSchema.parse({ version: 'native-derivative/1',
    conversion: 'native_gis_to_geojson@1', readerVersion: 'citygml-ground-outline/1', originalSourceId: caseId,
    originalSourceRevision: 1, originalSha256: hash, originalItemId: caseId, format: 'citygml',
    layer: 'test_only outlines', ordinal: 0, crs: 'EPSG:4326', crsSource: 'stated', features: 1, notWritten: 0,
    sidecar, converterLayout: { method: 'converter:citygml-ground-outline@1', sourceClasses: ['Building'],
      kind: 'building', identifierField: 'gml:id', nameField: null,
      derivativeSha256: fixture.src.sha256, derivativeBytes: bytes.length } });
  const base = fixture.client.query.bind(fixture.client);
  fixture.client.query = (async (sql: string, values: any[]) => {
    if (sql.startsWith('SELECT id FROM sources')) return { rows: [{ id: caseId }], rowCount: 1 };
    if (sql.startsWith('SELECT id,family_id,revision,sha256 FROM sources')) {
      const { id, family_id, revision, sha256: digest } = fixture.src;
      return { rows: [{ id, family_id, revision, sha256: digest }], rowCount: 1 };
    }
    if (sql.startsWith('SELECT item_id,case_id,state,placement') || sql.includes('FROM map_areas WHERE seed_key'))
      return { rows: [], rowCount: 0 };
    if (sql.startsWith('SELECT body FROM usp_mapping_recipes WHERE id='))
      return { rows: fixture.state.receipt ? [{ body: fixture.state.receipt }] : [], rowCount: 1 };
    if (sql.startsWith('INSERT INTO usp_mapping_recipes')) {
      fixture.state.receipt = values[5];
      fixture.state.recipeRevision = values[5].revision;
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith('INSERT INTO usp_mapping_recipe_revisions') || sql.startsWith('INSERT INTO usp_intake_targets'))
      return { rows: [], rowCount: 0 };
    if (sql.startsWith('SELECT id FROM jobs WHERE case_id=')) return { rows: [{ id: caseId }], rowCount: 1 };
    if (sql.startsWith('SELECT body FROM import_packages WHERE id=')) return { rows: [{ body: {
      id: caseId, sourceRevisionIds: [sourceId], features: [], parts: [], documents: [], observations: [] } }],
      rowCount: 1 };
    return base(sql, values);
  }) as typeof fixture.client.query;
  await tableCommands(fixture, bytes, async () => {
    mock.getter(settings, 'teacherCaseOriginals', () => 'off');
    mock.method(AdaptiveMappingService.prototype, 'propose', async () => assert.fail('No layout teacher.'));
    const decide = ManualIngestionService.prototype.decide;
    const execute = mock.method(ManualIngestionService.prototype, 'decide', async (_case: string,
      _recipe: string, _request: unknown, action: string) => {
      assert.equal(action, 'execute', 'No officer approval is manufactured.');
      const receipt = fixture.state.receipt!;
      assert.equal(receipt.state, 'approved');
      assert.equal(receipt.approval!.subject, null);
      assert.equal(receipt.approval!.provenance, 'converter_recorded');
      assert.equal(receipt.plan.operations[0].sourcePath, '/features/*/properties/gml:id');
      receipt.state = 'executed';
      receipt.execution = { packageId: caseId, sourceRevisionId: sourceId,
        subject: binding.subject, at: new Date().toISOString() };
      return receipt;
    });
    // Exercise the bounded draft authority directly; new native layers are enrolled through the stream path.
    const jobId = intakeDraftKey(sourceId, 0, 'job');
    const input = IntakeDraftInputSchema.parse({ version: 'intake-draft/1', jobId, caseId, itemId: sourceId,
      caseRevision: 0, sourceId, sourceRevision: 1, sourceSha256: fixture.src.sha256,
      sourcePin: intakeSourcePin(fixture.src, binding), recipeRevision: 0,
      subject: binding.subject, accessSha256: binding.access });
    fixture.jobs.push({ id: jobId, status: 'queued', operation: 'intake-draft', source_id: sourceId,
      case_id: caseId, case_revision: 0, payload: input, input_fingerprint: fingerprint(input) });
    fixture.state.registered = new Set([jobId]);
    await runIntakeDraftJob(jobId);
    assert.equal(execute.mock.callCount(), 1);
    assert.equal(fixture.state.projection.state, 'read');
    assert.equal(fixture.state.projection.placement, 'on_map');
    assert.equal(fixture.state.projection.plan_ref.origin, null);
    assert.equal(fixture.state.projection.plan_ref.layoutQuestion, undefined);
    assert(!fixture.statements.some(sql => /INSERT INTO registry_/.test(sql)));
    fixture.state.receipt!.state = 'approved';
    fixture.src.inspection!.nativeDerivative.readerVersion = 'citygml-ground-outline/2';
    await assert.rejects(decide.call(new ManualIngestionService(), caseId, fixture.state.receipt!.id,
      { requestKey: caseId, expectedRecipeRevision: fixture.state.receipt!.revision }, 'execute'),
    { code: 'CONVERTER_LAYOUT' });
  });
});

function replayLayout(fixture: Protocol) {
  fixture.src.inspection!.gis = { suggestedTitle: 'Protocol control', suggestedNamespace: 'Protocol control' };
  const teacher = mock.method(AdaptiveMappingService.prototype, 'propose', async (_case: string,
    _source: string, raw: unknown) => {
    const request = AdaptiveMappingRequestSchema.parse(raw);
    return AdaptiveMappingResponseSchema.parse({ version: 'adaptive-geojson-proposal/1',
      requestKey: request.requestKey,
      source: request.source, workspaceRevision: request.workspaceRevision,
      workspaceFingerprint: request.workspaceFingerprint, status: 'proposed', code: null,
      plan: { ...plan, source: request.source, workspaceRevision: request.workspaceRevision,
        workspaceFingerprint: request.workspaceFingerprint },
      validationErrors: [], call: null, validation: 'mechanics_only', reviewRequired: true });
  });
  mock.method(ManualIngestionService.prototype, 'author', async (_case: string, _source: string, raw: unknown) => {
    const request = raw as { requestKey: string; plan: MappingReceipt['plan'] };
    const receipt: MappingReceipt = { ...remembered, revision: 1, state: 'proposed', plan: request.plan,
      approval: null, execution: null };
    fixture.state.receipt = receipt;
    fixture.state.recipeRevision = receipt.revision;
    fixture.state.operations.set(`manual-author:${request.requestKey}`, { result: receipt });
    return receipt;
  });
  return teacher;
}

for (const path of ['E:/BhuAayam-data/datasets/nyc-10013/files/buildings-original.geojson',
  'fixtures/usp/D4/gf0-context-v1/osm-road-centrelines.geojson']) {
  test(`layer meanings: one masked replay, unknown columns only, durable candidates: ${path}`, async () => {
    const bytes = readFileSync(path);
    const originalHash = sha256(bytes);
    const features = JSON.parse(bytes.toString('utf8')).features;
    const fixture = protocol();
    Object.assign(fixture.src, { bytes: bytes.length, sha256: originalHash });
    fixture.tray.card = { ...fixture.tray.card, format: 'geojson' } as DraftItem['card'];
    const card = await probeOriginal(async (start, end) => bytes.subarray(start, end), bytes.length, path);
    const profiled = profileGisAttributes(features.slice(0, 100).map((feature: any) => feature.properties)).profile;
    const known = new Set(proposeMappingRules(profiled).map(rule => rule.field.sourceField));
    const unknown = profiled.columns.filter(column => !known.has(column.name)).map(column => column.name);
    const jobId = await queueIntakeDraftTx(fixture.client, fixture.src);
    await tableCommands(fixture, bytes, async () => {
      mock.getter(settings, 'teacherCaseOriginals', () => 'masked_profile');
      const layoutTeacher = replayLayout(fixture);
      const propose = ModelGateway.prototype.propose;
      const requests: any[] = [];
      mock.method(ModelGateway.prototype, 'propose', async function (this: ModelGateway,
        ...[context, request, trusted]: Parameters<ModelGateway['propose']>) {
        const sent = JSON.parse((request.input as any).messages[1].content).columnProfile;
        requests.push(sent);
        assert.equal(sent.sourceKind, 'gis_attributes');
        assert.deepEqual(sent.columns.map((column: any) => column.header), unknown);
        for (const column of sent.columns) {
          assert(column.maskedSamples.length <= 5);
          assert(column.maskedSamples.every((sample: string) => !/[0-9०-९@]|phone|email/i.test(sample)));
          const observed = profiled.columns.find(value => value.name === column.header)!;
          assert.deepEqual(column.valueShapes, observed.valueShapes);
        }
        const output = { fields: sent.columns.map((column: any) => ({ sourceField: column.sourceField,
          target: 'unknown', operation: { kind: 'copy' }, confidence: 'none',
          rationale: 'Review the source before assigning a meaning.' })) };
        const response = { output, responseHash: gatewayHash(output), httpStatus: 200 };
        const adapter = new ReplayAdapter(async replayKey => ({ inputHash: replayKey, replayKey,
          sourceHashes: trusted.sourceHashes, responseHash: gatewayHash(response), response, eligible: true }));
        const replay = new ModelGateway(this.config, { reserve: async () => {
          assert.fail('Replay cannot reserve a live provider request.');
        } } as unknown as PgModelCallLedger, adapter);
        return propose.call(replay, context, request, trusted);
      });
      await runIntakeDraftJob(jobId!);
      assert.equal(requests.length, 1);
      assert(requests[0].columns.some((column: any) => column.maskedSamples.length === 5));
      assert.equal(layoutTeacher.mock.callCount(), 1, 'The existing layout proposal still runs independently.');
      assert.equal(fixture.jobs[0].status, 'succeeded');
      assert.equal(fixture.state.projection.state, 'planned', 'Same proposed-layout state as the base path.');
      assert.equal(fixture.state.projection.placement, 'undecided');
      assert.equal(fixture.state.projection.plan_ref.recipeState, 'proposed');
      assert.equal(fixture.state.projection.plan_ref.origin, 'teacher');
      const row = fixture.state.projection;
      const meanings = row.plan_ref.layerMeanings;
      assert.equal(meanings.labelKind, 'pseudo_label');
      assert.equal(meanings.sourceSha256, originalHash);
      assert.equal(meanings.replayed, true);
      assert.equal(meanings.attempts, 1);
      assert.equal([...fixture.state.operations.keys()].filter(key => key.startsWith('intake-layer-meanings:'))
        .length, 1);
      const reading = readingOf({ ...row, source_id: sourceId }, card);
      const named = reading.fields.filter(field => field.basis === 'sarvam');
      assert.deepEqual(named.map(field => field.field.split('/').at(-1)), unknown);
      assert(named.every(field => /candidate.*not confirmed/i.test(field.words)));
      const published = intakeItem({ ...fixture.tray, ...row, card, name: path, format: 'geojson',
        size_bytes: bytes.length, size_class: 'S', wave: 1, member_path: null, card_sha256: null,
        probe_version: null, parts_planned: null, parts_done: 0, pinned_by_officer: false,
        created_at: new Date(), updated_at: new Date() });
      assert.equal(published.plan?.recipeId, fixture.state.receipt!.id);
      assert.equal(published.plan?.recipeState, 'proposed', 'Supplemental meanings do not hide the recipe.');
      assert(!fixture.statements.some(sql => /INSERT INTO registry_/.test(sql)));
      fixture.jobs[0].status = 'queued';
      fixture.state.attempt = undefined;
      await runIntakeDraftJob(jobId!);
      assert.equal(requests.length, 1, 'A replayed draft uses the operations row, not another teacher call.');
      const nextJob = await queueIntakeDraftTx(fixture.client, fixture.src);
      assert.notEqual(nextJob, jobId);
      fixture.state.attempt = undefined;
      await runIntakeDraftJob(nextJob!);
      assert.equal(requests.length, 1, 'A later layout revision reuses the same source meanings.');
      assert.equal(readingOf({ ...row, source_id: caseId }, card).fields.length, 0, 'A different source is ignored.');
      assert.equal(sha256(readFileSync(path)), originalHash);
    });
  });
}

for (const scenario of ['large count', 'large content', 'kml', 'parse error', 'teacher error']) {
  test(`optional layer meanings preserve the base draft outcome on ${scenario}`, async () => {
    const original = readFileSync('E:/BhuAayam-data/datasets/nyc-10013/files/buildings-original.geojson');
    let bytes = original;
    if (scenario.startsWith('large')) {
      const collection = JSON.parse(original.toString('utf8'));
      // Count-bound control: repeat retained features, without inventing geometry or property values.
      const features = [...collection.features, ...collection.features];
      bytes = Buffer.from(JSON.stringify({ ...collection, features }));
    }
    if (scenario === 'kml' || scenario === 'parse error')
      bytes = readFileSync('E:/BhuAayam-data/task-data/desktop-kml-native/originals/kmlsamples.kml');
    const outcomes: Record<string, any>[] = [];
    for (const mode of ['off', 'masked_profile'] as const) {
      const fixture = protocol();
      Object.assign(fixture.src, { bytes: bytes.length, sha256: sha256(bytes) });
      fixture.tray.card = { ...fixture.tray.card, format: 'geojson' } as DraftItem['card'];
      const jobId = await queueIntakeDraftTx(fixture.client, fixture.src);
      if (scenario === 'large count')
        fixture.src.inspection!.manualProfile.featureCount = JSON.parse(bytes.toString('utf8')).features.length;
      if (scenario === 'kml') fixture.tray.card!.format = 'kml';
      await tableCommands(fixture, bytes, async () => {
        mock.getter(settings, 'teacherCaseOriginals', () => mode);
        const meanings = mock.method(ModelGateway.prototype, 'propose', async () => {
          throw new Error('Field interpretation is unavailable.');
        });
        const layout = mock.method(AdaptiveMappingService.prototype, 'propose', async () =>
          AdaptiveMappingResponseSchema.parse({ version: 'adaptive-geojson-proposal/1', requestKey: caseId,
            source: profile.source, workspaceRevision: 0, workspaceFingerprint: hash, status: 'disabled',
            code: 'MODEL_DISABLED', plan: null, validationErrors: [], call: null,
            validation: 'mechanics_only', reviewRequired: true }));
        await runIntakeDraftJob(jobId!);
        assert.equal(meanings.mock.callCount(), mode === 'masked_profile' && scenario === 'teacher error' ? 1 : 0);
        assert.equal(layout.mock.callCount(), mode === 'masked_profile' ? 1 : 0);
        assert.equal(fixture.state.projection.plan_ref.layerMeanings, undefined);
        assert.equal(fixture.state.projection.state, 'probed');
        assert.equal(fixture.jobs[0].status, 'succeeded');
        outcomes.push(fixture.state.projection);
      });
    }
    assert.deepEqual(outcomes[1], outcomes[0], 'Only the optional meanings step differs from the base path.');
  });
}

test('optional meanings never swallow an error from the existing layout path', async () => {
  const bytes = readFileSync('E:/BhuAayam-data/datasets/nyc-10013/files/buildings-original.geojson');
  const fixture = protocol();
  Object.assign(fixture.src, { bytes: bytes.length, sha256: sha256(bytes) });
  fixture.tray.card = { ...fixture.tray.card, format: 'geojson' } as DraftItem['card'];
  const jobId = await queueIntakeDraftTx(fixture.client, fixture.src);
  await tableCommands(fixture, bytes, async () => {
    mock.getter(settings, 'teacherCaseOriginals', () => 'masked_profile');
    mock.method(ModelGateway.prototype, 'propose', async () => { throw new Error('Meanings unavailable.'); });
    mock.method(AdaptiveMappingService.prototype, 'propose', async () => { throw new Error('Layout failed.'); });
    await assert.rejects(runIntakeDraftJob(jobId!), /Layout failed/);
    assert.equal(fixture.jobs[0].status, 'failed');
  });
});

test('layer meanings: switch off never reaches a gateway or reads sample cells', async () => {
  const bytes = readFileSync('E:/BhuAayam-data/datasets/nyc-10013/files/buildings-original.geojson');
  const fixture = protocol();
  Object.assign(fixture.src, { bytes: bytes.length, sha256: sha256(bytes) });
  fixture.tray.card = { ...fixture.tray.card, format: 'geojson' } as DraftItem['card'];
  const jobId = await queueIntakeDraftTx(fixture.client, fixture.src);
  await tableCommands(fixture, bytes, async () => {
    mock.getter(settings, 'teacherCaseOriginals', () => 'off');
    const teacher = mock.method(ModelGateway.prototype, 'propose', async () =>
      assert.fail('A refused profile cannot dispatch.'));
    mock.method(AdaptiveMappingService.prototype, 'propose', async () => assert.fail('No layout teacher is allowed.'));
    await runIntakeDraftJob(jobId!);
    assert.equal(teacher.mock.callCount(), 0);
    assert.equal(fixture.state.projection.plan_ref.layerMeanings, undefined);
  });
});

/** S9.5c. Another file of the batch moves the case while a table draft settles; `change` alters the rest. */
function staleAtSettle(fixture: Awaited<ReturnType<typeof tableProtocol>>, times: number, change = () => {}) {
  const query = fixture.client.query.bind(fixture.client);
  let left = times;
  (fixture.client as any).query = async (sql: string, values: any[]) => {
    if (left > 0 && sql.startsWith('UPDATE usp_intake_items SET state=') && values[2] === 'read') {
      left--;
      fixture.state.revision++;
      change();
      throw new AppError(409, 'STALE_REVISION', 'Another file of the batch moved the case.');
    }
    return query(sql, values);
  };
}

async function staleTableRuns(times: number, change?: (fixture: Awaited<ReturnType<typeof tableProtocol>>) => void) {
  const bytes = readFileSync('fixtures/usp/D4/reference-area-gurugram-59-63a/lgd-gurugram.csv');
  const fixture = await tableProtocol(bytes, 'lgd-gurugram.csv');
  await queueIntakeDraftTx(fixture.client, fixture.src, fixture.tray.card!);
  staleAtSettle(fixture, times, () => change?.(fixture));
  await tableCommands(fixture, bytes, async () => {
    mock.method(StreamingVectorService.prototype, 'enqueue', async () => ({ jobId: sourceId }));
    mock.method(ChunkMappingService.prototype, 'enqueue', async () => ({ jobId: caseId }));
    for (let run = 0; run <= times; run++) {
      const job = fixture.jobs.filter(row => row.operation === 'intake-draft')[run];
      if (!job) break;
      if (run < times) await assert.rejects(runIntakeDraftJob(job.id), { code: 'STALE_REVISION' });
      else await runIntakeDraftJob(job.id);
    }
  });
  return { fixture, drafts: fixture.jobs.filter(row => row.operation === 'intake-draft'), bytes };
}

test('a stale table draft is queued once more under the current case revision, and its item settles', async () => {
  const { fixture, drafts, bytes } = await staleTableRuns(1);
  assert.equal(drafts.length, 2);
  assert.deepEqual([drafts[0].status, drafts[0].error], ['stale', 'STALE_REVISION']);
  const next = IntakeDraftInputSchema.parse(drafts[1].payload);
  const first = IntakeDraftInputSchema.parse(drafts[0].payload);
  assert.equal(next.requeue, 1);
  assert.equal(next.caseRevision, fixture.state.revision);
  assert(next.caseRevision > first.caseRevision);
  assert.deepEqual([next.sourceRevision, next.sourceSha256, next.sourcePin, next.tableSelection],
    [first.sourceRevision, first.sourceSha256, first.sourcePin, first.tableSelection]);
  assert.equal(drafts[1].status, 'succeeded');
  assert.equal(fixture.state.projection.state, 'read');
  assert.match(fixture.state.projection.limit_reason, /being proposed/);
  assert.equal(fixture.src.sha256, sha256(bytes));
});

test('a third stale end of the same draft is kept as it is, after two re-queues', async () => {
  const { fixture, drafts } = await staleTableRuns(3);
  assert.equal(drafts.length, 3);
  assert.deepEqual(drafts.map(job => [job.status, job.error, job.payload.requeue]),
    [['stale', 'STALE_REVISION', undefined], ['stale', 'STALE_REVISION', 1], ['stale', 'STALE_REVISION', 2]]);
  assert.equal(fixture.state.projection.state, 'reading');
});

test('a changed source or an officer-written recipe keeps the stale end without another draft job', async () => {
  for (const change of ['source', 'officer'] as const) {
    const { fixture, drafts } = await staleTableRuns(1, current => {
      if (change === 'source') current.src.sha256 = 'b'.repeat(64);
      else current.state.receipt = remembered;
    });
    assert.equal(drafts.length, 1, change);
    assert.deepEqual([drafts[0].status, drafts[0].error], ['stale', 'STALE_REVISION']);
    assert(fixture.statements.includes('SAVEPOINT intake_draft_requeue'));
    if (change === 'source') assert(fixture.statements.includes('ROLLBACK TO SAVEPOINT intake_draft_requeue'));
  }
});
