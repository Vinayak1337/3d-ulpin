import { z } from 'zod';

export const PROJECTED_VECTOR_PROFILE = Object.freeze({
  version:'nwic-district-vector/1', namespace:'nwic:district-boundary:8d9aa2e9-9806-4f26-a4ac-48ba21e9b96d',
  zipBytes:71238839, zipSha256:'44c734cc72139f2447dcebfe2791cac862dc5ba265e158912d797cf3410d5c37',
  member:'district_nwic.GeoJSON', memberBytes:168356689, memberSha256:'2b27a478e24d8c51b0655e74ce3f4f880e75c752e4597550d6fc925ed06ac201',
  features:733, positions:3125505, nativeInvalid:13,
  featureBytes:1024*1024, geographicBytes:2*1024*1024, indexBytes:1024*1024,
  outputBytes:384*1024*1024, featurePositions:18000, rings:128, ringPositions:17000,
  page:25, active:1, publicationMs:120000,
  // Retain compact history separately from expensive accepted observations. Failed
  // staging is fenced and retired; immutable feature artifacts remain deduplicated.
  jobReceipts:128, requestReceipts:256, parserGenerations:4, acceptedGenerations:8,
  observationGenerationBytes:128*1024*1024, retainedObservationBytes:1024*1024*1024,
});
const id=z.string().uuid(), hash=z.string().regex(/^[a-f0-9]{64}$/), rev=z.number().int().nonnegative();
const box=z.tuple([z.number().finite(),z.number().finite(),z.number().finite(),z.number().finite()]);
export const AdministrativeNativeKeySchema=z.discriminatedUnion('type',[
  z.strictObject({type:z.literal('number'),value:z.number().int().safe()}),
  z.strictObject({type:z.literal('string'),value:z.string().min(1).max(256)}),
]);
export const ProjectedVectorRequestSchema=z.strictObject({requestKey:id,expectedCaseRevision:rev,
  expectedSourceRevision:z.number().int().positive(),sourceSha256:hash});
/** Internal job input: an existing retained source, never a scene/snapshot manifest. */
export const ProjectedVectorInputSchema=z.strictObject({kind:z.literal('retained_source'),version:z.literal(PROJECTED_VECTOR_PROFILE.version),
  jobId:id,caseId:id,caseRevision:rev,sourceId:id,sourceRevision:z.number().int().positive(),sourceFamilyId:id,
  sha256:z.literal(PROJECTED_VECTOR_PROFILE.zipSha256),bytes:z.literal(PROJECTED_VECTOR_PROFILE.zipBytes),
  objectKey:z.string().max(150),parserSha256:hash,accessBinding:hash,inputFingerprint:hash});
export const ProjectedVectorArtifactSchema=z.strictObject({key:z.string().min(1).max(320),sha256:hash,
  bytes:z.number().int().positive().max(PROJECTED_VECTOR_PROFILE.geographicBytes)});
export const ProjectedVectorTransformSchema=z.strictObject({sourceCrs:z.literal('EPSG:7755'),targetCrs:z.literal('EPSG:4326'),
  axisOrder:z.literal('always_xy'),sourceUnit:z.literal('metre'),targetUnit:z.literal('degree'),verticalReference:z.null(),
  pyproj:z.literal('3.6.1'),proj:z.literal('9.3.0'),shapely:z.literal('2.0.7'),projDatabaseSha256:hash,
  definition:z.string().max(1024),network:z.literal(false),ballpark:z.literal(false),grids:z.array(z.never()).max(0),
  accuracyQualification:z.literal('numerical_transform_only_not_survey_accuracy'),parserSha256:hash});
export const ProjectedVectorTotalsSchema=z.strictObject({features:z.literal(733),positions:z.literal(3125505),
  nativeValid:z.literal(720),nativeInvalid:z.literal(13),admitted:z.number().int().min(0).max(720),quarantined:z.number().int().min(13).max(733)});
export const ProjectedVectorEntrySchema=z.strictObject({index:z.number().int().min(0).max(732),
  start:rev,end:rev,key:AdministrativeNativeKeySchema,positions:z.number().int().positive().max(18000),
  disposition:z.enum(['admitted','quarantined']),reason:z.string().max(600).nullable(),
  nativeBounds:box,geographicBounds:box.nullable(),raw:ProjectedVectorArtifactSchema,geographic:ProjectedVectorArtifactSchema.nullable()});
export const ProjectedVectorIndexSchema=z.strictObject({version:z.literal(PROJECTED_VECTOR_PROFILE.version),namespace:z.literal(PROJECTED_VECTOR_PROFILE.namespace),
  jobId:id,sourceId:id,inputFingerprint:hash,zipSha256:z.literal(PROJECTED_VECTOR_PROFILE.zipSha256),memberSha256:z.literal(PROJECTED_VECTOR_PROFILE.memberSha256),
  memberBytes:z.literal(PROJECTED_VECTOR_PROFILE.memberBytes),transform:ProjectedVectorTransformSchema,totals:ProjectedVectorTotalsSchema,
  numericalRoundTrip:z.strictObject({maximumMetres:z.number().finite().nonnegative().max(0.000001),positions:z.literal(3125505)}),
  entries:z.array(ProjectedVectorEntrySchema).length(733)});
export const ProjectedVectorResultSchema=z.strictObject({version:z.literal(PROJECTED_VECTOR_PROFILE.version),jobId:id,sourceId:id,inputFingerprint:hash,
  index:ProjectedVectorArtifactSchema,totals:ProjectedVectorTotalsSchema,parserSha256:hash,
  execution:z.strictObject({seconds:z.number().finite().nonnegative().max(110),peakResidentBytes:z.number().int().positive(),outputBytes:z.number().int().nonnegative().max(PROJECTED_VECTOR_PROFILE.outputBytes)})});
export const ProjectedVectorStatusSchema=z.strictObject({version:z.literal(PROJECTED_VECTOR_PROFILE.version),caseId:id,sourceId:id,
  sourceRevision:z.number().int().positive(),sourceSha256:hash,currentCaseRevision:rev,
  jobId:id,status:z.enum(['queued','running','succeeded','failed','stale']),totals:ProjectedVectorTotalsSchema.nullable(),
  transform:ProjectedVectorTransformSchema.nullable(),errorCode:z.string().max(80).nullable()});
export const AdministrativeObservationSchema=z.strictObject({id,kind:z.literal('district'),namespace:z.literal(PROJECTED_VECTOR_PROFILE.namespace),
  nativeKey:AdministrativeNativeKeySchema,sourceId:id,sourceRevision:z.number().int().positive(),jobId:id,
  featureIndex:rev,locator:z.strictObject({member:z.literal(PROJECTED_VECTOR_PROFILE.member),start:rev,end:rev}),
  name:z.string().max(500),code:z.string().max(256).nullable(),disposition:z.enum(['admitted','quarantined']),reason:z.string().max(600).nullable(),
  nativeBounds:box,geographicBounds:box.nullable(),rawSha256:hash,geographicSha256:hash.nullable(),
  sourceCrs:z.literal('EPSG:7755'),geographicCrs:z.literal('EPSG:4326'),verticalReference:z.null(),
  purpose:z.literal('administrative_context'),accuracyQualification:z.literal('source_boundary_accuracy_and_currentness_unqualified')});
export const AdministrativeObservationPageSchema=z.strictObject({jobId:id,records:z.array(AdministrativeObservationSchema).max(25),next:rev.nullable()});
export type ProjectedVectorEntry=z.infer<typeof ProjectedVectorEntrySchema>;
export type ProjectedVectorIndex=z.infer<typeof ProjectedVectorIndexSchema>;
export type ProjectedVectorResult=z.infer<typeof ProjectedVectorResultSchema>;
