import assert from 'node:assert/strict';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { UspExactPartSchema } from '../../../../../contracts/src/usp/packet0';
import { NativeRecordReferenceSchema } from '@ulpin/contracts';
import { permitsDecodedFeatureCitation } from '../../registry/registry-reference-policy';
import { decodedRecordExtract } from './feature-extract';
import { assessPlanTx } from './plan-authority';
import { createPacketPlan, confirmPacketPlan, executePacketPlan } from './plan-service';
import { nativeInputs, withNativeFeaturePlan, realNativeDecoder } from './native-record.test-fixture';
import type { FeaturePlanStore } from './feature-plan.test-fixture';
import { sha256 } from '../../../infrastructure/storage';

function assess(store: FeaturePlanStore) {
  return assessPlanTx(store.pool() as unknown as PoolClient, store.ctx, store.input(), store.io.read,
    undefined, realNativeDecoder);
}

for (const input of nativeInputs) {
  test(`${input.format}: the plan and excerpt bind decoded fields and execute through existing authority`,
    async () => withNativeFeaturePlan(input, async store => {
      const result = await assess(store);
      const entry = result.entries[0];
      assert.equal(entry.state, 'included');
      assert.equal(entry.method, 'decoded_record');
      const decoded = await realNativeDecoder(store.original, entry.decodedRecord!);
      assert.equal(entry.excerptSha256, sha256(result.lines[0].excerpt!));
      for (const [name, value] of Object.entries(decoded.fields!))
        assert(result.lines[0].excerpt!.includes(`${JSON.stringify(name)}: ${JSON.stringify(value)}`));
      assert(!result.lines[0].excerpt!.includes('geometry'));
      const exact = UspExactPartSchema.parse({ pointer: store.pointer, sourceSha256: store.source.sha256,
        text: result.lines[0].excerpt, method: entry.method, decodedRecord: entry.decodedRecord });
      assert.equal(exact.method, 'decoded_record');
      const plan = await createPacketPlan(store.ctx,
        { input: store.input(), guard: { mode: 'create', requestKey: 'native-record-plan' } }, store.io);
      const confirmation = await confirmPacketPlan(store.ctx, { planId: plan.planId, version: 1,
        planSha256: plan.planSha256, reviewed: true, guard: { mode: 'update', requestKey: 'native-record-confirm',
          expectedVersion: 1, expectedManifestId: plan.input.scope.manifestId } }, store.io);
      const execution = await executePacketPlan(store.ctx, { planId: plan.planId, version: 1,
        confirmationId: confirmation.confirmationId,
        guard: { mode: 'create', requestKey: 'native-record-execute' } }, store.io);
      assert.equal(execution.packet.status, 'complete');
    }));

  test(`${input.format}: a changed position never searches by key`, async () =>
    withNativeFeaturePlan(input, async store => {
      const reference = store.features[0].body.sourceReference.nativeRecord;
      reference.position++;
      await assert.rejects(() => assess(store), { code: 'PACKET_PLAN_NATIVE_KEY_MISMATCH' });
    }));

  test(`${input.format}: changed committed key is refused`, async () => withNativeFeaturePlan(input, async store => {
    store.features[0].body.sourceKey += ' altered';
    const locator = `feature ${store.features[0].body.sourceKey}`;
    store.pointer.locator.locator = locator;
    store.pointer.legacyLocator = locator;
    store.record.body.evidence[0].locator = locator;
    await assert.rejects(() => assess(store), { code: 'PACKET_PLAN_NATIVE_KEY_MISMATCH' });
  }));

  if (input.format === 'gpkg') test('Unsafe decoded integer refuses rather than publishing a rounded value',
    async () => withNativeFeaturePlan(input, async store => {
      const faultyDecoder: typeof realNativeDecoder = async (bytes, reference) => {
        const decoded = await realNativeDecoder(bytes, reference);
        return { ...decoded, fields: { ...decoded.fields, integer_precision_control: 9007199254740992 } };
      };
      await assert.rejects(() => decodedRecordExtract(store.original, store.source, store.features[0].body,
        faultyDecoder), { code: 'PACKET_PLAN_NATIVE_FIELD_UNSUPPORTED' });
    }));

  test(`${input.format}: changed retained bytes refuse before native decoding`,
    async () => withNativeFeaturePlan(input, async store => {
      store.original[100] ^= 1;
      await assert.rejects(() => assess(store), { code: 'PACKET_PLAN_ORIGINAL_INTEGRITY' });
    }));

  test(`${input.format}: an observation imported without a position stays blocked`,
    async () => withNativeFeaturePlan(input, async store => {
      delete store.features[0].body.sourceReference.nativeRecord;
      const result = await assess(store);
      assert.equal(result.entries[0].state, 'blocked_required_context');
      assert.equal(result.entries[0].reasonCode, 'PACKET_PLAN_NATIVE_POSITION_UNAVAILABLE');
      assert(!Object.hasOwn(result.entries[0], 'method'));
    }));

  test(`${input.format}: another site's source is denied`, async () => withNativeFeaturePlan(input, async store => {
    store.scope.scopeId = '00000000-0000-4000-8000-000000000999';
    await assert.rejects(() => assess(store), { code: 'DECLARATION_SOURCE_DENIED' });
  }));

  test(`${input.format}: another native profile cannot use this record reference`,
    async () => withNativeFeaturePlan(input, async store => {
      const reference = store.features[0].body.sourceReference.nativeRecord;
      const other = { ...store.source, profile: input.format === 'gpkg' ? 'shapefile_zip-area-v2' : 'gpkg-area-v2' };
      assert(!permitsDecodedFeatureCitation(other, reference));
      await assert.rejects(() => decodedRecordExtract(store.original, other, store.features[0].body,
        realNativeDecoder), { code: 'PACKET_PLAN_NATIVE_SOURCE_UNSUPPORTED' });
      assert(!NativeRecordReferenceSchema.safeParse({ ...reference, position: 1.5 }).success);
    }));
}
