import { z } from 'zod';
import {LegacyMappingTargetSchema} from '../canonical/targets';
import { ColumnProfileDocumentSchema, DelimitedReadingSchema, MappingPlanV2Schema } from '../canonical/mapping-plan';
import { STREAMING_VECTOR_LIMITS, StreamingVectorInputSchema, StreamingVectorRequestSchema,
  StreamingVectorStatusSchema, StreamingVectorFramingSchema } from './streaming-vector';
export {MappingPlanV2Schema} from '../canonical/mapping-plan';
export type {MappingPlanV2} from '../canonical/mapping-plan';

const id = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const revision = z.number().int().positive();
const text = z.string().min(1).max(150).refine(v => v.trim() === v && !/[\u0000-\u001f]/.test(v));
export const INGESTION_VERSION = 'manual-geojson/1' as const;
export const ConversionIdSchema = z.enum(['literal_identifier@1', 'literal_text@1', 'geojson_polygon@1',
  'geojson_geometry@1', 'literal_integer_identifier@1', 'feature_position@1']);
/** Paths are inventory tokens, never expressions or values. Membership is checked by the server. */
export const SourcePathSchema = z.string().max(512).regex(/^\/features\/\*\/(?:id|geometry|properties\/(?:[^~\/]|~[01])+)$/);
export const MappingOperationSchema = z.strictObject({
  target: z.union([LegacyMappingTargetSchema, z.enum(['feature.sourceKey', 'feature.geometry', 'feature.name'])]),
  sourcePath: SourcePathSchema, conversionId: ConversionIdSchema,
});
export function positionKeyIssue(operations: z.infer<typeof MappingOperationSchema>[]): string | null {
  return operations.some(operation => operation.conversionId === 'feature_position@1'
    && (operation.target !== 'feature.sourceKey' || operation.sourcePath !== '/features/*/geometry'))
    ? 'File position keys require feature.sourceKey and the feature geometry path.' : null;
}
export const SourcePinSchema = z.strictObject({sourceId: id, familyId: id, sourceRevision: revision, sourceSha256: hash, schemaFingerprint: hash});
export const SourceProfileSchema = z.strictObject({
  version: z.literal(INGESTION_VERSION), source: SourcePinSchema,
  caseId: id, workspaceRevision: z.number().int().nonnegative(), workspaceFingerprint: hash,
  format: z.literal('geojson'), featureCount: revision,
  crs: z.strictObject({value: z.string(), evidence: z.string(), unit: z.string().min(1).max(80)}),
  geometryTypes: z.array(z.string()),
  paths: z.array(z.strictObject({
    path: SourcePathSchema, types: z.array(z.enum(['string', 'number', 'boolean', 'object', 'array'])),
    values: z.number().int().nonnegative(), explicitNull: z.number().int().nonnegative(), absent: z.number().int().nonnegative(),
    literalIdEligible: z.boolean(), literalTextEligible: z.boolean(), integerIdEligible: z.boolean().optional(),
    /** In a file of outlines with pins or lines, the same identity facts over the outlines an outline kind draws. */
    outlineLiteralIdEligible: z.boolean().optional(), outlineIntegerIdEligible: z.boolean().optional(),
    /** Complete literal text over those same outlines; older stored profiles keep their whole-file rule. */
    outlineLiteralTextEligible: z.boolean().optional(),
  })),
  limitations: z.array(z.string()),
});
/** Converter semantics belong only to these exact derivative bytes and their retained original. */
export const ConverterLayoutPinSchema = z.strictObject({
  method: z.string().regex(/^converter:[a-z0-9-]+@[a-zA-Z0-9.-]+$/),
  derivativeSha256: hash, derivativeBytes: z.number().int().positive().max(STREAMING_VECTOR_LIMITS.sourceBytes),
  originalSourceId: id, originalSourceRevision: revision, originalSha256: hash,
});
export const MappingApprovalSchema = z.discriminatedUnion('provenance', [
  z.strictObject({ subject: z.string().min(1).max(300), at: z.iso.datetime(), planHash: hash,
    provenance: z.literal('server_configured_local_operator') }),
  // A converter authorization has no officer subject; layout memory requires the local officer's subject.
  z.strictObject({ subject: z.null(), at: z.iso.datetime(), planHash: hash,
    provenance: z.literal('converter_recorded') }),
]);
export const LayoutKindSchema = z.enum(['building', 'parcel', 'road', 'public_land', 'utility']);
/** A layout without a kind is the older building layout; one with a kind uses feature targets. Any file size. */
export function layoutTargetsIssue(kind: string | undefined, targets: string[]): string | null {
  const prefix = kind === undefined ? 'building' : 'feature';
  return new Set(targets).size !== targets.length || !targets.includes(`${prefix}.sourceKey`)
    || !targets.includes(`${prefix}.geometry`) || targets.some(target => !target.startsWith(`${prefix}.`))
    ? `Choose one ${prefix} source key and geometry; use ${prefix} targets only, each once.` : null;
}
export const MappingPlanSchema = z.strictObject({
  version: z.literal(INGESTION_VERSION), mode: z.literal('manual_mapping'), source: SourcePinSchema,
  caseId: id, workspaceRevision: z.number().int().nonnegative(), workspaceFingerprint: hash,
  kind: LayoutKindSchema.optional(),
  basis: z.literal('converter_recorded').optional(), converterPin: ConverterLayoutPinSchema.optional(),
  heightField: z.string().min(1).max(80).refine(value => value.trim() === value).optional(),
  heightUnit: z.enum(['m', 'ft']).optional(),
  heightMeaning: z.string().trim().min(1).max(500).optional(),
  operations: z.array(MappingOperationSchema).min(2).max(3),
}).superRefine((plan, ctx) => {
  if (Boolean(plan.converterPin) !== (plan.basis === 'converter_recorded'))
    ctx.addIssue({code: 'custom', path: ['converterPin'], message: 'Converter semantics require their exact pin.'});
  if ([plan.heightField, plan.heightUnit, plan.heightMeaning].some(value => value !== undefined)
    && (!plan.heightField || !plan.heightUnit || !plan.heightMeaning))
    ctx.addIssue({code: 'custom', path: ['heightField'],
      message: 'A height mapping requires its field, source unit (m or ft), and meaning together; no unit is guessed.'});
  const message = layoutTargetsIssue(plan.kind, plan.operations.map(op => op.target))
    || positionKeyIssue(plan.operations);
  if (message) ctx.addIssue({code: 'custom', path: ['operations'], message});
});
export const MappingDestinationSchema = z.discriminatedUnion('kind', [
  z.strictObject({kind: z.literal('new_area'), namespace: text, name: text}),
  z.strictObject({kind: z.literal('existing_area'), areaId: id, expectedAreaRevision: z.number().int().nonnegative(), referenceFingerprint: hash, namespace: text, name: text}),
]);
export const AuthorMappingSchema = z.strictObject({
  requestKey: id, expectedRecipeRevision: z.number().int().nonnegative(), plan: MappingPlanSchema, destination: MappingDestinationSchema.optional(),
});
export const MappingDecisionSchema = z.strictObject({requestKey: id, expectedRecipeRevision: revision});
export const MappingReceiptSchema = z.strictObject({
  id, revision, state: z.enum(['proposed', 'approved', 'executed']), plan: MappingPlanSchema,
  destination: MappingDestinationSchema, planHash: hash,
  authoredBy: z.string(), authoredAt: z.string().datetime(),
  approval: MappingApprovalSchema.nullable(),
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

function boundedCollectionMetadata(value: Record<string, unknown>): boolean {
  try {
    return !Object.hasOwn(value, 'features')
      && new TextEncoder().encode(JSON.stringify(value)).length <= 64 * 1024;
  } catch { return false; }
}

/** Server-written only after semantic EOF and whole-original verification. Not registry admission. */
export const StreamedMapOriginalReceiptSchema = z.strictObject({
  version: z.literal('streamed-map-original/1'), coverage: z.literal('sealed'), unknownRemainder: z.literal(false),
  sourceId: id, sourceRevision: revision,
  sourceBytes: z.number().int().positive().max(STREAMING_VECTOR_LIMITS.sourceBytes),
  sourceSha256: hash, readerVersion: z.literal('geojson-stream/2'), rawJobId: id,
  framing: StreamingVectorFramingSchema, parts: z.number().int().min(1).max(STREAMING_VECTOR_LIMITS.chunks),
  features: z.number().int().min(1).max(STREAMING_VECTOR_LIMITS.features), accepted: z.number().int().nonnegative(),
  quarantined: z.number().int().nonnegative(),
  /** Each set-aside record counted under its reader issue code; present only when something was set aside. */
  quarantinedByCode: z.record(z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/), z.number().int().positive())
    .refine(codes => Object.keys(codes).length <= 64, 'At most 64 set-aside codes belong in the receipt.').optional(),
  rawManifestSha256: hash,
  collectionMetadata: z.record(z.string(), z.unknown()).refine(boundedCollectionMetadata,
    'Only bounded original collection metadata belongs in the receipt.'),
  /** `sourceCrs` is the declaration as the file writes it; `authority` the code it resolves to, when not degrees. */
  reference: z.strictObject({
    sourceCrs: z.string().min(1).max(100).nullable(), evidence: z.string().min(1).max(200),
    coordinateUnit: z.string().min(1).max(80),
    authority: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*:[A-Za-z0-9_.-]+$/).max(100).optional(),
  }),
}).superRefine((receipt, ctx) => {
  if (receipt.accepted + receipt.quarantined !== receipt.features)
    ctx.addIssue({ code: 'custom', message: 'The exact receipt dispositions must close at semantic EOF.' });
  const codes = receipt.quarantinedByCode;
  if (codes && (!receipt.quarantined
    || Object.values(codes).reduce((sum, count) => sum + count, 0) !== receipt.quarantined))
    ctx.addIssue({ code: 'custom', path: ['quarantinedByCode'],
      message: 'The set-aside codes must count every set-aside record exactly once.' });
});
export type StreamedMapOriginalReceipt = z.infer<typeof StreamedMapOriginalReceiptSchema>;

export const TABULAR_LIMITS = Object.freeze({ bytes: 16 * 1024 * 1024, rows: 2000, columns: 256, chunkRows: 16 });
/** A CSV or workbook above TABULAR_LIMITS.bytes is read as a stream in row windows; its byte ceiling is
 * large-original/2's. */
export const TABULAR_STREAM_LIMITS = Object.freeze({ bytes: 7 * 1024 ** 3, rows: 1_000_000, windowRows: 10_000,
  recordBytes: 1024 * 1024, windowBytes: 16 * 1024 * 1024, windows: 4096, pageRows: 500 });
export const TabularSelectionSchema = z.strictObject({
  ...DelimitedReadingSchema.shape,
  format: z.enum(['csv', 'xlsx', 'ods']), sheet: z.string().min(1).max(150), table: z.null(),
  headerRows: z.array(z.number().int().min(1).max(2000)).min(1).max(5),
}).superRefine((value, ctx) => {
  if (new Set(value.headerRows).size !== value.headerRows.length ||
      value.headerRows.some((row, index) => index > 0 && row <= value.headerRows[index - 1]!)) {
    ctx.addIssue({ code: 'custom', message: 'Header rows must be ordered, distinct physical source rows.' });
  }
  if (value.format === 'csv' && (value.sheet !== 'csv' || value.headerRows.length !== 1 || value.headerRows[0] !== 1)) {
    ctx.addIssue({ code: 'custom', message: 'CSV admission requires the first logical record as its header.' });
  }
});
const DevelopmentTabularPinSchema = z.strictObject({
  selection: TabularSelectionSchema, sourceBytes: z.number().int().positive().max(TABULAR_LIMITS.bytes),
  developmentAssetId: z.string().min(1).max(150), developmentFamily: z.string().regex(/^mi-d\d+$/),
  derivativeOf: z.strictObject({ originalSha256: hash, version: z.literal('json-table-csv/1') }).optional(),
});
export const TabularProvenanceSchema = z.strictObject({
  issuer: z.string().min(1).max(500).refine(value => Boolean(value.trim())).nullable(),
  origin: z.literal('officer_supplied'), licence: z.enum(['unconfirmed', 'open', 'restricted']),
  containsPersonalData: z.enum(['unknown', 'yes', 'no']),
});
/** A case original's CSV or workbook above 16 MiB is read as a stream; a development asset keeps the 16 MiB bound. */
export const TabularPinSchema = z.union([DevelopmentTabularPinSchema, z.strictObject({
  selection: TabularSelectionSchema, sourceBytes: z.number().int().positive().max(TABULAR_STREAM_LIMITS.bytes),
  admission: TabularProvenanceSchema.extend({ kind: z.literal('case_original') }),
})]);
/** Counts over every record the stream read, per header position; an empty cell is never counted as a value. */
const TabularStreamCountsSchema = z.strictObject({ written: z.number().int().nonnegative(),
  empty: z.number().int().nonnegative(), absent: z.number().int().nonnegative() });
export const TabularSourceProfileSchema = z.strictObject({
  version: z.literal('manual-tabular/1'), source: SourcePinSchema, tabular: TabularPinSchema,
  caseId: id, workspaceRevision: z.number().int().nonnegative(), workspaceFingerprint: hash,
  headers: z.array(z.string().max(400)).min(1).max(TABULAR_LIMITS.columns),
  records: z.number().int().positive().max(TABULAR_STREAM_LIMITS.rows), profile: ColumnProfileDocumentSchema,
  limitations: z.array(z.string()),
  streamCounts: z.array(TabularStreamCountsSchema).min(1).max(TABULAR_LIMITS.columns).optional(),
});
export const AnySourceProfileSchema = z.union([SourceProfileSchema, TabularSourceProfileSchema]);
export const AnyRetainSourceSchema = z.union([RetainGisSchema, z.strictObject({ ...RetainGisSchema.shape,
  format: z.enum(['csv', 'xlsx', 'ods']), selection: TabularSelectionSchema,
  ...TabularProvenanceSchema.partial().shape,
}).superRefine((value, ctx) => {
  if (value.format !== value.selection.format) {
    ctx.addIssue({ code: 'custom', message: 'Format and selection differ.' });
  }
  if (Boolean(value.familyId) !== Boolean(value.expectedSourceRevision)) {
    ctx.addIssue({ code: 'custom', message: 'A revised source requires its family and current revision.' });
  }
})]);
export const TabularMappingPlanSchema = z.strictObject({
  version: z.literal('manual-tabular/1'), mode: z.literal('manual_mapping'), source: SourcePinSchema,
  caseId: id, workspaceRevision: z.number().int().nonnegative(), workspaceFingerprint: hash,
  tabular: TabularPinSchema, mapping: MappingPlanV2Schema,
  decisions: z.array(z.strictObject({ sourceField: z.string().min(1).max(512),
    reason: z.string().min(1).max(2000).refine(value => Boolean(value.trim())) }))
    .min(1).max(TABULAR_LIMITS.columns),
});
export const TabularMappingReceiptSchema = MappingReceiptSchema.omit({ plan: true, destination: true }).extend({
  plan: TabularMappingPlanSchema, destination: z.null(),
});
export const AnyMappingReceiptSchema = z.union([MappingReceiptSchema, TabularMappingReceiptSchema]);
export const AnyAuthorMappingSchema = z.union([AuthorMappingSchema, AuthorMappingSchema.omit({ plan: true,
  destination: true }).extend({ plan: TabularMappingPlanSchema, destination: z.null() })]);
export const AnyStreamingRequestSchema = z.union([StreamingVectorRequestSchema,
  StreamingVectorRequestSchema.omit({ framing: true }).extend({
    framing: z.literal('tabular'), tabular: TabularPinSchema })]);
export const AnyStreamingInputSchema = z.union([StreamingVectorInputSchema,
  StreamingVectorInputSchema.omit({ framing: true }).extend({
    framing: z.literal('tabular'), tabular: TabularPinSchema,
    // G13: a case-original CSV is read in windows up to the table's own byte ceiling; GIS keeps STREAMING_VECTOR_LIMITS.sourceBytes.
    sourceBytes: z.number().int().positive().max(TABULAR_STREAM_LIMITS.bytes) })]);
export const AnyStreamingStatusSchema = StreamingVectorStatusSchema.omit({ framing: true }).extend({
  framing: z.enum([...StreamingVectorFramingSchema.options, 'tabular']), tabular: TabularPinSchema.optional(),
});
export type TabularPin = z.infer<typeof TabularPinSchema>;
export type TabularSelection = z.infer<typeof TabularSelectionSchema>;
export type TabularSourceProfile = z.infer<typeof TabularSourceProfileSchema>;
export type AnySourceProfile = z.infer<typeof AnySourceProfileSchema>;
export type TabularMappingPlan = z.infer<typeof TabularMappingPlanSchema>;
export type TabularMappingReceipt = z.infer<typeof TabularMappingReceiptSchema>;
export type AnyMappingReceipt = z.infer<typeof AnyMappingReceiptSchema>;
export type AnyStreamingInput = z.infer<typeof AnyStreamingInputSchema>;
export const TabularRawRowSchema = z.strictObject({ headers: z.array(z.string().max(400)).min(1).max(256),
  cells: z.array(z.discriminatedUnion('state', [z.strictObject({ state: z.literal('absent') }),
    z.strictObject({ state: z.literal('unknown') }),
    z.strictObject({ state: z.literal('literal'), value: z.string() })])).max(256),
  sheet: z.string().min(1).max(150), sourceRow: z.number().int().positive(),
});

/** Byte receipt is independent of semantic parsing/conversion admission. The active limits count open receipts
 * (not finalized, aborted or expired); maxReservedOriginalBytes bounds the bytes open receipts reserve runtime-wide
 * and, per case, the retained and open originals together. */
export const LARGE_ORIGINAL_LIMITS = {
  version: 'large-original/1', partBytes: 8 * 1024 * 1024, maxOriginalBytes: 128 * 1024 * 1024,
  maxParts: 16, maxActivePerCase: 2, maxActivePerOperator: 2, maxActiveGlobal: 4,
  maxZeroPayloadFenceObjectsPerReceipt: 17,
  maxReservedOriginalBytes: 512 * 1024 * 1024, maxStoredBytesIncludingTemporaryCopies: 1024 * 1024 * 1024,
  uploadLifetimeSeconds: 24 * 60 * 60, partRequestSeconds: 30, storageRequestSeconds: 30,
  leaseSeconds: 180, finalizationSeconds: 120, cleanupSeconds: 120, maxFinalizationAttempts: 3, maxPartAttempts: 3,
  maxConcurrentDownloads: 2, downloadSeconds: 120,
  storageProfile: 'unversioned_private_conditional_put', cleanupProtection: 'permanent_zero_payload_fences',
} as const;
/** Opt-in transport capacity. One source can require parts, an open MPU and a sealed original at once. */
export const LARGE_ORIGINAL_V2_LIMITS = {
  version: 'large-original/2', partBytes: LARGE_ORIGINAL_LIMITS.partBytes,
  maxOriginalBytes: 7 * 1024 ** 3, maxParts: 896, maxActiveGlobal: 1,
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
const UnstatedUploadProvenanceSchema = z.strictObject({origin: z.literal('not_stated'), acquiredAt: z.string().datetime()});
const LargeUploadCreateBaseSchema = z.strictObject({
  requestKey: id, expectedCaseRevision: caseRevision,
  filename: z.string().min(1).max(150).refine(value => value.trim() === value && !/[\u0000-\u001f\/\\]/.test(value)),
  mediaType: z.enum(['application/zip', 'application/octet-stream']),
  sha256: hash,
  provenance: z.union([LargeUploadProvenanceSchema, UnstatedUploadProvenanceSchema]),
});
/** CD1: any original of 1 byte or more, of any kind; the bounded map routes stay for their own kinds. */
export const LargeUploadCreateSchema = z.union([
  LargeUploadCreateBaseSchema.extend({profile:z.literal('large-original/1').optional(),
    bytes:z.number().int().min(1).max(LARGE_ORIGINAL_LIMITS.maxOriginalBytes)}),
  LargeUploadCreateBaseSchema.extend({profile:z.literal('large-original/2'),
    bytes:z.number().int().min(1).max(LARGE_ORIGINAL_V2_LIMITS.maxOriginalBytes)}),
]);
export const LargeUploadGuardSchema = z.strictObject({requestKey: id, expectedRevision: revision, expectedCaseRevision: caseRevision});
export const LargeUploadFinalizeSchema = LargeUploadGuardSchema.extend({sha256: hash});
export const LargeUploadPartSchema = LargeUploadGuardSchema.extend({partNumber: z.number().int().min(1).max(LARGE_ORIGINAL_V2_LIMITS.maxParts), sha256: hash});
export const LargeOriginalEvidenceSchema = z.strictObject({
  uploadId: id, operatorSubject: z.string(), objectEtag: z.string(), verifiedSha256: hash,
  verifiedBytes: z.number().int().positive().max(LARGE_ORIGINAL_V2_LIMITS.maxOriginalBytes),
  receiptVersion: z.enum(['large-original/1','large-original/2']).optional(),
  provenance: z.union([LargeUploadProvenanceSchema.extend({state: z.literal('caller_declared')}),
    UnstatedUploadProvenanceSchema.extend({state: z.literal('not_stated')})]),
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
  /** N04B. The receipt's own worker lease (finalization or cleanup); null when none is held. */
  leaseExpiresAt: z.string().datetime().nullable(),
  finalization: z.strictObject({jobId:id,phase:z.enum(['queued','assembling','verifying','cleaning','complete']),
    completedParts:z.number().int().nonnegative(),
    /** N04B. The storage job's own status and error, when its row is found. */
    jobStatus: z.enum(['queued','running','succeeded','failed','stale','cancelled']).optional(),
    jobError: z.string().nullable().optional()}).optional(),
});
/** Admission did not create a receipt: replay the same create when a slot frees. Other quotas remain refusals. */
export const LargeUploadWaitingSchema = z.strictObject({
  state: z.literal('waiting'),
  limit: z.enum(['open_receipts', 'open_receipts_operator', 'open_receipts_case']),
  freesAt: z.string().datetime().nullable(),
});
/** N04. This operator's receipts in one case that hold an upload slot, newest first: what resume and cancel need. */
export const LargeUploadListSchema = z.strictObject({uploads: z.array(z.strictObject({
  id, filename: z.string(), bytes: z.number().int().positive(), sha256: hash,
  profile: z.enum(['large-original/1','large-original/2']), state: z.enum(['receiving','finalizing','aborting']),
  receivedParts: z.number().int().nonnegative(), partCount: revision, expiresAt: z.string().datetime(),
  revision, currentCaseRevision: caseRevision})).max(20)});
export type LargeUploadCreate = z.infer<typeof LargeUploadCreateSchema>;
export type LargeUploadGuard = z.infer<typeof LargeUploadGuardSchema>;
export type LargeUploadPart = z.infer<typeof LargeUploadPartSchema>;
export type LargeUploadStatus = z.infer<typeof LargeUploadStatusSchema>;
export type LargeUploadList = z.infer<typeof LargeUploadListSchema>;
export type LargeOriginalEvidence = z.infer<typeof LargeOriginalEvidenceSchema>;
