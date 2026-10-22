import { z } from 'zod';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const page = z.number().int().min(1).max(8);
const point = z.tuple([z.number().finite(), z.number().finite()]);
const rings = z.array(z.array(point).min(4).max(500)).min(1).max(50);
const polygon = z.union([
  z.strictObject({ type: z.literal('Polygon'), coordinates: rings }),
  z.strictObject({ type: z.literal('MultiPolygon'), coordinates: z.array(rings).min(1).max(50) }),
]);
// Preserve panel_result's null value without a null-only field that the fetch client's mapped type drops.
const unknownLevel = z.object({ state: z.literal('unknown') }).passthrough()
  .refine(level => level.value === null, 'A page candidate has no associated level.');
const observation = z.object({ literal: z.string().min(1).max(2048),
  bboxPt: z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]),
  method: z.string().min(1).max(256), tile: z.number().int().nonnegative(), item: z.number().int().nonnegative(),
  state: z.literal('candidate') }).passthrough();
const room = z.object({ state: z.literal('candidate'), level: unknownLevel,
  className: z.string().min(1).max(64),
  literalClass: z.string().max(64).nullable(), geometryPagePixels: polygon,
  containedOcrLiterals: z.array(observation).max(64),
  metric: z.object({ geometry: polygon, areaM2: z.number().finite().nonnegative(), unit: z.literal('m'),
    frame: z.string(), state: z.literal('candidate') }).passthrough().nullable(),
}).passthrough();

function supportedPageScale(scale: { pairs: Record<string, unknown>[]; metresPerPoint: number | null },
  observations: { literal: string }[]) {
  const axes = new Set(scale.pairs.map(pair => pair.axis));
  return axes.has('x') && axes.has('y') && scale.pairs.every(pair => {
    const at = pair.observation;
    const ratio = pair.metresPerPoint;
    return typeof at === 'number' && Number.isInteger(at) && observations[at]?.literal === pair.literal
      && typeof ratio === 'number' && Number.isFinite(ratio) && ratio > 0
      && Math.abs(ratio / scale.metresPerPoint! - 1) <= 0.02
      && typeof pair.lineRef === 'string' && pair.lineRef.length > 0;
  });
}

/** The existing panel_result shape; extra diagnostic/provenance fields remain intact, not registry facts. */
export const IntakePlanResultSchema = z.object({
  schemaVersion: z.literal('raster-plan-candidates/1'), state: z.literal('candidate'), level: unknownLevel,
  panel: z.string(),
  sourceCitation: z.object({ sourceId: z.string().uuid(), sourceSha256: hash,
    locator: z.object({ page, unit: z.enum(['pt', 'pixel']) }).passthrough() }).passthrough(),
  model: z.object({ sha256: hash }).passthrough(),
  overlay: z.strictObject({ mediaType: z.literal('image/png'), sha256: hash,
    base64: z.string().max(1400000).regex(/^[A-Za-z0-9+/]+={0,2}$/),
    bytes: z.number().int().positive().max(1024 ** 2),
    width: z.number().int().positive().max(768), height: z.number().int().positive().max(768),
  }).nullable().optional(),
  scale: z.object({ state: z.enum(['no_scale', 'candidate']), metresPerPoint: z.number().finite().positive().nullable(),
    pairs: z.array(z.record(z.string(), z.unknown())).max(100), reason: z.string().optional(),
  }).passthrough(),
  rooms: z.array(room).max(100), ocrObservations: z.array(observation).max(64),
  gaps: z.array(z.string()).max(100),
}).passthrough().superRefine((value, ctx) => {
  const noScale = value.scale.state === 'no_scale';
  if (noScale !== (value.scale.metresPerPoint === null)
    || (noScale && value.rooms.some(entry => entry.metric !== null))
    || (!noScale && (!supportedPageScale(value.scale, value.ocrObservations)
      || value.rooms.some(entry => entry.metric === null)))) {
    ctx.addIssue({ code: 'custom', message: 'Metric geometry requires the page\'s verified dimension pairs.' });
  }
  if (value.rooms.some(entry => entry.containedOcrLiterals.some(label => !value.ocrObservations.some(
    source => source.literal === label.literal && source.method === label.method
      && source.tile === label.tile && source.item === label.item
      && source.bboxPt.every((coordinate, at) => coordinate === label.bboxPt[at]))))) {
    ctx.addIssue({ code: 'custom', message: 'Contained labels must cite the page\'s own OCR observations.' });
  }
});
export const IntakePlanReadingSchema = z.strictObject({ jobId: z.string().uuid(), page,
  status: z.enum(['queued', 'completed', 'failed']), error: z.string().nullable(),
  result: IntakePlanResultSchema.nullable() });
export const IntakePlanRequestSchema = z.strictObject({ requestKey: z.string().uuid(), page });
export const IntakePlanReceiptSchema = z.strictObject({ jobId: z.string().uuid(), itemId: z.string().uuid(), page });
export const IntakePlanModelSchema = z.strictObject({ available: z.boolean(), reason: z.string().nullable(),
  modelSha256: hash.nullable() });
export const IntakePlanOfferSchema = IntakePlanModelSchema.extend({ pages: z.array(page).max(8) });
export type IntakePlanResult = z.infer<typeof IntakePlanResultSchema>;
export type IntakePlanReading = z.infer<typeof IntakePlanReadingSchema>;
export type IntakePlanModel = z.infer<typeof IntakePlanModelSchema>;
