import {z} from 'zod';
import {PacketRegionWorkerSchema,PACKET_REGION_LIMITS} from '../packet-region';
import {RegistryRegionCitationSchema} from '../registry-document-evidence';
import {CoreIdSchema,CoreSha256Schema,coreText} from '../spatial/core/scalars';
import {UspSnapshotScopeSchema,UspTargetPinSchema,UspPrincipalSchema,UspAssetRefSchema} from './common';

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
const target=UspTargetPinSchema.refine(p=>p.ref.namespace==='registry_record'&&p.revision>0);
export const UspPdfPlanSelectionSchema=z.strictObject({bindingId:CoreSha256Schema,required:z.literal(true),
  inclusionReason:coreText(2048)}).readonly();
export const UspPdfPacketPlanInputSchema=z.strictObject({target,scope:UspSnapshotScopeSchema,
  purpose:z.literal('record_evidence'),format:z.literal('pdf'),recipe:z.literal(PACKET_PDF_RECIPE),
  expiresAt:z.iso.datetime({offset:true}),entries:z.tuple([UspPdfPlanSelectionSchema]).readonly()}).readonly();
export const UspPdfPacketPlanEntrySchema=z.strictObject({selection:UspPdfPlanSelectionSchema,
  binding:RegistryRegionCitationSchema.nullable(),targetPath:z.array(target).length(1).readonly(),
  applicabilitySha256:CoreSha256Schema.nullable(),
  state:z.enum(['included','blocked_required_context']),reasonCode:CoreIdSchema.nullable(),entrySha256:CoreSha256Schema}).readonly();
export const UspPdfPacketPlanSchema=z.strictObject({planId:z.uuid(),version:z.number().int().positive(),
  previousVersion:z.number().int().positive().nullable(),input:UspPdfPacketPlanInputSchema,
  creator:UspPrincipalSchema,accessViewId:CoreIdSchema,policyVersion:CoreIdSchema,
  targetBodySha256:CoreSha256Schema,targetLabel:coreText(1024),
  entries:z.tuple([UspPdfPacketPlanEntrySchema]).readonly(),requiredContext:z.enum(['available','blocked']),
  createdAt:z.iso.datetime({offset:true}),planSha256:CoreSha256Schema}).readonly();
export const UspPacketPdfReceiptSchema=z.strictObject({version:z.literal('packet-pdf/1'),packetId:z.uuid(),
  target,scope:UspSnapshotScopeSchema,format:z.literal('pdf'),artifact:UspAssetRefSchema,
  planId:z.uuid(),planVersion:z.number().int().positive(),planSha256:CoreSha256Schema,confirmationId:z.uuid(),
  bindingId:CoreSha256Schema,entrySha256:CoreSha256Schema,assembly:PacketPdfAssemblySchema,
  contentType:z.literal('application/pdf'),status:z.literal('complete'),
  createdAt:z.iso.datetime({offset:true}),commandSha256:CoreSha256Schema}).readonly();
export const UspPdfPacketPlanExecutionSchema=z.strictObject({planId:z.uuid(),version:z.number().int().positive(),
  confirmationId:z.uuid(),packet:UspPacketPdfReceiptSchema,omissions:z.array(z.never()).length(0).readonly()}).readonly();
export type PdfPacketPlanInput=z.infer<typeof UspPdfPacketPlanInputSchema>;
export type PdfPacketPlan=z.infer<typeof UspPdfPacketPlanSchema>;
export type PdfPacketPlanEntry=z.infer<typeof UspPdfPacketPlanEntrySchema>;
export type PacketPdfReceipt=z.infer<typeof UspPacketPdfReceiptSchema>;
export type PdfPacketPlanExecution=z.infer<typeof UspPdfPacketPlanExecutionSchema>;
