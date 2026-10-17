import assert from 'node:assert/strict';
import test from 'node:test';
import { createPacketPlan, confirmPacketPlan, executePacketPlan } from './plan-service';
import { previewPropertyCard, generatePropertyCard } from './card-service';
import { planId, withCardStore } from './card-verification.test-fixture';
import { withFeaturePlan, type FeaturePlanStore } from './feature-plan.test-fixture';
import { sha256 } from '../../../infrastructure/storage';

async function executedPlan(store: FeaturePlanStore) {
  const plan = await createPacketPlan(store.ctx,
    { input: store.input(), guard: { mode: 'create', requestKey: 'native-create' } }, store.io);
  const confirmation = await confirmPacketPlan(store.ctx, { planId: plan.planId, version: plan.version,
    planSha256: plan.planSha256, reviewed: true, guard: { mode: 'update', requestKey: 'native-confirm',
      expectedVersion: plan.version, expectedManifestId: plan.input.scope.manifestId } }, store.io);
  await executePacketPlan(store.ctx, { planId: plan.planId, version: plan.version,
    confirmationId: confirmation.confirmationId, guard: { mode: 'create', requestKey: 'native-execute' } }, store.io);
  return plan;
}

for (const [index, key] of [[0, '345'], [1620, '1272393']] as const) {
  test(`NYC ${key}: create, confirm, execute, preview and generate a building card with captured citation and scope`,
    async () => withFeaturePlan(index, async store => {
      const plan = await executedPlan(store);
      const command = { planId: plan.planId, planVersion: plan.version, cardId: null,
        expiresAt: new Date(Date.now() + 3600000).toISOString(), guard: { mode: 'create' } };
      const writes = store.cards.writes;
      const preview = await previewPropertyCard(store.ctx, command, store.cards.io);
      assert.equal(store.cards.writes, writes);
      assert.deepEqual(preview.facts.map(fact => fact.key), ['target', 'identifier', 'project_identity',
        'vertical_locator', 'parcel_assertions', 'source_citation', 'declared_share', 'geometry',
        'measurements', 'render', 'rights']);
      assert.deepEqual(preview.facts[2], { key: 'project_identity', label: 'Application identity', state: 'available',
        value: 'Identity codes are for recorded spaces only', reasonCode: null });
      assert.deepEqual(preview.facts[5], { key: 'source_citation', label: 'Source citation', state: 'available',
        value: `buildings-original.geojson, feature ${key}`, reasonCode: null });
      for (const name of ['geometry', 'measurements', 'render'])
        assert.equal(preview.facts.find(fact => fact.key === name)?.state, 'unavailable');
      assert.equal(preview.facts.find(fact => fact.key === 'rights')?.state, 'not_assessed');
      const card = await generatePropertyCard(store.ctx, { ...command,
        guard: { mode: 'create', requestKey: 'native-card' } }, store.cards.io);
      assert.deepEqual(card.facts, preview.facts);
      assert.equal(card.artifact.pages, 1);
      assert.equal(store.cards.cards.length, 1);
    }));
}

test('floor without P3 keeps legacy text-plan wording and has no building citation',
  async () => withFeaturePlan(0, async store => {
    // Isolated legacy protocol text, not a source or floor asserted to exist operationally.
    store.original = Buffer.from('Memory-only text control\r\n');
    store.record.kind = 'floor';
    store.source = { ...store.source, profile: 'text-reference-v2', bytes: store.original.length,
      sha256: sha256(store.original), inspection: { status: 'reference_only',
        referenceParts: [{ locator: 'line 1', text: 'Memory-only text control' }] } } as any;
    store.pointer.locator.locator = 'line 1';
    store.pointer.legacyLocator = 'line 1';
    store.record.body.evidence[0].locator = 'line 1';
    const plan = await executedPlan(store);
    const preview = await previewPropertyCard(store.ctx, { planId: plan.planId, planVersion: plan.version,
      cardId: null, expiresAt: new Date(Date.now() + 3600000).toISOString(),
      guard: { mode: 'create' } }, store.cards.io);
    assert.equal(preview.facts[2].value, 'No captured P3/1 identity');
    assert.equal(preview.facts[2].state, 'unavailable');
    assert(!preview.facts.some(fact => fact.key === 'source_citation'));
  }));

test('space without P3 keeps existing unavailable wording and row order, with no building citation',
  async () => withCardStore(async (store, ctx) => {
    const preview = await previewPropertyCard(ctx, { planId, planVersion: 1, cardId: null,
      expiresAt: new Date(Date.now() + 3600000).toISOString(), guard: { mode: 'create' } }, store.io);
    assert.deepEqual(preview.facts.map(fact => fact.key), ['target', 'identifier', 'project_identity',
      'vertical_locator', 'parcel_assertions', 'declared_share', 'geometry', 'measurements', 'render', 'rights']);
    assert.deepEqual(preview.facts[2], { key: 'project_identity', label: 'Application identity', state: 'unavailable',
      value: 'No captured P3/1 identity', reasonCode: 'project_identity_not_recorded' });
  }));
