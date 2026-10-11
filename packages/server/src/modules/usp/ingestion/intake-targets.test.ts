import assert from 'node:assert/strict';
import test from 'node:test';
import type { ImportPackage, PhysicalFeature } from '@ulpin/contracts';
import type { PoolClient } from 'pg';
import { intakeTargetReadiness, targetLocator } from './intake-targets';
import { appendIntakeTargetsTx } from './events';

const id = '10000000-0000-4000-8000-000000000001';
const sourceId = '10000000-0000-4000-8000-000000000002';
const feature = { id, revision: 0, kind: 'building', worldStatus: 'observed', properties: {},
  sourceRevisionId: sourceId, sourceKey: 'protocol-key', evidence: [{ sourceRevisionId: sourceId,
    featureId: 'protocol-key' }], height: { value: null }, geometryRole: 'unknown' } as PhysicalFeature;
const review = { packageRevision: 2, findings: [{ code: 'BUILDING_FOOTPRINT_OVERLAP', featureIds: [id] }] } as
  NonNullable<ImportPackage['review']>;
const pkg = { id, revision: 2, features: [feature], sourceRevisionIds: [sourceId], review } as ImportPackage;

test('review preparation is not an officer decision and a named overlap does not block commit', () => {
  assert.equal(intakeTargetReadiness({ featureId: id }, pkg, undefined).readiness, 'preparing');
  const ready = intakeTargetReadiness({ featureId: id }, pkg, review);
  assert.equal(ready.readiness, 'ready');
  assert.deepEqual(ready.blockedBy, []);
  assert.match(ready.reason, /BUILDING_FOOTPRINT_OVERLAP \(1\)/);
  assert.match(ready.reason, /unknown: role, height, floors, units/);
  assert.equal(feature.height.value, null);
  assert.equal(targetLocator(feature), 'feature protocol-key');
});

test('derived footprints and packages that are not reviewable are held, not resolved by the run', () => {
  const derived = structuredClone(pkg);
  derived.features[0].properties.spatialExtraction = {};
  assert.equal(intakeTargetReadiness({ featureId: id }, derived, review).readiness, 'held');
  const workspace = { ...pkg, sourceWorkspace: {} } as ImportPackage;
  assert.equal(intakeTargetReadiness({ featureId: id }, workspace, review).readiness, 'held');
  assert.equal(intakeTargetReadiness({ featureId: sourceId }, pkg, review).readiness, 'held');
});

test('bulk target events allocate contiguous sequences without replacing target ids with a count', async () => {
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'e1-protocol-operator';
  const calls: { sql: string; values: any[] }[] = [];
  const client = { query: async (sql: string, values: any[]) => {
    calls.push({ sql, values });
    return { rows: sql.startsWith('SELECT revision') ? [{ revision: 0 }] : [{ sequence: '12' }] };
  } } as unknown as PoolClient;
  await appendIntakeTargetsTx(client, id, [
    { target_id: id, readiness: 'ready', stage: 2 },
    { target_id: sourceId, readiness: 'ready', stage: 2 },
  ]);
  assert.equal(calls.length, 4);
  assert.equal(calls[2].values[1], 2);
  assert.match(calls[3].sql, /WITH ORDINALITY/);
  const changes = calls[3].values[3].map((body: string) => JSON.parse(body).change);
  assert.deepEqual(changes, [
    { kind: 'intake.target', targetId: id, readiness: 'ready', stage: 2 },
    { kind: 'intake.target', targetId: sourceId, readiness: 'ready', stage: 2 },
  ]);
});
