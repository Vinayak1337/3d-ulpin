import assert from 'node:assert/strict';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { assessPlanTx } from './plan-authority';
import { createPacketPlan, confirmPacketPlan, executePacketPlan } from './plan-service';
import { featurePropertiesExtract } from './feature-extract';
import { sha256 } from '../../../infrastructure/storage';
import { withFeaturePlan, uuid, type FeaturePlanStore } from './feature-plan.test-fixture';

function assess(store: FeaturePlanStore) {
  return assessPlanTx(store.pool() as unknown as PoolClient, store.ctx, store.input(), store.io.read);
}

for (const [index, key] of [[0, '345'], [1620, '1272393']] as const) {
  test(`NYC ${key}: captured index includes exact words, then confirms and executes (four mapped members compared)`,
    async () => withFeaturePlan(index, async store => {
      const assessment = await assess(store);
      const excerpt = featurePropertiesExtract(store.original, index)!;
      assert.equal(assessment.requiredContext, 'available');
      assert.equal(assessment.entries[0].state, 'included');
      assert.equal(assessment.entries[0].excerptSha256, sha256(excerpt));
      assert.equal(assessment.lines[0].excerpt, excerpt);
      assert.equal(Object.keys(store.features[0].body.properties).length, 4);
      const plan = await createPacketPlan(store.ctx,
        { input: store.input(), guard: { mode: 'create', requestKey: 'native-create' } }, store.io);
      const confirmation = await confirmPacketPlan(store.ctx, { planId: plan.planId, version: plan.version,
        planSha256: plan.planSha256, reviewed: true, guard: { mode: 'update', requestKey: 'native-confirm',
          expectedVersion: plan.version, expectedManifestId: plan.input.scope.manifestId } }, store.io);
      const execution = await executePacketPlan(store.ctx, { planId: plan.planId, version: plan.version,
        confirmationId: confirmation.confirmationId,
        guard: { mode: 'create', requestKey: 'native-execute' } }, store.io);
      assert.equal(execution.packet.status, 'complete');
      assert('included' in execution.packet);
      assert.equal(execution.packet.included.length, 1);
      const packet = store.cards.objects.get(store.packets[0].object_key)!;
      assert(Buffer.from(packet).toString().includes(excerpt.replaceAll('"', '""')));
    }));
}

test('one changed original byte fails integrity before feature extraction',
  async () => withFeaturePlan(0, async store => {
  store.original = Buffer.from(store.original);
  store.original[100] ^= 1;
  await assert.rejects(() => assess(store), { code: 'PACKET_PLAN_ORIGINAL_INTEGRITY', status: 422 });
}));

const refused: [string, (store: FeaturePlanStore) => void][] = [
  ['wrong sourceKey', store => { store.features[0].body.sourceKey = '345 '; }],
  ['wrong source revision', store => { store.features[0].body.sourceRevisionId = uuid(20); }],
  ['missing index', store => { delete store.features[0].body.sourceFeatureIndex; }],
  ['negative index', store => { store.features[0].body.sourceFeatureIndex = -1; }],
  ['fractional index', store => { store.features[0].body.sourceFeatureIndex = 1.5; }],
  ['two matching captured members', store => {
    store.features.push({ ...structuredClone(store.features[0]), id: uuid(10) });
  }],
  ['no captured feature', store => { store.features = []; }],
  ['wrong mapped member', store => { store.features[0].body.properties.bin = 'different'; }],
  ['index points at a different original feature', store => { store.features[0].body.sourceFeatureIndex = 1620; }],
  ['derived observation marker, including null', store => {
    store.features[0].body.properties.spatialExtraction = null;
  }],
  ['unmatched locator', store => {
    store.pointer.locator.locator = 'feature 999999999';
    store.pointer.legacyLocator = store.pointer.locator.locator;
    store.record.body.evidence[0].locator = store.pointer.locator.locator;
  }],
  ['floor target with its building feature in the closure', store => {
    store.record.kind = 'floor';
    store.record.id = uuid(10);
    store.target.ref.id = uuid(10);
  }],
];

for (const [name, change] of refused) {
  test(`${name}: blocked_required_context / exact_extract_unavailable`, async () => withFeaturePlan(0, async store => {
    change(store);
    const result = await assess(store);
    assert.equal(result.requiredContext, 'blocked');
    assert.equal(result.entries[0].state, 'blocked_required_context');
    assert.equal(result.entries[0].reasonCode, 'exact_extract_unavailable');
    assert.equal(result.entries[0].excerptSha256, null);
  }));
}

test('no shared property names passes with nothing compared; product-only members are not differences',
  async () => withFeaturePlan(0, async store => {
    store.features[0].body.properties = { officerConflictDecision: { protocol: 'memory-only control' } };
    assert.equal((await assess(store)).entries[0].state, 'included');
  }));

test('16001-character properties object is unavailable at the plan bound',
  async () => withFeaturePlan(0, async store => {
  const properties = `{"value":"${'x'.repeat(15989)}"}`;
  assert.equal(properties.length, 16001);
  store.original = Buffer.from(`{"features":[{"properties":${properties}}]}`);
  store.source.sha256 = sha256(store.original);
  store.source.bytes = store.original.length;
  store.features[0].body.properties = {};
  const result = await assess(store);
  assert.equal(result.entries[0].reasonCode, 'exact_extract_unavailable');
}));
