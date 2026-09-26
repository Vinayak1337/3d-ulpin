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
