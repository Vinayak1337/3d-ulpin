import {z} from 'zod';
import {DOCUMENT_IMAGE_LIMITS,DocumentImageInfoSchema,DocumentImagePinSchema} from './document-images';

export const PACKET_IMAGE_REGION_LIMITS=Object.freeze({...DOCUMENT_IMAGE_LIMITS,selectionBytes:4096,provenanceBytes:4096});
const hash=z.string().regex(/^[a-f0-9]{64}$/),id=z.uuid().transform(v=>v.toLowerCase());
const coordinate=z.number().finite().min(0).max(DOCUMENT_IMAGE_LIMITS.sourceSide);
const region=z.tuple([coordinate,coordinate,coordinate,coordinate]);
const pixelBounds=z.tuple([coordinate.int(),coordinate.int(),coordinate.int(),coordinate.int()]);
const affine=z.tuple([z.number().finite(),z.number().finite(),z.number().finite(),
  z.number().finite(),z.number().finite(),z.number().finite()]);
export const PacketImageRegionFrameSchema=z.strictObject({kind:z.literal('image_oriented_top_left_pixels'),
  width:z.number().int().positive().max(DOCUMENT_IMAGE_LIMITS.sourceSide),
  height:z.number().int().positive().max(DOCUMENT_IMAGE_LIMITS.sourceSide),
  orientation:DocumentImageInfoSchema.shape.orientation,
});
export const PacketImageRegionSelectionSchema=z.strictObject({frame:PacketImageRegionFrameSchema,
  coordinates:z.literal('oriented_original_pixel_edges/1'),region,selectionAcknowledged:z.literal(true),
}).refine(s=>s.frame.width*s.frame.height<=DOCUMENT_IMAGE_LIMITS.sourcePixels&&
  s.frame.orientation.applied===(s.frame.orientation.exifValue??1)&&
  s.frame.orientation.provenance===(s.frame.orientation.exifValue===null?'specification_default':'source_exif')&&
  s.region[2]<=s.frame.width&&s.region[3]<=s.frame.height&&
  Math.floor(s.region[2])-Math.ceil(s.region[0])>=1&&Math.floor(s.region[3])-Math.ceil(s.region[1])>=1,
{message:'Pin an exact oriented original frame and select at least one complete pixel inside it.'});
export const PacketImageRegionRequestSchema=DocumentImagePinSchema.extend({
  purpose:z.literal('private_source_preview'),selection:PacketImageRegionSelectionSchema});
export const PacketImageRegionRecipeSchema=z.strictObject({version:z.literal('packet-image-region-recipe/1'),
  workerSha256:hash,decoderSha256:hash,supervisorSha256:hash,
  crop:z.literal('oriented_original_before_resampling/1'),rounding:z.literal('inward_complete_pixels/1'),
  metadataPolicy:z.literal('fresh_rgb_or_rgba_pixels_only/1')});
export const PacketImageRegionWorkerSchema=z.strictObject({version:z.literal('packet-image-region-local/1'),
  sourceSha256:hash,sourceBytes:z.number().int().positive().max(DOCUMENT_IMAGE_LIMITS.originalBytes),
  sourceImage:DocumentImageInfoSchema.omit({display:true}).extend({unsupportedReason:z.null()}),
  selection:PacketImageRegionSelectionSchema,recipe:PacketImageRegionRecipeSchema,
  runtime:z.strictObject({python:z.string().min(1).max(32),pillow:z.string().min(1).max(32),
    jpegCodec:z.string().max(32).nullable(),libjpegTurbo:z.string().max(32).nullable(),zlibCodec:z.string().max(32).nullable(),
    pythonSha256:hash,launcherSha256:hash,pillowImageSha256:hash,imagingSha256:hash}),
  transform:z.strictObject({includedPixelBounds:pixelBounds,includedOrientedRegion:pixelBounds,
    sourceToOriented:affine,orientedToOutput:affine,sourceToOutput:affine,outputToOriented:affine,
    coordinateConvention:z.literal('pixel_edges/1'),rounding:z.literal('inward_complete_pixels/1'),
    resampling:z.enum(['none','lanczos'])}),
  output:z.strictObject({sha256:hash,bytes:z.number().int().positive().max(DOCUMENT_IMAGE_LIMITS.pngBytes),
    pixels:z.tuple([z.number().int().positive().max(1400),z.number().int().positive().max(1400)]),
    format:z.literal('png'),mode:z.enum(['RGB','RGBA']),colorInterpretation:z.literal('encoded_samples_unmanaged'),
    metadataPolicy:z.literal('fresh_rgb_or_rgba_pixels_only/1')}),
});
export const PacketImageRegionProvenanceSchema=PacketImageRegionWorkerSchema.extend({version:z.literal('packet-image-region/1'),
  caseId:id,caseRevision:z.number().int().nonnegative(),sourceId:id,sourceRevision:z.number().int().positive(),
  purpose:z.literal('private_source_preview'),locator:z.strictObject({kind:z.literal('original_image'),frame:z.literal(0)}),
  calibration:z.null(),applicability:z.literal('not_assessed')});
export type PacketImageRegionSelection=z.output<typeof PacketImageRegionSelectionSchema>;
export type PacketImageRegionWorker=z.output<typeof PacketImageRegionWorkerSchema>;
export type PacketImageRegionRecipe=z.output<typeof PacketImageRegionRecipeSchema>;
