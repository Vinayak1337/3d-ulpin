import { z } from 'zod';

export const INTAKE_CARD_VERSION = 'intake-card/1' as const;
export const INTAKE_PROBE_LIMITS = Object.freeze({
  headBytes: 64 * 1024, tailBytes: 64 * 1024, directoryBytes: 1024 * 1024,
  members: 2000, memberHeadBytes: 64 * 1024, expandedBytes: 7 * 1024 ** 3,
  compressionRatio: 100, nestingDepth: 2, budgetMs: 2000, columns: 256, sampleRecords: 16,
});
export const IntakeFamilySchema = z.enum([
  'vector', 'table', 'raster', 'point_cloud', 'model3d', 'document', 'image', 'archive', 'unknown',
]);
export const IntakeSizeClassSchema = z.enum(['S', 'M', 'L', 'XL']);
export const IntakeStateSchema = z.enum([
  'received', 'probed', 'planned', 'reading', 'read', 'read_to_limit', 'failed_part', 'probe_failed',
]);
export const IntakePlacementSchema = z.enum([
  'undecided', 'on_map', 'attached', 'waiting_for_anchor', 'needs_answer', 'not_understood',
]);
export const IntakeCrsStateSchema = z.enum(['stated', 'sidecar', 'absent', 'conflicting', 'not_applicable']);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable();
const text = z.string().min(1).max(1024);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const bbox = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]);
const column = z.strictObject({
  name: text,
  inferredType: z.enum(['unknown', 'number', 'boolean', 'date', 'text', 'object', 'array', 'mixed', 'geometry']),
  sampledNonEmpty: z.number().int().nonnegative(),
});
const namedCount = z.strictObject({ name: text, count });
const fields = {
  version: z.literal(INTAKE_CARD_VERSION), family: IntakeFamilySchema, format: z.string().min(1).max(64),
  formatVersion: z.string().max(64).nullable(), detectedBy: z.enum(['bytes', 'bytes_and_name']),
  nameDisagrees: z.boolean(), depth: z.enum(['signature', 'structure']), encoding: z.string().max(64).nullable(),
  crs: z.strictObject({ state: IntakeCrsStateSchema,
    code: z.string().max(128).nullable(), sidecarSha256: hash.nullable() }),
  extent: z.strictObject({ native: bbox.nullable(), epsg4326: bbox.nullable() }),
  counts: z.strictObject({ features: count, rows: count, pages: count, members: count, points: count, bands: count }),
  geometryTypes: z.array(z.string().min(1).max(64)).max(32),
  layers: z.array(namedCount).max(INTAKE_PROBE_LIMITS.members),
  sheets: z.array(namedCount).max(INTAKE_PROBE_LIMITS.members),
  columns: z.array(column).max(INTAKE_PROBE_LIMITS.columns),
  limits: z.array(z.string().min(1).max(2000)).max(2048),
  probeBytesRead: z.number().int().nonnegative(), probeMs: z.number().finite().nonnegative(),
  drawableHint: z.boolean(), delimiter: z.enum([',', '\t', ';', '|']).nullable(),
  encrypted: z.boolean().nullable(),
  raster: z.strictObject({ width: count, height: count, tiled: z.boolean().nullable() }).nullable(),
  point: z.strictObject({ format: count, scale: z.tuple([z.number(), z.number(), z.number()]).nullable() }).nullable(),
  citations: z.array(z.strictObject({ locator: text, sha256: hash })).max(32),
};
// Child cards are shallow. Nested archives remain kept at signature depth, never recursively inflated.
export const IntakeMemberCardSchema = z.strictObject(fields);
export const IntakeMemberSchema = z.strictObject({
  name: text, sizeBytes: z.number().int().nonnegative(), compressedBytes: z.number().int().nonnegative(),
  format: z.string().max(64), family: IntakeFamilySchema, refusalCode: z.string().max(128).nullable(),
  companions: z.array(text).max(8), card: IntakeMemberCardSchema.nullable(),
});
export const IntakeCardSchema = z.strictObject({ ...fields, members: z.array(IntakeMemberSchema).max(2000) });
export const IntakeRegisterSchema = z.strictObject({ sourceId: z.string().uuid(), requestKey: z.string().uuid() });
export const IntakePinSchema = z.strictObject({ wave: z.number().int().min(1).max(4), requestKey: z.string().uuid() });
export const IntakeItemPlanSchema = z.strictObject({
  recipeId: z.string().uuid(), recipeRevision: z.number().int().positive(),
  recipeState: z.enum(['proposed', 'approved', 'executed']),
  origin: z.enum(['memory', 'teacher', 'officer']).nullable(), packageId: z.string().uuid().nullable(),
});
export const IntakeItemSchema = z.strictObject({
  itemId: z.string().uuid(), sourceId: z.string().uuid().nullable(), caseId: z.string().uuid(),
  parentItemId: z.string().uuid().nullable(), memberPath: text.nullable(), name: text,
  family: IntakeFamilySchema, format: z.string().max(64).nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  sizeClass: IntakeSizeClassSchema.nullable(), wave: z.number().int().min(1).max(4), state: IntakeStateSchema,
  placement: IntakePlacementSchema, card: IntakeCardSchema.nullable(), cardSha256: hash.nullable(),
  plan: IntakeItemPlanSchema.nullable(),
  probeVersion: z.string().nullable(), partsPlanned: z.number().int().positive().nullable(),
  partsDone: z.number().int().nonnegative(), recordsSeen: z.number().int().nonnegative(),
  limitReason: z.string().nullable(), pinnedByOfficer: z.boolean(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
export const IntakeManifestSchema = z.strictObject({ caseId: z.string().uuid(), items: z.array(IntakeItemSchema) });
export type IntakeCard = z.infer<typeof IntakeCardSchema>;
export type IntakeMemberCard = z.infer<typeof IntakeMemberCardSchema>;
export type IntakeMember = z.infer<typeof IntakeMemberSchema>;

export const INTAKE_TARGET_LIMITS = Object.freeze({ draftTargets: 2000, confirmationTargets: 100, page: 200 });
export const IntakeTargetReadinessSchema = z.enum([
  'preparing', 'ready', 'needs_answer', 'held', 'confirmed', 'recorded', 'carded', 'stopped',
]);
const uuid = z.string().uuid();
const code = z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/);
const at = z.string().datetime();
const pinned = z.strictObject({ id: uuid, revision: z.number().int().nonnegative() });
export const IntakeTargetArtefactsSchema = z.strictObject({
  record: pinned.optional(),
  snapshot: z.strictObject({ id: uuid, digest: hash }).optional(),
  identity: z.string().min(1).max(256).optional(),
  plan: z.strictObject({ id: uuid, version: z.number().int().positive(), sha256: hash }).optional(),
  planConfirmation: z.strictObject({ id: uuid }).optional(),
  packet: z.strictObject({ id: uuid }).optional(),
  card: pinned.optional(),
  verification: z.literal('consistent').optional(),
});
export const IntakeTargetSchema = z.strictObject({
  targetId: uuid, caseId: uuid, anchorItemId: uuid, packageId: uuid, featureId: uuid, locator: text,
  kind: z.literal('building'), stage: z.number().int().min(1).max(8), readiness: IntakeTargetReadinessSchema,
  blockedBy: z.array(code).max(16), reason: z.string().min(1).max(2000).nullable(),
  confirmationId: uuid.nullable(),
  priorityAt: at.nullable(), artefacts: IntakeTargetArtefactsSchema, updatedAt: at,
});
const tally = z.number().int().nonnegative();
export const IntakeTargetCountsSchema = z.strictObject({ preparing: tally, ready: tally, needs_answer: tally, held: tally,
  confirmed: tally, recorded: tally, carded: tally, stopped: tally });
export const IntakeTargetQuerySchema = z.strictObject({
  readiness: IntakeTargetReadinessSchema.optional(), cursor: uuid.optional(),
});
export const IntakeRunControlSchema = z.strictObject({});
export const IntakeTargetPackageSchema = z.strictObject({
  packageId: uuid, areaId: uuid, anchorItemId: uuid, revision: z.number().int().positive(),
  state: z.enum(['RECEIVED', 'NEEDS_INPUT', 'READY_FOR_REVIEW', 'REVIEWED', 'COMMITTED']),
  reviewFingerprint: hash.nullable(), findingCounts: z.record(code, tally).nullable(),
  reviewRefusal: z.strictObject({ code, message: z.string().min(1).max(2000) }).nullable().optional()
    .describe('Current review refusal; emitted as null before review or after it passes. Older pages may omit it.'),
  counts: IntakeTargetCountsSchema,
});
export const IntakeTargetPageSchema = z.strictObject({
  caseId: uuid, items: z.array(IntakeTargetSchema).max(INTAKE_TARGET_LIMITS.page),
  counts: IntakeTargetCountsSchema, nextCursor: uuid.nullable(),
  packages: z.array(IntakeTargetPackageSchema).max(100), packagesTruncated: z.boolean(),
});
export const IntakeConfirmedPackageSchema = z.strictObject({
  packageId: uuid, revision: z.number().int().positive(), reviewFingerprint: hash,
});
export const IntakeConfirmSchema = z.strictObject({
  requestKey: uuid, acknowledgement: z.string().min(1).max(500)
    .refine(value => value.trim().length > 0, 'Use a non-blank acknowledgement in the officer\'s words.'),
  packages: z.array(IntakeConfirmedPackageSchema).min(1).max(100)
    .refine(rows => new Set(rows.map(row => row.packageId)).size === rows.length, 'Name each package once.'),
  targets: z.array(uuid).max(INTAKE_TARGET_LIMITS.confirmationTargets)
    .refine(ids => new Set(ids).size === ids.length, 'Name each target once.'),
});
export const IntakeConfirmationSchema = z.strictObject({
  confirmationId: uuid, caseId: uuid, requestKey: uuid, subject: z.string().min(1).max(256),
  acknowledgement: z.string().min(1).max(500), packages: z.array(IntakeConfirmedPackageSchema).min(1).max(100),
  targets: z.array(uuid).max(INTAKE_TARGET_LIMITS.confirmationTargets), reason: z.string().min(1).max(512),
  expiresAt: at, createdAt: at, progress: z.array(IntakeTargetSchema).max(INTAKE_TARGET_LIMITS.confirmationTargets),
  counts: z.strictObject({ recorded: tally, carded: tally, stopped: tally }),
  findingCounts: z.record(code, tally).nullable()
    .describe('Counts from the pinned package reviews; null if any exact review is no longer available.'),
});
export type IntakeTargetReadiness = z.infer<typeof IntakeTargetReadinessSchema>;
export type IntakeTargetArtefacts = z.infer<typeof IntakeTargetArtefactsSchema>;
export type IntakeTarget = z.infer<typeof IntakeTargetSchema>;
export type IntakeConfirm = z.infer<typeof IntakeConfirmSchema>;
export type IntakeConfirmation = z.infer<typeof IntakeConfirmationSchema>;
