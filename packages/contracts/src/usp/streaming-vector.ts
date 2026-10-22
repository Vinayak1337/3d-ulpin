import {z} from 'zod';

const id=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/);
const parts=5000,partFeatures=100;
/** The one source of the large GeoJSON ceilings: 1 GiB and 5000 parts of 100 features (500,000 features). */
export const STREAMING_VECTOR_LIMITS=Object.freeze({
  version:'geojson-stream/2',featureBytes:1024*1024,chunkBytes:512*1024,
  chunkFeatures:partFeatures,featurePositions:10000,chunks:parts,features:parts*partFeatures,sourceBytes:1024*1024*1024,
  metadataBytes:64*1024,metadataFields:32,jsonNesting:64,
  numberPolicy:'exact_decimal_roundtrip_or_quarantine',duplicateKeyPolicy:'quarantine',
  readMs:10*60*1000,readSpanBytes:128*1024*1024,lookaheadSlots:8,stagedBytes:64*1024*1024,
});
/** A whole read may take `readMs` for each started `readSpanBytes` of the original: 10 minutes up to 128 MiB,
 * as before, and 80 minutes for 1 GiB. */
export function streamingReadMs(sourceBytes:number){
  const spans=Math.max(1,Math.ceil(sourceBytes/STREAMING_VECTOR_LIMITS.readSpanBytes));
  return spans*STREAMING_VECTOR_LIMITS.readMs;
}
/** Exact parity with the canonical area normalizer; counts are accepted features, not multipart members. */
export const StreamingVectorGeometryKindSchema=z.enum([
  'Point','MultiPoint','LineString','MultiLineString','Polygon','MultiPolygon',
]);
export const StreamingVectorGeometrySummarySchema=z.strictObject({
  rawJobId:id,
  counts:z.partialRecord(StreamingVectorGeometryKindSchema,
    z.number().int().positive().max(STREAMING_VECTOR_LIMITS.features)),
});
export type StreamingVectorGeometrySummary=z.infer<typeof StreamingVectorGeometrySummarySchema>;
export const StreamingVectorFramingSchema=z.enum(['feature-collection','geojson-seq-rs']);
export const StreamingVectorRequestSchema=z.strictObject({
  requestKey:id,expectedCaseRevision:z.number().int().nonnegative(),
  expectedSourceRevision:z.number().int().positive(),sourceSha256:hash,
  framing:StreamingVectorFramingSchema,
});
export const StreamingVectorInputSchema=z.strictObject({
  version:z.literal(STREAMING_VECTOR_LIMITS.version),jobId:id,caseId:id,
  caseRevision:z.number().int().nonnegative(),sourceId:id,sourceRevision:z.number().int().positive(),
  sourceFamilyId:id,sourceSha256:hash,sourceBytes:z.number().int().positive().max(STREAMING_VECTOR_LIMITS.sourceBytes),
  objectKey:z.string().min(1).max(320),framing:StreamingVectorFramingSchema,
  subject:z.string().min(1).max(300),accessBinding:hash,readerSha256:hash,inputFingerprint:hash,
});
export const StreamingVectorRefSchema=z.strictObject({key:z.string().min(1).max(400),sha256:hash,
  bytes:z.number().int().positive().max(STREAMING_VECTOR_LIMITS.chunkBytes)});
export const StreamingVectorSlotSchema=z.strictObject({
  chunkIndex:z.number().int().nonnegative().max(STREAMING_VECTOR_LIMITS.chunks),
  status:z.enum(['ready','quarantined']),published:z.boolean(),
  firstFeatureIndex:z.number().int().nonnegative(),lastFeatureIndex:z.number().int().nonnegative().nullable(),
  records:z.number().int().nonnegative().max(STREAMING_VECTOR_LIMITS.chunkFeatures),
  accepted:z.number().int().nonnegative(),quarantined:z.number().int().nonnegative(),
  bytes:z.number().int().nonnegative().max(STREAMING_VECTOR_LIMITS.chunkBytes),
  ref:StreamingVectorRefSchema.nullable(),issueCode:z.string().max(80).nullable(),
  resultSha256:hash,attempt:z.number().int().positive(),fence:z.number().int().positive(),
});
/** Read-only freshness never changes retained results or grants current mutation authority. */
export const RetainedResultFreshnessSchema=z.strictObject({current:z.boolean(),
  reasons:z.array(z.enum(['case_advanced','reader_changed','converter_changed','source_superseded'])).max(4)});
export const StreamingVectorStatusSchema=z.strictObject({
  ...RetainedResultFreshnessSchema.shape,
  version:z.literal(STREAMING_VECTOR_LIMITS.version),jobId:id,caseId:id,sourceId:id,
  sourceRevision:z.number().int().positive(),sourceSha256:hash,framing:StreamingVectorFramingSchema,
  status:z.enum(['queued','running','completed','completed_with_rejections','failed','stale']),
  nextPublishIndex:z.number().int().nonnegative(),sealedChunks:z.number().int().nonnegative().nullable(),
  records:z.number().int().nonnegative(),accepted:z.number().int().nonnegative(),quarantined:z.number().int().nonnegative(),
  issueCode:z.string().max(80).nullable(),unknownRemainder:z.boolean(),
  reference:z.strictObject({sourceCrs:z.string().max(100).nullable(),evidence:z.string().max(200).nullable(),
    globalPlacement:z.literal('not_qualified')}),
  slots:z.array(StreamingVectorSlotSchema).max(32),
});
export const StreamingVectorRecordSchema=z.strictObject({
  featureIndex:z.number().int().nonnegative(),byteStart:z.number().int().nonnegative(),byteEnd:z.number().int().positive(),
  rawSha256:hash,disposition:z.enum(['accepted','quarantined']),issueCode:z.string().max(80).nullable(),
  feature:z.unknown(),
});
export const StreamingVectorPayloadSchema=z.strictObject({
  version:z.literal(STREAMING_VECTOR_LIMITS.version),jobId:id,sourceId:id,sourceRevision:z.number().int().positive(),
  sourceSha256:hash,chunkIndex:z.number().int().nonnegative(),
  records:z.array(StreamingVectorRecordSchema).max(STREAMING_VECTOR_LIMITS.chunkFeatures),
});
export const StreamingVectorChunkResponseSchema=z.strictObject({
  ...RetainedResultFreshnessSchema.shape,
  slot:StreamingVectorSlotSchema,payload:StreamingVectorPayloadSchema.nullable(),
  sourceComplete:z.boolean(),unknownRemainder:z.boolean(),
});
export type StreamingVectorInput=z.infer<typeof StreamingVectorInputSchema>;
export type StreamingVectorRecord=z.infer<typeof StreamingVectorRecordSchema>;
export type StreamingVectorPayload=z.infer<typeof StreamingVectorPayloadSchema>;
