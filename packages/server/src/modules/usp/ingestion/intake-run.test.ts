import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import type { ImportPackage } from '@ulpin/contracts';
import { IntakeConfirmSchema } from '@ulpin/contracts/usp';
import { AppError } from '../../../infrastructure/errors';
import { intakeConfirmationReason, packageDifference } from './intake-confirmations';
import { intakeRunKey } from './intake-run';
import { intakeCardVerificationPin, intakeRunRefusal, intakeTargetCitation } from './intake-run-worker';

const id = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const named = { packageId: id, revision: 2, reviewFingerprint: 'a'.repeat(64) };
const pkg = { id, state: 'REVIEWED', revision: 2,
  review: { packageRevision: 2, inputFingerprint: named.reviewFingerprint } } as ImportPackage;

test('one reason identifies the actual confirmation, with no invented justification', () => {
  assert.equal(intakeConfirmationReason(id, new Date('2026-01-01T01:00:00Z')),
    `Confirmed by the officer in intake confirmation ${id} on 2026-01-01.`);
});

test('keys distinguish confirmation, target and step but not attempt or job id', () => {
  assert.equal(intakeRunKey(id, other, 'plan'), intakeRunKey(id, other, 'plan'));
  assert.notEqual(intakeRunKey(id, other, 'plan'), intakeRunKey(other, other, 'plan'));
  assert.notEqual(intakeRunKey(id, other, 'plan'), intakeRunKey(id, id, 'plan'));
  assert.notEqual(intakeRunKey(id, other, 'plan'), intakeRunKey(id, other, 'card'));
});

test('confirmation rejects a changed revision or fingerprint rather than choosing new pins', () => {
  assert.equal(packageDifference(named, pkg), null);
  assert.match(packageDifference(named, { ...pkg, revision: 3 })!, /revision 3, not 2/);
  assert.match(packageDifference({ ...named, reviewFingerprint: 'b'.repeat(64) }, pkg)!, /another review/);
  assert.match(packageDifference(named, { ...pkg, review: undefined })!, /no review/);
});

test('the stored list is bounded and cannot contain commands to resolve conflicts or assume facts', () => {
  const input = { requestKey: id, acknowledgement: 'Protocol acknowledgement', packages: [named], targets: [other] };
  assert(IntakeConfirmSchema.safeParse(input).success);
  for (const extra of [{ resolveConflict: true }, { matches: [id, other] }, { owner: 'assumed' }, { height: 0 }]) {
    assert(!IntakeConfirmSchema.safeParse({ ...input, ...extra }).success);
  }
  assert(!IntakeConfirmSchema.safeParse({ ...input, targets: Array(101).fill(other) }).success);
  assert(!IntakeConfirmSchema.safeParse({ ...input, targets: [other, other] }).success);
});

test('two matches remain conflicting: the run does not resolve them or pick the first citation', () => {
  const pointer = { legacyLocator: 'feature protocol-key' };
  assert.equal(intakeTargetCitation([pointer], pointer.legacyLocator), pointer);
  assert.throws(() => intakeTargetCitation([pointer, { ...pointer }], pointer.legacyLocator),
    { code: 'INTAKE_TARGET_CITATION' });
  assert.throws(() => intakeTargetCitation([], pointer.legacyLocator), { code: 'INTAKE_TARGET_CITATION' });
});

test('a product refusal stops, while infrastructure faults are retried by the authority', () => {
  assert.deepEqual(intakeRunRefusal(new AppError(409, 'USP_STALE_TARGET', 'Pin moved.')),
    { code: 'USP_STALE_TARGET', message: 'Pin moved.' });
  assert.equal(intakeRunRefusal(new AppError(503, 'UNAVAILABLE', 'Timeout.')), null);
  assert.equal(intakeRunRefusal(new Error('Socket closed.')), null);
  const invalid = z.string().safeParse(0);
  assert(!invalid.success);
  assert.equal(intakeRunRefusal(invalid.error)?.code, 'INTAKE_RUN_INPUT');
});

test('verification reads the exact revision from the saved card link, not a fabricated link', () => {
  const url = `http://127.0.0.1:3000/api/v1/usp/property-cards/${id}/revisions/1`;
  assert.deepEqual(intakeCardVerificationPin(url, { id, revision: 1 }), { cardId: id, revision: 1 });
  assert.throws(() => intakeCardVerificationPin(url, { id: other, revision: 1 }), { code: 'INTAKE_CARD_LINK' });
  assert.throws(() => intakeCardVerificationPin(url, { id, revision: 2 }), { code: 'INTAKE_CARD_LINK' });
  assert.throws(() => intakeCardVerificationPin(url.replace('127.0.0.1', 'example.org'), { id, revision: 1 }),
    { code: 'INTAKE_CARD_LINK' });
});
