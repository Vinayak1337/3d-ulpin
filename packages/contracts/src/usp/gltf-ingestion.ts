import {z} from 'zod';

export const GLTF_VERSION='gltf-native/1' as const;
export const GLTF_LIMITS=Object.freeze({originalBytes:16*1024*1024,artifactBytes:16*1024*1024,
  resultBytes:512*1024,statusBytes:512*1024,retainedSources:64,retainedBytes:256*1024*1024,jobsPerSource:16,
  active:1,workerMs:150_000,requestMs:45_000,readMs:60_000});
const id=z.uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/),rev=z.number().int().nonnegative(),positive=z.number().int().positive();
const scene=z.number().int().min(0).max(9999);
export const GltfLineageSchema=z.strictObject({issuer:z.string().min(1).max(300).nullable(),
  originalUrl:z.url().max(2048).nullable(),acquiredAt:z.iso.datetime().nullable(),
  permissionReference:z.string().max(2048).nullable(),geography:z.string().max(500).nullable(),
  limitations:z.array(z.string().max(1000)).max(20)});
export const GltfRetainSchema=z.strictObject({requestKey:id,expectedCaseRevision:rev,lineage:GltfLineageSchema,sceneIndex:scene.optional()});
export const GltfRequestSchema=z.strictObject({requestKey:id,expectedCaseRevision:rev,
  expectedSourceRevision:positive,sourceSha256:hash,sceneIndex:scene.optional()});
export const GltfOriginalSchema=z.strictObject({version:z.literal(GLTF_VERSION),subject:z.string().min(1).max(256),
  accessSha256:hash,sha256:hash,bytes:positive.max(GLTF_LIMITS.originalBytes),receivedAt:z.iso.datetime(),
  lineageState:z.literal('caller_declared'),lineage:GltfLineageSchema});
export const GltfToolPinsSchema=z.strictObject({platform:z.literal('windows-x86_64'),pythonSha256:hash,
  profileSha256:hash,readerSha256:hash,supervisorSha256:hash,dependencyLockSha256:hash,codeSha256:hash});
export const GltfInputSchema=z.strictObject({version:z.literal(GLTF_VERSION),jobId:id,caseId:id,
  caseRevision:rev,caseContextSha256:hash,sourceId:id,sourceFamilyId:id,sourceRevision:positive,
  sourceSha256:hash,sourceBytes:positive.max(GLTF_LIMITS.originalBytes),objectKey:z.string().min(1).max(512),
  subject:z.string().min(1).max(256),accessSha256:hash,readerSha256:hash,tools:GltfToolPinsSchema.nullable(),sceneIndex:scene.nullable()});
export const GltfSummarySchema=z.strictObject({schemaVersion:z.literal('gltf-local-inspection/1'),sourceSha256:hash,
  sourceBytes:positive.max(GLTF_LIMITS.originalBytes),status:z.enum(['inspected_local','inspected_partial']),
  geometryProjectionStatus:z.enum(['available','partial','unavailable']),representation:z.literal('context_mesh'),
  selectedSceneIndex:scene.nullable(),selectedSceneOrigin:z.enum(['source','caller','absent']),
  nodeCount:rev.max(10000),primitiveCount:rev.max(10000),projectedPositions:rev.max(100000),projectedIndices:rev.max(300000),
  missingCompanionCount:rev.max(20000),unsupportedPrimitiveCount:rev.max(10000),
  globalPlacement:z.literal('unknown'),accuracy:z.literal('not_assessed'),validity:z.literal('not_assessed'),
  canonicalIdentity:z.literal('not_assessed'),analyticEligible:z.literal(false),registryAdmission:z.literal(false),
  measurements:z.literal(false),learningLabels:z.literal(false),rights:z.literal('not_assessed')});
/** The accepted CLI's observations; no OS thread/egress ceiling is implied. */
export const GltfSupervisionSchema=z.strictObject({flags:z.literal(8968),activeProcessLimit:z.literal(1),
  processMemoryLimitBytes:z.literal(2*1024**3),jobMemoryLimitBytes:z.literal(2*1024**3),
  peakJobPrivateBytes:rev.max(2*1024**3),deadlineSeconds:z.literal(45),observedSeconds:z.number().nonnegative().max(45),
  computePoolThreads:z.literal(1),osThreadCeiling:z.null(),importAfterJobAttachment:z.literal(true),
  workerPid:positive,stdoutBytes:rev.max(65536),stderrBytes:z.literal(0)});
export const GltfArtifactSchema=z.strictObject({key:z.string().min(1).max(512),sha256:hash,
  bytes:positive.max(GLTF_LIMITS.artifactBytes),mediaType:z.literal('application/json'),profile:z.literal('gltf-local-inspection/1')});
export const GltfResultSchema=z.strictObject({version:z.literal(GLTF_VERSION),input:GltfInputSchema,summary:GltfSummarySchema,
  supervision:GltfSupervisionSchema,artifact:GltfArtifactSchema,createdAt:z.iso.datetime()}).superRefine((v,ctx)=>{
  if(!v.input.tools||v.input.readerSha256!==v.input.tools.readerSha256||v.summary.sourceSha256!==v.input.sourceSha256||v.summary.sourceBytes!==v.input.sourceBytes
    ||(v.input.sceneIndex!==null&&(v.summary.selectedSceneOrigin!=='caller'||v.summary.selectedSceneIndex!==v.input.sceneIndex)))
    ctx.addIssue({code:'custom',message:'Accepted glTF inspection requires exact original, scene and reader/tool pins.'});
});
export const GltfStatusSchema=z.strictObject({version:z.literal(GLTF_VERSION),caseId:id,sourceId:id,jobId:id,
  currentCaseRevision:rev,sourceRevision:positive,sourceSha256:hash,status:z.enum(['queued','running','completed','partial','failed','stale']),
  code:z.string().max(100).nullable(),result:z.strictObject({summary:GltfSummarySchema,artifact:GltfArtifactSchema,createdAt:z.iso.datetime()}).nullable()});
export const GltfRetainReceiptSchema=z.strictObject({version:z.literal(GLTF_VERSION),caseId:id,
  caseRevision:rev,sourceId:id,sourceRevision:positive,sourceSha256:hash,bytes:positive.max(GLTF_LIMITS.originalBytes),jobId:id});
export const GltfQueueReceiptSchema=z.strictObject({version:z.literal(GLTF_VERSION),caseId:id,sourceId:id,jobId:id});
export type GltfInput=z.infer<typeof GltfInputSchema>;
export type GltfResult=z.infer<typeof GltfResultSchema>;
export type GltfToolPins=z.infer<typeof GltfToolPinsSchema>;
