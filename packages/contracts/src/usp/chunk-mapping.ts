import {z} from 'zod';
import {AdaptiveMappingResponseSchema} from './adaptive-mapping';

const id=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/);
const issue=z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/);
export const CHUNK_MAPPING_LIMITS=Object.freeze({version:'chunk-mapping/1',chunkBytes:256*1024,
  chunkFeatures:100,chunks:4096,readMs:12*60*1000,active:1});
export const ChunkMappingRequestSchema=z.strictObject({requestKey:id,rawJobId:id,
  expectedCaseRevision:z.number().int().nonnegative(),expectedSourceRevision:z.number().int().positive(),sourceSha256:hash});
export const ChunkMappingInputSchema=z.strictObject({version:z.literal(CHUNK_MAPPING_LIMITS.version),jobId:id,
  caseId:id,caseRevision:z.number().int().nonnegative(),sourceId:id,sourceRevision:z.number().int().positive(),
  sourceFamilyId:id,sourceSha256:hash,rawJobId:id,rawInputFingerprint:hash,readerSha256:hash,
  route:z.enum(['approved_recipe','proposal_only']),recipeId:id.nullable(),recipeRevision:z.number().int().positive().nullable(),
  planHash:hash.nullable(),schemaFingerprint:hash.nullable(),workspaceFingerprint:hash.nullable(),
  converterSha256:hash,subject:z.string().min(1).max(300),accessBinding:hash,inputFingerprint:hash});
export const ChunkMappingFieldSchema=z.strictObject({state:z.enum(['known','absent','null','withheld','conflicting','unknown']),
  value:z.string().max(2048).nullable(),sourcePath:z.string().max(512).nullable()});
export const ChunkMappingObservationSchema=z.strictObject({featureIndex:z.number().int().nonnegative(),
  byteStart:z.number().int().nonnegative(),byteEnd:z.number().int().positive(),rawSha256:hash,
  disposition:z.enum(['observed','quarantined','unresolved']),sourceKey:ChunkMappingFieldSchema,
  name:ChunkMappingFieldSchema,geometryRef:z.strictObject({rawJobId:id,chunkIndex:z.number().int().nonnegative(),
    featureIndex:z.number().int().nonnegative(),rawSha256:hash,sourcePath:z.literal('/features/*/geometry')}).nullable(),
  issueCodes:z.array(issue).max(8)});
export const ChunkMappingPayloadSchema=z.strictObject({version:z.literal(CHUNK_MAPPING_LIMITS.version),jobId:id,
  rawJobId:id,sourceId:id,sourceRevision:z.number().int().positive(),sourceSha256:hash,
  chunkIndex:z.number().int().nonnegative(),rawResultSha256:hash,schemaFingerprint:hash.nullable(),
  recipeRevision:z.number().int().positive(),
  converterSha256:hash,records:z.array(ChunkMappingObservationSchema).max(CHUNK_MAPPING_LIMITS.chunkFeatures)});
export const ChunkMappingSlotSchema=z.strictObject({chunkIndex:z.number().int().nonnegative().max(CHUNK_MAPPING_LIMITS.chunks),
  status:z.enum(['ready','quarantined']),published:z.boolean(),rawResultSha256:hash.nullable(),
  schemaFingerprint:hash.nullable(),schemaDrift:z.boolean(),
  firstFeatureIndex:z.number().int().nonnegative(),lastFeatureIndex:z.number().int().nonnegative().nullable(),
  records:z.number().int().nonnegative().max(CHUNK_MAPPING_LIMITS.chunkFeatures),
  normalized:z.number().int().nonnegative(),quarantined:z.number().int().nonnegative(),unresolved:z.number().int().nonnegative(),
  bytes:z.number().int().nonnegative().max(CHUNK_MAPPING_LIMITS.chunkBytes),
  ref:z.strictObject({key:z.string().min(1).max(400),sha256:hash,bytes:z.number().int().positive().max(CHUNK_MAPPING_LIMITS.chunkBytes)}).nullable(),
  issueCode:issue.nullable(),resultSha256:hash,attempt:z.number().int().positive(),fence:z.number().int().positive()});
export const ChunkMappingStatusSchema=z.strictObject({version:z.literal(CHUNK_MAPPING_LIMITS.version),jobId:id,rawJobId:id,
  caseId:id,sourceId:id,sourceRevision:z.number().int().positive(),sourceSha256:hash,
  status:z.enum(['queued','running','needs_input','disabled','unavailable','completed','completed_with_rejections','failed','stale']),
  route:z.enum(['approved_recipe','proposal_only']),recipeId:id.nullable(),recipeRevision:z.number().int().positive().nullable(),
  schemaFingerprint:hash.nullable(),converterSha256:hash,sourceCrs:z.string().max(100).nullable(),
  referenceEvidence:z.string().max(200).nullable(),globalPlacement:z.literal('not_qualified'),
  nextPublishIndex:z.number().int().nonnegative(),sealedChunks:z.number().int().nonnegative().nullable(),
  records:z.number().int().nonnegative(),normalized:z.number().int().nonnegative(),
  quarantined:z.number().int().nonnegative(),unresolved:z.number().int().nonnegative(),duplicateKeys:z.number().int().nonnegative(),
  schemaDriftChunks:z.number().int().nonnegative(),
  issueCode:issue.nullable(),unknownRemainder:z.boolean(),sourceComplete:z.boolean(),identityComplete:z.boolean(),
  proposal:AdaptiveMappingResponseSchema.nullable(),proposalTrainingEligible:z.literal(false),slots:z.array(ChunkMappingSlotSchema).max(32)});
export const ChunkMappingChunkResponseSchema=z.strictObject({slot:ChunkMappingSlotSchema,
  payload:ChunkMappingPayloadSchema.nullable(),sourceComplete:z.boolean(),identityComplete:z.boolean(),unknownRemainder:z.boolean()});
export type ChunkMappingInput=z.infer<typeof ChunkMappingInputSchema>;
export type ChunkMappingObservation=z.infer<typeof ChunkMappingObservationSchema>;
export type ChunkMappingPayload=z.infer<typeof ChunkMappingPayloadSchema>;
export type ChunkMappingSlot=z.infer<typeof ChunkMappingSlotSchema>;
