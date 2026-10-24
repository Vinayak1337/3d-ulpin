import {z} from 'zod';
import {CoreSha256Schema} from '../spatial/core/scalars';
import {RasterPixelWindowSchema,RasterWindowMetadataSchema,RasterArtifactSchema,RASTER_WINDOW_LIMITS} from './raster-window';
import {PointBatchSelectionSchema,PointBatchMetadataSchema,PointArtifactSchema,POINT_BATCH_LIMITS} from './point-batch';

// Independent leaf: the lead composes this addition into the root sufficiency
// envelope. Producer metadata remains complete; artifact keys stay private.
const hash=CoreSha256Schema;
const common={inputSha256:hash.nullable(),readerSha256:hash.nullable(),
  acceptedFence:z.number().int().positive().nullable(),code:z.string().min(1).max(100).nullable(),
  tools:z.literal('not_checked'),installedInventory:z.literal('not_read'),
  coverage:z.literal('accepted_result_metadata_only; native_artifact_not_read'),
  artifactVerification:z.literal('accepted_receipt_reference_only'),
  otherSelections:z.literal('not_fetched'),interpretation:z.literal('not_assessed')};
export const SufficiencyRasterDetailSchema=z.strictObject({...common,kind:z.literal('raster'),
  requestedWindow:RasterPixelWindowSchema.nullable(),metadata:RasterWindowMetadataSchema.nullable(),
  artifact:RasterArtifactSchema.omit({key:true}).nullable(),
  measuredResultBytes:z.number().int().positive().max(RASTER_WINDOW_LIMITS.resultBytes).nullable()});
export const SufficiencyPointDetailSchema=z.strictObject({...common,kind:z.literal('point'),
  requestedBatch:PointBatchSelectionSchema.nullable(),metadata:PointBatchMetadataSchema.nullable(),
  artifact:PointArtifactSchema.omit({key:true}).nullable(),
  measuredResultBytes:z.number().int().positive().max(POINT_BATCH_LIMITS.resultBytes).nullable()});
export const SufficiencyRasterPointDetailSchema=z.discriminatedUnion('kind',[
  SufficiencyRasterDetailSchema,SufficiencyPointDetailSchema,
]);
export const SufficiencyRasterPointEnvelopeSchema=z.strictObject({
  state:z.enum(['pending','running','failed','stale','unavailable','inspected_metadata']),
  jobId:z.uuid().nullable(),resultSha256:hash.nullable(),nativeStatus:z.null(),modelStatus:z.null(),
  rasterPoint:SufficiencyRasterPointDetailSchema,
}).superRefine((value,ctx)=>{
  const d=value.rasterPoint,available=value.state==='inspected_metadata';
  if(available?(!value.jobId||!value.resultSha256||!d.inputSha256||!d.readerSha256||!d.acceptedFence||
    !d.metadata||!d.artifact||!d.measuredResultBytes):
    (value.resultSha256!==null||d.metadata!==null||d.artifact!==null||d.measuredResultBytes!==null))
    ctx.addIssue({code:'custom',message:'Only inspected accepted metadata may carry result metadata and measured receipt bytes.'});
});
export type SufficiencyRasterPointEnvelope=z.infer<typeof SufficiencyRasterPointEnvelopeSchema>;
