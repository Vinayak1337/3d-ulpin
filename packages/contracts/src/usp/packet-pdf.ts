import {z} from 'zod';
import {PacketRegionWorkerSchema,PACKET_REGION_LIMITS} from '../packet-region';
import {RegistryRegionCitationSchema,RegistryRegionOriginalSchema} from '../registry-document-evidence';
import {CoreIdSchema,CoreSha256Schema,coreText} from '../spatial/core/scalars';
import {UspSnapshotScopeSchema,UspTargetPinSchema,UspPrincipalSchema,UspAssetRefSchema} from './common';
import {UspImagePdfPacketPlanInputSchema,UspImagePdfPacketPlanSchema,UspPacketImagePdfReceiptSchema,
  UspImagePdfPacketPlanExecutionSchema} from './packet-image-pdf';
import {UspMixedPdfPacketPlanInputSchema,UspMixedPdfPacketPlanSchema,UspPacketMixedPdfReceiptSchema,UspMixedPdfPacketPlanExecutionSchema} from './packet-mixed-pdf';

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

/** Additive recipe: old single-region contracts and receipt bodies stay exact. */
export const PACKET_PDF_MULTI_RECIPE='pack1-multi-region-image/1' as const;
export const PACKET_PDF_MULTI_LIMITS=Object.freeze({pages:4,pixels:48_000_000,bytes:32*1024**2,
  seconds:PACKET_REGION_LIMITS.seconds});
const multiSelections=z.array(UspPdfPlanSelectionSchema).min(2).max(4).superRefine((entries,ctx)=>{
  if(new Set(entries.map(e=>e.bindingId)).size!==entries.length)
    ctx.addIssue({code:'custom',message:'Select each distinct committed region binding once.'});
}).readonly();
export const UspPdfMultiPacketPlanInputSchema=UspPdfPacketPlanInputSchema.unwrap().extend({
  recipe:z.literal(PACKET_PDF_MULTI_RECIPE),entries:multiSelections}).readonly();
export const UspPdfMultiPacketPlanSchema=UspPdfPacketPlanSchema.unwrap().extend({
  input:UspPdfMultiPacketPlanInputSchema,entries:z.array(UspPdfPacketPlanEntrySchema).min(2).max(4).readonly()}).readonly();
export const PacketPdfMultiAssemblySchema=z.strictObject({version:z.literal('packet-pdf-assembly/2'),
  recipe:z.literal(PACKET_PDF_MULTI_RECIPE),regions:z.array(PacketRegionWorkerSchema).min(2).max(4),
  output:z.strictObject({sha256:hash,bytes:z.number().int().positive().max(PACKET_PDF_MULTI_LIMITS.bytes),
    contentType:z.literal('application/pdf'),pages:z.number().int().min(2).max(4),
    processedPixels:z.number().int().positive().max(PACKET_PDF_MULTI_LIMITS.pixels),
    policy:z.literal('fresh_rgb_image_only; no_source_pdf_objects/1')})}).superRefine((v,ctx)=>{
  const first=v.regions[0];
  if(v.regions.some(r=>r.sourceSha256!==first.sourceSha256||r.sourceBytes!==first.sourceBytes)||
    v.output.pages!==v.regions.length||v.output.processedPixels!==v.regions.reduce((n,r)=>n+r.output.pixels[0]*r.output.pixels[1],0))
    ctx.addIssue({code:'custom',message:'Ordered pages must retain one exact original and their cumulative rendered-pixel count.'});
});
export const UspPacketPdfMultiReceiptSchema=UspPacketPdfReceiptSchema.unwrap().omit({bindingId:true,entrySha256:true}).extend({
  version:z.literal('packet-pdf/2'),assembly:PacketPdfMultiAssemblySchema,
  entries:z.array(z.strictObject({bindingId:CoreSha256Schema,entrySha256:CoreSha256Schema,
    outputPage:z.number().int().min(1).max(4)})).min(2).max(4).readonly()}).superRefine((v,ctx)=>{
  if(v.entries.length!==v.assembly.regions.length||new Set(v.entries.map(e=>e.bindingId)).size!==v.entries.length||
    v.entries.some((e,i)=>e.outputPage!==i+1))
    ctx.addIssue({code:'custom',message:'Every required distinct binding needs its exact ordered output page.'});
}).readonly();
export const UspPdfMultiPacketPlanExecutionSchema=UspPdfPacketPlanExecutionSchema.unwrap().extend({
  packet:UspPacketPdfMultiReceiptSchema}).readonly();
/** Separate recipe: existing one-original receipts and hashes stay unchanged. */
export const PACKET_PDF_ORIGINALS_RECIPE='pack1-multiple-original-region-image/1' as const;
export const PACKET_PDF_ORIGINALS_LIMITS=Object.freeze({...PACKET_PDF_MULTI_LIMITS,originalBytes:32*1024**2});
export const UspPdfOriginalsPacketPlanInputSchema=UspPdfMultiPacketPlanInputSchema.unwrap().extend({
  recipe:z.literal(PACKET_PDF_ORIGINALS_RECIPE)}).readonly();
export const UspPdfOriginalsPacketPlanSchema=UspPdfMultiPacketPlanSchema.unwrap().extend({
  input:UspPdfOriginalsPacketPlanInputSchema}).readonly();
export const PacketPdfOriginalSetSchema=z.array(RegistryRegionOriginalSchema).min(2).max(4).superRefine((originals,ctx)=>{
  const unique=new Map<string,typeof originals[number]>();
  for(const original of originals){
    const prior=unique.get(original.sourceId);
    if(prior&&JSON.stringify(prior)!==JSON.stringify(original))
      ctx.addIssue({code:'custom',message:'Each canonical original must retain one exact source and case pin.'});
    unique.set(original.sourceId,original);
  }
  if(unique.size<2||[...unique.values()].reduce((n,o)=>n+o.sourceBytes,0)>PACKET_PDF_ORIGINALS_LIMITS.originalBytes)
    ctx.addIssue({code:'custom',message:'Select at least two canonical originals within the aggregate 32 MiB source profile.'});
});
export const PacketPdfOriginalsAssemblySchema=z.strictObject({version:z.literal('packet-pdf-assembly/3'),
  recipe:z.literal(PACKET_PDF_ORIGINALS_RECIPE),originals:PacketPdfOriginalSetSchema,
  regions:z.array(PacketRegionWorkerSchema).min(2).max(4),output:PacketPdfMultiAssemblySchema.shape.output
}).superRefine((v,ctx)=>{
  if(v.originals.length!==v.regions.length||v.regions.some((r,i)=>r.sourceSha256!==v.originals[i]?.sourceSha256||r.sourceBytes!==v.originals[i]?.sourceBytes)||
    v.output.pages!==v.regions.length||v.output.processedPixels!==v.regions.reduce((n,r)=>n+r.output.pixels[0]*r.output.pixels[1],0))
    ctx.addIssue({code:'custom',message:'Every ordered page must retain its exact original and rendered-pixel count.'});
});
export const UspPacketPdfOriginalsReceiptSchema=z.strictObject({...UspPacketPdfMultiReceiptSchema.unwrap().shape,
  version:z.literal('packet-pdf/3'),assembly:PacketPdfOriginalsAssemblySchema}).superRefine((v,ctx)=>{
  if(v.entries.length!==v.assembly.regions.length||new Set(v.entries.map(e=>e.bindingId)).size!==v.entries.length||
    v.entries.some((e,i)=>e.outputPage!==i+1))
    ctx.addIssue({code:'custom',message:'Every required distinct binding needs its exact ordered output page.'});
}).readonly();
export const UspPdfOriginalsPacketPlanExecutionSchema=UspPdfPacketPlanExecutionSchema.unwrap().extend({
  packet:UspPacketPdfOriginalsReceiptSchema}).readonly();
export const UspAnyPdfPacketPlanInputSchema=z.union([UspPdfPacketPlanInputSchema,UspPdfMultiPacketPlanInputSchema,UspPdfOriginalsPacketPlanInputSchema,UspImagePdfPacketPlanInputSchema,UspMixedPdfPacketPlanInputSchema]);
export const UspAnyPdfPacketPlanSchema=z.union([UspPdfPacketPlanSchema,UspPdfMultiPacketPlanSchema,UspPdfOriginalsPacketPlanSchema,UspImagePdfPacketPlanSchema,UspMixedPdfPacketPlanSchema]);
export const UspAnyPacketPdfReceiptSchema=z.union([UspPacketPdfReceiptSchema,UspPacketPdfMultiReceiptSchema,UspPacketPdfOriginalsReceiptSchema,UspPacketImagePdfReceiptSchema,UspPacketMixedPdfReceiptSchema]);
export const UspAnyPdfPacketPlanExecutionSchema=z.union([UspPdfPacketPlanExecutionSchema,UspPdfMultiPacketPlanExecutionSchema,UspPdfOriginalsPacketPlanExecutionSchema,UspImagePdfPacketPlanExecutionSchema,UspMixedPdfPacketPlanExecutionSchema]);
export type AnyPdfPacketPlanInput=z.infer<typeof UspAnyPdfPacketPlanInputSchema>;
export type AnyPdfPacketPlan=z.infer<typeof UspAnyPdfPacketPlanSchema>;
export type AnyPdfPacketPlanExecution=z.infer<typeof UspAnyPdfPacketPlanExecutionSchema>;
export type PacketPdfMultiAssembly=z.infer<typeof PacketPdfMultiAssemblySchema>;
