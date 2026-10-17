import { z } from 'zod';
import { CoreRefSchema, CoreSha256Schema, coreText } from '../spatial/core/scalars';
import { UspCreateGuardSchema, UspMutationGuardSchema, UspSnapshotScopeSchema, UspTargetPinSchema,
  UspPrincipalSchema, UspUpdateGuardSchema } from './common';

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
const generateFields = UspGeneratePropertyCardSchema.unwrap().shape;
/** Same card input without a request key: a preview never reads or stores a command receipt. */
export const UspPreviewPropertyCardSchema = z.strictObject({
  planId: generateFields.planId, planVersion: generateFields.planVersion,
  cardId: generateFields.cardId, expiresAt: generateFields.expiresAt,
  guard: z.discriminatedUnion('mode', [
    UspCreateGuardSchema.unwrap().omit({ requestKey: true }).readonly(),
    UspUpdateGuardSchema.unwrap().omit({ requestKey: true }).readonly(),
  ]),
}).superRefine((command, ctx) => {
  if (command.guard.mode === 'create' ? command.cardId !== null
    : !command.cardId || !command.guard.expectedManifestId) {
    ctx.addIssue({ code: 'custom',
      message: 'Create a new card or append with an exact card/snapshot revision guard.' });
  }
}).readonly();
export const UspPropertyCardPreviewSchema = z.strictObject({
  mode: z.enum(['create', 'update']), revision: UspPropertyCardSchema.unwrap().shape.revision,
  facts: UspPropertyCardSchema.unwrap().shape.facts,
  expiresAt: generateFields.expiresAt, scope: UspSnapshotScopeSchema,
}).describe('The rows a card made now from this executed plan would print. '
  + 'A preview is not a card: nothing is stored and it has no id.').readonly();
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
/** Lists the caller's own card revisions of one target in the site of a checked snapshot scope. The scope names
 * that site and nothing more: it selects no row, and no field of a row is measured against it. */
export const UspListPropertyCardsSchema = z.strictObject({
  scope: UspSnapshotScopeSchema.describe('Names the site whose cards are listed and is checked as on every USP '
    + 'read. It selects no row: the cards generated from every snapshot of that site are listed, and no field '
    + 'of a row is measured against this scope.'),
  target: CoreRefSchema, limit: z.number().int().min(1).max(50).default(20),
}).readonly();
/** One card revision without any card fact. A row whose body cannot be relied on carries its key only. */
const UspPropertyCardListItemSchema = z.strictObject({
  cardId: z.uuid(), revision: z.number().int().positive().max(2147483647),
  integrity: z.enum(['consistent', 'inconsistent']),
  latestRevision: z.number().int().positive().max(2147483647).nullable(), superseded: z.boolean().nullable(),
  createdAt: z.iso.datetime({ offset: true }).nullable(), expiresAt: z.iso.datetime({ offset: true }).nullable(),
  expired: z.boolean().nullable(), revoked: z.boolean().nullable(),
  revokedAt: z.iso.datetime({ offset: true }).nullable(),
  targetRevision: z.number().int().positive().nullable()
    .describe('The revision of the target record that this card revision was generated from.'),
  currentTargetRevision: z.number().int().positive().nullable()
    .describe('The revision of the target record in the registry at the time of this read. It is not read from '
      + 'the scope of the request.'),
  snapshotState: z.enum(['same_revision', 'changed_revision']).nullable()
    .describe('Whether the target record changed after the card was generated: same_revision exactly when '
      + 'targetRevision equals currentTargetRevision. The scope of the request takes no part in it, so a scope '
      + 'that holds the target at another revision is answered with the same state.'),
  profile: UspPropertyCardProfileSchema.nullable(),
  artifact: z.strictObject({ sha256: CoreSha256Schema, bytes: z.number().int().positive().max(524288) })
    .readonly().nullable(),
  cardSha256: CoreSha256Schema.nullable(), resolverUrl: z.url().max(256).nullable(),
}).superRefine((item, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  const { cardId: _, revision, integrity, revokedAt, ...facts } = item;
  const stated = Object.values(facts).filter(value => value !== null).length;
  if (integrity === 'inconsistent') {
    if (stated || revokedAt !== null) issue('An inconsistent row states its card and revision only.');
    return;
  }
  if (stated !== Object.keys(facts).length) issue('A consistent row states every fact.');
  if (facts.revoked !== (revokedAt !== null)) issue('A revocation time is stated exactly for a revoked revision.');
  if (facts.superseded !== (facts.latestRevision ?? 0) > revision || (facts.latestRevision ?? 0) < revision)
    issue('A revision is superseded exactly when a later revision of the same card exists.');
  if ((facts.snapshotState === 'same_revision') !== (facts.targetRevision === facts.currentTargetRevision))
    issue('The snapshot state must follow from the two target revisions.');
}).readonly();
/** Newest first. `truncated` says that more rows matched than the limit, before any row was left out. */
export const UspPropertyCardListSchema = z.strictObject({
  items: z.array(UspPropertyCardListItemSchema).max(50).readonly(), truncated: z.boolean(),
}).readonly();
export type PropertyCard = z.infer<typeof UspPropertyCardSchema>;
export type PropertyCardList = z.infer<typeof UspPropertyCardListSchema>;
export type PropertyCardRevocation = z.infer<typeof UspPropertyCardRevocationSchema>;
export type PropertyCardVerification = z.infer<typeof UspPropertyCardVerificationSchema>;
export type PropertyCardFact = z.infer<typeof UspPropertyCardFactSchema>;
export type PropertyCardView = z.infer<typeof UspPropertyCardViewSchema>;
