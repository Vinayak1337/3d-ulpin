import {z} from 'zod';

export const GEOPARQUET_VERSION='geoparquet-native/1' as const;
export const GEOPARQUET_LIMITS=Object.freeze({originalBytes:32*1024*1024,artifactBytes:16*1024*1024,
  resultBytes:512*1024,statusBytes:512*1024,retainedSources:64,retainedBytes:256*1024*1024,jobsPerSource:16,
  active:1,workerMs:150_000,requestMs:45_000,readMs:60_000});
const id=z.uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/),rev=z.number().int().nonnegative(),positive=z.number().int().positive();
export const GeoParquetLineageSchema=z.strictObject({issuer:z.string().min(1).max(300).nullable(),
  originalUrl:z.url().max(2048).nullable(),acquiredAt:z.iso.datetime().nullable(),
  permissionReference:z.string().max(2048).nullable(),geography:z.string().max(500).nullable(),
  limitations:z.array(z.string().max(1000)).max(20)});
export const GeoParquetOriginalSchema=z.strictObject({version:z.literal(GEOPARQUET_VERSION),subject:z.string().min(1).max(256),
  accessSha256:hash,sha256:hash,bytes:positive.max(GEOPARQUET_LIMITS.originalBytes),receivedAt:z.iso.datetime(),
  lineageState:z.literal('caller_declared'),lineage:GeoParquetLineageSchema});
export const GeoParquetToolPinsSchema=z.strictObject({platform:z.literal('windows-x86_64'),pythonSha256:hash,
  profileSha256:hash,readerSha256:hash,supervisorSha256:hash,dependencyLockSha256:hash,codeSha256:hash});
export const GeoParquetSelectionSchema=z.strictObject({startRowIndex:rev.max(Number.MAX_SAFE_INTEGER-1000),rowCount:positive.max(1000)});
export const GeoParquetContinuationSchema=z.strictObject({jobId:id,resultSha256:hash,artifactSha256:hash,nextRowIndex:rev.max(Number.MAX_SAFE_INTEGER-1000)});
export const GeoParquetContinuationPinSchema=GeoParquetContinuationSchema.extend({inputSha256:hash,acceptedFence:positive});
export const GeoParquetRetainSchema=z.strictObject({requestKey:id,expectedCaseRevision:rev,lineage:GeoParquetLineageSchema,selection:GeoParquetSelectionSchema});
export const GeoParquetRequestSchema=z.strictObject({requestKey:id,expectedCaseRevision:rev,expectedSourceRevision:positive,sourceSha256:hash,
  selection:GeoParquetSelectionSchema,continuation:GeoParquetContinuationSchema.nullable()});
export const GeoParquetInputSchema=z.strictObject({version:z.literal(GEOPARQUET_VERSION),jobId:id,caseId:id,
  caseRevision:rev,caseContextSha256:hash,sourceId:id,sourceFamilyId:id,sourceRevision:positive,
  sourceSha256:hash,sourceBytes:positive.max(GEOPARQUET_LIMITS.originalBytes),objectKey:z.string().min(1).max(512),
  subject:z.string().min(1).max(256),accessSha256:hash,readerSha256:hash,tools:GeoParquetToolPinsSchema.nullable(),selection:GeoParquetSelectionSchema,continuation:GeoParquetContinuationPinSchema.nullable()});
export const GeoParquetWindowSchema=z.strictObject({totalRows:rev.max(Number.MAX_SAFE_INTEGER),requestedStartRowIndex:rev.max(Number.MAX_SAFE_INTEGER-1000),
  requestedRows:positive.max(1000),returnedRows:rev.max(1000),coordinateValues:rev.max(100000),status:z.enum(['available','unsupported']),
  nextRowIndex:rev.max(Number.MAX_SAFE_INTEGER-1000).nullable(),truncated:z.boolean(),prefixRowsOmitted:rev.max(Number.MAX_SAFE_INTEGER),
  scannedBatchRows:rev.max(100000).optional(),prefixRowsScannedInSelectedGroups:rev.max(100000).optional(),
  stopReason:z.enum(['row_window','coordinate_budget','end_of_file']).optional()});
export const GeoParquetSummarySchema=z.strictObject({format:z.literal('usp-native-geoparquet/1'),sourceSha256:hash,
  sourceBytes:positive.max(GEOPARQUET_LIMITS.originalBytes),scope:z.literal('source_native_literal_inventory'),
  profileStatus:z.enum(['supported','unsupported']),profileReasons:z.array(z.string().max(100)).max(128),
  geoMetadataState:z.enum(['absent','null','declared','conflicting','unsupported']),status:z.enum(['available','partial','unsupported']),
  window:GeoParquetWindowSchema,columnCount:rev.max(128),rowGroupCount:rev.max(128),unsupportedGeometryCells:rev.max(128000),
  accuracy:z.literal('not_assessed'),validity:z.literal('not_assessed'),canonicalIdentity:z.literal('not_assessed'),
  analyticEligible:z.literal(false),registryAdmission:z.literal(false),learningLabels:z.literal(false),rights:z.literal('not_assessed')});
/** Actual accepted CLI observations, kept separate from source-native projection. */
export const GeoParquetSupervisionSchema=z.strictObject({platform:z.literal('win32'),exitCode:z.literal(0),
  seconds:z.number().nonnegative().max(65),peakSampledRssBytes:rev.max(2*1024**3),peakSampledThreads:rev.max(6),
  peakJobPrivateBytes:rev.max(2*1024**3),memoryEnforcement:z.literal('Windows Job private-byte ceiling'),
  processLimit:z.literal(1),processingCpuLimit:z.literal(2),observedCpuAffinity:z.array(rev).length(2),
  computePoolThreads:z.literal(1),baselineOsThreads:rev.max(6),osHelperAllowance:z.literal(4),
  totalOsThreadCeiling:z.literal(6),literalTwoOsThreadsEnforced:z.literal(false),gatedStart:z.literal(true),
  osEgressDenied:z.literal(false),arrowInput:z.literal('BufferReader of pinned bytes; no filesystem dispatch')});
export const GeoParquetArtifactSchema=z.strictObject({key:z.string().min(1).max(512),sha256:hash,
  bytes:positive.max(GEOPARQUET_LIMITS.artifactBytes),mediaType:z.literal('application/json'),profile:z.literal('usp-native-geoparquet/1')});
export const GeoParquetResultSchema=z.strictObject({version:z.literal(GEOPARQUET_VERSION),input:GeoParquetInputSchema,summary:GeoParquetSummarySchema,
  supervision:GeoParquetSupervisionSchema,artifact:GeoParquetArtifactSchema,createdAt:z.iso.datetime()}).superRefine((v,ctx)=>{
  if(v.summary.window.requestedStartRowIndex!==v.input.selection.startRowIndex||v.summary.window.requestedRows!==v.input.selection.rowCount)
    ctx.addIssue({code:'custom',message:'The accepted row selection differs from the enrolled request.'});
  if(!v.input.tools||v.input.readerSha256!==v.input.tools.readerSha256||v.summary.sourceSha256!==v.input.sourceSha256||v.summary.sourceBytes!==v.input.sourceBytes)
    ctx.addIssue({code:'custom',message:'An accepted inspection requires exact original and configured reader/tool pins.'});
});
export const GeoParquetStatusSchema=z.strictObject({version:z.literal(GEOPARQUET_VERSION),caseId:id,sourceId:id,jobId:id,
  currentCaseRevision:rev,sourceRevision:positive,sourceSha256:hash,
  status:z.enum(['queued','running','completed','partial','unsupported','failed','stale']),code:z.string().max(100).nullable(),
  result:z.strictObject({summary:GeoParquetSummarySchema,artifact:GeoParquetArtifactSchema,createdAt:z.iso.datetime()}).nullable(),continuation:GeoParquetContinuationSchema.nullable()});
export const GeoParquetRetainReceiptSchema=z.strictObject({version:z.literal(GEOPARQUET_VERSION),caseId:id,
  caseRevision:rev,sourceId:id,sourceRevision:positive,sourceSha256:hash,bytes:positive.max(GEOPARQUET_LIMITS.originalBytes),jobId:id});
export const GeoParquetQueueReceiptSchema=z.strictObject({version:z.literal(GEOPARQUET_VERSION),caseId:id,sourceId:id,jobId:id});
export type GeoParquetInput=z.infer<typeof GeoParquetInputSchema>;
export type GeoParquetResult=z.infer<typeof GeoParquetResultSchema>;
export type GeoParquetToolPins=z.infer<typeof GeoParquetToolPinsSchema>;
