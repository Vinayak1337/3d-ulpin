import {z} from 'zod';
import {POINT_BATCH_RECORD_LENGTHS} from './plain';

export const POINT_BATCH_VERSION='point-batch/1' as const;
// SB1: (1 overview + 64 preview batches) under three pins = 195 jobs; 611 keeps legacy plans within the cap.
export const POINT_BATCH_LIMITS=Object.freeze({originalBytes:1024**3,directRetainBytes:16*1024*1024,retainedSources:64,
  retainedBytes:256*1024*1024,sourcePoints:500_000_000,batchPoints:32_768,
  artifactBytes:2*1024*1024,resultBytes:32*1024,jobsPerSource:611,active:2});
const id=z.uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/),rev=z.number().int().nonnegative();
const positive=z.number().int().positive(),finite=z.number().finite();
export {POINT_BATCH_RECORD_LENGTHS};
const FORMAT_0_DIMENSIONS = ['X', 'Y', 'Z', 'intensity', 'return_number', 'number_of_returns',
  'scan_direction_flag', 'edge_of_flight_line', 'classification', 'synthetic', 'key_point', 'withheld',
  'scan_angle_rank', 'user_data', 'point_source_id'];
const FORMAT_6_DIMENSIONS=['X','Y','Z','intensity','return_number','number_of_returns','synthetic',
  'key_point','withheld','overlap','scanner_channel','scan_direction_flag','edge_of_flight_line',
  'classification','user_data','scan_angle','point_source_id','gps_time'];
const RGB_DIMENSIONS = ['red', 'green', 'blue'];
const POINT_DIMENSIONS = {
  0: FORMAT_0_DIMENSIONS, 1: [...FORMAT_0_DIMENSIONS, 'gps_time'],
  2: [...FORMAT_0_DIMENSIONS, ...RGB_DIMENSIONS], 3: [...FORMAT_0_DIMENSIONS, 'gps_time', ...RGB_DIMENSIONS],
  6: FORMAT_6_DIMENSIONS, 7: [...FORMAT_6_DIMENSIONS, ...RGB_DIMENSIONS],
  8: [...FORMAT_6_DIMENSIONS, ...RGB_DIMENSIONS, 'nir'],
};
export const PointBatchSelectionSchema=z.strictObject({start:rev.max(POINT_BATCH_LIMITS.sourcePoints-1),
  count:positive.max(POINT_BATCH_LIMITS.batchPoints),step:positive.max(65_536).optional()});
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
export const PointBatchMetadataSchema=z.strictObject({lasVersion:z.enum(['1.2','1.3','1.4']),
  pointFormatId:z.literal([0,1,2,3,6,7,8]),recordLength:z.literal([20,28,26,34,30,36,38]),
  recordEncoding:z.string().regex(/^las-1\.[234]-point-format-[0123678]-le$/),
  dimensions:z.array(z.string().max(64)).min(15).max(22),
  sourcePointCount:positive.max(POINT_BATCH_LIMITS.sourcePoints),
  scale:z.tuple([finite,finite,finite]),offset:z.tuple([finite,finite,finite]),
  sourceBounds:z.tuple([finite,finite,finite,finite,finite,finite]),
  crsWkt:z.string().max(8192).nullable(),horizontalAuthority:z.string().max(100).nullable(),
  verticalReference:z.string().max(500).nullable(),verticalReferenceStatus:z.enum(['known','unknown']),
  gpsTimeType:z.enum(['standard','week_time']).nullable(),batch:PointBatchSelectionSchema,
  recordFields:z.array(z.strictObject({name:z.string().max(64),offset:rev.max(37),
    dtype:z.string().max(16),bytes:positive.max(38)})).min(1).max(20),
  globalPlacement:z.literal('not_qualified')}).superRefine((m,ctx)=>{
  const dimensions = POINT_DIMENSIONS[m.pointFormatId];
  if((m.pointFormatId >= 6 && m.lasVersion !== '1.4') ||
    m.recordLength !== POINT_BATCH_RECORD_LENGTHS[m.pointFormatId] ||
    m.recordEncoding !== `las-${m.lasVersion}-point-format-${m.pointFormatId}-le` ||
    m.dimensions.length !== dimensions.length || m.dimensions.some((name,index)=>name !== dimensions[index]) ||
    (m.gpsTimeType !== null) !== dimensions.includes('gps_time') ||
    m.recordFields.some(f=>f.offset+f.bytes>m.recordLength))
    ctx.addIssue({code:'custom',message:'Point metadata must describe the source format without invented dimensions.'});
});
const ResultBase=z.strictObject({version:z.literal(POINT_BATCH_VERSION),input:PointBatchInputSchema,
  metadata:PointBatchMetadataSchema,artifact:PointArtifactSchema,createdAt:z.iso.datetime()});
export const PointBatchResultSchema=ResultBase.superRefine((value,ctx)=>{
  const m=value.metadata;
  if(m.verticalReferenceStatus==='known'!==Boolean(m.verticalReference)||
    m.batch.start+m.batch.count>m.sourcePointCount||
    m.batch.count*m.recordLength!==value.artifact.bytes||
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
