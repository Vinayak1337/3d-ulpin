import { z } from 'zod';
import { CanonicalMappedValueSchema } from './mapping-plan';

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
}).superRefine(addPrismIssue);
export const BuildingLevelSchema = z.strictObject({
  levelId: id,
  order: z.number().int().nonnegative(),
  label: buildingValueSchema(z.string()),
  lowerM: buildingValueSchema(number, 'm'),
  upperM: buildingValueSchema(number, 'm'),
  spaces: z.array(BuildingSpaceSchema),
});
const conflictValue = buildingValueSchema(z.union([z.string(), number, z.boolean()]));
export const BuildingConflictSchema = z.strictObject({
  property: id,
  alternatives: z.array(conflictValue).min(2),
  reason: z.string(),
});
export const BuildingCandidateRefSchema = z.strictObject({
  candidateId: id,
  task: id,
  taskVersion: id,
  inputManifest: id,
  outputRef: id.nullable(),
  state: z.enum(['candidate', 'abstained', 'unsupported', 'failed', 'reviewed']),
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
  conflicts: z.array(BuildingConflictSchema),
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
  baseFeatures: z.array(BuildingBaseFeatureSchema),
  overlays: z.array(BuildingOverlaySchema),
  tilesets: z.array(z.strictObject({ id, url: z.string(), revisionId: id })),
  gaps: z.array(z.string()),
});
export type AreaFrame = z.infer<typeof AreaFrameSchema>;
export type NormalizedBuilding = z.infer<typeof NormalizedBuildingSchema>;
export type NormalizedArea = z.infer<typeof NormalizedAreaSchema>;
