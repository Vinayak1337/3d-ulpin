import {z} from 'zod';
import {DocumentPageFrameSchema,DocumentPagePinSchema} from './document-pages';

/** Stricter than H10's later assembly ceiling; no existing cap is raised. */
export const PACKET_REGION_LIMITS=Object.freeze({sourceBytes:16*1024**2,pages:8,sourceSide:14400,
  selectedSide:2000,pixels:1_600_000,side:1400,pngBytes:8*1024**2,metadataBytes:16*1024,
  memoryBytes:512*1024**2,workerSeconds:25,seconds:35});
const hash=z.string().regex(/^[a-f0-9]{64}$/),id=z.uuid().transform(v=>v.toLowerCase());
const coordinate=z.number().finite().min(-10_000_000).max(10_000_000);
const box=z.tuple([coordinate,coordinate,coordinate,coordinate]);
export const PacketNormalizedRegionSchema=z.tuple(Array.from({length:4},()=>z.number().finite().min(0).max(1)) as
  [z.ZodNumber,z.ZodNumber,z.ZodNumber,z.ZodNumber]).refine(v=>v[0]<v[2]&&v[1]<v[3],{message:'Select a nonempty normalized region.'});
export const PacketRegionSelectionSchema=z.strictObject({
  frame:DocumentPageFrameSchema,mediaBox:box,cropBox:box,boxConvention:z.literal('pymupdf_page_rectangles/1'),
  coordinates:z.literal('displayed_cropbox_normalized_top_left/1'),region:PacketNormalizedRegionSchema,
  selectionAcknowledged:z.literal(true),
}).refine(s=>{
  const width=(s.region[2]-s.region[0])*s.frame.width,height=(s.region[3]-s.region[1])*s.frame.height;
  return [0,90,180,270].includes(s.frame.rotation)&&Math.max(s.frame.width,s.frame.height)<=14400&&
    Math.min(width,height)>=1&&Math.max(width,height)<=2000;
},{message:'This frame or crop exceeds the supported selected-region profile.'});
export const PacketRegionRequestSchema=DocumentPagePinSchema.extend({
  purpose:z.literal('private_source_preview'),selection:PacketRegionSelectionSchema});
export const PacketRegionPageSchema=z.number().int().min(1).max(8);
const pair=z.tuple([z.number().int().positive().max(43200),z.number().int().positive().max(43200)]);
export const PacketRegionWorkerSchema=z.strictObject({version:z.literal('packet-region-local/1'),
  sourceSha256:hash,sourceBytes:z.number().int().positive().max(PACKET_REGION_LIMITS.sourceBytes),
  page:PacketRegionPageSchema,selection:PacketRegionSelectionSchema,recipeSha256:hash,
  renderer:z.strictObject({pypdfium2:z.literal('5.13.0'),pdfium:z.literal('153.0.7999.0'),pymupdf:z.literal('1.25.5'),pillow:z.literal('12.3.0'),
    pdfiumSha256:z.literal('fb898a1f5ace57805834f390407500bdb6ef93eff326a252ad334a8aae809d8e')}),
  transform:z.strictObject({canvasPixels:pair,pixelRegion:z.tuple([z.number().int().nonnegative(),z.number().int().nonnegative(),
    z.number().int().positive(),z.number().int().positive()]),
    pixelToDisplay:z.tuple([z.number(),z.number(),z.number(),z.number(),z.number(),z.number()]),
    includedNormalizedRegion:PacketNormalizedRegionSchema,rounding:z.literal('inward_complete_pixels/1')}),
  output:z.strictObject({sha256:hash,bytes:z.number().int().positive().max(PACKET_REGION_LIMITS.pngBytes),
    pixels:z.tuple([z.number().int().positive().max(1400),z.number().int().positive().max(1400)]),
    format:z.literal('png'),metadataPolicy:z.literal('fresh_rgb_pixels_only/1'),annotations:z.literal('excluded'),
    applicability:z.literal('not_assessed')}),
});
export const PacketRegionProvenanceSchema=PacketRegionWorkerSchema.extend({version:z.literal('packet-region/1'),
  caseId:id,caseRevision:z.number().int().nonnegative(),sourceId:id,sourceRevision:z.number().int().positive(),
  purpose:z.literal('private_source_preview')});
export type PacketRegionSelection=z.output<typeof PacketRegionSelectionSchema>;
export type PacketRegionWorker=z.output<typeof PacketRegionWorkerSchema>;
