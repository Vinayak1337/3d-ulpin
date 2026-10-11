import assert from 'node:assert/strict';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { SourceProfileSchema, AdaptiveMappingResponseSchema, type MappingReceipt } from '@ulpin/contracts/usp';
import { ingestionBinding } from './events';
import { intakeSourcePin, type IntakeSourceRow } from './intake-context';
import { IntakeDraftInputSchema, intakeDraftKey, intakeDraftLimit, queueIntakeDraftTx,
  assertIntakeDraftTx, type DraftItem } from './intake-draft';
import { proposeIntakeLayout } from './intake-draft-worker';
import { registerUspJobInputTx } from '../jobs';
import { fingerprint } from '../../cases/domain';

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
    state: 'probed', family: 'vector', plan_ref: null,
    card: { crs: { state: 'stated' } } as DraftItem['card'] };
}
function input() {
  return IntakeDraftInputSchema.parse({ version: 'intake-draft/1', jobId: intakeDraftKey(sourceId, 0, 'job'),
    caseId, itemId: sourceId, caseRevision: 0, sourceId, sourceRevision: 1, sourceSha256: hash,
    sourcePin: intakeSourcePin(source(), binding), recipeRevision: 0,
    subject: binding.subject, accessSha256: binding.access });
}
function protocol() {
  const src = source();
  const tray = item();
  const jobs: any[] = [];
  const statements: string[] = [];
  const client = { query: async (sql: string, values: any[]) => {
    statements.push(sql);
    if (sql.startsWith('INSERT INTO jobs')) {
      jobs.push({ id: values[0], case_id: values[1], source_id: values[2], operation: 'intake-draft',
        case_revision: values[3], input_fingerprint: values[4], payload: values[5] });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('SELECT * FROM usp_intake_items')) return { rows: [tray] };
    if (sql.startsWith('SELECT id,revision,archived FROM cases'))
      return { rows: [{ id: caseId, revision: 0, archived: false }] };
    if (sql.startsWith('SELECT * FROM sources')) return { rows: [src] };
    if (sql.startsWith('SELECT max(revision)')) return { rows: [{ revision: src.revision }] };
    if (sql.startsWith('SELECT revision FROM usp_mapping_recipes')
      || sql.startsWith('SELECT * FROM usp_job_metadata')) return { rows: [] };
    if (sql.startsWith('SELECT id,payload FROM jobs') || sql.startsWith('SELECT * FROM jobs'))
      return { rows: jobs.filter(row => row.id === values[0]) };
    if (sql.includes('FROM jobs') && sql.includes('status IN')) return { rows: jobs };
    if (sql.startsWith('SELECT pg_advisory') || sql.startsWith('INSERT INTO usp_job_metadata'))
      return { rows: [], rowCount: 1 };
    throw new Error(`Unexpected protocol SQL: ${sql}`);
  } } as unknown as PoolClient;
  return { client, src, tray, jobs, statements };
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
