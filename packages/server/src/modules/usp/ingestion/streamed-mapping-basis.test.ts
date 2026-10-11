import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { AnyStreamedMappingPlanSchema, StreamedMappingReceiptSchema,
  StreamedPrefixMappingPlanSchema } from '@ulpin/contracts/usp';
import { fingerprint } from '../../cases/domain';
import { assertStreamedIssuerEvidence } from './streamed-mapping';

const stored = JSON.parse(readFileSync('docs/evidence/gf1/pv1/stored-receipt-before.json', 'utf8')).receipt;
const cited = { profile: 'large-original-v1', inspection: { largeOriginal: { provenance: {
  issuer: stored.plan.semanticEvidence[0].issuer,
  originalUrl: stored.plan.semanticEvidence[0].evidenceUrl, state: 'caller_declared',
} } } };
const unstated = { profile: 'large-original-v1', inspection: { largeOriginal: { provenance: {
  origin: 'not_stated', acquiredAt: '2026-10-11T00:00:00.000Z', state: 'not_stated',
} } } };

function officerPlan() {
  return AnyStreamedMappingPlanSchema.parse({ ...stored.plan, basis: 'officer_stated', semanticEvidence: [] });
}

test('absent basis preserves the stored approved recipe bytes and its exact planHash', () => {
  const after = StreamedMappingReceiptSchema.parse(stored);
  assert.equal(JSON.stringify(after), JSON.stringify(stored));
  assert.equal(fingerprint(after.plan), stored.planHash);
  assert(!Object.hasOwn(after.plan, 'basis'));
  assert.doesNotThrow(() => assertStreamedIssuerEvidence(after.plan, cited));
});

test('officer statement with no citations works with both origins and still requires separate local approval', () => {
  const plan = officerPlan();
  for (const source of [unstated, cited]) assert.doesNotThrow(() => assertStreamedIssuerEvidence(plan, source));
  const proposed = StreamedMappingReceiptSchema.parse({ ...stored, state: 'proposed', plan,
    planHash: fingerprint(plan), approval: null });
  assert.equal(proposed.approval, null);
  assert.notEqual(proposed.planHash, stored.planHash);
  assert.deepEqual(plan.operations, stored.plan.operations);
});

test('publisher cited layouts on an unstated source give the actionable origin refusal', () => {
  for (const basis of [undefined, 'publisher_cited']) {
    const plan = AnyStreamedMappingPlanSchema.parse({ ...stored.plan, ...(basis ? { basis } : {}) });
    assert.throws(() => assertStreamedIssuerEvidence(plan, unstated), {
      status: 422, code: 'STREAMED_MAPPING_PROVENANCE',
      message: "This layout cites the publisher, and this file's origin is not stated. "
        + "State the layout as the officer's own.",
    });
  }
});

test('an officer statement cannot carry citations; an absent or publisher basis cannot omit them', () => {
  assert.equal(AnyStreamedMappingPlanSchema.safeParse({ ...stored.plan, basis: 'officer_stated' }).success, false);
  assert.throws(() => assertStreamedIssuerEvidence({ ...officerPlan(), semanticEvidence: stored.plan.semanticEvidence },
    cited), { code: 'STREAMED_MAPPING_SEMANTICS' });
  for (const basis of [undefined, 'publisher_cited']) {
    assert.equal(AnyStreamedMappingPlanSchema.safeParse({ ...stored.plan, semanticEvidence: [],
      ...(basis ? { basis } : {}) }).success, false);
  }
});

test('the existing issuer and same-host citation requirements do not weaken for publisher layouts', () => {
  const plan = AnyStreamedMappingPlanSchema.parse(stored.plan);
  assert.throws(() => assertStreamedIssuerEvidence(plan, { ...cited, inspection: {} }),
    { code: 'STREAMED_MAPPING_PROVENANCE' });
  for (const patch of [{ issuer: 'Another issuer' }, { evidenceUrl: 'https://another.invalid/meaning' }]) {
    const changed = { ...plan, semanticEvidence: plan.semanticEvidence.map(item => ({ ...item, ...patch })) };
    assert.throws(() => assertStreamedIssuerEvidence(changed, cited), { code: 'STREAMED_MAPPING_SEMANTICS' });
  }
});

test('prefix officer statements carry no publisher citations and retain exact observed-prefix checks', () => {
  const plan = officerPlan();
  const prefix = { ...plan, version: 'streamed-prefix-mapping/1',
    scope: 'observed_prefix_and_later_compatible_features', prefix: {
      throughRawChunkIndex: plan.profileGeneration, rawResultSha256: 'b'.repeat(64), recordsSeen: 100, accepted: 100,
    } };
  const parsed = StreamedPrefixMappingPlanSchema.parse(prefix);
  assert.doesNotThrow(() => assertStreamedIssuerEvidence(parsed, unstated));
  assert.equal(StreamedPrefixMappingPlanSchema.safeParse({ ...prefix,
    semanticEvidence: stored.plan.semanticEvidence }).success, false);
});
