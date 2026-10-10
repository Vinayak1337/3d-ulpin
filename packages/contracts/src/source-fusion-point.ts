import {z} from 'zod';
import {SourceFusionPinSchema} from './source-fusion-common';
import {POINT_BATCH_LIMITS,PointBatchSelectionSchema,PointBatchMetadataSchema} from './usp/point-batch';

const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const SourceFusionPointPinSchema=SourceFusionPinSchema.extend({
  resultBytes:z.number().int().positive().max(POINT_BATCH_LIMITS.resultBytes)});
/** One explicit metadata fragment from one exact accepted batch, never point records. */
export const SourceFusionPointSelectionSchema=z.strictObject({kind:z.literal('point'),pin:SourceFusionPointPinSchema,
  artifactSha256:hash,metadataSha256:hash,batch:PointBatchSelectionSchema});
export const SourceFusionPointSchema=z.strictObject({kind:z.literal('point'),pin:SourceFusionPointPinSchema,
  namespace:z.string(),sourceSetRole:z.literal('operator_selected_fragment'),key:z.string(),pointer:z.literal('/metadata'),
  artifactSha256:hash,artifactBytes:z.number().int().positive().max(POINT_BATCH_LIMITS.artifactBytes),metadataSha256:hash,
  selectionSha256:hash,selectionHashBasis:z.literal('accepted_source_result_input_reader_fence_artifact_batch_and_metadata'),
  metadata:PointBatchMetadataSchema,
  coverage:z.strictObject({selectedBatches:z.literal(1),scope:z.literal('exact_accepted_batch_metadata'),
    pointRecords:z.literal('not_read'),otherBatches:z.literal('not_fetched'),
    artifactVerification:z.literal('accepted_receipt_reference_only'),geometryQualification:z.literal('not_assessed'),
    propertyMatching:z.literal('unsupported')})});
export type SourceFusionPointSelection=z.infer<typeof SourceFusionPointSelectionSchema>;
export type SourceFusionPoint=z.infer<typeof SourceFusionPointSchema>;
