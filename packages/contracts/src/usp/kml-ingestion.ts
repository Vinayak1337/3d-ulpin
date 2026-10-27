import {z} from 'zod';

export const KML_VERSION='kml-native/1' as const;
export const KML_LIMITS=Object.freeze({originalBytes:16*1024*1024,artifactBytes:16*1024*1024,
  resultBytes:512*1024,statusBytes:512*1024,retainedSources:64,retainedBytes:256*1024*1024,jobsPerSource:16,
  active:1,workerMs:150_000,requestMs:45_000,readMs:60_000});
const id=z.uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/),rev=z.number().int().nonnegative(),positive=z.number().int().positive();
export const KMLLineageSchema=z.strictObject({issuer:z.string().min(1).max(300).nullable(),
  originalUrl:z.url().max(2048).nullable(),acquiredAt:z.iso.datetime().nullable(),
  permissionReference:z.string().max(2048).nullable(),geography:z.string().max(500).nullable(),
  limitations:z.array(z.string().max(1000)).max(20)});
// Exact archive spelling is retained; only archive-local regular KML paths are selectable.
export const KMLMemberPinSchema=z.strictObject({path:z.string().min(1).max(1024).regex(/^[^\\:\u0000-\u001f\u007f]+$/)
  .refine(v=>v.split('/').every(p=>p!==''&&p!=='.'&&p!=='..')&&v.toLowerCase().endsWith('.kml')),
  ordinal:rev.max(255),sha256:hash,bytes:rev.max(64*1024*1024)});
export const KMLRetainSchema=z.strictObject({requestKey:id,expectedCaseRevision:rev,lineage:KMLLineageSchema});
export const KMLRequestSchema=z.strictObject({requestKey:id,expectedCaseRevision:rev,
  expectedSourceRevision:positive,sourceSha256:hash,member:KMLMemberPinSchema.nullable()});
export const KMLOriginalSchema=z.strictObject({version:z.literal(KML_VERSION),subject:z.string().min(1).max(256),
  accessSha256:hash,sha256:hash,bytes:positive.max(KML_LIMITS.originalBytes),receivedAt:z.iso.datetime(),
  lineageState:z.literal('caller_declared'),lineage:KMLLineageSchema});
export const KMLToolPinsSchema=z.strictObject({platform:z.literal('windows-x86_64'),pythonSha256:hash,
  profileSha256:hash,readerSha256:hash,supervisorSha256:hash,dependencyLockSha256:hash,codeSha256:hash});
export const KMLInputSchema=z.strictObject({version:z.literal(KML_VERSION),jobId:id,caseId:id,
  caseRevision:rev,caseContextSha256:hash,sourceId:id,sourceFamilyId:id,sourceRevision:positive,
  sourceSha256:hash,sourceBytes:positive.max(KML_LIMITS.originalBytes),objectKey:z.string().min(1).max(512),
  subject:z.string().min(1).max(256),accessSha256:hash,readerSha256:hash,tools:KMLToolPinsSchema.nullable(),
  selection:KMLMemberPinSchema.nullable()});
export const KMLSummarySchema=z.strictObject({schemaVersion:z.literal('kml-native-inspection/1'),sourceSha256:hash,
  sourceBytes:positive.max(KML_LIMITS.originalBytes),container:z.enum(['kml','kmz']),status:z.enum(['inspected','partial','needs_input']),
  xmlSha256:hash.nullable(),member:KMLMemberPinSchema.nullable(),members:z.array(KMLMemberPinSchema).max(256),
  selectionCode:z.enum(['KML_MEMBER_SELECTION_REQUIRED','NO_KML_MEMBER']).nullable(),
  documentProfile:z.enum(['kml_2_2','unnamespaced_feature_fragment']).nullable(),horizontalReference:z.enum(['kml_specification','unknown']),
  featureCount:rev.max(10000),coordinateCount:rev.max(100000),unsupportedCount:rev.max(100000),unresolvedReferenceCount:rev.max(100000),
  accuracy:z.literal('not_assessed'),analyticEligible:z.literal(false),registryAdmission:z.literal(false),learningLabels:z.literal(false),rights:z.literal('not_assessed')});
export const KMLSupervisionSchema=z.strictObject({gatedStart:z.literal(true),memoryBytes:z.literal(2*1024**3),activeProcessLimit:z.literal(1),
  deadlineSeconds:z.literal(45),affinityMask:positive,computePoolThreads:z.literal(1),osThreadCeiling:z.null(),
  peakJobPrivateBytes:rev.max(2*1024**3),exitCode:z.literal(0),elapsedSeconds:z.number().nonnegative().max(60)});
export const KMLArtifactSchema=z.strictObject({key:z.string().min(1).max(512),sha256:hash,
  bytes:positive.max(KML_LIMITS.artifactBytes),mediaType:z.literal('application/json'),profile:z.literal('kml-native-inspection/1')});
export const KMLResultSchema=z.strictObject({version:z.literal(KML_VERSION),input:KMLInputSchema,summary:KMLSummarySchema,
  supervision:KMLSupervisionSchema,artifact:KMLArtifactSchema,createdAt:z.iso.datetime()}).superRefine((v,ctx)=>{
  if(!v.input.tools||v.summary.sourceSha256!==v.input.sourceSha256||v.summary.sourceBytes!==v.input.sourceBytes)
    ctx.addIssue({code:'custom',message:'An accepted inspection requires exact original and configured tool pins.'});
  if(v.input.selection&&JSON.stringify(v.input.selection)!==JSON.stringify(v.summary.member))
    ctx.addIssue({code:'custom',message:'The exact selected KMZ member differs from the result.'});
});
export const KMLStatusSchema=z.strictObject({version:z.literal(KML_VERSION),caseId:id,sourceId:id,jobId:id,
  currentCaseRevision:rev,sourceRevision:positive,sourceSha256:hash,
  status:z.enum(['queued','running','completed','partial','needs_input','failed','stale']),code:z.string().max(100).nullable(),
  result:z.strictObject({summary:KMLSummarySchema,artifact:KMLArtifactSchema,createdAt:z.iso.datetime()}).nullable()});
export const KMLRetainReceiptSchema=z.strictObject({version:z.literal(KML_VERSION),caseId:id,
  caseRevision:rev,sourceId:id,sourceRevision:positive,sourceSha256:hash,bytes:positive.max(KML_LIMITS.originalBytes),jobId:id});
export const KMLQueueReceiptSchema=z.strictObject({version:z.literal(KML_VERSION),caseId:id,sourceId:id,jobId:id});
export type KMLInput=z.infer<typeof KMLInputSchema>;
export type KMLResult=z.infer<typeof KMLResultSchema>;
export type KMLToolPins=z.infer<typeof KMLToolPinsSchema>;
