import {z} from 'zod';

export const CITYJSON_VERSION='cityjson-native/1' as const;
export const CITYJSON_LIMITS=Object.freeze({originalBytes:8*1024*1024,artifactBytes:32*1024*1024,
  resultBytes:16*1024,statusBytes:16*1024,retainedSources:64,retainedBytes:128*1024*1024,jobsPerSource:16,active:2});
const id=z.uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/),rev=z.number().int().nonnegative(),positive=z.number().int().positive();
export const CityJSONLineageSchema=z.strictObject({issuer:z.string().min(1).max(300).nullable(),
  originalUrl:z.url().max(2048).nullable(),acquiredAt:z.iso.datetime().nullable(),
  permissionReference:z.string().max(2048).nullable(),geography:z.string().max(500).nullable(),
  limitations:z.array(z.string().max(1000)).max(20)});
export const CityJSONRetainSchema=z.strictObject({requestKey:id,expectedCaseRevision:rev,lineage:CityJSONLineageSchema});
export const CityJSONRequestSchema=z.strictObject({requestKey:id,expectedCaseRevision:rev,
  expectedSourceRevision:positive,sourceSha256:hash});
export const CityJSONOriginalSchema=z.strictObject({version:z.literal(CITYJSON_VERSION),subject:z.string().min(1).max(256),
  accessSha256:hash,sha256:hash,bytes:positive.max(CITYJSON_LIMITS.originalBytes),receivedAt:z.iso.datetime(),
  lineageState:z.literal('caller_declared'),lineage:CityJSONLineageSchema});
export const CityJSONInputSchema=z.strictObject({version:z.literal(CITYJSON_VERSION),jobId:id,caseId:id,
  caseRevision:rev,caseContextSha256:hash,sourceId:id,sourceFamilyId:id,sourceRevision:positive,
  sourceSha256:hash,sourceBytes:positive.max(CITYJSON_LIMITS.originalBytes),objectKey:z.string().min(1).max(512),
  subject:z.string().min(1).max(256),accessSha256:hash,readerSha256:hash,
  selection:z.literal('complete_bounded_source')});
const coordinate=z.tuple([z.number().finite(),z.number().finite(),z.number().finite()]);
export const CityJSONSummarySchema=z.strictObject({schemaVersion:z.literal('source-native-cityjson/1'),
  status:z.enum(['supported','partial_unsupported']),sourceSha256:hash,sourceBytes:positive.max(CITYJSON_LIMITS.originalBytes),
  objectCount:rev.max(1000),vertexCount:rev.max(100000),boundaryIndexCount:rev.max(500000),
  supportedGeometryCount:rev.max(500000),unsupportedGeometryCount:rev.max(500000),
  decodedBounds:z.strictObject({minimum:coordinate,maximum:coordinate}).nullable(),
  transformState:z.enum(['supplied','absent']),coordinateMode:z.enum(['supplied_transform_only','source_coordinates_untransformed']),
  referenceSystemState:z.enum(['absent','null','declared']),
  structuralReadingOnly:z.literal(true),globalPlacement:z.literal('not_qualified'),
  watertightSolid:z.literal('not_qualified'),interiorFloors:z.literal('not_established_by_reader'),rights:z.literal('not_assessed')});
export const CityJSONArtifactSchema=z.strictObject({key:z.string().min(1).max(512),sha256:hash,
  bytes:positive.max(CITYJSON_LIMITS.artifactBytes),mediaType:z.literal('application/json'),
  profile:z.literal('source-native-cityjson/1')});
export const CityJSONResultSchema=z.strictObject({version:z.literal(CITYJSON_VERSION),input:CityJSONInputSchema,
  summary:CityJSONSummarySchema,artifact:CityJSONArtifactSchema,createdAt:z.iso.datetime()}).superRefine((v,ctx)=>{
  if(v.summary.sourceSha256!==v.input.sourceSha256||v.summary.sourceBytes!==v.input.sourceBytes)
    ctx.addIssue({code:'custom',message:'Native summary must bind to the exact original.'});
});
export const CityJSONStatusSchema=z.strictObject({version:z.literal(CITYJSON_VERSION),caseId:id,sourceId:id,jobId:id,
  currentCaseRevision:rev,sourceRevision:positive,sourceSha256:hash,
  status:z.enum(['queued','running','completed','failed','stale']),code:z.string().max(100).nullable(),
  result:z.strictObject({summary:CityJSONSummarySchema,artifact:CityJSONArtifactSchema,createdAt:z.iso.datetime()}).nullable()});
export const CityJSONRetainReceiptSchema=z.strictObject({version:z.literal(CITYJSON_VERSION),caseId:id,
  caseRevision:rev,sourceId:id,sourceRevision:positive,sourceSha256:hash,bytes:positive.max(CITYJSON_LIMITS.originalBytes),jobId:id});
export const CityJSONQueueReceiptSchema=z.strictObject({version:z.literal(CITYJSON_VERSION),caseId:id,sourceId:id,jobId:id});
export type CityJSONInput=z.infer<typeof CityJSONInputSchema>;
export type CityJSONResult=z.infer<typeof CityJSONResultSchema>;
