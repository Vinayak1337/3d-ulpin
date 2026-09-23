import { z } from 'zod';
import { CoreIdSchema, CoreSha256Schema, coreText } from '../spatial/core/scalars';
import { UspAssetRefSchema, UspEvidencePointerSchema, UspMutationGuardSchema, uspServiceResultSchema,
  UspSnapshotScopeSchema, UspTargetPinSchema } from './common';

/** Initial private scoped derivative, deliberately distinct from an original-source bundle. */
export const UspPacket0RequestSchema = z.strictObject({
  scope: UspSnapshotScopeSchema, target: UspTargetPinSchema,
  evidence: z.array(UspEvidencePointerSchema).min(1).max(64).readonly(),
  format: z.enum(['text', 'csv']), guard: UspMutationGuardSchema,
}).readonly();
export const UspPacket0ReceiptSchema = z.strictObject({
  packetId: CoreIdSchema, target: UspTargetPinSchema, scope: UspSnapshotScopeSchema,
  format: z.enum(['text', 'csv']), artifact: UspAssetRefSchema,
  included: z.array(UspEvidencePointerSchema).max(64).readonly(),
  unavailable: z.array(z.strictObject({ pointer: UspEvidencePointerSchema,
    reasonCode: CoreIdSchema }).readonly()).max(64).readonly(),
  contentType: coreText(255), createdAt: z.iso.datetime({ offset: true }),
  status: z.enum(['complete', 'incomplete']), commandSha256: CoreSha256Schema,
}).readonly();
/** A single source part already linked to the selected recorded target. */
export const UspExactPartSchema = z.strictObject({
  pointer: UspEvidencePointerSchema, sourceSha256: CoreSha256Schema,
  text: z.string().min(1).max(16000),
}).readonly();
export const UspExactPartResultSchema = uspServiceResultSchema(UspExactPartSchema);
export type Packet0Request = z.infer<typeof UspPacket0RequestSchema>;
export type Packet0Receipt = z.infer<typeof UspPacket0ReceiptSchema>;
