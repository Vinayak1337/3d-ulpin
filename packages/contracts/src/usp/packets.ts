import { z } from 'zod';
import { CoreIdSchema, CoreSha256Schema, coreText } from '../spatial/core/scalars';
import { UspCreateGuardSchema, UspPinnedUpdateGuardSchema, UspSnapshotScopeSchema,
  UspTargetPinSchema, UspEvidencePointerSchema, UspPrincipalSchema } from './common';
import { UspPacket0ReceiptSchema } from './packet0';

const review = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('direct'), reviewed: z.boolean() }).readonly(),
  z.strictObject({ kind: z.literal('shared'), declaration: UspTargetPinSchema.refine(p =>
    p.ref.namespace === 'declaration' && p.revision > 0), validAt: z.iso.date().nullable() }).readonly(),
]);
export const UspPacketPlanEntryInputSchema = z.strictObject({
  pointer: UspEvidencePointerSchema, required: z.boolean(), inclusionReason: coreText(2048), review,
}).readonly();
const entries = z.array(UspPacketPlanEntryInputSchema).min(1).max(20).superRefine((items, ctx) => {
  const seen = new Set<string>();
  for (const [i, e] of items.entries()) {
    const key = JSON.stringify([e.pointer.sourceRevision, e.pointer.assetRevision, e.pointer.partRevision, e.pointer.locator]);
    if (seen.has(key)) ctx.addIssue({ code: 'custom', path: [i], message: 'Select each exact part once' });
    seen.add(key);
  }
}).readonly();
export const UspPacketPlanInputSchema = z.strictObject({
  target: UspTargetPinSchema.refine(p => p.ref.namespace === 'registry_record' && p.revision > 0),
  scope: UspSnapshotScopeSchema, purpose: z.enum(['record_evidence', 'declared_share']),
  format: z.enum(['text', 'csv']), recipe: z.literal('pack0-exact-text-csv/1'),
  expiresAt: z.iso.datetime({ offset: true }), entries,
}).readonly();
export const UspCreatePacketPlanSchema = z.strictObject({
  input: UspPacketPlanInputSchema, guard: UspCreateGuardSchema,
}).readonly();
export const UspRevisePacketPlanSchema = z.strictObject({
  planId: z.uuid(), input: UspPacketPlanInputSchema, guard: UspPinnedUpdateGuardSchema,
}).readonly();
export const UspReadPacketPlanSchema = z.strictObject({ planId: z.uuid(), version: z.number().int().positive() }).readonly();
export const UspConfirmPacketPlanSchema = z.strictObject({
  planId: z.uuid(), version: z.number().int().positive(), planSha256: CoreSha256Schema,
  reviewed: z.literal(true), guard: UspPinnedUpdateGuardSchema,
}).readonly();
export const UspExecutePacketPlanSchema = z.strictObject({
  planId: z.uuid(), version: z.number().int().positive(), confirmationId: z.uuid(), guard: UspCreateGuardSchema,
}).readonly();
export const UspPacketPlanEntrySchema = z.strictObject({
  selection: UspPacketPlanEntryInputSchema, sourceSha256: CoreSha256Schema,
  sourceBytes: z.number().int().nonnegative(), sourceBodySha256: CoreSha256Schema,
  evidenceSha256: CoreSha256Schema, excerptSha256: CoreSha256Schema.nullable(),
  targetPath: z.array(UspTargetPinSchema).length(1).readonly(),
  applicabilitySha256: CoreSha256Schema.nullable(),
  state: z.enum(['included', 'omitted_optional', 'blocked_required_context']),
  reasonCode: CoreIdSchema.nullable(), entrySha256: CoreSha256Schema,
}).readonly();
export const UspPacketPlanSchema = z.strictObject({
  planId: z.uuid(), version: z.number().int().positive(), previousVersion: z.number().int().positive().nullable(),
  input: UspPacketPlanInputSchema, creator: UspPrincipalSchema, accessViewId: CoreIdSchema, policyVersion: CoreIdSchema,
  targetBodySha256: CoreSha256Schema, targetLabel: coreText(1024),
  entries: z.array(UspPacketPlanEntrySchema).min(1).max(20).readonly(),
  requiredContext: z.enum(['available', 'blocked']), createdAt: z.iso.datetime({ offset: true }), planSha256: CoreSha256Schema,
}).readonly();
export const UspPacketPlanConfirmationSchema = z.strictObject({
  confirmationId: z.uuid(), planId: z.uuid(), version: z.number().int().positive(), planSha256: CoreSha256Schema,
  reviewer: UspPrincipalSchema, reviewed: z.literal(true), confirmedAt: z.iso.datetime({ offset: true }),
}).readonly();
export const UspPacketPlanExecutionSchema = z.strictObject({
  planId: z.uuid(), version: z.number().int().positive(), confirmationId: z.uuid(),
  packet: UspPacket0ReceiptSchema, omissions: z.array(z.strictObject({ entrySha256: CoreSha256Schema,
    reasonCode: CoreIdSchema }).readonly()).max(20).readonly(),
}).readonly();
export const UspPacketPlanViewSchema = z.strictObject({ plan: UspPacketPlanSchema,
  confirmation: UspPacketPlanConfirmationSchema.nullable(), execution: UspPacketPlanExecutionSchema.nullable(),
}).readonly();
export type PacketPlanInput = z.infer<typeof UspPacketPlanInputSchema>;
export type PacketPlan = z.infer<typeof UspPacketPlanSchema>;
export type PacketPlanEntry = z.infer<typeof UspPacketPlanEntrySchema>;
export type PacketPlanConfirmation = z.infer<typeof UspPacketPlanConfirmationSchema>;
export type PacketPlanExecution = z.infer<typeof UspPacketPlanExecutionSchema>;
