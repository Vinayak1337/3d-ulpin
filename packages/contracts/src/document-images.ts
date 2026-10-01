import {z} from 'zod';

export const DOCUMENT_IMAGE_LIMITS=Object.freeze({originalBytes:16*1024**2,sourcePixels:25_000_000,
  sourceSide:25_000,metadataBytes:128*1024,pngBytes:8*1024**2,pixels:1_600_000,side:1400,
  seconds:30,memoryBytes:2*1024**3});
const hash=z.string().regex(/^[a-f0-9]{64}$/),id=z.uuid().transform(value=>value.toLowerCase());
export const DocumentImagePinSchema=z.strictObject({revision:z.string().regex(/^[1-9]\d*$/).transform(Number)
  .pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER)),sha256:hash});
const orientation=z.number().int().min(1).max(8);
const affine=z.tuple(Array.from({length:6},()=>z.number().finite().min(-25_000).max(25_000)) as
  [z.ZodNumber,z.ZodNumber,z.ZodNumber,z.ZodNumber,z.ZodNumber,z.ZodNumber]);
export const DocumentImageDisplaySchema=z.strictObject({frame:z.strictObject({kind:z.literal('image_display_top_left_pixels'),
  width:z.number().int().positive().max(1400),height:z.number().int().positive().max(1400)}),
  sourceToRaster:affine,coordinateConvention:z.literal('pixel_edges/1'),mode:z.enum(['RGB','RGBA']),
  resampling:z.enum(['none','lanczos']),colorInterpretation:z.literal('encoded_samples_unmanaged')});
export const DocumentImageInfoSchema=z.strictObject({format:z.enum(['png','jpeg']),mode:z.string().min(1).max(32),
  frame:z.strictObject({kind:z.literal('image_source_top_left_pixels'),
    width:z.number().int().positive().max(25_000),height:z.number().int().positive().max(25_000)}),frameCount:z.literal(1),
  orientation:z.strictObject({exifValue:orientation.nullable(),applied:orientation,
    provenance:z.enum(['source_exif','specification_default'])}),
  densityDeclarations:z.array(z.strictObject({kind:z.enum(['png_phys','jpeg_jfif','exif_resolution']),
    unitCode:z.number().int().nonnegative().max(4_294_967_295).nullable(),
    x:z.tuple([z.number().int().nonnegative().max(4_294_967_295),z.number().int().nonnegative().max(4_294_967_295)]).nullable(),
    y:z.tuple([z.number().int().nonnegative().max(4_294_967_295),z.number().int().nonnegative().max(4_294_967_295)]).nullable(),
    status:z.enum(['supplied','unsupported']),qualification:z.literal('not_calibrated')})).max(3),
  color:z.strictObject({embeddedIcc:z.boolean(),declaredSrgb:z.boolean().nullable(),
    transparency:z.enum(['absent','supplied'])}),display:DocumentImageDisplaySchema.nullable(),
  unsupportedReason:z.enum(['unsupported_color_profile','unsupported_pixel_mode']).nullable()});
export const DocumentImageRenderSchema=z.strictObject({sha256:hash,
  bytes:z.number().int().positive().max(DOCUMENT_IMAGE_LIMITS.pngBytes)});
export const DocumentImageWorkerSchema=z.strictObject({version:z.literal('document-image-local/1'),
  sourceSha256:hash,sourceBytes:z.number().int().positive().max(DOCUMENT_IMAGE_LIMITS.originalBytes),
  image:DocumentImageInfoSchema,render:DocumentImageRenderSchema.nullable()});
export const DocumentImageSchema=z.strictObject({version:z.literal('document-image/1'),sourceId:id,caseId:id,
  caseRevision:z.number().int().nonnegative(),sourceRevision:z.number().int().positive(),sourceSha256:hash,
  sourceBytes:z.number().int().positive().max(DOCUMENT_IMAGE_LIMITS.originalBytes),name:z.string().max(150),
  image:DocumentImageInfoSchema,url:z.string().max(512).nullable(),calibration:z.null(),
  locator:z.strictObject({kind:z.literal('original_image'),frame:z.literal(0)})});
export type DocumentImagePin=z.output<typeof DocumentImagePinSchema>;
export type DocumentImageInfo=z.output<typeof DocumentImageInfoSchema>;
export type DocumentImageWorker=z.output<typeof DocumentImageWorkerSchema>;
