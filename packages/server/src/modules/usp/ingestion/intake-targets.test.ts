import assert from 'node:assert/strict';
import test from 'node:test';
import type { ImportPackage, PhysicalFeature } from '@ulpin/contracts';
import type { Pool, PoolClient } from 'pg';
import { IntakeConfirmedPackageSchema } from '@ulpin/contracts/usp';
import { createIntakeTargetsTx, intakeTargetReadiness, listIntakeTargets, readIntakeTargetByFeature,
  targetLocator } from './intake-targets';
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

type PackagePlace = { recorded: boolean; part: number | null };

/** A store answering the target read's own SQL; `recording` maps a package to the confirmation whose run records it. */
function packagePageProtocol(size: number, zeroTargets = false,
  place: (index: number) => PackagePlace = () => ({ recorded: false, part: null }),
  recording: Record<string, string> = {}) {
  const packages = Array.from({ length: size }, (_, index) => ({
    id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    area_id: sourceId, revision: 2, state: place(index).recorded ? 'COMMITTED' : 'REVIEWED',
    review_fingerprint: 'a'.repeat(64), finding_counts: { BOUNDARY_CONTACT: 1 },
  }));
  const calls: { sql: string; values: unknown[] }[] = [];
  const client = { release() {}, query: async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    if (sql.startsWith('SELECT id,revision,archived')) return { rows: [{ id, revision: 0, archived: false }] };
    if (sql.startsWith('SELECT * FROM usp_intake_targets')) return { rows: [] };
    if (sql.startsWith('SELECT p.id AS package_id')) return { rows: packages.map(row => ({
      package_id: row.id, anchor_item_id: id,
    })) };
    if (sql.startsWith('SELECT package_id,min')) return { rows: zeroTargets ? [] : packages.map(row => ({
      package_id: row.id, anchor_item_id: id, readiness: 'ready', count: 2,
    })) };
    if (sql.startsWith('SELECT p.id,p.state')) return { rows: packages.map((row, index) => ({ id: row.id,
      recorded: place(index).recorded, item_id: place(index).part === null ? null : sourceId,
      part_index: place(index).part })).reverse() };
    if (sql.startsWith('WITH packages AS')) {
      return { rows: packages.filter(row => (values[0] as string[]).includes(row.id)) };
    }
    if (sql.startsWith('SELECT DISTINCT ON (p.id)')) return { rows: (values[1] as string[])
      .filter(packageId => recording[packageId]).map(packageId => ({ package_id: packageId,
        confirmation_id: recording[packageId] })) };
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
    for (const { sql } of projections) {
      assert.equal(sql.match(/p\.body\b/g)?.length, 1, 'one body input per package');
      assert.match(sql, /CROSS JOIN LATERAL jsonb_to_record\(p\.body\)/);
      assert.match(sql, /WITH packages AS MATERIALIZED/);
      assert.doesNotMatch(sql, /features|p\.body->/);
    }
    const drafted = fixture.calls.find(call => call.sql.startsWith('SELECT p.id AS package_id'))!.sql;
    assert.match(drafted, /UNION ALL/);
    assert.doesNotMatch(drafted, /OR EXISTS/);
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

test('250 packages, 120 recorded: unrecorded first in file part order, then recorded, 100 a page', async () => {
  const globals = globalThis as unknown as { ulpinPool?: Pool };
  const previous = globals.ulpinPool;
  // Every third package of the first 180 is unrecorded, and so is every one from 180; parts run backwards by id.
  const fixture = packagePageProtocol(250, false, index => ({ recorded: index < 180 && index % 3 !== 0,
    part: index < 240 ? 249 - index : null }));
  globals.ulpinPool = fixture.pool;
  try {
    const ids = fixture.packages.map(row => row.id);
    const unrecorded = ids.filter((_, index) => index >= 180 || index % 3 === 0);
    const filed = (rows: string[]) => [...rows.filter(id => ids.indexOf(id) < 240).reverse(),
      ...rows.filter(id => ids.indexOf(id) >= 240)];
    const expected = [...filed(unrecorded), ...filed(ids.filter(id => !unrecorded.includes(id)))];
    assert.equal(unrecorded.length, 130);
    const pages = [await listIntakeTargets(id, undefined, undefined)];
    while (pages.at(-1)!.packagesNextCursor) {
      pages.push(await listIntakeTargets(id, undefined, undefined, pages.at(-1)!.packagesNextCursor!));
    }
    assert.deepEqual(pages.map(page => page.packages.length), [100, 100, 50]);
    assert.deepEqual(pages.flatMap(page => page.packages.map(row => row.packageId)), expected);
    assert(pages[0].packages.every(row => row.state !== 'COMMITTED'));
    assert.deepEqual(pages[1].packages.map(row => row.state !== 'COMMITTED'),
      [...Array(30).fill(true), ...Array(70).fill(false)]);
    assert.deepEqual(pages.map(page => [page.packagesTotal, page.packagesUnrecorded, page.packagesUnrecordedAfter,
      page.packagesTruncated]), [[250, 130, 30, true], [250, 130, 0, true], [250, 130, 0, true]]);
    assert.equal(pages[2].packagesNextCursor, null);
    const again = await listIntakeTargets(id, 'ready', undefined, pages[0].packagesNextCursor!);
    assert.deepEqual(again.packages, pages[1].packages);
    assert.equal(again.packagesNextCursor, pages[1].packagesNextCursor);
    assert.deepEqual(pages.map(page => page.counts.ready), [500, 500, 500]);
    const reads = fixture.calls.filter(call => /^(WITH packages AS|SELECT p\.id,p\.state)/.test(call.sql));
    assert(reads.every(call => !/features|SELECT p\.body\b/.test(call.sql)));
    await assert.rejects(listIntakeTargets(id, undefined, undefined, 'bm90LWEta2V5'),
      (error: { code?: string }) => error.code === 'INTAKE_TARGET_QUERY');
  } finally {
    globals.ulpinPool = previous;
  }
});

test('a package a confirmation is recording says so on the page; the others say none', async () => {
  const globals = globalThis as unknown as { ulpinPool?: Pool };
  const previous = globals.ulpinPool;
  const confirmationId = '10000000-0000-4000-8000-000000000900';
  const fixture = packagePageProtocol(3, false, undefined,
    { '10000000-0000-4000-8000-000000000002': confirmationId });
  globals.ulpinPool = fixture.pool;
  try {
    const page = await listIntakeTargets(id, undefined, undefined);
    assert.deepEqual(page.packages.map(row => row.recordingConfirmationId), [null, confirmationId, null]);
    assert.equal(page.counts.ready, 6);
    const asked = fixture.calls.filter(call => call.sql.startsWith('SELECT DISTINCT ON (p.id)'));
    assert.equal(asked.length, 1);
    assert.deepEqual(asked[0].values, [id, fixture.packages.map(row => row.id), null]);
    assert.match(asked[0].sql, /j\.status IN \('queued','running'\) AND j\.payload->>'phase'='commit'/);
    assert.match(asked[0].sql, /p\.state<>'COMMITTED'/);
    assert(!/p\.body/.test(asked[0].sql));
  } finally {
    globals.ulpinPool = previous;
  }
});

test('a drafted item with no building is listed as a confirmable package with zero counts', async () => {
  const globals = globalThis as unknown as { ulpinPool?: Pool };
  const previous = globals.ulpinPool;
  const fixture = packagePageProtocol(1, true);
  globals.ulpinPool = fixture.pool;
  try {
    const page = await listIntakeTargets(id, undefined, undefined);
    assert.equal(page.items.length, 0);
    assert.equal(page.packages.length, 1);
    assert.equal(page.packages[0].anchorItemId, id);
    assert(Object.values(page.packages[0].counts).every(count => count === 0));
    assert.equal(page.packages[0].reviewFingerprint, 'a'.repeat(64));
  } finally {
    globals.ulpinPool = previous;
  }
});

test('zero buildings still requests preparation; a prior prepare job prevents a second request', async () => {
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'e1-protocol-operator';
  let prepared = false;
  let queued = 0;
  const client = { query: async (sql: string) => {
    if (sql.startsWith('INSERT INTO usp_intake_targets')) return { rows: [] };
    if (sql.startsWith('SELECT id FROM jobs WHERE case_id')) return { rows: prepared ? [{ id }] : [] };
    if (sql.startsWith('SELECT id FROM jobs WHERE operation')) {
      queued++;
      prepared = true;
      return { rows: [{ id }] };
    }
    throw new Error(sql);
  } } as unknown as PoolClient;
  const context = { ...pkg, features: [{ ...feature, kind: 'public_land' as const }] };
  assert.equal(await createIntakeTargetsTx(client, id, sourceId, context, sourceId), 0);
  assert.equal(await createIntakeTargetsTx(client, id, sourceId, context, sourceId), 0);
  assert.equal(queued, 1);
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

function byFeatureProtocol(targets: Record<string, unknown>[], archived = false) {
  const calls: { sql: string; values: unknown[] }[] = [];
  const client = { release() {}, query: async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    if (sql.startsWith('SELECT * FROM usp_intake_targets WHERE feature_id')) return { rows: targets };
    if (sql.startsWith('SELECT id,revision,archived')) return { rows: [{ id: values[0], revision: 0, archived }] };
    assert(['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql), sql);
    return { rows: [] };
  } } as unknown as PoolClient;
  return { calls, pool: { connect: async () => client } as unknown as Pool };
}

async function withPool<T>(pool: Pool, run: () => Promise<T>) {
  const globals = globalThis as unknown as { ulpinPool?: Pool };
  const previous = globals.ulpinPool;
  globals.ulpinPool = pool;
  try {
    return await run();
  } finally {
    globals.ulpinPool = previous;
  }
}

test('a building picked on the map finds its target in the packages that recorded it, with case access', async () => {
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'e1-protocol-operator';
  const caseId = '10000000-0000-4000-8000-000000000003';
  const row = { target_id: sourceId, case_id: caseId, anchor_item_id: id, package_id: id, feature_id: id,
    locator: 'feature protocol-key', kind: 'building', stage: 3, readiness: 'recorded', blocked_by: [],
    reason: 'Recorded with its package; not listed for a card.', confirmation_id: null, priority_at: null,
    artefacts: { record: { id, revision: 1 } }, updated_at: new Date('2026-10-21T00:00:00Z') };
  const recorded = byFeatureProtocol([row]);
  const target = await withPool(recorded.pool, () => readIntakeTargetByFeature(id, undefined));
  assert.equal(target.targetId, sourceId);
  assert.equal(target.readiness, 'recorded');
  assert.equal(target.confirmationId, null);
  const read = recorded.calls.find(call => call.sql.startsWith('SELECT * FROM usp_intake_targets'))!;
  assert.deepEqual(read.values, [id, null]);
  assert.match(read.sql, /physical_feature_revisions/);
  assert.match(read.sql, /ORDER BY stage DESC/);
  assert.deepEqual(recorded.calls.find(call => call.sql.startsWith('SELECT id,revision,archived'))!.values, [caseId]);

  const proposed = byFeatureProtocol([{ ...row, stage: 2, readiness: 'ready', artefacts: {} }]);
  assert.equal((await withPool(proposed.pool, () => readIntakeTargetByFeature(id, sourceId))).readiness, 'ready');
  assert.deepEqual(proposed.calls.find(call => call.sql.startsWith('SELECT * FROM usp_intake_targets'))!.values,
    [id, sourceId]);
});

test('no target is a 404, an archived case refuses, and a malformed id is refused before any read', async () => {
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'e1-protocol-operator';
  await assert.rejects(withPool(byFeatureProtocol([]).pool, () => readIntakeTargetByFeature(id, undefined)),
    (error: { status?: number }) => error.status === 404);
  const row = { target_id: sourceId, case_id: id, anchor_item_id: id, package_id: id, feature_id: id,
    locator: 'feature k', kind: 'building', stage: 8, readiness: 'carded', blocked_by: [], reason: null,
    confirmation_id: id, priority_at: null, artefacts: {}, updated_at: new Date() };
  await assert.rejects(withPool(byFeatureProtocol([row], true).pool, () => readIntakeTargetByFeature(id, undefined)),
    (error: { code?: string }) => error.code === 'INGESTION_CASE_ARCHIVED');
  const untouched = byFeatureProtocol([]);
  await assert.rejects(withPool(untouched.pool, () => readIntakeTargetByFeature('building-101', undefined)));
  assert.equal(untouched.calls.length, 0);
});
