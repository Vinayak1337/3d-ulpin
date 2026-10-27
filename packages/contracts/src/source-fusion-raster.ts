import {z} from 'zod';
import {SourceFusionPinSchema} from './source-fusion-common';
import {RASTER_WINDOW_LIMITS,RasterPixelWindowSchema,RasterWindowMetadataSchema} from './usp/raster-window';

const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const SourceFusionRasterPinSchema=SourceFusionPinSchema.extend({
  resultBytes:z.number().int().positive().max(RASTER_WINDOW_LIMITS.resultBytes)});
/** One explicit metadata fragment from one exact accepted window, never pixels. */
export const SourceFusionRasterSelectionSchema=z.strictObject({kind:z.literal('raster'),pin:SourceFusionRasterPinSchema,
  artifactSha256:hash,metadataSha256:hash,window:RasterPixelWindowSchema});
export const SourceFusionRasterSchema=z.strictObject({kind:z.literal('raster'),pin:SourceFusionRasterPinSchema,
  namespace:z.string(),sourceSetRole:z.literal('operator_selected_fragment'),key:z.string(),pointer:z.literal('/metadata'),
  artifactSha256:hash,artifactBytes:z.number().int().positive().max(RASTER_WINDOW_LIMITS.artifactBytes),metadataSha256:hash,
  selectionSha256:hash,selectionHashBasis:z.literal('accepted_source_result_input_reader_fence_artifact_window_and_metadata'),
  metadata:RasterWindowMetadataSchema,
  coverage:z.strictObject({selectedWindows:z.literal(1),scope:z.literal('exact_accepted_window_metadata'),
    pixelContent:z.literal('not_read'),otherWindows:z.literal('not_fetched'),
    artifactVerification:z.literal('accepted_receipt_reference_only'),geometryQualification:z.literal('not_assessed'),
    propertyMatching:z.literal('unsupported')})});
export type SourceFusionRasterSelection=z.infer<typeof SourceFusionRasterSelectionSchema>;
export type SourceFusionRaster=z.infer<typeof SourceFusionRasterSchema>;
