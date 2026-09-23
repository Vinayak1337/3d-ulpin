import { z } from 'zod';
import { CoreIdSchema, CorePositiveRevisionSchema, CoreSha256Schema, coreText } from '../spatial/core/scalars';
import {
  UspAssetRefSchema, UspEvidencePointerSchema, UspIntakeScopeSchema, UspMutationGuardSchema,
  UspReadEvidenceRequestSchema, UspReadScopeRequestSchema, UspRequestContextSchema,
  UspResolveTargetRequestSchema, UspScopeSchema, UspSnapshotScopeSchema,
  type RequestContext, type ServiceResult,
} from './common';
import {
  UspCommitProposalSchema, UspEnqueueJobSchema, UspPrepareProposalSchema,
  type AuthorizedAsset, type CommitReceipt, type JobProjection, type PrepareProposal,
  type ResolvedTarget, type ScopePage, type SnapshotManifest,
} from './domain';

export const UspCaptureSnapshotRequestSchema = z.strictObject({
  scopeId: CoreIdSchema, world: UspSnapshotScopeSchema.unwrap().shape.world,
  stage: UspSnapshotScopeSchema.unwrap().shape.stage,
  selection: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('site') }).readonly(),
    z.strictObject({ kind: z.literal('targets'), pins: z.array(UspResolveTargetRequestSchema.unwrap().shape.pin).min(1).max(100).readonly() }).readonly(),
  ]),
}).readonly();
export const UspReceiveUploadSchema = z.strictObject({
  scope: UspIntakeScopeSchema, name: coreText(512), mediaType: coreText(255),
  expectedBytes: z.number().int().positive().max(128 * 1024 * 1024), guard: UspMutationGuardSchema,
}).readonly();
export const UspWriteUploadPartSchema = z.strictObject({
  uploadId: CoreIdSchema, partNumber: CorePositiveRevisionSchema, partHash: CoreSha256Schema,
  bytes: z.number().int().positive().max(16 * 1024 * 1024), guard: UspMutationGuardSchema,
}).readonly();
export const UspFinalizeUploadSchema = z.strictObject({
  uploadId: CoreIdSchema, parts: z.array(z.strictObject({ partNumber: CorePositiveRevisionSchema,
    sha256: CoreSha256Schema }).readonly()).min(1).max(128).readonly(),
  wholeHash: CoreSha256Schema, guard: UspMutationGuardSchema,
}).readonly();
export const UspPromoteUploadSchema = z.strictObject({
  uploadId: CoreIdSchema, hash: CoreSha256Schema, scanReceiptId: CoreIdSchema,
  destinationCaseId: CoreIdSchema, intentKey: coreText(128), guard: UspMutationGuardSchema,
}).readonly();
export const UspReadUploadSchema = z.strictObject({
  uploadId: CoreIdSchema, action: z.enum(['status', 'safe_preview', 'download']),
}).readonly();
export const UspControlJobSchema = z.strictObject({
  jobId: CoreIdSchema, action: z.enum(['pause', 'resume', 'cancel', 'retry']), guard: UspMutationGuardSchema,
}).readonly();
export const UspOutboxEventSchema = z.strictObject({
  streamId: CoreIdSchema, type: CoreIdSchema, scope: UspScopeSchema,
  manifestId: CoreIdSchema, correlationId: CoreIdSchema,
}).readonly();
export const UspUploadReceiptSchema = z.strictObject({
  uploadId: CoreIdSchema, version: CorePositiveRevisionSchema,
  state: z.enum(['receiving', 'received', 'quarantined', 'promoted']),
  asset: UspAssetRefSchema.nullable(),
}).readonly();
export const UspAssetDecisionSchema = z.strictObject({
  target: UspResolveTargetRequestSchema.unwrap().shape.pin, pointer: UspEvidencePointerSchema,
  action: UspReadEvidenceRequestSchema.unwrap().shape.action,
  accessViewId: UspRequestContextSchema.unwrap().shape.accessViewId,
}).readonly();
export const UspModelGatewayRequestSchema = z.strictObject({
  taskKind: CoreIdSchema, evidenceRefs: z.array(UspEvidencePointerSchema).max(64).readonly(),
  input: z.json(), outputSchemaId: CoreIdSchema,
  budget: z.strictObject({ maxInputBytes: z.number().int().positive().max(16 * 1024 * 1024),
    deadlineMs: z.number().int().positive().max(60000) }).readonly(),
  policyVersion: CoreIdSchema,
}).readonly();
export const UspModelGatewayResultSchema = z.strictObject({
  output: z.json(), modelId: CoreIdSchema, outputSchemaId: CoreIdSchema,
  evidenceRefs: z.array(UspEvidencePointerSchema).max(64).readonly(),
}).readonly();
export const UspScanAssetRequestSchema = z.strictObject({
  uploadId: CoreIdSchema, assetHash: CoreSha256Schema,
}).readonly();
export const UspScanReceiptSchema = z.strictObject({
  receiptId: CoreIdSchema, uploadId: CoreIdSchema, assetHash: CoreSha256Schema,
  state: z.enum(['clean', 'rejected', 'quarantined', 'unavailable']),
  scannerVersion: CoreIdSchema.nullable(),
}).readonly();
export const UspSendReceiptRequestSchema = z.strictObject({
  notificationId: CoreIdSchema, deliveryKey: coreText(128),
  audience: coreText(256), templateId: CoreIdSchema,
}).readonly();
export const UspSendReceiptResultSchema = z.strictObject({
  state: z.enum(['accepted', 'rejected', 'unknown']),
  receiptId: CoreIdSchema.nullable(),
}).readonly();

export interface UspPortTransaction {
  /** An existing caller-owned SQL transaction; never open another transaction in this helper. */
  readonly opaqueClient: unknown;
}
export interface UspPorts {
  resolveTarget(ctx: RequestContext, request: z.infer<typeof UspResolveTargetRequestSchema>): Promise<ServiceResult<ResolvedTarget>>;
  captureSnapshot(ctx: RequestContext, request: z.infer<typeof UspCaptureSnapshotRequestSchema>): Promise<ServiceResult<SnapshotManifest>>;
  readScope(ctx: RequestContext, request: z.infer<typeof UspReadScopeRequestSchema>): Promise<ServiceResult<ScopePage>>;
  readEvidence(ctx: RequestContext, request: z.infer<typeof UspReadEvidenceRequestSchema>): Promise<ServiceResult<AuthorizedAsset>>;
  receiveUpload(ctx: RequestContext, request: z.infer<typeof UspReceiveUploadSchema>): Promise<z.infer<typeof UspUploadReceiptSchema>>;
  writeUploadPart(ctx: RequestContext, request: z.infer<typeof UspWriteUploadPartSchema>, bytes: Uint8Array): Promise<z.infer<typeof UspUploadReceiptSchema>>;
  finalizeUpload(ctx: RequestContext, request: z.infer<typeof UspFinalizeUploadSchema>): Promise<z.infer<typeof UspUploadReceiptSchema>>;
  readUpload(ctx: RequestContext, request: z.infer<typeof UspReadUploadSchema>): Promise<ServiceResult<z.infer<typeof UspUploadReceiptSchema> | AuthorizedAsset>>;
  promoteUpload(ctx: RequestContext, request: z.infer<typeof UspPromoteUploadSchema>): Promise<{ sourceRevision: string; receiptId: string }>;
  prepareProposal(ctx: RequestContext, request: PrepareProposal): Promise<{ proposalId: string; version: number; state: 'draft' }>;
  commitProposal(ctx: RequestContext, request: z.infer<typeof UspCommitProposalSchema>): Promise<CommitReceipt>;
  enqueueJob(ctx: RequestContext, request: z.infer<typeof UspEnqueueJobSchema>): Promise<{ jobId: string; version: number }>;
  readJob(ctx: RequestContext, request: { jobId: string }): Promise<ServiceResult<JobProjection>>;
  controlJob(ctx: RequestContext, request: z.infer<typeof UspControlJobSchema>): Promise<JobProjection>;
  appendOutbox(tx: UspPortTransaction, event: z.infer<typeof UspOutboxEventSchema>): Promise<{ streamId: string; sequence: string }>;
  modelGateway(ctx: RequestContext, request: z.infer<typeof UspModelGatewayRequestSchema>): Promise<ServiceResult<z.infer<typeof UspModelGatewayResultSchema>>>;
  scanAsset(ctx: RequestContext, request: z.infer<typeof UspScanAssetRequestSchema>): Promise<z.infer<typeof UspScanReceiptSchema>>;
  sendReceipt(ctx: RequestContext, request: z.infer<typeof UspSendReceiptRequestSchema>): Promise<z.infer<typeof UspSendReceiptResultSchema>>;
}
