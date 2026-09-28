import {z} from 'zod';

const id=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/);
export const STREAMING_VECTOR_LIMITS=Object.freeze({
  version:'geojson-stream/1',featureBytes:1024*1024,chunkBytes:512*1024,
  chunkFeatures:100,featurePositions:10000,chunks:4096,sourceBytes:128*1024*1024,
  metadataBytes:64*1024,readMs:10*60*1000,lookaheadSlots:8,stagedBytes:64*1024*1024,
});
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
export const StreamingVectorStatusSchema=z.strictObject({
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
  slot:StreamingVectorSlotSchema,payload:StreamingVectorPayloadSchema.nullable(),
  sourceComplete:z.boolean(),unknownRemainder:z.boolean(),
});
export type StreamingVectorInput=z.infer<typeof StreamingVectorInputSchema>;
export type StreamingVectorRecord=z.infer<typeof StreamingVectorRecordSchema>;
export type StreamingVectorPayload=z.infer<typeof StreamingVectorPayloadSchema>;
