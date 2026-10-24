import {z} from 'zod';

export const DXF_VERSION='dxf-native/1' as const;
export const DXF_LIMITS=Object.freeze({originalBytes:16*1024*1024,artifactBytes:16*1024*1024,
  resultBytes:16*1024,statusBytes:16*1024,retainedSources:64,retainedBytes:256*1024*1024,jobsPerSource:16,
  active:1,workerMs:150_000,requestMs:45_000,readMs:60_000});
const id=z.uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/),rev=z.number().int().nonnegative(),positive=z.number().int().positive();
export const DXFLineageSchema=z.strictObject({issuer:z.string().min(1).max(300).nullable(),
  originalUrl:z.url().max(2048).nullable(),acquiredAt:z.iso.datetime().nullable(),
  permissionReference:z.string().max(2048).nullable(),geography:z.string().max(500).nullable(),
  limitations:z.array(z.string().max(1000)).max(20)});
export const DXFRetainSchema=z.strictObject({requestKey:id,expectedCaseRevision:rev,lineage:DXFLineageSchema});
export const DXFRequestSchema=z.strictObject({requestKey:id,expectedCaseRevision:rev,
  expectedSourceRevision:positive,sourceSha256:hash});
export const DXFOriginalSchema=z.strictObject({version:z.literal(DXF_VERSION),subject:z.string().min(1).max(256),
  accessSha256:hash,sha256:hash,bytes:positive.max(DXF_LIMITS.originalBytes),receivedAt:z.iso.datetime(),
  lineageState:z.literal('caller_declared'),lineage:DXFLineageSchema});
export const DXFToolPinsSchema=z.strictObject({platform:z.literal('windows-x86_64'),pythonSha256:hash,
  profileSha256:hash,readerSha256:hash,supervisorSha256:hash,dependencyLockSha256:hash,codeSha256:hash});
export const DXFInputSchema=z.strictObject({version:z.literal(DXF_VERSION),jobId:id,caseId:id,
  caseRevision:rev,caseContextSha256:hash,sourceId:id,sourceFamilyId:id,sourceRevision:positive,
  sourceSha256:hash,sourceBytes:positive.max(DXF_LIMITS.originalBytes),objectKey:z.string().min(1).max(512),
  subject:z.string().min(1).max(256),accessSha256:hash,readerSha256:hash,tools:DXFToolPinsSchema.nullable(),
  selection:z.literal('complete_bounded_source')});
export const DXFSummarySchema=z.strictObject({schemaVersion:z.literal('dxf-native-inspection/1'),sourceSha256:hash,
  sourceBytes:positive.max(DXF_LIMITS.originalBytes),dxfVersion:z.enum(['AC1009','AC1012','AC1014','AC1015','AC1018','AC1021','AC1024','AC1027','AC1032']),
  recordCount:rev.max(100000),projectedEntityCount:rev.max(10000),pointCount:rev.max(100000),unsupportedFindingCount:rev.max(10000),
  units:z.strictObject({state:z.enum(['absent','unitless','declared','unsupported']),code:z.number().int().nullable(),name:z.string().max(100).nullable()}),
  inspectionFrame:z.literal('source_local'),geometryValidity:z.literal('not_assessed'),globalPlacement:z.literal('not_assessed'),
  unitConversionApplied:z.literal(false),blockExpansion:z.literal('not_performed'),analyticEligible:z.literal(false),
  operationalRecords:z.literal(false),trainingLabels:z.literal(false),rights:z.literal('not_assessed')});
export const DXFArtifactSchema=z.strictObject({key:z.string().min(1).max(512),sha256:hash,
  bytes:positive.max(DXF_LIMITS.artifactBytes),mediaType:z.literal('application/json'),profile:z.literal('dxf-native-inspection/1')});
export const DXFResultSchema=z.strictObject({version:z.literal(DXF_VERSION),input:DXFInputSchema,
  summary:DXFSummarySchema,artifact:DXFArtifactSchema,createdAt:z.iso.datetime()}).superRefine((v,ctx)=>{
  if(!v.input.tools||v.summary.sourceSha256!==v.input.sourceSha256||v.summary.sourceBytes!==v.input.sourceBytes)
    ctx.addIssue({code:'custom',message:'An accepted native result requires exact original and configured tool pins.'});
});
export const DXFStatusSchema=z.strictObject({version:z.literal(DXF_VERSION),caseId:id,sourceId:id,jobId:id,
  currentCaseRevision:rev,sourceRevision:positive,sourceSha256:hash,
  status:z.enum(['queued','running','completed','failed','stale']),code:z.string().max(100).nullable(),
  result:z.strictObject({summary:DXFSummarySchema,artifact:DXFArtifactSchema,createdAt:z.iso.datetime()}).nullable()});
export const DXFRetainReceiptSchema=z.strictObject({version:z.literal(DXF_VERSION),caseId:id,
  caseRevision:rev,sourceId:id,sourceRevision:positive,sourceSha256:hash,bytes:positive.max(DXF_LIMITS.originalBytes),jobId:id});
export const DXFQueueReceiptSchema=z.strictObject({version:z.literal(DXF_VERSION),caseId:id,sourceId:id,jobId:id});
export type DXFInput=z.infer<typeof DXFInputSchema>;
export type DXFResult=z.infer<typeof DXFResultSchema>;
export type DXFToolPins=z.infer<typeof DXFToolPinsSchema>;
