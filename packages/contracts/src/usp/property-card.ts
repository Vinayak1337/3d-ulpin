import { z } from 'zod';
import { CoreSha256Schema, coreText } from '../spatial/core/scalars';
import { UspMutationGuardSchema, UspSnapshotScopeSchema, UspTargetPinSchema, UspPrincipalSchema } from './common';

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
  profile: z.literal('property-card-summary-ascii/1'), mode: z.literal('local_operator'),
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
export type PropertyCard = z.infer<typeof UspPropertyCardSchema>;
export type PropertyCardFact = z.infer<typeof UspPropertyCardFactSchema>;
export type PropertyCardView = z.infer<typeof UspPropertyCardViewSchema>;
