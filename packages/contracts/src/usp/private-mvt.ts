import {z} from 'zod';
import {AdministrativeObservationSchema,PROJECTED_VECTOR_PROFILE} from './projected-vector';

export const PRIVATE_MVT_PROFILE=Object.freeze({version:'nwic-private-mvt/1',grid:'xyz-webmercator-4096-b64/1',
  layer:'nwic_districts',minimumZoom:2,maximumZoom:6,extent:4096,buffer:64,cells:128,batch:4,
  tileBytes:2*1024*1024,mapBytes:512*1024,manifestBytes:1024*1024,outputBytes:64*1024*1024,
  jobMs:240000,sqlMs:8000,lockMs:2000,objectMs:10000,active:1,jobs:32,requests:128,completed:8,versions:32});
const p=PRIVATE_MVT_PROFILE,id=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/),integer=z.number().int().nonnegative();
export const PrivateMvtCellSchema=z.strictObject({z:z.number().int().min(p.minimumZoom).max(p.maximumZoom),x:integer.max(63),y:integer.max(63)})
  .refine(v=>v.x<2**v.z&&v.y<2**v.z,'Cell is outside its declared XYZ zoom.');
export const PrivateMvtWindowSchema=z.strictObject({z:z.number().int().min(p.minimumZoom).max(p.maximumZoom),
  minX:integer.max(63),maxX:integer.max(63),minY:integer.max(63),maxY:integer.max(63)})
  .refine(v=>v.minX<=v.maxX&&v.minY<=v.maxY&&v.maxX<2**v.z&&v.maxY<2**v.z
    &&(v.maxX-v.minX+1)*(v.maxY-v.minY+1)<=p.cells,'Use an increasing bounded XYZ window.');
export const PrivateMvtGenerationPinSchema=z.strictObject({jobId:id,version:z.number().int().min(1).max(p.versions),sha256:hash});
export const PrivateMvtRequestSchema=z.strictObject({requestKey:id,expectedCaseRevision:integer,expectedSourceRevision:integer.min(1),
  admissionJobId:id,expectedGeneration:PrivateMvtGenerationPinSchema.nullable(),window:PrivateMvtWindowSchema.nullable(),
  revalidateUnitIds:z.array(id).max(733).default([])}).refine(v=>new Set(v.revalidateUnitIds).size===v.revalidateUnitIds.length,'Repeat no unit ID.');
export const PrivateMvtCompilerSchema=z.strictObject({codeSha256:hash,policySha256:hash,postgis:z.string().min(1).max(2000),
  sha256:hash,sourceTransformSha256:hash,sourceCrs:z.literal('EPSG:4326'),targetCrs:z.literal('EPSG:3857'),axisOrder:z.literal('always_xy'),verticalReference:z.null()});
const bounds=z.tuple([z.number().finite(),z.number().finite(),z.number().finite(),z.number().finite()]);
export const PrivateMvtSourcePinsSchema=z.strictObject({caseId:id,caseRevision:integer,sourceId:id,sourceRevision:integer.min(1),sourceFamilyId:id,
  sha256:z.literal(PROJECTED_VECTOR_PROFILE.zipSha256),admissionJobId:id,admissionIndexSha256:hash,admissionInputFingerprint:hash,
  sourceDependencySha256:hash,accessBinding:hash,namespace:z.literal(PROJECTED_VECTOR_PROFILE.namespace)});
export const PrivateMvtInvalidationSchema=z.strictObject({version:z.literal(p.grid),cells:z.array(PrivateMvtCellSchema).max(p.cells),
  changes:z.array(z.strictObject({unitId:id,kind:z.enum(['added','removed','changed','revalidated']),oldBounds:bounds.nullable(),newBounds:bounds.nullable()})).max(733),
  includeHalo:z.literal(true),includeParents:z.literal(true)});
export const PrivateMvtInputSchema=z.strictObject({kind:z.literal('retained_administrative_observations'),version:z.literal(p.version),jobId:id,
  source:PrivateMvtSourcePinsSchema,compiler:PrivateMvtCompilerSchema,base:PrivateMvtGenerationPinSchema.nullable(),
  window:PrivateMvtWindowSchema.nullable(),catalog:z.array(PrivateMvtCellSchema).min(1).max(p.cells),plan:z.array(PrivateMvtCellSchema).max(p.cells),
  invalidation:PrivateMvtInvalidationSchema,inputFingerprint:hash});
export const PrivateMvtAssetSchema=z.strictObject({key:z.string().min(1).max(500),sha256:hash,bytes:integer.max(p.tileBytes)});
export const PrivateMvtMapEntrySchema=z.strictObject({mvtId:integer.safe(),unitId:id,featureIndex:integer.max(732),
  rawSha256:hash,geographicSha256:hash});
export const PrivateMvtIdentityMapSchema=z.strictObject({version:z.literal(p.version),grid:z.literal(p.grid),cell:PrivateMvtCellSchema,
  namespace:z.literal(PROJECTED_VECTOR_PROFILE.namespace),features:z.array(PrivateMvtMapEntrySchema).max(720)});
export const PrivateMvtPreparedCellSchema=z.strictObject({cell:PrivateMvtCellSchema,bounds3857:bounds,tile:PrivateMvtAssetSchema,
  identityMap:PrivateMvtAssetSchema,candidates:integer.max(720),emitted:integer.max(720),omittedByDisplay:integer.max(720),
  dependencySha256:hash,reused:z.boolean()}).refine(v=>v.emitted+v.omittedByDisplay===v.candidates,'Display disposition counts must close.');
export const PrivateMvtManifestSchema=z.strictObject({version:z.literal(p.version),grid:z.literal(p.grid),generationId:id,
  sequence:z.number().int().min(1).max(p.versions),fence:integer.min(1),attempt:integer.min(1),source:PrivateMvtSourcePinsSchema,
  compiler:PrivateMvtCompilerSchema,base:PrivateMvtGenerationPinSchema.nullable(),window:PrivateMvtWindowSchema.nullable(),
  catalog:z.array(PrivateMvtCellSchema).min(1).max(p.cells),pending:z.array(PrivateMvtCellSchema).max(p.cells),
  cells:z.array(PrivateMvtPreparedCellSchema).max(p.cells),complete:z.boolean(),invalidation:PrivateMvtInvalidationSchema,
  excludedQuarantined:integer.min(13).max(733),extent:z.literal(4096),buffer:z.literal(64),layer:z.literal(p.layer),
  purpose:z.literal('administrative_context'),analyticEligible:z.literal(false),
  limitations:z.array(z.enum(['display_quantization_clipping_may_omit_collapse_or_repair_geometry','administrative_context_not_property_geometry',
    'source_accuracy_currentness_unqualified','post_admission_only_multi_chunk_import_stream_gate_pending'])).length(4)});
export const PrivateMvtStatusSchema=z.strictObject({version:z.literal(p.version),caseId:id,sourceId:id,currentCaseRevision:integer,
  jobId:id,status:z.enum(['queued','running','succeeded','failed','stale']),context:z.enum(['current','stale']),
  generation:PrivateMvtGenerationPinSchema.nullable(),preparedCells:integer.max(p.cells),plannedCells:integer.max(p.cells),errorCode:z.string().max(80).nullable()});
export const PrivateMvtManifestResponseSchema=z.strictObject({pin:PrivateMvtGenerationPinSchema,jobStatus:z.enum(['queued','running','succeeded','failed','stale']),manifest:PrivateMvtManifestSchema});
export const PrivateMvtLookupSchema=z.strictObject({generation:PrivateMvtGenerationPinSchema,mvtId:integer.safe(),observation:AdministrativeObservationSchema});
export type PrivateMvtCell=z.infer<typeof PrivateMvtCellSchema>;
export type PrivateMvtInput=z.infer<typeof PrivateMvtInputSchema>;
export type PrivateMvtPreparedCell=z.infer<typeof PrivateMvtPreparedCellSchema>;
export type PrivateMvtManifest=z.infer<typeof PrivateMvtManifestSchema>;
export type PrivateMvtGenerationPin=z.infer<typeof PrivateMvtGenerationPinSchema>;
export type PrivateMvtMapEntry=z.infer<typeof PrivateMvtMapEntrySchema>;
