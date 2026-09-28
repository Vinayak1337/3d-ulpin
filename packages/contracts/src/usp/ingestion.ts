import { z } from 'zod';

const id = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const revision = z.number().int().positive();
const text = z.string().min(1).max(150).refine(v => v.trim() === v && !/[\u0000-\u001f]/.test(v));
export const INGESTION_VERSION = 'manual-geojson/1' as const;
export const ConversionIdSchema = z.enum(['literal_identifier@1', 'literal_text@1', 'geojson_polygon@1']);
/** Paths are inventory tokens, never expressions or values. Membership is checked by the server. */
export const SourcePathSchema = z.string().max(512).regex(/^\/features\/\*\/(?:id|geometry|properties\/(?:[^~\/]|~[01])+)$/);
export const MappingOperationSchema = z.strictObject({
  target: z.enum(['building.sourceKey', 'building.name', 'building.geometry']),
  sourcePath: SourcePathSchema, conversionId: ConversionIdSchema,
});
export const SourcePinSchema = z.strictObject({sourceId: id, familyId: id, sourceRevision: revision, sourceSha256: hash, schemaFingerprint: hash});
export const SourceProfileSchema = z.strictObject({
  version: z.literal(INGESTION_VERSION), source: SourcePinSchema,
  caseId: id, workspaceRevision: z.number().int().nonnegative(), workspaceFingerprint: hash,
  format: z.literal('geojson'), featureCount: revision,
  crs: z.strictObject({value: z.string(), evidence: z.string(), unit: z.literal('degree')}),
  geometryTypes: z.array(z.string()),
  paths: z.array(z.strictObject({
    path: SourcePathSchema, types: z.array(z.enum(['string', 'number', 'boolean', 'object', 'array'])),
    values: z.number().int().nonnegative(), explicitNull: z.number().int().nonnegative(), absent: z.number().int().nonnegative(),
    literalIdEligible: z.boolean(), literalTextEligible: z.boolean(),
  })),
  limitations: z.array(z.string()),
});
export const MappingPlanSchema = z.strictObject({
  version: z.literal(INGESTION_VERSION), mode: z.literal('manual_mapping'), source: SourcePinSchema,
  caseId: id, workspaceRevision: z.number().int().nonnegative(), workspaceFingerprint: hash,
  operations: z.array(MappingOperationSchema).min(2).max(3),
}).superRefine((plan, ctx) => {
  const targets = plan.operations.map(op => op.target);
  if (new Set(targets).size !== targets.length || !targets.includes('building.sourceKey') || !targets.includes('building.geometry'))
    ctx.addIssue({code: 'custom', path: ['operations'], message: 'Choose one source key and one building geometry; each target occurs once.'});
});
export const MappingDestinationSchema = z.discriminatedUnion('kind', [
  z.strictObject({kind: z.literal('new_area'), namespace: text, name: text}),
  z.strictObject({kind: z.literal('existing_area'), areaId: id, expectedAreaRevision: z.number().int().nonnegative(), referenceFingerprint: hash, namespace: text, name: text}),
]);
export const AuthorMappingSchema = z.strictObject({
  requestKey: id, expectedRecipeRevision: z.number().int().nonnegative(), plan: MappingPlanSchema, destination: MappingDestinationSchema,
});
export const MappingDecisionSchema = z.strictObject({requestKey: id, expectedRecipeRevision: revision});
export const MappingReceiptSchema = z.strictObject({
  id, revision, state: z.enum(['proposed', 'approved', 'executed']), plan: MappingPlanSchema,
  destination: MappingDestinationSchema, planHash: hash,
  authoredBy: z.string(), authoredAt: z.string().datetime(),
  approval: z.strictObject({subject: z.string(), at: z.string().datetime(), planHash: hash, provenance: z.literal('server_configured_local_operator')}).nullable(),
  execution: z.strictObject({packageId: id, sourceRevisionId: id, subject: z.string(), at: z.string().datetime()}).nullable(),
});
export const RetainGisSchema = z.strictObject({
  requestKey: id, expectedWorkspaceRevision: z.number().int().nonnegative(), format: z.literal('geojson'),
  familyId: id.optional(), expectedSourceRevision: revision.optional(),
}).superRefine((input, ctx) => {
  if (Boolean(input.familyId) !== Boolean(input.expectedSourceRevision))
    ctx.addIssue({code: 'custom', message: 'A revised source requires its family and current revision.'});
});
export type MappingPlan = z.infer<typeof MappingPlanSchema>;
export type MappingReceipt = z.infer<typeof MappingReceiptSchema>;
export type SourceProfile = z.infer<typeof SourceProfileSchema>;
export type MappingDestination = z.infer<typeof MappingDestinationSchema>;

/** Byte receipt is independent of semantic parsing/conversion admission. */
export const LARGE_ORIGINAL_LIMITS = {
  version: 'large-original/1', partBytes: 8 * 1024 * 1024, maxOriginalBytes: 128 * 1024 * 1024,
  maxParts: 16, maxActivePerCase: 2, maxActivePerOperator: 2, maxActiveGlobal: 4,
  maxUploadReceipts: 128, maxZeroPayloadFenceObjectsPerReceipt: 17,
  maxReservedOriginalBytes: 512 * 1024 * 1024, maxStoredBytesIncludingTemporaryCopies: 1024 * 1024 * 1024,
  uploadLifetimeSeconds: 24 * 60 * 60, partRequestSeconds: 30, storageRequestSeconds: 30,
  leaseSeconds: 180, finalizationSeconds: 120, cleanupSeconds: 120, maxFinalizationAttempts: 3, maxPartAttempts: 3,
  maxConcurrentDownloads: 2, downloadSeconds: 120,
  storageProfile: 'unversioned_private_conditional_put', cleanupProtection: 'permanent_zero_payload_fences',
} as const;
/** Opt-in transport capacity. One source can require parts, an open MPU and a sealed original at once. */
export const LARGE_ORIGINAL_V2_LIMITS = {
  version: 'large-original/2', partBytes: LARGE_ORIGINAL_LIMITS.partBytes,
  maxOriginalBytes: 7 * 1024 ** 3, maxParts: 896, maxActiveGlobal: 1, maxUploadReceipts: 8,
  maxReservedOriginalBytes: 7 * 1024 ** 3,
  maxStoredBytesIncludingTemporaryCopies: 22 * 1024 ** 3,
  uploadLifetimeSeconds: 7 * 24 * 60 * 60, partRequestSeconds: 30, storageRequestSeconds: 60,
  leaseSeconds: 180, finalizationSeconds: 12 * 60 * 60, cleanupSeconds: 12 * 60 * 60,
  maxFinalizationAttempts: 3, maxPartAttempts: 3, maxConcurrentDownloads: 1,
  downloadSeconds: 12 * 60 * 60, storageProfile: 'unversioned_private_conditional_multipart',
  cleanupProtection: 'permanent_zero_payload_fences',
} as const;
const caseRevision = z.number().int().nonnegative();
const url = z.string().url().max(2048).refine(value => /^https?:\/\//.test(value));
const LargeUploadProvenanceSchema = z.strictObject({issuer: z.string().min(1).max(500), originalUrl: url, acquiredAt: z.string().datetime(),
  permissionReference: z.string().min(1).max(2048), limitations: z.array(z.string().min(1).max(2000)).max(20)});
const LargeUploadCreateBaseSchema = z.strictObject({
  requestKey: id, expectedCaseRevision: caseRevision,
  filename: z.string().min(1).max(150).refine(value => value.trim() === value && !/[\u0000-\u001f\/\\]/.test(value)),
  mediaType: z.enum(['application/zip', 'application/octet-stream']),
  sha256: hash,
  provenance: LargeUploadProvenanceSchema,
});
export const LargeUploadCreateSchema = z.union([
  LargeUploadCreateBaseSchema.extend({profile:z.literal('large-original/1').optional(),
    bytes:z.number().int().min(16 * 1024 * 1024 + 1).max(LARGE_ORIGINAL_LIMITS.maxOriginalBytes)}),
  LargeUploadCreateBaseSchema.extend({profile:z.literal('large-original/2'),
    bytes:z.number().int().min(16 * 1024 * 1024 + 1).max(LARGE_ORIGINAL_V2_LIMITS.maxOriginalBytes)}),
]);
export const LargeUploadGuardSchema = z.strictObject({requestKey: id, expectedRevision: revision, expectedCaseRevision: caseRevision});
export const LargeUploadFinalizeSchema = LargeUploadGuardSchema.extend({sha256: hash});
export const LargeUploadPartSchema = LargeUploadGuardSchema.extend({partNumber: z.number().int().min(1).max(LARGE_ORIGINAL_V2_LIMITS.maxParts), sha256: hash});
export const LargeOriginalEvidenceSchema = z.strictObject({
  uploadId: id, operatorSubject: z.string(), objectEtag: z.string(), verifiedSha256: hash,
  verifiedBytes: z.number().int().positive().max(LARGE_ORIGINAL_V2_LIMITS.maxOriginalBytes),
  receiptVersion: z.enum(['large-original/1','large-original/2']).optional(),
  provenance: LargeUploadProvenanceSchema.extend({state: z.literal('caller_declared')}),
  conversion: z.literal('unsupported'), bundleCompleteness: z.literal('single_original_only_archive_dependencies_not_assessed'),
});
export const LargeUploadStatusSchema = z.strictObject({
  version: z.enum(['large-original/1','large-original/2']), id, caseId: id, revision, currentCaseRevision: caseRevision,
  pinnedCaseRevision: caseRevision, state: z.enum(['receiving','finalizing','retained','aborting','aborted']),
  operatorSubject: z.string(), filename: z.string(), mediaType: z.string(), bytes: z.number().int().positive(),
  declaredSha256: hash, verifiedSha256: hash.nullable(), partBytes: z.literal(LARGE_ORIGINAL_LIMITS.partBytes),
  partCount: revision, receivedBytes: z.number().int().nonnegative(), expiresAt: z.string().datetime(),
  parts: z.array(z.strictObject({partNumber: revision, bytes: z.number().int().positive(),
    state: z.enum(['writing','failed','received']), sha256: hash, requestKey: id, attempts: revision, leaseExpiresAt: z.string().datetime().nullable()})),
  source: z.strictObject({sourceId: id, sourceRevision: revision, sha256: hash, bytes: z.number().int().positive()}).nullable(),
  conversion: z.literal('unsupported'), bundleCompleteness: z.literal('single_original_only_archive_dependencies_not_assessed'),
  cleanupPending: z.boolean(), lastError: z.string().nullable(),
  finalization: z.strictObject({jobId:id,phase:z.enum(['queued','assembling','verifying','cleaning','complete']),completedParts:z.number().int().nonnegative()}).optional(),
});
export type LargeUploadCreate = z.infer<typeof LargeUploadCreateSchema>;
export type LargeUploadGuard = z.infer<typeof LargeUploadGuardSchema>;
export type LargeUploadPart = z.infer<typeof LargeUploadPartSchema>;
export type LargeUploadStatus = z.infer<typeof LargeUploadStatusSchema>;
export type LargeOriginalEvidence = z.infer<typeof LargeOriginalEvidenceSchema>;
