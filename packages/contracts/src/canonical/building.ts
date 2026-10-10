import { z } from 'zod';
import { CanonicalMappedValueSchema } from './mapping-plan';
import type { FactCandidate, ImportPackage, PhysicalFeature } from '../area';

export const NORMALIZED_BUILDING_VERSION = 'normalized-building/1' as const;
/** The mapping vocabulary also has needs_input (a workflow state, not a record value state). */
export const BuildingValueStateSchema = CanonicalMappedValueSchema.shape.state.exclude(['needs_input']);
export type BuildingValueState = z.infer<typeof BuildingValueStateSchema>;
const id = z.string().min(1).max(256);
const number = z.number().finite();
export const BuildingMethodSchema = z
  .string()
  .max(512)
  .regex(/^(source_literal|deterministic:[^\s@]+@[^\s@]+|model:[^\s@]+@[^\s@]+|reviewer:[^\s]+)$/);
export const BuildingCitationSchema = z.strictObject({
  sourceId: id,
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  sourceRevision: z.number().int().positive().optional(),
  locator: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('page'),
      page: z.number().int().positive(),
      text: z.string().optional(),
    }),
    z.strictObject({
      kind: z.literal('region'),
      page: z.number().int().positive(),
      x: number,
      y: number,
      width: number.positive(),
      height: number.positive(),
      unit: z.enum(['normalized', 'pt', 'pixel']),
    }),
    z.strictObject({
      kind: z.literal('row'),
      row: z.number().int().nonnegative(),
      sheet: z.string().optional(),
    }),
    z.strictObject({
      kind: z.literal('cell'),
      row: z.number().int().nonnegative(),
      column: id,
      sheet: z.string().optional(),
    }),
    z.strictObject({
      kind: z.literal('entity'),
      entityId: id,
      text: z.string().optional(),
    }),
    z.strictObject({ kind: z.literal('feature'), featureId: id }),
    z.strictObject({ kind: z.literal('point'), pointId: id }),
  ]),
});
export type BuildingCitation = z.infer<typeof BuildingCitationSchema>;
export interface Value<T> {
  value: T | null;
  state: BuildingValueState;
  unit?: string;
  citations: BuildingCitation[];
  method: string;
  revisionId: string;
}

const UNRESOLVED_STATES = ['unknown', 'absent', 'null', 'withheld', 'conflicting'];
const SUPPORTED_STATES = ['estimated', 'candidate', 'source_supported', 'reviewed'];

export function buildingValueSchema<T extends z.ZodType>(schema: T, expectedUnit?: 'm' | 'count') {
  return z.strictObject({
    value: schema.nullable(),
    state: BuildingValueStateSchema,
    unit: expectedUnit ? z.literal(expectedUnit).optional() : z.string().min(1).max(128).optional(),
    citations: z.array(BuildingCitationSchema),
    method: BuildingMethodSchema,
    revisionId: id,
  }).superRefine((v, ctx) => {
    const value = (v as { value?: unknown }).value;
    if (UNRESOLVED_STATES.includes(v.state) && value !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'Unresolved values must be null; alternatives belong in conflicts.',
      });
    }
    if (SUPPORTED_STATES.includes(v.state) && value === null) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'A supported value cannot be null.' });
    }
  });
}

const xy = z.tuple([number, number]);

function isClosedRing(points: [number, number][]): boolean {
  const first = points[0];
  const last = points.at(-1);
  return last !== undefined && first[0] === last[0] && first[1] === last[1];
}

const ring = z.array(xy).min(4).refine(isClosedRing, 'Rings must be closed');

function signedArea(points: [number, number][]): number {
  return points
    .slice(0, -1)
    .reduce((sum, point, index) => sum + point[0] * points[index + 1][1] - points[index + 1][0] * point[1], 0);
}

function hasValidWinding(rings: [number, number][][]): boolean {
  return rings.every((points, index) => (index === 0 ? signedArea(points) > 0 : signedArea(points) < 0));
}

/** Local ENU metres, not GeoJSON longitude/latitude. Original ring order is never rewritten in storage. */
export const BuildingMultiPolygonSchema = z
  .array(z.array(ring).min(1).refine(hasValidWinding, 'Outer rings must be counter-clockwise; holes clockwise'))
  .min(1);
export type BuildingMultiPolygon = z.infer<typeof BuildingMultiPolygonSchema>;

export const AreaFrameSchema = z.strictObject({
  areaId: id,
  origin: z.strictObject({
    lon: number.min(-180).max(180).nullable(),
    lat: number.min(-90).max(90).nullable(),
    hEllipsoidal: number.nullable(),
  }),
  axes: z.literal('ENU'),
  unit: z.literal('m'),
  placement: BuildingValueStateSchema,
  sourceCrs: z.array(z.string()),
  verticalRefs: z.array(z.string()),
  horizontalOperation: BuildingMethodSchema.nullable(),
});

type PrismBounds = { lowerM: { value: number | null }; upperM: { value: number | null } };

function addPrismIssue(v: PrismBounds, ctx: z.RefinementCtx): void {
  if (v.lowerM.value !== null && v.upperM.value !== null && v.lowerM.value >= v.upperM.value) {
    ctx.addIssue({ code: 'custom', message: 'Prisms require lowerM < upperM' });
  }
}

export const LevelScheduleRowSchema = z.strictObject({
  levelId: z.uuid(), order: z.number().int().nonnegative(), labelLiteral: z.string().trim().min(1).max(500),
  kind: z.enum(['basement', 'stilt', 'podium', 'floor', 'mezzanine', 'terrace', 'roof', 'other']),
  lowerM: number.nullable(), upperM: number.nullable(),
  heightSource: z.enum(['stated', 'derived', 'unknown']),
  verticalReference: z.string().trim().min(1).max(200).nullable(),
  statedHeightM: number.positive().optional(), citations: z.array(BuildingCitationSchema).min(1).max(20),
}).superRefine((row, ctx) => {
  if (row.heightSource === 'unknown' && (row.lowerM !== null || row.upperM !== null || row.statedHeightM)) {
    ctx.addIssue({ code: 'custom', message: 'Unknown heights must remain null, without a typical height.' });
  }
  if (row.heightSource === 'stated' && (row.lowerM === null || row.upperM === null || !row.verticalReference)) {
    ctx.addIssue({ code: 'custom', message: 'Stated limits require both bounds and a cited vertical reference.' });
  }
  if (row.lowerM !== null && row.upperM !== null && row.lowerM >= row.upperM) {
    ctx.addIssue({ code: 'custom', message: 'Level limits require lowerM < upperM.' });
  }
});
export const LevelPrismAssessmentSchema = z.strictObject({
  method: z.literal('prism/2'), analyticalEligibility: z.literal('not_assessed'),
  state: z.enum(['not_assessed', 'ok', 'unsupported']),
  heightState: z.enum(['unknown', 'known']), reason: z.string().optional(),
  prism: z.strictObject({ lowerM: z.string(), upperM: z.string(), heightM: z.string(),
    verticalReference: z.string(), volumeM3: number, volumeM3Exact: z.string() }).nullable(),
});
const scheduleFields = {
  state: z.enum(['reviewed', 'conflicting']), levels: z.array(LevelScheduleRowSchema).max(150),
  alternatives: z.array(z.strictObject({ labelLiteral: z.string().trim().min(1).max(500),
    citations: z.array(BuildingCitationSchema).min(1).max(20),
    levels: z.array(LevelScheduleRowSchema).max(150) })).min(2).max(10).optional(),
  statedBase: z.strictObject({ valueM: number, verticalReference: z.string().trim().min(1).max(200),
    citations: z.array(BuildingCitationSchema).min(1).max(20) }).optional(),
};
function checkSchedule(v: { state: string; levels: { levelId: string; order: number }[];
  alternatives?: unknown[] }, ctx: z.RefinementCtx): void {
  if ((v.state === 'reviewed' && (!v.levels.length || v.alternatives))
    || (v.state === 'conflicting' && (v.levels.length || !v.alternatives))) {
    ctx.addIssue({
      code: 'custom', message: 'Review listed levels or retain conflicting alternatives without selection.',
    });
  }
  if (new Set(v.levels.map(row => row.levelId)).size !== v.levels.length
    || new Set(v.levels.map(row => row.order)).size !== v.levels.length) {
    ctx.addIssue({ code: 'custom', message: 'Level identities and inventory order must be unique.' });
  }
}
export const LevelScheduleContentSchema = z.strictObject(scheduleFields).superRefine(checkSchedule);
export const LevelScheduleSchema = z.strictObject({ ...scheduleFields,
  buildingId: z.uuid(), revision: z.number().int().positive(), proposalId: z.uuid(),
  decision: z.strictObject({ actor: id, reason: z.string().trim().min(3).max(2000), at: z.string().datetime() }),
  prisms: z.record(z.string(), LevelPrismAssessmentSchema),
}).superRefine(checkSchedule);
export const LevelScheduleProposalSchema = z.strictObject({
  proposalId: z.uuid(), buildingId: z.uuid(), recordRevision: z.number().int().positive(),
  state: z.literal('candidate'), content: LevelScheduleContentSchema,
  actor: id, at: z.string().datetime(),
});
const scheduleCommand = { requestKey: z.uuid(), expectedCanonicalRevision: z.string().regex(/^[a-f0-9]{64}$/) };
export const LevelScheduleRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({ ...scheduleCommand, action: z.literal('propose'), content: LevelScheduleContentSchema }),
  z.strictObject({ ...scheduleCommand, action: z.literal('review'), proposalId: z.uuid(),
    reason: z.string().trim().min(3).max(2000) }),
]);
export const LevelScheduleReceiptSchema = z.strictObject({
  requestKey: z.uuid(), buildingId: z.uuid(), recordRevision: z.number().int().positive(),
  action: z.enum(['propose', 'review']), proposal: LevelScheduleProposalSchema,
  schedule: LevelScheduleSchema.nullable(),
});
export type LevelScheduleRow = z.infer<typeof LevelScheduleRowSchema>;
export type LevelSchedule = z.infer<typeof LevelScheduleSchema>;
export type LevelScheduleContent = z.infer<typeof LevelScheduleContentSchema>;
export type LevelScheduleRequest = z.infer<typeof LevelScheduleRequestSchema>;
export type LevelScheduleReceipt = z.infer<typeof LevelScheduleReceiptSchema>;
export * from './source-spaces';

export const BuildingStoreySchema = z.strictObject({
  levelId: id,
  label: buildingValueSchema(z.string()),
  lowerM: buildingValueSchema(number, 'm'),
  upperM: buildingValueSchema(number, 'm'),
  belowGround: buildingValueSchema(z.boolean()),
  open: buildingValueSchema(z.boolean()),
  roof: buildingValueSchema(z.boolean()),
  polygons: buildingValueSchema(BuildingMultiPolygonSchema, 'm'),
}).superRefine(addPrismIssue);
export const BuildingSpaceSchema = z.strictObject({
  spaceId: id,
  kind: buildingValueSchema(z.enum(['unit', 'common', 'shaft', 'balcony', 'terrace', 'parking', 'unknown'])),
  polygons: buildingValueSchema(BuildingMultiPolygonSchema, 'm'),
  lowerM: buildingValueSchema(number, 'm'),
  upperM: buildingValueSchema(number, 'm'),
  proposedCode: buildingValueSchema(z.string()),
  label: buildingValueSchema(z.string()).optional(),
  recordState: z.literal('reviewed').optional(),
  areaM2: buildingValueSchema(number).optional(),
}).superRefine(addPrismIssue);
export const BuildingLevelSchema = z.strictObject({
  levelId: id,
  order: z.number().int().nonnegative(),
  label: buildingValueSchema(z.string()),
  lowerM: buildingValueSchema(number, 'm'),
  upperM: buildingValueSchema(number, 'm'),
  spaces: z.array(BuildingSpaceSchema),
  kind: LevelScheduleRowSchema.shape.kind.optional(),
  heightSource: LevelScheduleRowSchema.shape.heightSource.optional(),
  heightState: BuildingValueStateSchema.optional(),
  roomCandidateIds: z.array(id).optional(),
  prismAssessment: LevelPrismAssessmentSchema.optional(),
  registryFloorId: z.uuid().optional(),
  polygons: buildingValueSchema(BuildingMultiPolygonSchema, 'm').optional(),
  recordState: z.literal('reviewed').optional(),
});
const conflictValue = buildingValueSchema(z.union([z.string(), number, z.boolean()]));
export const BuildingConflictSchema = z.strictObject({
  property: id,
  alternatives: z.array(conflictValue).min(2),
  reason: z.string(),
});
const conflictProperty = z.enum(['building.storeyLabel', 'building.storeyCount', 'building.floorCount']);
const conflictScalar = z.union([z.string().trim().min(1).max(500), z.number().int().nonnegative()]);
const checkedPage = BuildingCitationSchema.extend({ locator: BuildingCitationSchema.shape.locator.options[0] });
const decisionFields = {
  requestKey: z.string().uuid(),
  expectedCanonicalRevision: z.string().regex(/^[a-f0-9]{64}$/),
  property: conflictProperty,
  reason: z.string().trim().min(1).max(2000),
  citation: checkedPage,
};
export const BuildingConflictDecisionRequestSchema = z.discriminatedUnion('outcome', [
  z.strictObject({ ...decisionFields, outcome: z.literal('selected'), chosenValue: conflictScalar }),
  z.strictObject({ ...decisionFields, outcome: z.literal('unresolved') }),
]);
export const BuildingConflictDecisionSchema = z.strictObject({
  ...decisionFields,
  outcome: z.enum(['selected', 'unresolved']),
  chosenValue: conflictScalar.nullable(),
  alternatives: z.array(conflictValue).min(2),
  actor: id,
  time: z.string().datetime(),
  recordRevision: z.number().int().positive(),
}).superRefine((decision, ctx) => {
  const valid = decision.outcome === 'unresolved' ? decision.chosenValue === null
    : decision.alternatives.some(alternative => alternative.value === decision.chosenValue);
  if (!valid) ctx.addIssue({
    code: 'custom', message: 'A decision selects a retained alternative or remains unresolved.',
  });
});
export type BuildingConflictDecisionRequest = z.infer<typeof BuildingConflictDecisionRequestSchema>;
export type BuildingConflictDecision = z.infer<typeof BuildingConflictDecisionSchema>;

const estimateBasis = z.strictObject({ method: z.literal('polygon_area_in_plan_metres@1'),
  scaleState: z.literal('candidate'), metresPerPdfPoint: number.positive() });
/**
 * A room's size in its plan's own metres, computed by the read; an estimate, never a measurement. One object
 * with nullable values (not a union with null-only members, which the Studio's typed client drops).
 */
export const RoomPlanEstimateSchema = z.strictObject({
  state: z.enum(['estimated', 'unknown']), areaM2: number.positive().nullable(),
  extentM: z.tuple([number.nonnegative(), number.nonnegative()]).nullable(), basis: estimateBasis.nullable(),
  limitations: z.array(z.string()),
}).superRefine((estimate, ctx) => {
  const values = [estimate.areaM2, estimate.extentM, estimate.basis];
  const valid = estimate.state === 'estimated' ? values.every(value => value !== null)
    : values.every(value => value === null);
  if (!valid) ctx.addIssue({ code: 'custom', message: 'An estimate states every value; an unknown one none.' });
});
export type RoomPlanEstimate = z.infer<typeof RoomPlanEstimateSchema>;

export const BuildingCandidateRefSchema = z.strictObject({
  candidateId: id,
  task: id,
  taskVersion: id,
  inputManifest: id,
  outputRef: id.nullable(),
  state: z.enum(['candidate', 'abstained', 'unsupported', 'failed', 'reviewed']),
  kind: z.enum(['roofprint', 'room']).optional(),
  method: BuildingMethodSchema.optional(),
  modelId: id.optional(), modelHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  confidence: number.min(0).max(1).nullable().optional(),
  confidenceCalibration: z.enum(['uncalibrated', 'not_applicable']).optional(),
  limitations: z.array(z.string()).optional(), citations: z.array(BuildingCitationSchema).optional(),
  polygons: BuildingMultiPolygonSchema.nullable().optional(),
  coordinateFrame: id.optional(), levelId: id.nullable().optional(),
  labelLiteral: z.string().optional(), levelLabelLiteral: z.string().optional(),
  planFrame: z.strictObject({ originPdf: z.tuple([number, number]),
    metresPerPdfPoint: number.positive(), unit: z.literal('m'), axes: z.tuple([
      z.literal('page_right'), z.literal('page_up')]), placement: z.literal('unknown'),
    scaleState: z.literal('candidate') }).optional(),
  planEstimate: RoomPlanEstimateSchema.optional(),
  review: z.strictObject({ outcome: z.enum(['accepted', 'rejected']), reason: z.string().min(1),
    actor: id, time: z.string().datetime() }).optional(),
});
export const BuildingPlanCandidateRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('retain_rooms'), requestKey: z.uuid(),
    expectedCanonicalRevision: z.string().regex(/^[a-f0-9]{64}$/),
    derivativeSha256: z.string().regex(/^[a-f0-9]{64}$/),
    candidates: z.array(BuildingCandidateRefSchema.extend({ kind: z.literal('room'),
      state: z.literal('candidate'), method: z.literal('deterministic:vector-plan@1'),
      levelId: z.null(), coordinateFrame: id, polygons: BuildingMultiPolygonSchema,
      citations: z.array(BuildingCitationSchema).min(1), review: z.never().optional(),
      planEstimate: z.never().optional(),
    })).min(1).max(64),
  }),
  z.strictObject({ action: z.literal('attach_level'), requestKey: z.uuid(),
    expectedCanonicalRevision: z.string().regex(/^[a-f0-9]{64}$/), candidateId: id,
    levelId: z.uuid(), reason: z.string().trim().min(3).max(2000),
  }),
  z.strictObject({ action: z.literal('reject'), requestKey: z.uuid(),
    expectedCanonicalRevision: z.string().regex(/^[a-f0-9]{64}$/), candidateId: id,
    reason: z.string().trim().min(3).max(2000),
  }),
]);
export type BuildingPlanCandidateRequest = z.infer<typeof BuildingPlanCandidateRequestSchema>;
export const BuildingPlanCandidateReceiptSchema = z.strictObject({ requestKey: z.uuid(),
  buildingId: z.uuid(), recordRevision: z.number().int().positive(),
  candidateIds: z.array(id), actor: id, time: z.string().datetime(),
  derivativeSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
});
export const BuildingInputRevisionSchema = z.strictObject({
  namespace: z.enum(['area', 'area_feature', 'registry_record', 'import_package']),
  id,
  revision: z.number().int().nonnegative(),
});

type HeightStated = { heightState: BuildingValueState; heightM: { state: BuildingValueState } };

function addHeightStateIssue(v: HeightStated, ctx: z.RefinementCtx): void {
  if (v.heightState !== v.heightM.state) {
    ctx.addIssue({ code: 'custom', path: ['heightState'], message: 'heightState must equal heightM.state' });
  }
}

export const NormalizedBuildingSchema = z.strictObject({
  schemaVersion: z.literal(NORMALIZED_BUILDING_VERSION),
  buildingId: id,
  revisionId: id,
  recordState: z.enum(['candidate', 'reviewed']),
  areaId: id,
  frame: AreaFrameSchema,
  name: buildingValueSchema(z.string()),
  inputRevisions: z.array(BuildingInputRevisionSchema),
  parcelRefs: z.array(z.strictObject({ parcelId: id, officialUlpin: buildingValueSchema(z.string()) })),
  footprint: buildingValueSchema(BuildingMultiPolygonSchema, 'm'),
  footprintKind: buildingValueSchema(z.enum(['roofprint', 'ground_footprint'])),
  baseM: buildingValueSchema(number, 'm'),
  heightM: buildingValueSchema(number.nonnegative(), 'm'),
  heightState: BuildingValueStateSchema,
  storeyCount: buildingValueSchema(number.int().nonnegative(), 'count'),
  storeyLabel: buildingValueSchema(z.string()),
  storeys: buildingValueSchema(z.array(BuildingStoreySchema)),
  levels: z.array(BuildingLevelSchema),
  levelSchedule: LevelScheduleSchema.optional(),
  levelScheduleProposals: z.array(LevelScheduleProposalSchema).optional(),
  conflicts: z.array(BuildingConflictSchema),
  conflictDecisions: z.array(BuildingConflictDecisionSchema).optional(),
  resolvedConflicts: z.array(BuildingConflictDecisionSchema).optional(),
  gaps: z.array(z.string()),
  candidates: z.array(BuildingCandidateRefSchema),
}).superRefine(addHeightStateIssue);
export const BuildingBaseFeatureSchema = z.strictObject({
  id,
  kind: z.enum(['parcel', 'road', 'public_land', 'water', 'utility']),
  polygons: buildingValueSchema(BuildingMultiPolygonSchema, 'm'),
  name: buildingValueSchema(z.string()),
  lowerM: buildingValueSchema(number, 'm'),
  upperM: buildingValueSchema(number, 'm'),
  network: buildingValueSchema(z.string()),
});
export const RetainedImagerySchema = z.strictObject({
  clusterId: z.string().min(1).max(120),
  classification: z.literal('test_only'),
  analyticalEligibility: z.literal('not_assessed'),
  chips: z.array(z.strictObject({
    chipId: z.string().uuid(), sourceId: z.string().uuid(), sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    sourceCrs: z.literal('EPSG:4326'),
    affine: z.tuple([number, number, number, number, number, number]),
    width: z.number().int().positive().max(256), height: z.number().int().positive().max(256),
    originalUrl: z.string().url(), acquiredAt: z.string(),
    licence: z.literal('CC-BY-NC-4.0'), upstreamConditions: z.string().min(1).max(1000),
  })).min(1).max(64),
});
export const BuildingOverlaySchema = z.discriminatedUnion('kind', [
  z.strictObject({
    id,
    kind: z.literal('image'),
    corners: z.tuple([xy, xy, xy, xy]),
    originalUrl: z.string(),
    citations: z.array(BuildingCitationSchema),
  }),
  z.strictObject({
    id,
    kind: z.literal('points'),
    positions: z.array(number),
    colors: z.array(number),
    sizeM: number.positive(),
  }),
  z.strictObject({
    id,
    kind: z.literal('comparison'),
    role: z.enum(['plan', 'conflict']),
    polygons: BuildingMultiPolygonSchema,
    heightM: number,
  }),
]);
export const NormalizedBuildingSummarySchema = z.strictObject({
  buildingId: id,
  revisionId: id,
  recordState: z.enum(['candidate', 'reviewed']),
  name: buildingValueSchema(z.string()),
  footprint: buildingValueSchema(BuildingMultiPolygonSchema, 'm'),
  heightM: buildingValueSchema(number.nonnegative(), 'm'),
  heightState: BuildingValueStateSchema,
}).superRefine(addHeightStateIssue);
export const NormalizedAreaSchema = z.strictObject({
  schemaVersion: z.literal(NORMALIZED_BUILDING_VERSION),
  revisionId: id,
  frame: AreaFrameSchema,
  buildings: z.array(NormalizedBuildingSummarySchema),
  candidates: z.array(BuildingCandidateRefSchema).optional(),
  baseFeatures: z.array(BuildingBaseFeatureSchema),
  administrativeContext: z.array(z.strictObject({
    id,
    kind: z.literal('sector'),
    role: z.literal('administrative_context'),
    analyticalEligibility: z.literal('not_assessed'),
    sourceCrs: z.string(),
    name: buildingValueSchema(z.string()),
    polygons: buildingValueSchema(BuildingMultiPolygonSchema, 'm'),
  })).optional(),
  imagery: z.array(RetainedImagerySchema).optional(),
  overlays: z.array(BuildingOverlaySchema),
  tilesets: z.array(z.strictObject({ id, url: z.string(), revisionId: id })),
  gaps: z.array(z.string()),
});
export const ImageryAreaImportSchema = z.strictObject({
  format: z.literal('imagery_area'), requestKey: z.string().uuid(), clusterId: z.string().min(1).max(120),
});
export type RetainedImagery = z.infer<typeof RetainedImagerySchema>;
export type ImageryAreaImport = z.infer<typeof ImageryAreaImportSchema>;

export type AreaFrame = z.infer<typeof AreaFrameSchema>;
export type NormalizedBuilding = z.infer<typeof NormalizedBuildingSchema>;
export type NormalizedArea = z.infer<typeof NormalizedAreaSchema>;

const sourceImportId = z.string().uuid();
const sourceImportText = z.string().trim().min(1).max(500);
const sourceImportCitation = z.strictObject({
  documentKey: sourceImportText,
  page: z.number().int().positive().max(10000),
  locator: sourceImportText,
  quote: sourceImportText.optional(),
});

export const ClaimTranscriptionSchema = z.discriminatedUnion('by', [
  z.strictObject({
    by: z.literal('agent'),
    agent: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/),
  }),
  z.strictObject({ by: z.literal('officer') }),
]);
export type ClaimTranscription = z.infer<typeof ClaimTranscriptionSchema>;
export type SourceBuildingClaim = FactCandidate & { transcription: ClaimTranscription };

/** Original-backed transcriptions; agent claims remain candidates until officer confirmation. */
export const SourceBuildingImportSchema = z.strictObject({
  format: z.enum(['document_buildings', 'administrative_context']),
  requestKey: sourceImportId,
  namespace: z.string().trim().min(1).max(150),
  name: z.string().trim().min(1).max(150),
  areaId: sourceImportId.optional(),
  expectedAreaRevision: z.number().int().nonnegative().optional(),
  documents: z.array(z.strictObject({
    key: sourceImportText,
    filename: sourceImportText,
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    originalUrl: z.string().url().max(2000),
    issuer: sourceImportText,
    acquiredAt: z.string().min(1).max(100),
    permission: z.literal('unconfirmed'),
    classification: z.literal('test_only'),
  })).min(1).max(8),
  buildings: z.array(z.strictObject({
    sourceKey: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(120),
    geometry: z.null(),
    footprint: z.null(),
    placement: z.literal('unknown'),
    worldStatus: z.enum(['observed', 'planned']),
    citations: z.array(sourceImportCitation).min(1).max(20),
    claims: z.array(z.strictObject({
      property: z.enum(['building.storeyLabel', 'building.storeyCount', 'building.floorCount']),
      value: z.union([sourceImportText, z.number().int().nonnegative()]),
      method: z.literal('source_literal'),
      transcription: ClaimTranscriptionSchema,
      citations: z.array(sourceImportCitation).min(1).max(20),
    })).max(30),
  })).max(100),
  administrativeContext: z.strictObject({
    kind: z.literal('sector'),
    idField: z.string().trim().min(1).max(80),
    nameField: z.string().trim().min(1).max(80),
  }).optional(),
}).superRefine((input, ctx) => {
  if (input.format === 'document_buildings' && (!input.buildings.length || input.administrativeContext)) {
    ctx.addIssue({ code: 'custom', message: 'Building imports need declarations, not an administrative mapping.' });
  }
  if (input.format === 'administrative_context' && (input.buildings.length || !input.administrativeContext
    || !input.areaId || input.documents.length !== 1)) {
    ctx.addIssue({
      code: 'custom', message: 'Administrative context needs one original, a pinned area and no buildings.',
    });
  }
  const keys = new Set(input.documents.map(document => document.key));
  if (keys.size !== input.documents.length) {
    ctx.addIssue({ code: 'custom', message: 'Document keys must be distinct.' });
  }
  if (new Set(input.buildings.map(building => building.sourceKey)).size !== input.buildings.length) {
    ctx.addIssue({ code: 'custom', message: 'Building source keys must be distinct.' });
  }
  for (const building of input.buildings) {
    const citations = [...building.citations, ...building.claims.flatMap(claim => claim.citations)];
    if (citations.some(entry => !keys.has(entry.documentKey))) {
      ctx.addIssue({ code: 'custom', message: 'Every citation must name an attached original.' });
    }
  }
  if (input.areaId && input.expectedAreaRevision === undefined) {
    ctx.addIssue({ code: 'custom', message: 'Pin the destination area revision.' });
  }
});
export const SourceAdministrativeContextSchema = z.strictObject({
  sourceId: sourceImportId,
  sourceCrs: z.string().regex(/^EPSG:\d+$/),
  units: z.array(z.strictObject({
    id: sourceImportId, sourceKey: sourceImportText, kind: z.literal('sector'), name: sourceImportText,
    rings: z.array(z.array(z.tuple([z.number().finite(), z.number().finite()])).min(4).max(10000)).min(1).max(100),
  })).min(1).max(100),
});
export type SourceBuildingImport = z.infer<typeof SourceBuildingImportSchema>;
export type SourceBuildingFeature = Omit<
  PhysicalFeature, 'geometry' | 'geographicGeometry' | 'sourceGeometry'
> & { geometry: null; geographicGeometry: null; sourceGeometry: null; placement: 'unknown' };
export type SourceBuildingPackage = Omit<ImportPackage, 'features' | 'factCandidates'> & {
  geometryFree: true;
  factCandidates: SourceBuildingClaim[];
  features: SourceBuildingFeature[];
  documentPins: { sourceId: string; sourceRevision: number; sourceSha256: string }[];
  sourceMetadata: SourceBuildingImport['documents'];
  administrativeContext?: z.infer<typeof SourceAdministrativeContextSchema>;
};
