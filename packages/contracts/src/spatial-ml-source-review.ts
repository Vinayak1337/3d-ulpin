import {z} from 'zod';
import {DocumentPageFrameSchema} from './document-pages';

export const SPATIAL_SOURCE_REVIEW_LIMITS=Object.freeze({requestBytes:256*1024,responseBytes:256*1024,
  resultBytes:4*1024*1024,artifactBytes:8*1024*1024,seconds:90});
const id=z.uuid().transform(v=>v.toLowerCase()).pipe(z.uuid()),hash=z.string().regex(/^[a-f0-9]{64}$/);
const count=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const text=(max:number)=>z.string().min(1).max(max).refine(v=>/\S/u.test(v),'Use nonblank text.')
  .refine(v=>!/[\u0000\uD800-\uDFFF]/u.test(v),'Use losslessly storable Unicode text.');
const region=z.strictObject({x:z.number().finite().min(0).max(1),y:z.number().finite().min(0).max(1),
  width:z.number().finite().positive().max(1),height:z.number().finite().positive().max(1)})
  .refine(r=>r.x+r.width<=1&&r.y+r.height<=1,'The region must fit the source page.');
export const SpatialSourceReviewScopeSchema=z.strictObject({kind:z.literal('source'),caseId:id,caseRevision:count,
  sourceId:id,sourceRevision:count.min(1),sourceSha256:hash,sourceBytes:count.min(1).max(16*1024*1024),
  page:count.min(1).max(100),frame:DocumentPageFrameSchema,region,
  locator:z.strictObject({kind:z.literal('pdf_page'),page:count.min(1).max(100)}),
  calibration:z.null(),applicability:z.literal('not_assessed')}).refine(v=>v.page===v.locator.page,'The page locator must match.');
const artifact=z.strictObject({sha256:hash,width:count.min(1).max(4000),height:count.min(1).max(4000),
  bytes:count.min(24).max(SPATIAL_SOURCE_REVIEW_LIMITS.artifactBytes)});
export const SpatialSourceReviewPinSchema=z.strictObject({itemId:id,batchId:id,jobId:id,
  scope:SpatialSourceReviewScopeSchema,inputFingerprint:hash,
  model:z.strictObject({id:text(120),sha256:hash,profileVersion:text(160)}),
  resultSha256:hash,transformSha256:hash,raster:artifact,mask:artifact});
export const SpatialSourceDecisionSchema=z.strictObject({componentId:text(120),
  decision:z.enum(['reviewed','rejected','needs_input']),reason:text(2000)});
export const SpatialSourceReviewRequestSchema=z.strictObject({requestKey:id,pin:SpatialSourceReviewPinSchema,
  decisions:z.array(SpatialSourceDecisionSchema).min(1).max(100)})
  .refine(v=>new Set(v.decisions.map(d=>d.componentId)).size===v.decisions.length,'Select each component once.');
const limits=z.strictObject({coordinateUnit:z.literal('pixel'),physicalTarget:z.null(),calibration:z.null(),
  canonicalMatchState:z.literal('not_assessed'),qualification:z.literal('not_assessed'),
  learningLabel:z.literal(false),independentGroundTruth:z.literal(false)});
export const SpatialSourceReviewContextSchema=z.strictObject({version:z.literal('source-candidate-context/1'),
  pin:SpatialSourceReviewPinSchema,candidates:z.array(z.strictObject({componentId:text(120),className:text(100),
    score:z.number().finite().min(0).max(1),geometrySha256:hash})).max(100),
  inspection:z.strictObject({itemUrl:z.string(),rasterUrl:z.string(),maskUrl:z.string()}),limits});
export const SpatialSourceReviewSchema=z.strictObject({version:z.literal('source-candidate-review/1'),
  reviewId:id,reviewRevision:z.literal(1),pin:SpatialSourceReviewPinSchema,
  decisions:z.array(SpatialSourceDecisionSchema).min(1).max(100),candidateCount:count.max(100),
  unselectedCount:count.max(100),limits,
  review:z.strictObject({actor:text(256),time:z.iso.datetime(),attribution:z.literal('local_process'),
    humanAuthenticated:z.literal(false),independentGroundTruth:z.literal(false)})})
  .refine(v=>new Set(v.decisions.map(d=>d.componentId)).size===v.decisions.length&&
    v.candidateCount===v.decisions.length+v.unselectedCount,'The decision population must remain intact.');
export type SpatialSourceReviewPin=z.output<typeof SpatialSourceReviewPinSchema>;
export type SpatialSourceReview=z.output<typeof SpatialSourceReviewSchema>;
