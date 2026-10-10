import { z } from 'zod';
import { CoreSha256Schema, coreText } from '../spatial/core/scalars';
import { UspCreateGuardSchema, UspMutationGuardSchema, UspSnapshotScopeSchema, UspTargetPinSchema,
  UspPrincipalSchema } from './common';

export const PROPERTY_CARD_ASCII_PROFILE = 'property-card-summary-ascii/1' as const;
export const PROPERTY_CARD_UNICODE_PROFILE = 'property-card-summary-latin-deva/1' as const;
export const UspPropertyCardProfileSchema = z.enum([PROPERTY_CARD_ASCII_PROFILE, PROPERTY_CARD_UNICODE_PROFILE]);

export const UspGeneratePropertyCardSchema = z.strictObject({
  planId: z.uuid(), planVersion: z.number().int().positive().max(2147483647),
  cardId: z.uuid().nullable(), expiresAt: z.iso.datetime({ offset: true }), guard: UspMutationGuardSchema,
}).superRefine((c, ctx) => {
  if (c.guard.mode === 'create' ? c.cardId !== null : !c.cardId || !c.guard.expectedManifestId)
    ctx.addIssue({ code: 'custom', message: 'Create a new card or append with an exact card/snapshot revision guard.' });
}).readonly();
export const UspReadPropertyCardSchema = z.strictObject({
  cardId: z.uuid(), revision: z.number().int().positive().max(2147483647),
}).readonly();
export const UspPropertyCardFactSchema = z.strictObject({
  key: coreText(64), label: coreText(128), state: z.enum(['available', 'unavailable', 'not_assessed']),
  value: coreText(4096).nullable(), reasonCode: coreText(128).nullable(),
}).superRefine((fact, ctx) => {
  if (fact.state === 'available' ? fact.value === null || fact.reasonCode !== null : fact.reasonCode === null)
    ctx.addIssue({ code: 'custom', message: 'Available facts need exact text; missing or unassessed facts need an explicit reason.' });
}).readonly();
export const UspPropertyCardSchema = z.strictObject({
  cardId: z.uuid(), revision: z.number().int().positive().max(2147483647), previousRevision: z.number().int().positive().max(2147483647).nullable(),
  profile: UspPropertyCardProfileSchema, mode: z.literal('local_operator'),
  planId: z.uuid(), planVersion: z.number().int().positive(), planSha256: CoreSha256Schema,
  confirmationId: z.uuid(), packetId: z.uuid(), packetSha256: CoreSha256Schema,
  target: UspTargetPinSchema, scope: UspSnapshotScopeSchema, targetBodySha256: CoreSha256Schema,
  snapshotCapturedAt: z.iso.datetime({ offset: true }), creator: UspPrincipalSchema,
  accessViewId: coreText(128), policyVersion: coreText(128),
  facts: z.array(UspPropertyCardFactSchema).min(1).max(24).readonly(),
  evidenceEntrySha256: z.array(CoreSha256Schema).min(1).max(20).readonly(),
  omissions: z.array(z.strictObject({ entrySha256: CoreSha256Schema, reasonCode: coreText(128) }).readonly()).max(20).readonly(),
  resolverUrl: z.url().max(256), createdAt: z.iso.datetime({ offset: true }), expiresAt: z.iso.datetime({ offset: true }),
  artifact: z.strictObject({ sha256: CoreSha256Schema, bytes: z.number().int().positive().max(524288),
    contentType: z.literal('application/pdf'), pages: z.literal(1) }).readonly(), cardSha256: CoreSha256Schema,
}).readonly();
export const UspPropertyCardViewSchema = z.strictObject({
  card: UspPropertyCardSchema, currentTargetRevision: z.number().int().positive(),
  snapshotState: z.enum(['same_revision', 'changed_revision']),
}).readonly();
export const PROPERTY_CARD_CHECK_KEYS = ['card_body', 'stored_linkage', 'revision_chain', 'artifact_bytes',
  'plan_link', 'packet_bytes'] as const;
const UspPropertyCardCheckSchema = z.strictObject({
  key: z.enum(PROPERTY_CARD_CHECK_KEYS), state: z.enum(['pass', 'fail', 'not_checked']),
  reasonCode: coreText(128).nullable(),
}).superRefine((check, ctx) => {
  if ((check.state === 'pass') !== (check.reasonCode === null))
    ctx.addIssue({ code: 'custom', message: 'A check carries a reason code exactly when it did not pass.' });
}).readonly();
/** Hash-chain consistency of one exact card revision. It repeats no card fact and makes no signature claim:
 * no trusted key policy exists, so `consistent` never means more than "the stored chain agrees with itself". */
export const UspPropertyCardVerificationSchema = z.strictObject({
  cardId: z.uuid(), revision: z.number().int().positive().max(2147483647),
  checkedAt: z.iso.datetime({ offset: true }), result: z.enum(['consistent', 'inconsistent']),
  checks: z.array(UspPropertyCardCheckSchema).length(PROPERTY_CARD_CHECK_KEYS.length).readonly(),
  // The expiry is read from the card body, so it is unknown (null) unless that body is this row's intact body.
  lifecycle: z.strictObject({
    latestRevision: z.number().int().positive().max(2147483647), superseded: z.boolean(),
    expiresAt: z.iso.datetime({ offset: true }).nullable(), expired: z.boolean().nullable(),
    revocation: z.strictObject({ revokedAt: z.iso.datetime({ offset: true }), reasonCode: coreText(128) })
      .readonly().nullable(),
  }).readonly(),
  // Both revisions come from the executed plan the row names and the registry, never from the card body.
  snapshot: z.strictObject({
    cardTargetRevision: z.number().int().positive(), currentTargetRevision: z.number().int().positive(),
    state: z.enum(['same_revision', 'changed_revision']),
  }).readonly(),
  signature: z.strictObject({
    state: z.literal('not_assessed'), reasonCode: z.literal('NO_TRUSTED_KEY_POLICY'),
  }).readonly(),
}).superRefine((report, ctx) => {
  const passed = (key: string) => report.checks.some(check => check.key === key && check.state === 'pass');
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (report.checks.some((check, index) => check.key !== PROPERTY_CARD_CHECK_KEYS[index]))
    issue('Checks are reported once each, in their fixed order.');
  if ((report.result === 'consistent') !== report.checks.every(check => check.state === 'pass'))
    issue('A card is consistent exactly when every check passed.');
  const { lifecycle, snapshot } = report, bodyKnown = passed('card_body') && passed('stored_linkage');
  if (lifecycle.superseded !== lifecycle.latestRevision > report.revision || lifecycle.latestRevision < report.revision)
    issue('A revision is superseded exactly when a later revision of the same card exists.');
  if ((lifecycle.expiresAt !== null) !== bodyKnown || (lifecycle.expired !== null) !== bodyKnown)
    issue('The expiry is reported exactly when the card body and its stored linkage passed.');
  if ((snapshot.state === 'same_revision') !== (snapshot.cardTargetRevision === snapshot.currentTargetRevision))
    issue('The snapshot state must follow from the two target revisions.');
}).readonly();
// The code is the caller's own short lower-case classification; no fixed list of reasons is decided yet.
const UspPropertyCardRevocationReasonCodeSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
/** Revokes one exact revision. A revocation is recorded once and is never changed or withdrawn. */
export const UspRevokePropertyCardSchema = z.strictObject({
  cardId: z.uuid(), revision: z.number().int().positive().max(2147483647),
  reasonCode: UspPropertyCardRevocationReasonCodeSchema, reason: coreText(1024), guard: UspCreateGuardSchema,
}).readonly();
export const UspPropertyCardRevocationSchema = z.strictObject({
  cardId: z.uuid(), revision: z.number().int().positive().max(2147483647), cardSha256: CoreSha256Schema,
  reasonCode: UspPropertyCardRevocationReasonCodeSchema, reason: coreText(1024), scope: UspSnapshotScopeSchema,
  revokedAt: z.iso.datetime({ offset: true }),
}).readonly();
export type PropertyCard = z.infer<typeof UspPropertyCardSchema>;
export type PropertyCardRevocation = z.infer<typeof UspPropertyCardRevocationSchema>;
export type PropertyCardVerification = z.infer<typeof UspPropertyCardVerificationSchema>;
export type PropertyCardFact = z.infer<typeof UspPropertyCardFactSchema>;
export type PropertyCardView = z.infer<typeof UspPropertyCardViewSchema>;
