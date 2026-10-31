import {z} from 'zod';
import {GLTF_LIMITS} from '../reader-limits';

export const GLTF_VERSION='gltf-native/1' as const;
export {GLTF_LIMITS};
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
/** GB1: at most this many external buffer bindings are recorded per glTF reading. */
export const GLTF_COMPANION_LIMIT=64;
const bufferIndex=z.number().int().nonnegative().max(9999),bufferUri=z.string().min(1).max(2048);
/**
 * GB1: one exact binding of a glTF buffer uri to a retained original of the same case (or a member at the same
 * relative path of the ZIP the glTF came from), decided by the percent-decoded file name, case-sensitive. A uri with
 * no candidate is not recorded and stays needs_input; several candidates refuse as ambiguous.
 */
export const GltfBufferBindingSchema=z.discriminatedUnion('state',[
  z.strictObject({bufferIndex,uri:bufferUri,state:z.literal('bound'),name:z.string().min(1).max(1024),sourceId:id,
    memberPath:z.string().min(1).max(1024).nullable(),sha256:hash,bytes:positive.max(GLTF_LIMITS.originalBytes),
    objectKey:z.string().min(1).max(512)}),
  z.strictObject({bufferIndex,uri:bufferUri,state:z.literal('ambiguous'),name:z.string().min(1).max(1024),
    candidates:z.number().int().min(2).max(10000)}),
  z.strictObject({bufferIndex,uri:bufferUri,state:z.literal('refused'),
    reason:z.enum(['EXTERNAL_URI_NOT_PLAIN_NAME','BYTE_BUDGET','COMPANION_ACCESS'])}),
]);
export const GltfInputSchema=z.strictObject({version:z.literal(GLTF_VERSION),jobId:id,caseId:id,
  caseRevision:rev,caseContextSha256:hash,sourceId:id,sourceFamilyId:id,sourceRevision:positive,
  sourceSha256:hash,sourceBytes:positive.max(GLTF_LIMITS.originalBytes),objectKey:z.string().min(1).max(512),
  subject:z.string().min(1).max(256),accessSha256:hash,readerSha256:hash,tools:GltfToolPinsSchema.nullable(),sceneIndex:scene.nullable(),
  buffers:z.array(GltfBufferBindingSchema).min(1).max(GLTF_COMPANION_LIMIT).optional()});
/** GB1: a companion file a reading names: joined from a retained original, still missing, or refused with a reason. */
export const GltfCompanionSchema=z.strictObject({kind:z.enum(['buffer','image']),index:bufferIndex,name:bufferUri,
  state:z.enum(['joined','missing','refused']),reason:z.string().regex(/^[A-Z_]{1,64}$/).nullable(),
  sourceId:id.nullable(),sha256:hash.nullable(),bytes:positive.max(GLTF_LIMITS.originalBytes).nullable()});
export const GltfSummarySchema=z.strictObject({schemaVersion:z.literal('gltf-local-inspection/1'),sourceSha256:hash,
  sourceBytes:positive.max(GLTF_LIMITS.originalBytes),status:z.enum(['inspected_local','inspected_partial']),
  geometryProjectionStatus:z.enum(['available','partial','unavailable']),representation:z.literal('context_mesh'),
  selectedSceneIndex:scene.nullable(),selectedSceneOrigin:z.enum(['source','caller','absent']),
  nodeCount:rev.max(10000),primitiveCount:rev.max(10000),projectedPositions:rev.max(100000),projectedIndices:rev.max(300000),
  missingCompanionCount:rev.max(20000),unsupportedPrimitiveCount:rev.max(10000),
  companions:z.array(GltfCompanionSchema).max(GLTF_COMPANION_LIMIT).optional(),
  joinedCompanionCount:rev.max(10000).optional(),refusedCompanionCount:rev.max(10000).optional(),
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
export type GltfBufferBinding=z.infer<typeof GltfBufferBindingSchema>;
export type GltfCompanion=z.infer<typeof GltfCompanionSchema>;
