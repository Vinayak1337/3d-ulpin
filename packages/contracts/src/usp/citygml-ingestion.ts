import {z} from 'zod';

export const CITYGML_VERSION='citygml-native/1' as const;
export const CITYGML_LIMITS=Object.freeze({originalBytes:32*1024*1024,artifactBytes:16*1024*1024,
  resultBytes:512*1024,statusBytes:512*1024,retainedSources:64,retainedBytes:256*1024*1024,jobsPerSource:16,
  active:1,workerMs:150_000,requestMs:45_000,readMs:60_000});
const id=z.uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/),rev=z.number().int().nonnegative(),positive=z.number().int().positive();
export const CityGMLLineageSchema=z.strictObject({issuer:z.string().min(1).max(300).nullable(),
  originalUrl:z.url().max(2048).nullable(),acquiredAt:z.iso.datetime().nullable(),
  permissionReference:z.string().max(2048).nullable(),geography:z.string().max(500).nullable(),
  limitations:z.array(z.string().max(1000)).max(20)});
export const CityGMLRetainSchema=z.strictObject({requestKey:id,expectedCaseRevision:rev,lineage:CityGMLLineageSchema});
export const CityGMLRequestSchema=z.strictObject({requestKey:id,expectedCaseRevision:rev,
  expectedSourceRevision:positive,sourceSha256:hash});
export const CityGMLOriginalSchema=z.strictObject({version:z.literal(CITYGML_VERSION),subject:z.string().min(1).max(256),
  accessSha256:hash,sha256:hash,bytes:positive.max(CITYGML_LIMITS.originalBytes),receivedAt:z.iso.datetime(),
  lineageState:z.literal('caller_declared'),lineage:CityGMLLineageSchema});
export const CityGMLToolPinsSchema=z.strictObject({platform:z.literal('windows-x86_64'),pythonSha256:hash,
  profileSha256:hash,readerSha256:hash,supervisorSha256:hash,dependencyLockSha256:hash,codeSha256:hash});
export const CityGMLInputSchema=z.strictObject({version:z.literal(CITYGML_VERSION),jobId:id,caseId:id,
  caseRevision:rev,caseContextSha256:hash,sourceId:id,sourceFamilyId:id,sourceRevision:positive,
  sourceSha256:hash,sourceBytes:positive.max(CITYGML_LIMITS.originalBytes),objectKey:z.string().min(1).max(512),
  subject:z.string().min(1).max(256),accessSha256:hash,readerSha256:hash,tools:CityGMLToolPinsSchema.nullable()});
export const CityGMLSummarySchema=z.strictObject({schemaVersion:z.literal('ulpin-native-citygml/1'),sourceSha256:hash,
  sourceBytes:positive.max(CITYGML_LIMITS.originalBytes),citygmlVersion:z.literal('2.0'),encodingProfile:z.literal('XML 1.0 UTF-8'),
  scope:z.literal('source_native_literal_inventory'),status:z.enum(['available','partial']),
  elementCount:positive.max(25000),buildingAndPartCount:rev.max(25000),coordinateDeclarationCount:rev.max(25000),
  decodedCoordinateValueCount:rev.max(100000),referenceCount:rev.max(25000),unsupportedElementCount:rev.max(25000),
  unresolvedReferenceCount:rev.max(25000),findingCodes:z.array(z.enum(['UNSUPPORTED_CONTENT','REFERENCES_NOT_COMPOSED',
    'DIMENSION_ABSENT','COORDINATE_DECLARATION_INCOMPLETE'])).max(4),
  accuracy:z.literal('not_assessed'),validity:z.literal('not_assessed'),canonicalIdentity:z.literal('not_assessed'),
  analyticEligible:z.literal(false),registryAdmission:z.literal(false),learningLabels:z.literal(false),rights:z.literal('not_assessed')});
/** Actual accepted CLI observations, kept separate from source-native projection. */
export const CityGMLSupervisionSchema=z.strictObject({platform:z.literal('win32'),exitCode:z.literal(0),
  seconds:z.number().nonnegative().max(65),peakSampledRssBytes:rev.max(2*1024**3),peakSampledThreads:rev.max(6),
  peakJobPrivateBytes:rev.max(2*1024**3),memoryEnforcement:z.literal('Windows Job private-byte ceiling'),
  processLimit:z.literal(1),processingCpuLimit:z.literal(2),appliedCpuAffinity:z.array(rev).length(2),
  computePoolThreads:z.literal(1),baselineOsThreads:rev.max(6),osHelperAllowance:z.literal(4),
  totalOsThreadCeiling:z.literal(6),literalTwoOsThreadsEnforced:z.literal(false),gatedStart:z.literal(true),
  osEgressEnforced:z.literal(false),xmlExternalResourcesDenied:z.literal(true)});
export const CityGMLArtifactSchema=z.strictObject({key:z.string().min(1).max(512),sha256:hash,
  bytes:positive.max(CITYGML_LIMITS.artifactBytes),mediaType:z.literal('application/json'),profile:z.literal('ulpin-native-citygml/1')});
export const CityGMLResultSchema=z.strictObject({version:z.literal(CITYGML_VERSION),input:CityGMLInputSchema,summary:CityGMLSummarySchema,
  supervision:CityGMLSupervisionSchema,artifact:CityGMLArtifactSchema,createdAt:z.iso.datetime()}).superRefine((v,ctx)=>{
  if(!v.input.tools||v.input.readerSha256!==v.input.tools.readerSha256||v.summary.sourceSha256!==v.input.sourceSha256||v.summary.sourceBytes!==v.input.sourceBytes)
    ctx.addIssue({code:'custom',message:'An accepted inspection requires exact original and configured reader/tool pins.'});
});
export const CityGMLStatusSchema=z.strictObject({version:z.literal(CITYGML_VERSION),caseId:id,sourceId:id,jobId:id,
  currentCaseRevision:rev,sourceRevision:positive,sourceSha256:hash,
  status:z.enum(['queued','running','completed','partial','failed','stale']),code:z.string().max(100).nullable(),
  result:z.strictObject({summary:CityGMLSummarySchema,artifact:CityGMLArtifactSchema,createdAt:z.iso.datetime()}).nullable()});
export const CityGMLRetainReceiptSchema=z.strictObject({version:z.literal(CITYGML_VERSION),caseId:id,
  caseRevision:rev,sourceId:id,sourceRevision:positive,sourceSha256:hash,bytes:positive.max(CITYGML_LIMITS.originalBytes),jobId:id});
export const CityGMLQueueReceiptSchema=z.strictObject({version:z.literal(CITYGML_VERSION),caseId:id,sourceId:id,jobId:id});
export type CityGMLInput=z.infer<typeof CityGMLInputSchema>;
export type CityGMLResult=z.infer<typeof CityGMLResultSchema>;
export type CityGMLToolPins=z.infer<typeof CityGMLToolPinsSchema>;
