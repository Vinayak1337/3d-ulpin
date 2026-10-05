import type { PoolClient } from 'pg';
import { z } from 'zod';
import type { SpatialMlSourceScope } from '@ulpin/contracts';
import { DocumentPageFrameSchema, DOCUMENT_PAGE_LIMITS } from '../../../../contracts/src/document-pages';
import { transaction } from '../../infrastructure/db';
import { AppError, conflict } from '../../infrastructure/errors';
import { openObjectStream, sha256, verifyObjectStream } from '../../infrastructure/storage';
import { fingerprint } from '../cases/domain';
import { DocumentPagesService, documentPageAuthorityTx, type DocumentPageAuthority } from '../usp/ingestion/document-pages';

const id = z.uuid().transform(v => v.toLowerCase()), hash = z.string().regex(/^[a-f0-9]{64}$/);
export const spatialMlSourceRegionSchema = z.strictObject({
  x: z.number().finite().min(0).max(1), y: z.number().finite().min(0).max(1),
  width: z.number().finite().positive().max(1), height: z.number().finite().positive().max(1),
}).refine(r => r.x + r.width <= 1 && r.y + r.height <= 1, 'Crop must fit the retained page.');
export const spatialMlSourceBatchSchema = z.strictObject({
  scope: z.literal('source'), caseId: id, caseRevision: z.number().int().nonnegative(),
  sourceId: id, sourceRevision: z.number().int().positive(), sourceSha256: hash,
  sourceBytes: z.number().int().positive().max(DOCUMENT_PAGE_LIMITS.originalBytes),
  page: z.number().int().min(1).max(100), frame: DocumentPageFrameSchema,
  region: spatialMlSourceRegionSchema, task: z.literal('floor-plan'),
  modelId: z.string().min(1).max(120), requestKey: id,
});
type SourceRequest = z.infer<typeof spatialMlSourceBatchSchema>;
type SourcePin = Pick<SpatialMlSourceScope, 'caseId' | 'caseRevision' | 'sourceId' | 'sourceRevision' | 'sourceSha256' | 'sourceBytes'>;
export type SpatialMlSourceAuthority = DocumentPageAuthority;
type Dependencies = {
  capture: (pin: SourcePin, deadline: number) => Promise<SpatialMlSourceAuthority>;
  pages: (sourceId: string, query: { revision: string; sha256: string; offset: string; limit: string }) => ReturnType<DocumentPagesService['pages']>;
  verify: (authority: SpatialMlSourceAuthority, deadline: number) => Promise<unknown>;
};
function live(deadline: number) {
  if (Date.now() >= deadline) throw new AppError(504, 'ML_SOURCE_DEADLINE', 'Source admission timed out. Retry the explicit selection.');
}
function same(before: SpatialMlSourceAuthority, after: SpatialMlSourceAuthority) {
  if (fingerprint(before) !== fingerprint(after)) conflict('The retained source, case or private access context changed.');
}
/** Case first, then the complete source family in stable order, before batch/item/job locks. */
export async function spatialMlSourceAuthorityTx(client: PoolClient, pin: SourcePin, lock = false) {
  if (lock) {
    await client.query('SELECT id FROM cases WHERE id=$1 FOR UPDATE', [pin.caseId]);
    await client.query(`SELECT id FROM sources WHERE case_id=$1
      AND family_id=(SELECT family_id FROM sources WHERE case_id=$1 AND id=$2) ORDER BY id FOR SHARE`, [pin.caseId, pin.sourceId]);
  }
  const authority = await documentPageAuthorityTx(client, pin.sourceId, { revision: pin.sourceRevision, sha256: pin.sourceSha256 });
  if (authority.caseId !== pin.caseId || authority.caseRevision !== pin.caseRevision || authority.sourceBytes !== pin.sourceBytes)
    conflict('Pin the current source case, revision and byte count.');
  return authority;
}
const defaults: Dependencies = {
  capture: (pin, deadline) => transaction(client => spatialMlSourceAuthorityTx(client, pin), { deadlineAt: deadline }, 'repeatable_read_only'),
  pages: (sourceId, query) => new DocumentPagesService().pages(sourceId, query),
  verify: (a, deadline) => verifyObjectStream(a.objectKey, a.sourceBytes, a.sourceSha256, Math.max(1, deadline - Date.now())),
};
/** Native page metadata is inspected only for a new queue/retry. Subsequent exact-hash
 * reads reuse that immutable page pin, verify original bytes, and recapture authority. */
export class SpatialMlSourceService {
  constructor(private readonly dependencies: Dependencies = defaults) {}
  async prepare(raw: unknown) {
    const input = spatialMlSourceBatchSchema.parse(raw), deadline = Date.now() + 45_000;
    const authority = await this.dependencies.capture(input, deadline); live(deadline);
    const pages = await this.dependencies.pages(input.sourceId, { revision: String(input.sourceRevision), sha256: input.sourceSha256, offset: String(input.page - 1), limit: '1' });
    const page = pages.pages[0];
    if (pages.caseId !== input.caseId || pages.caseRevision !== input.caseRevision || pages.sourceId !== input.sourceId ||
      pages.sourceRevision !== input.sourceRevision || pages.sourceSha256 !== input.sourceSha256 || pages.sourceBytes !== input.sourceBytes ||
      pages.pages.length !== 1 || !page || page.page !== input.page || fingerprint(page.frame) !== fingerprint(input.frame))
      conflict('The selected page or displayed frame differs from the retained original.');
    same(authority, await this.dependencies.capture(input, deadline)); live(deadline);
    const scope: SpatialMlSourceScope = { kind: 'source', caseId: input.caseId, caseRevision: input.caseRevision,
      sourceId: input.sourceId, sourceRevision: input.sourceRevision, sourceSha256: input.sourceSha256, sourceBytes: input.sourceBytes,
      page: input.page, frame: input.frame, region: input.region, locator: { kind: 'pdf_page', page: input.page }, calibration: null, applicability: 'not_assessed' };
    return { input, scope, authority };
  }
  async current(scope: SpatialMlSourceScope, expected: SpatialMlSourceAuthority) {
    const deadline = Date.now() + 30_000;
    same(expected, await this.dependencies.capture(scope, deadline)); live(deadline);
    await this.dependencies.verify(expected, deadline); live(deadline);
    same(expected, await this.dependencies.capture(scope, deadline)); live(deadline);
  }
  async protect(client: PoolClient, scope: SpatialMlSourceScope, expected: SpatialMlSourceAuthority) {
    same(expected, await spatialMlSourceAuthorityTx(client, scope, true));
  }
}
export const spatialMlSourceService = new SpatialMlSourceService();
export function sourceBatchRequest(scope: SpatialMlSourceScope, modelId: string, requestKey: string): SourceRequest {
  return { scope: 'source', caseId: scope.caseId, caseRevision: scope.caseRevision, sourceId: scope.sourceId,
    sourceRevision: scope.sourceRevision, sourceSha256: scope.sourceSha256, sourceBytes: scope.sourceBytes,
    page: scope.page, frame: scope.frame, region: scope.region, task: 'floor-plan', modelId, requestKey };
}
/** Byte/deadline bounds apply before buffering, including artifact replay. */
export async function readSpatialMlObject(key: string, bytes: number, hash: string, maxBytes: number, deadline = Date.now() + 30_000) {
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > maxBytes)
    throw new AppError(413, 'ML_ARTIFACT_LIMIT', 'The retained object exceeds its bounded profile.');
  live(deadline);
  const { body } = await openObjectStream(key, bytes, Math.max(1, deadline - Date.now()));
  let count = 0; const chunks: Buffer[] = [];
  try {
    for await (const value of body) {
      live(deadline); const chunk = Buffer.from(value); count += chunk.length;
      if (count > bytes) throw new AppError(422, 'ML_ARTIFACT_INTEGRITY', 'The retained artifact exceeds its byte receipt.');
      chunks.push(chunk);
    }
    const output = Buffer.concat(chunks);
    if (count !== bytes || sha256(output) !== hash) throw new AppError(422, 'ML_ARTIFACT_INTEGRITY', 'The retained artifact differs from its exact receipt.');
    return output;
  } finally { body.destroy(); }
}

const finite = z.number().finite(), count = z.number().int().nonnegative();
const omissions = z.object({ small: count, complex: count, invalid: count, capacity: count });
const floorClass = z.enum(['outdoor', 'wall', 'kitchen', 'living_room', 'bedroom', 'bath', 'hallway', 'railing', 'storage', 'garage', 'other_room']);
const sourceComponent = z.object({ sourceComponentId: id, className: floorClass, sourceGeometrySha256: hash,
  sourceMaskPixels: count, bounds: z.tuple([finite, finite, finite, finite]), predictedComponentIoU: finite.min(0).max(1).optional() });
const representationKind = z.enum(['partition-context', 'whole-exact', 'whole-contour-reduced']);
const representation = z.object({ version: z.literal('floor-bounded-contours/2'),
  groups: z.array(sourceComponent.extend({ representation: representationKind, componentIds: z.array(id).max(100) })).max(100),
  maskOnlyComponents: z.array(sourceComponent.extend({ representation: representationKind.optional(), reason: z.enum(['small', 'complex', 'invalid', 'capacity']), inspection: z.literal('retained-class-mask') })).max(100),
  maskOnlyDetailsTruncated: count, omittedMaskPixels: omissions, contextPartitionLimit: count,
  roomContourTolerancePixels: finite.nonnegative(), roomMinimumPredictedComponentIoU: finite.min(0).max(1),
  capacityPolicy: z.literal('largest source regions first; whole partition family or retained mask only'),
  inspectionArtifact: z.literal('mask'), completePolygons: z.boolean() });
/** Public projection has explicit fields; arbitrary processor metadata/private keys stay private.
 * This transform connects model pixels to the rendered page only, never metres or objects. */
export function spatialMlSourcePixelReceipt(scope: SpatialMlSourceScope, raster: { width: number; height: number; transform?: Record<string, unknown> }, receipt: Record<string, unknown>) {
  const t = z.object({ unit: z.literal('pixel'), coordinateConvention: z.literal('pixel-edge'), page: z.number().int(),
    sourceWidth: count.positive().max(2000), sourceHeight: count.positive().max(2000), region: spatialMlSourceRegionSchema,
    pixelRegion: z.tuple([count, count, count, count]), orientation: z.literal('PDF page rotation applied'),
    pixelToSource: z.tuple([finite, finite, finite, finite, finite, finite]), pdfPagePoints: z.tuple([finite.positive(), finite.positive()]),
    pdfRenderScale: finite.positive().max(2), renderer: z.literal('pypdfium2') }).parse(raster.transform);
  const box = [Math.floor(scope.region.x * t.sourceWidth), Math.floor(scope.region.y * t.sourceHeight),
    Math.ceil((scope.region.x + scope.region.width) * t.sourceWidth), Math.ceil((scope.region.y + scope.region.height) * t.sourceHeight)];
  const transform = [(box[2] - box[0]) / raster.width, 0, box[0], 0, (box[3] - box[1]) / raster.height, box[1]];
  const scale = Math.min(2, 2000 / Math.max(scope.frame.width, scope.frame.height));
  if (t.page !== scope.page || fingerprint(t.region) !== fingerprint(scope.region) || fingerprint(box) !== fingerprint(t.pixelRegion) ||
    Math.abs(t.pdfRenderScale - scale) > 1e-9 || t.sourceWidth !== Math.ceil(scope.frame.width * scale) || t.sourceHeight !== Math.ceil(scope.frame.height * scale) ||
    t.pdfPagePoints.some((v, i) => Math.abs(v - [scope.frame.width, scope.frame.height][i]) > 1e-6) ||
    t.pixelToSource.some((v, i) => Math.abs(v - transform[i]) > 1e-9) || box[2] > t.sourceWidth || box[3] > t.sourceHeight)
    throw new AppError(422, 'ML_SOURCE_FRAME_MISMATCH', 'The processor page/crop transform differs from the admitted original selection.');
  return { coordinateUnit: 'pixel', evidenceState: 'unresolved', spatialAuthority: false, scoresCalibrated: false,
    sourceId: scope.sourceId, sourceSha256: scope.sourceSha256, originalPage: scope.locator, sourceFrame: scope.frame,
    region: scope.region, rasterTransform: t, calibration: null, applicability: 'not_assessed',
    omittedComponents: omissions.parse(receipt.omittedComponents),
    ...(receipt.floorRepresentation ? { floorRepresentation: representation.parse(receipt.floorRepresentation) } : {}),
    authority: 'Unresolved source-only model pixel candidates. No geometry, identity, ownership or learning qualification.' };
}
