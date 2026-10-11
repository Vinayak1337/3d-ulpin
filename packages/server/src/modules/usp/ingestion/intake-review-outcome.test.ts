import assert from 'node:assert/strict';
import test from 'node:test';
import type { ImportPackage } from '@ulpin/contracts';
import type { Pool, PoolClient } from 'pg';
import { IntakeTargetPackageSchema } from '@ulpin/contracts/usp';
import { holdPackageTargetsTx, listIntakeTargets, prepareIntakeTargetsTx } from './intake-targets';

const caseId = '10000000-0000-4000-8000-000000000001';
const packageId = '10000000-0000-4000-8000-000000000002';
const message = 'Spatial analysis is not assessed: changed or unqualified geometry '
  + 'requires its own canonical qualification.';
const refusal = { code: 'USP_GEOMETRY_PAYLOAD_UNQUALIFIED', message };

function protocol(buildings: boolean) {
  const item = { state: 'read', placement: 'on_map', limit_reason: null as string | null,
    review_refusal_code: null as string | null, review_refusal_message: null as string | null };
  const target = { target_id: packageId, case_id: caseId, feature_id: packageId, stage: 2,
    readiness: 'preparing', reason: null as string | null, blocked_by: [] as string[] };
  const calls: { sql: string; values: any[] }[] = [];
  const client = { release() {}, query: async (sql: string, values: any[] = []) => {
    calls.push({ sql, values });
    if (sql.startsWith('UPDATE usp_intake_items SET review_refusal_code')) {
      assert(!/SET state|placement=/.test(sql));
      if (item.review_refusal_code === values[1] && item.review_refusal_message === values[2]) {
        return { rows: [] };
      }
      if (values[1] || item.limit_reason === item.review_refusal_message) item.limit_reason = values[2];
      item.review_refusal_code = values[1];
      item.review_refusal_message = values[2];
      return { rows: [{ item_id: caseId, case_id: caseId }] };
    }
    if (sql.startsWith('UPDATE usp_intake_targets t SET readiness=d.readiness')) {
      Object.assign(target, { readiness: values[1][0], reason: values[2][0], blocked_by: [] });
      return { rows: buildings ? [target] : [] };
    }
    if (sql.startsWith('UPDATE usp_intake_targets SET readiness')) {
      Object.assign(target, { readiness: 'held', reason: values[2], blocked_by: [values[1]] });
      return { rows: buildings ? [target] : [] };
    }
    return projection(sql, buildings, item, target);
  } } as unknown as PoolClient;
  return { item, target, calls, client, pool: { connect: async () => client } as unknown as Pool };
}

type Item = { state: string; placement: string; limit_reason: string | null;
  review_refusal_code: string | null; review_refusal_message: string | null };
type Target = { target_id: string; case_id: string; feature_id: string; stage: number;
  readiness: string; reason: string | null; blocked_by: string[] };

function projection(sql: string, buildings: boolean, item: Item, target: Target) {
  if (sql.startsWith('SELECT target_id,case_id,feature_id')) return { rows: buildings ? [target] : [] };
  if (sql.startsWith('SELECT item_id AS')) return { rows: [{ itemId: caseId, state: item.state,
    family: 'vector', format: 'geojson', sizeClass: 'S', wave: 1, pinnedByOfficer: false }] };
  if (sql.startsWith('SELECT id,revision,archived')) return { rows: [{ id: caseId, revision: 0, archived: false }] };
  if (sql.startsWith('SELECT revision')) return { rows: [{ revision: 0 }] };
  if (sql.startsWith('SELECT * FROM usp_intake_targets')) return { rows: [] };
  if (sql.startsWith('SELECT p.id AS package_id')) return { rows: [{ package_id: packageId,
    anchor_item_id: caseId }] };
  if (sql.startsWith('SELECT package_id,min')) return { rows: [] };
  if (sql.startsWith('WITH packages AS')) return { rows: [{ id: packageId, area_id: caseId,
    revision: 1, state: 'READY_FOR_REVIEW', review_fingerprint: null, finding_counts: null,
    review_refusal: item.review_refusal_code ? { code: item.review_refusal_code,
      message: item.review_refusal_message } : null }] };
  if (/^(BEGIN|COMMIT|ROLLBACK|INSERT INTO usp_outbox|UPDATE usp_outbox_streams)/.test(sql)) {
    return { rows: [{ sequence: '1' }] };
  }
  throw new Error(sql);
}

async function page(control: ReturnType<typeof protocol>) {
  const globals = globalThis as unknown as { ulpinPool?: Pool };
  const previous = globals.ulpinPool;
  globals.ulpinPool = control.pool;
  try { return await listIntakeTargets(caseId, undefined, undefined); }
  finally { globals.ulpinPool = previous; }
}

function reviewed(buildings: boolean): ImportPackage {
  return { id: packageId, revision: 2, review: { packageRevision: 2, findings: [] },
    sourceRevisionIds: [caseId],
    features: buildings ? [{ id: packageId, revision: 0, kind: 'building', worldStatus: 'observed',
      properties: {}, sourceRevisionId: caseId, evidence: [{ sourceRevisionId: caseId }],
      height: { value: null }, geometryRole: 'unknown' }] : [] } as unknown as ImportPackage;
}

for (const buildings of [false, true]) {
  const targetDescription = buildings ? 'a building' : 'no building';
  test(`review refusal publishes code and words with ${targetDescription}, then clears`, async () => {
    process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'review-outcome-protocol';
    const control = protocol(buildings);
    assert.equal((await page(control)).packages[0].reviewRefusal, null);
    await holdPackageTargetsTx(control.client, caseId, packageId, refusal.code, refusal.message);
    assert.equal(control.item.state, 'read');
    assert.equal(control.item.placement, 'on_map');
    assert.equal(control.item.limit_reason, message);
    assert.deepEqual((await page(control)).packages[0].reviewRefusal, refusal);
    const itemEvents = control.calls.filter(call => call.sql.startsWith('SELECT item_id AS')).length;
    await holdPackageTargetsTx(control.client, caseId, packageId, refusal.code, refusal.message);
    assert.equal(control.calls.filter(call => call.sql.startsWith('SELECT item_id AS')).length, itemEvents);
    if (buildings) {
      assert.equal(control.target.readiness, 'held');
      assert.equal(control.target.reason, message);
      assert.deepEqual(control.target.blocked_by, [refusal.code]);
    }
    await prepareIntakeTargetsTx(control.client, reviewed(buildings));
    assert.equal((await page(control)).packages[0].reviewRefusal, null);
    assert.equal(control.item.limit_reason, null);
    if (buildings) assert.equal(control.target.readiness, 'ready');
    const projections = control.calls.filter(call => call.sql.startsWith('WITH packages AS'));
    assert.equal(projections.length, 3);
    assert(projections.every(call => !/features|SELECT p\.body\b|FROM jobs/.test(call.sql)));
    assert(projections.every(call => /LIMIT 101/.test(call.sql)));
  });
}

test('an incomplete review cannot clear a refusal, and passing review preserves a different item reason', async () => {
  const control = protocol(false);
  await holdPackageTargetsTx(control.client, caseId, packageId, refusal.code, message);
  await prepareIntakeTargetsTx(control.client, { ...reviewed(false), revision: 3 });
  assert.equal(control.item.review_refusal_code, refusal.code);
  control.item.limit_reason = 'A different retained limit remains.';
  await prepareIntakeTargetsTx(control.client, reviewed(false));
  assert.equal(control.item.review_refusal_code, null);
  assert.equal(control.item.limit_reason, 'A different retained limit remains.');
});

test('the additive nullable refusal member accepts only the code and words', () => {
  const control = { packageId, areaId: caseId, anchorItemId: caseId, revision: 1, state: 'READY_FOR_REVIEW',
    reviewFingerprint: null, findingCounts: null, reviewRefusal: refusal,
    counts: { preparing: 0, ready: 0, needs_answer: 0, held: 0, confirmed: 0, recorded: 0, carded: 0, stopped: 0 } };
  assert(IntakeTargetPackageSchema.safeParse(control).success);
  assert(IntakeTargetPackageSchema.safeParse({ ...control, reviewRefusal: null }).success);
  assert(!IntakeTargetPackageSchema.safeParse({ ...control, reviewRefusal: { code: refusal.code } }).success);
  assert(!IntakeTargetPackageSchema.safeParse({ ...control, reviewRefusal: { ...refusal, retry: true } }).success);
});
