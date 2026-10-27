import {z} from 'zod';
import {PacketImageRegionWorkerSchema,PACKET_IMAGE_REGION_LIMITS} from '../packet-image-region';
import {RegistryImageRegionCitationSchema} from '../registry-document-evidence';
import {CoreIdSchema,CoreSha256Schema,coreText} from '../spatial/core/scalars';
import {UspSnapshotScopeSchema,UspTargetPinSchema,UspPrincipalSchema,UspAssetRefSchema} from './common';

/** An original-image crop has no PDF page, job or fence pin. */
export const PACKET_IMAGE_PDF_RECIPE='pack1-single-original-image-region/1' as const;
export const PACKET_IMAGE_PDF_LIMITS=Object.freeze({pages:1,pixels:PACKET_IMAGE_REGION_LIMITS.pixels,bytes:8*1024**2,seconds:60});
export const PACKET_IMAGE_PDF_POLICY='fresh_rgb_image_only; alpha_unsupported; no_original_metadata/1' as const;
const target=UspTargetPinSchema.refine(p=>p.ref.namespace==='registry_record'&&p.revision>0);
const selection=z.strictObject({bindingId:CoreSha256Schema,required:z.literal(true),inclusionReason:coreText(2048)}).readonly();
export const UspImagePdfPacketPlanInputSchema=z.strictObject({target,scope:UspSnapshotScopeSchema,
  purpose:z.literal('record_evidence'),format:z.literal('pdf'),recipe:z.literal(PACKET_IMAGE_PDF_RECIPE),
  expiresAt:z.iso.datetime({offset:true}),entries:z.tuple([selection]).readonly()}).readonly();
export const UspImagePdfPacketPlanEntrySchema=z.strictObject({selection,binding:RegistryImageRegionCitationSchema.nullable(),
  targetPath:z.array(target).length(1).readonly(),applicabilitySha256:CoreSha256Schema.nullable(),
  state:z.enum(['included','blocked_required_context']),reasonCode:CoreIdSchema.nullable(),entrySha256:CoreSha256Schema}).readonly();
export const UspImagePdfPacketPlanSchema=z.strictObject({planId:z.uuid(),version:z.number().int().positive(),
  previousVersion:z.number().int().positive().nullable(),input:UspImagePdfPacketPlanInputSchema,
  creator:UspPrincipalSchema,accessViewId:CoreIdSchema,policyVersion:CoreIdSchema,
  targetBodySha256:CoreSha256Schema,targetLabel:coreText(1024),entries:z.tuple([UspImagePdfPacketPlanEntrySchema]).readonly(),
  requiredContext:z.enum(['available','blocked']),createdAt:z.iso.datetime({offset:true}),planSha256:CoreSha256Schema}).readonly();
export const PacketImagePdfAssemblySchema=z.strictObject({version:z.literal('packet-image-pdf-assembly/1'),
  recipe:z.literal(PACKET_IMAGE_PDF_RECIPE),region:PacketImageRegionWorkerSchema.refine(r=>r.output.mode==='RGB'&&r.sourceImage.color.transparency==='absent'&&
    r.output.pixels[0]*r.output.pixels[1]<=PACKET_IMAGE_PDF_LIMITS.pixels,{message:'Single-image PDF supports bounded RGB crops only.'}),
  output:z.strictObject({sha256:CoreSha256Schema,bytes:z.number().int().positive().max(PACKET_IMAGE_PDF_LIMITS.bytes),
    contentType:z.literal('application/pdf'),pages:z.literal(1),policy:z.literal(PACKET_IMAGE_PDF_POLICY)})});
export const UspPacketImagePdfReceiptSchema=z.strictObject({version:z.literal('packet-image-pdf/1'),packetId:z.uuid(),target,
  scope:UspSnapshotScopeSchema,format:z.literal('pdf'),artifact:UspAssetRefSchema,
  planId:z.uuid(),planVersion:z.number().int().positive(),planSha256:CoreSha256Schema,confirmationId:z.uuid(),
  bindingId:CoreSha256Schema,entrySha256:CoreSha256Schema,assembly:PacketImagePdfAssemblySchema,
  contentType:z.literal('application/pdf'),status:z.literal('complete'),createdAt:z.iso.datetime({offset:true}),commandSha256:CoreSha256Schema}).readonly();
export const UspImagePdfPacketPlanExecutionSchema=z.strictObject({planId:z.uuid(),version:z.number().int().positive(),
  confirmationId:z.uuid(),packet:UspPacketImagePdfReceiptSchema,omissions:z.array(z.never()).length(0).readonly()}).readonly();
export type ImagePdfPacketPlan=z.infer<typeof UspImagePdfPacketPlanSchema>;
