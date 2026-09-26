import { z } from 'zod';

export const areaIdSchema = z.string().uuid();
export const areaRevisionSchema = z.number().int().nonnegative();
const str = z.string().trim().min(1).max(150);
const field = z.string().trim().min(1).max(80);
const geometryRole = z.enum([
  'unknown', 'observed_ground_occupation', 'observed_roof_projection',
  'approved_building_outline', 'recorded_parcel', 'public_road_land',
  'road_surface', 'public_land', 'physical_utility', 'documented_restriction',
]);
export const areaMappingSchema = z.object({
  idField: field.optional(),
  nameField: field.optional(),
  kind: z.enum(['building', 'parcel', 'road', 'public_land', 'utility']),
  heightField: field.optional(),
  heightUnit: z.enum(['m', 'ft']).optional(),
  heightMeaning: z.string().trim().min(1).max(500).optional(),
  identifierFields: z.array(field).max(10).optional(),
  geometryRole: geometryRole.optional(),
  geometryRoleField: field.optional(),
  roleValues: z.record(z.string(), geometryRole).optional(),
  levelReference: str.optional(),
  floorCountField: field.optional(),
  approvalStatusField: field.optional(),
  sourceDateField: field.optional(),
  validFromField: field.optional(),
  validToField: field.optional(),
  horizontalUncertaintyField: field.optional(),
  horizontalUncertaintyUnit: z.enum(['m', 'ft']).optional(),
  worldStatusField: field.optional(),
  worldStatusValues: z.record(z.string(), z.enum(['observed', 'planned', 'hypothetical', 'synthetic'])).optional(),
  verticalExtent: z.object({
    lowerField: field, upperField: field, unit: z.enum(['m', 'ft']), reference: str,
  }).strict().optional(),
  utility: z.object({
    assetIdField: field.optional(),
    utilityTypeField: field.optional(),
    operatorField: field.optional(),
    startLevelField: field.optional(),
    endLevelField: field.optional(),
    levelsField: field.optional(),
    levelUnit: z.enum(['m', 'ft']),
    levelMeaning: z.enum(['centre', 'invert', 'crown', 'depth_below_ground']),
    depthTo: z.enum(['centre', 'invert', 'crown']).optional(),
    verticalReference: str.nullable(),
    interpolation: z.enum(['per_vertex', 'linear_endpoints']).optional(),
    groundStartField: field.optional(),
    groundEndField: field.optional(),
    groundReference: str.optional(),
    crossSection: z.enum(['circular', 'rectangular']).optional(),
    diameterField: field.optional(),
    widthField: field.optional(),
    heightField: field.optional(),
    dimensionUnit: z.enum(['m', 'ft']),
  }).strict().optional(),
}).strict();

export const areaImportMetadataSchema = z.object({
  format: z.enum(['geojson', 'arcgis', 'gpkg', 'shapefile_zip']),
  layer: z.string().min(1).max(256).optional(),
  namespace: str, name: str, mapping: areaMappingSchema,
  areaId: areaIdSchema.optional(),
  sourceCrs: z.string().regex(/^EPSG:\d+$/).optional(),
  expectedAreaRevision: areaRevisionSchema.optional(),
  worldStatus: z.enum(['observed', 'planned', 'hypothetical', 'synthetic']).optional(),
}).strict();
export const acquisitionImportSchema = z.object({
  acquisitionId: areaIdSchema,
  areaId: areaIdSchema.optional(),
  expectedAreaRevision: areaRevisionSchema.optional(),
  name: str.optional(),
}).strict();
export const externalIdentifierSchema = z.object({
  featureId: areaIdSchema.optional(),
  recordId: areaIdSchema.optional(),
  scheme: z.enum(['official_ulpin', 'demo_ulpin', 'source_property_id', 'nyc_bin']),
  value: str, issuer: str, sourceId: areaIdSchema,
  locator: z.string().trim().min(1).max(500),
  expectedRevision: areaRevisionSchema,
}).strict().refine(v => Boolean(v.featureId) !== Boolean(v.recordId), 'Choose exactly one target.')
  .describe('Supply exactly one of featureId or recordId; expectedRevision is that target record revision. The historical demo_ulpin write branch returns 410.');
export const acquisitionProbeSchema = z.object({sourceId: str}).strict();
export const acquisitionSchema = z.object({
  sourceId: str, mode: z.enum(['saved', 'refresh']), requestKey: areaIdSchema,
}).strict();
export const packageCorrectionSchema = z.object({requestKey: areaIdSchema}).strict();
export const packageRevisionSchema = z.object({expectedRevision: areaRevisionSchema}).strict();
export const packageAnswerSchema = z.object({
  expectedRevision: areaRevisionSchema, questionId: areaIdSchema,
  answer: z.object({
    choice: z.enum(['keep_2d', 'estimate', 'select_claim']),
    value: z.number().finite().positive().max(1000).optional(),
    reason: z.string().trim().min(1).max(2000),
    claimId: areaIdSchema.optional(),
  }).strict(),
}).strict();
export const packageCommitSchema = packageRevisionSchema.extend({
  acknowledgement: z.string().trim().min(1).max(2000),
});
export const copyCaseDocumentsSchema = packageRevisionSchema.extend({
  caseId: areaIdSchema,
  sourceIds: z.array(areaIdSchema).min(1).max(20).refine(
    ids => new Set(ids).size === ids.length, 'Choose distinct source revisions.',
  ),
  buildingId: areaIdSchema,
  reason: z.string().trim().min(1).max(2000),
});
export const packageFactSchema = z.object({
  expectedRevision: areaRevisionSchema,
  claim: z.object({
    entityId: areaIdSchema,
    property: z.string().regex(/^[a-zA-Z]+\.[a-zA-Z][a-zA-Z0-9.]*$/).max(100),
    value: z.union([z.string().trim().min(1).max(500), z.number().finite()]),
    unit: field.optional(),
    referenceFrameId: str.optional(),
    evidence: z.array(z.object({
      sourceRevisionId: areaIdSchema,
      partId: areaIdSchema.optional(),
      page: z.number().int().positive().optional(),
      row: z.number().int().positive().optional(),
      featureId: field.optional(),
      jsonPointer: z.string().max(500).optional(),
    }).strict()).min(1).max(20),
  }).strict(),
}).strict();
export const areaCheckSchema = z.object({
  areaId: areaIdSchema, expectedRevision: areaRevisionSchema,
}).strict();
export const documentFormatSchema = z.enum(['pdf', 'docx', 'text', 'csv', 'png', 'jpeg']);
