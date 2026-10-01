import {z} from 'zod';

export const IFC_VERSION='ifc-native/1' as const;
export const IFC_LIMITS=Object.freeze({originalBytes:32*1024*1024,artifactBytes:16*1024*1024,
  resultBytes:16*1024,statusBytes:16*1024,retainedSources:64,retainedBytes:256*1024*1024,jobsPerSource:16,
  active:2,workerMs:150_000,requestMs:45_000,readMs:60_000});
const id=z.uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/),rev=z.number().int().nonnegative(),positive=z.number().int().positive();
export const IFCLineageSchema=z.strictObject({issuer:z.string().min(1).max(300).nullable(),
  originalUrl:z.url().max(2048).nullable(),acquiredAt:z.iso.datetime().nullable(),
  permissionReference:z.string().max(2048).nullable(),geography:z.string().max(500).nullable(),
  limitations:z.array(z.string().max(1000)).max(20)});
export const IFCRetainSchema=z.strictObject({requestKey:id,expectedCaseRevision:rev,lineage:IFCLineageSchema});
export const IFCRequestSchema=z.strictObject({requestKey:id,expectedCaseRevision:rev,
  expectedSourceRevision:positive,sourceSha256:hash});
export const IFCOriginalSchema=z.strictObject({version:z.literal(IFC_VERSION),subject:z.string().min(1).max(256),
  accessSha256:hash,sha256:hash,bytes:positive.max(IFC_LIMITS.originalBytes),receivedAt:z.iso.datetime(),
  lineageState:z.literal('caller_declared'),lineage:IFCLineageSchema});
export const IFCToolPinsSchema=z.strictObject({platform:z.literal('windows-x86_64'),pythonSha256:hash,
  profileSha256:hash,readerSha256:hash,supervisorSha256:hash,dependencyLockSha256:hash,codeSha256:hash});
export const IFCInputSchema=z.strictObject({version:z.literal(IFC_VERSION),jobId:id,caseId:id,
  caseRevision:rev,caseContextSha256:hash,sourceId:id,sourceFamilyId:id,sourceRevision:positive,
  sourceSha256:hash,sourceBytes:positive.max(IFC_LIMITS.originalBytes),objectKey:z.string().min(1).max(512),
  subject:z.string().min(1).max(256),accessSha256:hash,readerSha256:hash,tools:IFCToolPinsSchema.nullable(),
  selection:z.literal('complete_bounded_source')});
export const IFCSummarySchema=z.strictObject({schemaVersion:z.literal('ulpin-native-ifc/1'),sourceSha256:hash,
  sourceBytes:positive.max(IFC_LIMITS.originalBytes),schema:z.enum(['IFC2X3','IFC4']),entityCount:rev.max(100000),
  recordCount:rev.max(10000),buildingCount:rev.max(10000),storeyCount:rev.max(10000),spaceCount:rev.max(10000),
  georeferenceState:z.enum(['supplied_unqualified','missing_or_unqualified']),inspectionFrame:z.literal('source_local'),
  metadataOnly:z.literal(true),geometry:z.literal('unsupported'),globalPlacement:z.literal('not_qualified'),
  unitConversionApplied:z.literal(false),storeysAreLegalUnits:z.literal(false),rights:z.literal('not_assessed')});
export const IFCArtifactSchema=z.strictObject({key:z.string().min(1).max(512),sha256:hash,
  bytes:positive.max(IFC_LIMITS.artifactBytes),mediaType:z.literal('application/json'),profile:z.literal('ulpin-native-ifc/1')});
export const IFCResultSchema=z.strictObject({version:z.literal(IFC_VERSION),input:IFCInputSchema,
  summary:IFCSummarySchema,artifact:IFCArtifactSchema,createdAt:z.iso.datetime()}).superRefine((v,ctx)=>{
  if(!v.input.tools||v.summary.sourceSha256!==v.input.sourceSha256||v.summary.sourceBytes!==v.input.sourceBytes)
    ctx.addIssue({code:'custom',message:'An accepted native result requires exact original and configured tool pins.'});
});
export const IFCStatusSchema=z.strictObject({version:z.literal(IFC_VERSION),caseId:id,sourceId:id,jobId:id,
  currentCaseRevision:rev,sourceRevision:positive,sourceSha256:hash,
  status:z.enum(['queued','running','completed','failed','stale']),code:z.string().max(100).nullable(),
  result:z.strictObject({summary:IFCSummarySchema,artifact:IFCArtifactSchema,createdAt:z.iso.datetime()}).nullable()});
export const IFCRetainReceiptSchema=z.strictObject({version:z.literal(IFC_VERSION),caseId:id,
  caseRevision:rev,sourceId:id,sourceRevision:positive,sourceSha256:hash,bytes:positive.max(IFC_LIMITS.originalBytes),jobId:id});
export const IFCQueueReceiptSchema=z.strictObject({version:z.literal(IFC_VERSION),caseId:id,sourceId:id,jobId:id});
export type IFCInput=z.infer<typeof IFCInputSchema>;
export type IFCResult=z.infer<typeof IFCResultSchema>;
export type IFCToolPins=z.infer<typeof IFCToolPinsSchema>;
