import {z} from 'zod';
import {PROJECTED_VECTOR_PROFILE as p,ProjectedVectorIndexSchema,ProjectedVectorResultSchema,
  ProjectedChunkPinSchema,ProjectedChunkCoverageSchema,AdministrativeNativeKeySchema,ProjectedVectorTransformSchema} from './projected-vector';

export const SEMANTIC_CHUNK_PROFILE=Object.freeze({version:'nwic-semantic-chunks/1',records:100,positions:50000,
  referencedBytes:8*1024*1024,chunkMs:60000,chunks:128,chunkBodyBytes:128*1024,preparationBytes:1024*1024,
  chunkMetadataBytes:1024*1024,metadataBytes:256*1024*1024,displayMilestones:3});
const id=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/),n=z.number().int().nonnegative(),c=SEMANTIC_CHUNK_PROFILE;
export const SemanticPartitionSchema=z.strictObject({sequence:n.min(1).max(c.chunks),first:n.max(732),last:n.max(732),
  records:n.min(1).max(c.records),positions:n.min(1).max(c.positions),referencedBytes:n.min(1).max(c.referencedBytes)})
  .refine(v=>v.last-v.first+1===v.records,'A semantic partition contains complete contiguous records.');
export const SemanticPreparationSchema=z.strictObject({version:z.literal(c.version),jobId:id,sourceId:id,
  inputFingerprint:hash,publisherSha256:hash,result:ProjectedVectorResultSchema,index:ProjectedVectorIndexSchema,
  partitions:z.array(SemanticPartitionSchema).min(1).max(c.chunks)});
export const SemanticRecordSchema=z.strictObject({featureIndex:n.max(732),unitId:id,key:AdministrativeNativeKeySchema,
  disposition:z.enum(['admitted','quarantined']),rawSha256:hash,geographicSha256:hash.nullable(),
  nativeGeometrySha256:hash,geographicGeometrySha256:hash.nullable(),recordSha256:hash});
export const SemanticChunkSchema=z.strictObject({version:z.literal(c.version),jobId:id,caseId:id,caseRevision:n,
  sourceId:id,sourceRevision:n.min(1),sourceFamilyId:id,sourceSha256:z.literal(p.zipSha256),
  inputFingerprint:hash,accessBinding:hash,publisherSha256:hash,indexSha256:hash,transform:ProjectedVectorTransformSchema,
  partition:SemanticPartitionSchema,previous:ProjectedChunkPinSchema.nullable(),attempt:n.min(1).max(3),fence:n.min(1),
  records:z.array(SemanticRecordSchema).min(1).max(c.records),coverage:ProjectedChunkCoverageSchema});
export const SemanticChunkResponseSchema=z.strictObject({pin:ProjectedChunkPinSchema,chunk:SemanticChunkSchema,
  currentSourceAccepted:z.boolean(),sourceJobStatus:z.enum(['queued','running','succeeded','failed','stale'])});
export const SemanticDisplayPhaseSchema=z.enum(['early','middle','final']);
export const SemanticDisplayReservationSchema=z.strictObject({version:z.literal(c.version),jobId:id,sourceId:id,
  slots:z.strictObject({early:id,middle:id,final:id}),outcomes:z.record(SemanticDisplayPhaseSchema,
    z.discriminatedUnion('state',[z.strictObject({state:z.literal('reserved')}),
      z.strictObject({state:z.literal('created'),jobId:id,errorCode:z.string().max(80).optional()}),z.strictObject({state:z.literal('unavailable'),code:z.string().max(80)})]))});
export type SemanticPartition=z.infer<typeof SemanticPartitionSchema>;
export type SemanticPreparation=z.infer<typeof SemanticPreparationSchema>;
export type SemanticChunk=z.infer<typeof SemanticChunkSchema>;
export type SemanticRecord=z.infer<typeof SemanticRecordSchema>;
export type SemanticDisplayPhase=z.infer<typeof SemanticDisplayPhaseSchema>;
