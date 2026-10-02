import {z} from 'zod';
import {PacketRegionWorkerSchema,PACKET_REGION_LIMITS} from '../packet-region';

/** Assembly bytes are a derivative, never evidence applicability or a packet
 * publication. The plan service must separately supply its reviewed binding. */
export const PACKET_PDF_RECIPE='pack1-single-region-image/1' as const;
export const PACKET_PDF_LIMITS=Object.freeze({pages:1,bytes:8*1024**2,pixels:PACKET_REGION_LIMITS.pixels});
const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const PacketPdfAssemblySchema=z.strictObject({
  version:z.literal('packet-pdf-assembly/1'),recipe:z.literal(PACKET_PDF_RECIPE),
  region:PacketRegionWorkerSchema,
  output:z.strictObject({sha256:hash,bytes:z.number().int().positive().max(PACKET_PDF_LIMITS.bytes),
    contentType:z.literal('application/pdf'),pages:z.literal(1),
    policy:z.literal('fresh_rgb_image_only; no_source_pdf_objects/1')}),
});
export type PacketPdfAssembly=z.output<typeof PacketPdfAssemblySchema>;
