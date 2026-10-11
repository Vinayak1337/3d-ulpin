import assert from 'node:assert/strict';
import test from 'node:test';
import type { ImportPackage, PhysicalFeature } from '@ulpin/contracts';
import type { Pool, PoolClient } from 'pg';
import { IntakeConfirmedPackageSchema } from '@ulpin/contracts/usp';
import { intakeTargetReadiness, listIntakeTargets, targetLocator } from './intake-targets';
import { packageDifference } from './intake-confirmations';
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

function packagePageProtocol(size: number) {
  const packages = Array.from({ length: size }, (_, index) => ({
    id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    area_id: sourceId, revision: 2, state: 'REVIEWED', review_fingerprint: 'a'.repeat(64),
    finding_counts: { BOUNDARY_CONTACT: 1 },
  }));
  const calls: { sql: string; values: unknown[] }[] = [];
  const client = { release() {}, query: async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    if (sql.startsWith('SELECT id,revision,archived')) return { rows: [{ id, revision: 0, archived: false }] };
    if (sql.startsWith('SELECT * FROM usp_intake_targets')) return { rows: [] };
    if (sql.startsWith('SELECT package_id,min')) return { rows: packages.map(row => ({
      package_id: row.id, anchor_item_id: id, readiness: 'ready', count: 2,
    })) };
    if (sql.startsWith('WITH packages AS')) return { rows: packages.slice(0, 101) };
    assert(['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql), sql);
    return { rows: [] };
  } } as unknown as PoolClient;
  return { packages, calls, pool: { connect: async () => client } as unknown as Pool };
}

test('every target page publishes unfiltered package facts that the confirmation accepts unchanged', async () => {
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'e1-protocol-operator';
  const globals = globalThis as unknown as { ulpinPool?: Pool };
  const previous = globals.ulpinPool;
  const fixture = packagePageProtocol(1);
  globals.ulpinPool = fixture.pool;
  try {
    const first = await listIntakeTargets(id, undefined, undefined);
    const next = await listIntakeTargets(id, 'held', sourceId);
    assert.deepEqual(first.packages, next.packages);
    assert.equal(first.packagesTruncated, false);
    assert.equal(first.counts.ready, 2);
    const entry = first.packages[0];
    const named = IntakeConfirmedPackageSchema.parse({ packageId: entry.packageId,
      revision: entry.revision, reviewFingerprint: entry.reviewFingerprint });
    const current = { ...pkg, state: entry.state, revision: entry.revision,
      review: { ...review, inputFingerprint: entry.reviewFingerprint!, packageRevision: entry.revision } };
    assert.equal(packageDifference(named, current), null);
    assert.match(packageDifference(named, { ...current, revision: 3 })!, /no|revision/);
    assert.match(packageDifference(named, { ...current, state: 'COMMITTED' })!, /already recorded/);
    const projections = fixture.calls.filter(call => call.sql.startsWith('WITH packages AS'));
    assert.equal(projections.length, 2);
    assert(projections.every(call => !/features|SELECT p\.body\b/.test(call.sql)));
  } finally {
    globals.ulpinPool = previous;
  }
});

test('a case with more than 100 packages publishes the first 100 without refusing its targets', async () => {
  const globals = globalThis as unknown as { ulpinPool?: Pool };
  const previous = globals.ulpinPool;
  const fixture = packagePageProtocol(101);
  globals.ulpinPool = fixture.pool;
  try {
    const page = await listIntakeTargets(id, undefined, undefined);
    assert.equal(page.packages.length, 100);
    assert.equal(page.packagesTruncated, true);
    assert.deepEqual(page.packages.map(row => row.packageId), fixture.packages.slice(0, 100).map(row => row.id));
    assert.equal(page.counts.ready, 202);
  } finally {
    globals.ulpinPool = previous;
  }
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
