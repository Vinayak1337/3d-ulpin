import {z} from 'zod';

export const POINT_BATCH_VERSION='point-batch/1' as const;
export const POINT_BATCH_LIMITS=Object.freeze({originalBytes:16*1024*1024,retainedSources:64,
  retainedBytes:256*1024*1024,sourcePoints:5_000_000,batchPoints:8192,
  artifactBytes:512*1024,resultBytes:32*1024,jobsPerSource:32,active:2});
const id=z.uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/),rev=z.number().int().nonnegative();
const positive=z.number().int().positive(),finite=z.number().finite();
const FORMAT_6_DIMENSIONS=['X','Y','Z','intensity','return_number','number_of_returns','synthetic',
  'key_point','withheld','overlap','scanner_channel','scan_direction_flag','edge_of_flight_line',
  'classification','user_data','scan_angle','point_source_id','gps_time'];
export const PointBatchSelectionSchema=z.strictObject({start:rev.max(POINT_BATCH_LIMITS.sourcePoints-1),
  count:positive.max(POINT_BATCH_LIMITS.batchPoints)});
export const PointLineageSchema=z.strictObject({kind:z.enum(['original','native_point_derivative','unknown']),
  issuer:z.string().min(1).max(300).nullable(),originalUrl:z.url().max(2048).nullable(),
  acquiredAt:z.iso.datetime().nullable(),permissionReference:z.string().max(2048).nullable(),
  geography:z.string().max(500).nullable(),upstreamBytes:positive.nullable(),upstreamRetained:z.boolean().nullable(),
  parentSha256:hash.nullable(),limitations:z.array(z.string().max(1000)).max(20),note:z.string().max(1000).nullable()});
export const PointRetainSchema=z.strictObject({requestKey:id,expectedCaseRevision:rev,lineage:PointLineageSchema});
export const PointBatchRequestSchema=z.strictObject({requestKey:id,expectedCaseRevision:rev,
  expectedSourceRevision:positive,sourceSha256:hash,batch:PointBatchSelectionSchema});
export const PointOriginalSchema=z.strictObject({version:z.literal(POINT_BATCH_VERSION),subject:z.string().min(1).max(256),
  sha256:hash,bytes:positive.max(POINT_BATCH_LIMITS.originalBytes),receivedAt:z.iso.datetime(),
  lineageState:z.literal('caller_declared'),lineage:PointLineageSchema});
export const PointBatchInputSchema=z.strictObject({version:z.literal(POINT_BATCH_VERSION),jobId:id,caseId:id,
  caseRevision:rev,caseContextSha256:hash,sourceId:id,sourceFamilyId:id,sourceRevision:positive,
  sourceSha256:hash,sourceBytes:positive.max(POINT_BATCH_LIMITS.originalBytes),objectKey:z.string().min(1).max(512),
  subject:z.string().min(1).max(256),accessSha256:hash,readerSha256:hash,batch:PointBatchSelectionSchema.nullable()});
export const PointArtifactSchema=z.strictObject({key:z.string().min(1).max(512),sha256:hash,
  bytes:positive.max(POINT_BATCH_LIMITS.artifactBytes),mediaType:z.literal('application/vnd.las.point-records')});
export const PointBatchMetadataSchema=z.strictObject({lasVersion:z.literal('1.4'),pointFormatId:z.literal(6),
  recordLength:z.literal(30),recordEncoding:z.literal('las-1.4-point-format-6-le'),
  dimensions:z.array(z.string().max(64)).length(FORMAT_6_DIMENSIONS.length),
  sourcePointCount:positive.max(POINT_BATCH_LIMITS.sourcePoints),
  scale:z.tuple([finite,finite,finite]),offset:z.tuple([finite,finite,finite]),
  sourceBounds:z.tuple([finite,finite,finite,finite,finite,finite]),
  crsWkt:z.string().max(8192).nullable(),horizontalAuthority:z.string().max(100).nullable(),
  verticalReference:z.string().max(500).nullable(),verticalReferenceStatus:z.enum(['known','unknown']),
  gpsTimeType:z.enum(['standard','week_time']),batch:PointBatchSelectionSchema,
  recordFields:z.array(z.strictObject({name:z.string().max(64),offset:rev.max(29),
    dtype:z.string().max(16),bytes:positive.max(30)})).min(1).max(20),
  globalPlacement:z.literal('not_qualified')});
const ResultBase=z.strictObject({version:z.literal(POINT_BATCH_VERSION),input:PointBatchInputSchema,
  metadata:PointBatchMetadataSchema,artifact:PointArtifactSchema,createdAt:z.iso.datetime()});
export const PointBatchResultSchema=ResultBase.superRefine((value,ctx)=>{
  const m=value.metadata;
  if(m.verticalReferenceStatus==='known'!==Boolean(m.verticalReference)||
    m.batch.start+m.batch.count>m.sourcePointCount||
    m.batch.count*m.recordLength!==value.artifact.bytes||
    m.dimensions.some((name,index)=>name!==FORMAT_6_DIMENSIONS[index])||
    m.recordFields.some(f=>f.offset+f.bytes>m.recordLength)||
    (value.input.batch!==null&&(m.batch.start!==value.input.batch.start||m.batch.count!==value.input.batch.count)))
    ctx.addIssue({code:'custom',message:'Point batch metadata does not describe the exact native records.'});
});
export const PointBatchStatusSchema=z.strictObject({version:z.literal(POINT_BATCH_VERSION),caseId:id,sourceId:id,
  jobId:id,currentCaseRevision:rev,sourceRevision:positive,sourceSha256:hash,
  status:z.enum(['queued','running','completed','failed','stale']),code:z.string().nullable(),
  result:ResultBase.omit({input:true}).nullable()});
export const PointRetainReceiptSchema=z.strictObject({version:z.literal(POINT_BATCH_VERSION),caseId:id,
  caseRevision:rev,sourceId:id,sourceRevision:positive,sourceSha256:hash,bytes:positive,jobId:id});
export const PointBatchQueueReceiptSchema=z.strictObject({version:z.literal(POINT_BATCH_VERSION),caseId:id,sourceId:id,jobId:id});
export type PointBatchInput=z.infer<typeof PointBatchInputSchema>;
export type PointBatchResult=z.infer<typeof PointBatchResultSchema>;
