import assert from 'node:assert/strict';
import test from 'node:test';
import { createPacketPlan, confirmPacketPlan, executePacketPlan } from './plan-service';
import { isPdfPlan } from './plan-store';
import { previewPropertyCard, generatePropertyCard } from './card-service';
import { verifyPropertyCard } from './card-verification';
import { decodedRecordLabel, renderPacket0 } from '../packet0';
import { nativeInputs, withNativeFeaturePlan } from './native-record.test-fixture';

for (const input of nativeInputs) {
  test(`${input.format}: packet and verified card say decoded values and leave geometry and rights unassessed`,
    async () => withNativeFeaturePlan(input, async store => {
      const plan = await createPacketPlan(store.ctx,
        { input: store.input(), guard: { mode: 'create', requestKey: 'decoded-card-plan' } }, store.io);
      const confirmation = await confirmPacketPlan(store.ctx, { planId: plan.planId, version: 1,
        planSha256: plan.planSha256, reviewed: true, guard: { mode: 'update', requestKey: 'decoded-card-confirm',
          expectedVersion: 1, expectedManifestId: plan.input.scope.manifestId } }, store.io);
      const execution = await executePacketPlan(store.ctx, { planId: plan.planId, version: 1,
        confirmationId: confirmation.confirmationId,
        guard: { mode: 'create', requestKey: 'decoded-card-execute' } }, store.io);
      assert.equal(execution.packet.status, 'complete');
      assert(!isPdfPlan(plan));
      const locator = decodedRecordLabel(plan.entries[0].decodedRecord!);
      const packet = Buffer.from(store.cards.objects.get(store.packets[0].object_key)!).toString();
      assert(packet.includes(locator));
      assert(packet.includes(input.name));
      const command = { planId: plan.planId, planVersion: 1, cardId: null,
        expiresAt: new Date(Date.now() + 3600000).toISOString(), guard: { mode: 'create' } };
      const preview = await previewPropertyCard(store.ctx, command, store.cards.io);
      assert.equal(preview.facts.find(fact => fact.key === 'source_citation')?.value, `${input.name}, ${locator}`);
      const card = await generatePropertyCard(store.ctx, { ...command,
        guard: { mode: 'create', requestKey: 'decoded-card' } }, store.cards.io);
      assert.deepEqual(card.facts, preview.facts);
      assert.equal(card.facts.find(fact => fact.key === 'geometry')?.state, 'unavailable');
      assert.equal(card.facts.find(fact => fact.key === 'measurements')?.state, 'unavailable');
      assert.equal(card.facts.find(fact => fact.key === 'rights')?.state, 'not_assessed');
      const verification = await verifyPropertyCard(store.ctx, { cardId: card.cardId, revision: 1 }, store.cards.io);
      assert.equal(verification.report.result, 'consistent');
    }));
}

test('decoded text renderer names the method without labelling decoded fields an exact text extract',
  async () => withNativeFeaturePlan(nativeInputs[0], async store => {
    const line = { pointer: store.pointer, sourceSha256: store.source.sha256, reasonCode: null,
      excerpt: `Decoded field values of record 1 of Council_Buildings.dbf in ${store.source.name}`,
      method: 'decoded_record' as const, decodedRecord: store.features[0].body.sourceReference.nativeRecord };
    const bytes = renderPacket0({ id: store.target.ref.id, label: store.record.body.name }, [line], 'text');
    assert(bytes.includes('Council_Buildings.dbf, record 1, decoded values'));
    assert(bytes.includes('Decoded values extract: Decoded field values'));
    assert(!bytes.includes('Exact extract:'));
  }));
