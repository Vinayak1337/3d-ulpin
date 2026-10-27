import {z} from 'zod';

export const OBJ_VERSION='obj-native/1' as const;
export const OBJ_LIMITS=Object.freeze({originalBytes:16*1024*1024,artifactBytes:16*1024*1024,
  resultBytes:512*1024,statusBytes:512*1024,retainedSources:64,retainedBytes:256*1024*1024,jobsPerSource:16,
  active:1,workerMs:150_000,requestMs:45_000,readMs:60_000});
const id=z.uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/),rev=z.number().int().nonnegative(),positive=z.number().int().positive();
export const ObjLineageSchema=z.strictObject({issuer:z.string().min(1).max(300).nullable(),
  originalUrl:z.url().max(2048).nullable(),acquiredAt:z.iso.datetime().nullable(),
  permissionReference:z.string().max(2048).nullable(),geography:z.string().max(500).nullable(),
  limitations:z.array(z.string().max(1000)).max(20)});
export const ObjRetainSchema=z.strictObject({requestKey:id,expectedCaseRevision:rev,lineage:ObjLineageSchema});
export const ObjRequestSchema=z.strictObject({requestKey:id,expectedCaseRevision:rev,
  expectedSourceRevision:positive,sourceSha256:hash});
export const ObjOriginalSchema=z.strictObject({version:z.literal(OBJ_VERSION),subject:z.string().min(1).max(256),
  accessSha256:hash,sha256:hash,bytes:positive.max(OBJ_LIMITS.originalBytes),receivedAt:z.iso.datetime(),
  lineageState:z.literal('caller_declared'),lineage:ObjLineageSchema});
export const ObjToolPinsSchema=z.strictObject({platform:z.literal('windows-x86_64'),pythonSha256:hash,
  profileSha256:hash,readerSha256:hash,supervisorSha256:hash,dependencyLockSha256:hash,nativeRuntimeLockSha256:hash,codeSha256:hash});
export const ObjInputSchema=z.strictObject({version:z.literal(OBJ_VERSION),jobId:id,caseId:id,
  caseRevision:rev,caseContextSha256:hash,sourceId:id,sourceFamilyId:id,sourceRevision:positive,
  sourceSha256:hash,sourceBytes:positive.max(OBJ_LIMITS.originalBytes),objectKey:z.string().min(1).max(512),
  subject:z.string().min(1).max(256),accessSha256:hash,readerSha256:hash,tools:ObjToolPinsSchema.nullable()});
export const ObjSummarySchema=z.strictObject({schemaVersion:z.literal('obj-source-context/1'),sourceSha256:hash,
  sourceBytes:positive.max(OBJ_LIMITS.originalBytes),status:z.enum(['inspected_local','inspected_partial']),
  geometryProjectionStatus:z.enum(['available','partial','unavailable']),representation:z.literal('context_mesh'),
  vertexCount:rev.max(100000),textureCount:rev.max(100000),normalCount:rev.max(100000),
  polygonCount:rev.max(100000),faceReferenceCount:rev.max(500000),eligiblePolygonCount:rev.max(100000),
  declarationCount:rev.max(250000),unsupportedStatementCount:rev.max(250000),missingCompanionDeclarationCount:rev.max(250000),
  axes:z.literal('unknown'),units:z.literal('unknown'),crs:z.literal('unknown'),heightReference:z.literal('unknown'),
  globalPlacement:z.literal('unknown'),accuracy:z.literal('not_assessed'),validity:z.literal('not_assessed'),
  canonicalIdentity:z.literal('not_assessed'),analyticEligible:z.literal(false),registryAdmission:z.literal(false),
  measurements:z.literal(false),learningLabels:z.literal(false),rights:z.literal('not_assessed')});
/** The accepted CLI's observations; no OS thread/egress ceiling is implied. */
export const ObjSupervisionSchema=z.strictObject({flags:z.literal(8968),activeProcessLimit:z.literal(1),
  processMemoryLimitBytes:z.literal(512*1024**2),jobMemoryLimitBytes:z.literal(512*1024**2),
  peakJobPrivateBytes:rev.max(512*1024**2),deadlineSeconds:z.number().positive().max(45),observedSeconds:z.number().nonnegative().max(45),
  computePoolThreads:z.literal(1),osThreadCeiling:z.null(),importAfterJobAttachment:z.literal(true),
  workerPid:positive,stdoutBytes:rev.max(65536),stderrBytes:z.literal(0)});
export const ObjArtifactSchema=z.strictObject({key:z.string().min(1).max(512),sha256:hash,
  bytes:positive.max(OBJ_LIMITS.artifactBytes),mediaType:z.literal('application/json'),profile:z.literal('obj-source-context/1')});
/** Separate Python host/tree bound; Node/API memory is not covered by this Job. */
export const ObjHostSupervisionSchema=z.strictObject({flags:z.literal(8968),activeProcessLimit:z.literal(2),
  processMemoryLimitBytes:z.literal(1024**3),jobMemoryLimitBytes:z.literal(1024**3),peakJobPrivateBytes:rev.max(1024**3),
  deadlineSeconds:z.literal(75),observedSeconds:z.number().nonnegative().max(75),attachment:z.literal('before_profile_and_cli_import')});
export const ObjResultSchema=z.strictObject({version:z.literal(OBJ_VERSION),input:ObjInputSchema,summary:ObjSummarySchema,
  supervision:ObjSupervisionSchema,hostSupervision:ObjHostSupervisionSchema,artifact:ObjArtifactSchema,createdAt:z.iso.datetime()}).superRefine((v,ctx)=>{
  if(!v.input.tools||v.input.readerSha256!==v.input.tools.readerSha256||v.summary.sourceSha256!==v.input.sourceSha256||v.summary.sourceBytes!==v.input.sourceBytes
    )ctx.addIssue({code:'custom',message:'Accepted OBJ inspection requires exact original and reader/tool pins.'});
});
export const ObjStatusSchema=z.strictObject({version:z.literal(OBJ_VERSION),caseId:id,sourceId:id,jobId:id,
  currentCaseRevision:rev,sourceRevision:positive,sourceSha256:hash,status:z.enum(['queued','running','completed','partial','failed','stale']),
  code:z.string().max(100).nullable(),result:z.strictObject({summary:ObjSummarySchema,artifact:ObjArtifactSchema,createdAt:z.iso.datetime()}).nullable()});
export const ObjRetainReceiptSchema=z.strictObject({version:z.literal(OBJ_VERSION),caseId:id,
  caseRevision:rev,sourceId:id,sourceRevision:positive,sourceSha256:hash,bytes:positive.max(OBJ_LIMITS.originalBytes),jobId:id});
export const ObjQueueReceiptSchema=z.strictObject({version:z.literal(OBJ_VERSION),caseId:id,sourceId:id,jobId:id});
export type ObjInput=z.infer<typeof ObjInputSchema>;
export type ObjResult=z.infer<typeof ObjResultSchema>;
export type ObjToolPins=z.infer<typeof ObjToolPinsSchema>;
