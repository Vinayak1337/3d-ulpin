import {z} from 'zod';
import {PacketRegionWorkerSchema,PACKET_REGION_LIMITS} from '../packet-region';
import {PacketImageRegionWorkerSchema,PACKET_IMAGE_REGION_LIMITS} from '../packet-image-region';
import {RegistryRegionCitationSchema,RegistryImageRegionCitationSchema,RegistryRegionOriginalSchema} from '../registry-document-evidence';
import {CoreIdSchema,CoreSha256Schema as hash,coreText} from '../spatial/core/scalars';
import {UspSnapshotScopeSchema,UspTargetPinSchema,UspPrincipalSchema,UspAssetRefSchema} from './common';

export const PACKET_MIXED_PDF_RECIPE='pack1-mixed-pdf-image-regions/1' as const;
export const PACKET_MIXED_PDF_POLICY='fresh_rgb_image_only; no_original_metadata_or_source_pdf_objects/1' as const;
export const PACKET_MIXED_PDF_LIMITS=Object.freeze({pages:2,bytes:32*1024**2,originalBytes:32*1024**2,
  pixels:PACKET_REGION_LIMITS.pixels+PACKET_IMAGE_REGION_LIMITS.pixels,seconds:PACKET_REGION_LIMITS.seconds});
export const PacketMixedEntryKindSchema=z.enum(['pdf_page_region','original_image_region']);
const target=UspTargetPinSchema.refine(p=>p.ref.namespace==='registry_record'&&p.revision>0);
const selection=z.strictObject({kind:PacketMixedEntryKindSchema,bindingId:hash,required:z.literal(true),inclusionReason:coreText(2048)}).readonly();
const exactlyMixed=(kinds:readonly string[])=>kinds.length===2&&new Set(kinds).size===2;
export const UspMixedPdfPacketPlanInputSchema=z.strictObject({target,scope:UspSnapshotScopeSchema,purpose:z.literal('record_evidence'),
  format:z.literal('pdf'),recipe:z.literal(PACKET_MIXED_PDF_RECIPE),expiresAt:z.iso.datetime({offset:true}),
  entries:z.tuple([selection,selection]).superRefine((entries,ctx)=>{
    if(!exactlyMixed(entries.map(e=>e.kind))||entries[0].bindingId===entries[1].bindingId)
      ctx.addIssue({code:'custom',message:'Select one distinct reviewed PDF-page region and one reviewed original-image region, in explicit order.'});
  }).readonly()}).readonly();
export const UspMixedPdfPacketPlanEntrySchema=z.strictObject({selection,
  binding:z.union([RegistryRegionCitationSchema,RegistryImageRegionCitationSchema]).nullable(),
  targetPath:z.array(target).length(1).readonly(),applicabilitySha256:hash.nullable(),state:z.enum(['included','blocked_required_context']),
  reasonCode:CoreIdSchema.nullable(),entrySha256:hash}).superRefine((entry,ctx)=>{
    if(entry.binding&&((entry.selection.kind==='original_image_region')!==(entry.binding.version==='registry-image-region-citation/1')))
      ctx.addIssue({code:'custom',message:'Each mixed entry must retain its exact declared citation kind.'});
  }).readonly();
export const UspMixedPdfPacketPlanSchema=z.strictObject({planId:z.uuid(),version:z.number().int().positive(),
  previousVersion:z.number().int().positive().nullable(),input:UspMixedPdfPacketPlanInputSchema,creator:UspPrincipalSchema,
  accessViewId:CoreIdSchema,policyVersion:CoreIdSchema,targetBodySha256:hash,targetLabel:coreText(1024),
  entries:z.tuple([UspMixedPdfPacketPlanEntrySchema,UspMixedPdfPacketPlanEntrySchema]).readonly(),
  requiredContext:z.enum(['available','blocked']),createdAt:z.iso.datetime({offset:true}),planSha256:hash}).superRefine((plan,ctx)=>{
    if(plan.entries.some((entry,i)=>JSON.stringify(entry.selection)!==JSON.stringify(plan.input.entries[i])))
      ctx.addIssue({code:'custom',message:'Preserve the two exact ordered mixed selections.'});
  }).readonly();
const imageRegion=PacketImageRegionWorkerSchema.refine(r=>r.output.mode==='RGB'&&r.sourceImage.color.transparency==='absent'&&
  r.output.pixels[0]*r.output.pixels[1]<=PACKET_IMAGE_REGION_LIMITS.pixels,{message:'Mixed packets require a bounded RGB image crop.'});
export const PacketMixedPdfAssemblyEntrySchema=z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('pdf_page_region'),original:RegistryRegionOriginalSchema,derivative:PacketRegionWorkerSchema}),
  z.strictObject({kind:z.literal('original_image_region'),original:RegistryRegionOriginalSchema,derivative:imageRegion}),
]);
export const PacketMixedPdfAssemblyEntriesSchema=z.tuple([PacketMixedPdfAssemblyEntrySchema,PacketMixedPdfAssemblyEntrySchema]).superRefine((entries,ctx)=>{
    if(!exactlyMixed(entries.map(e=>e.kind))||entries[0].original.sourceId===entries[1].original.sourceId||
      entries.reduce((n,e)=>n+e.original.sourceBytes,0)>PACKET_MIXED_PDF_LIMITS.originalBytes||
      entries.some(e=>e.original.sourceSha256!==e.derivative.sourceSha256||e.original.sourceBytes!==e.derivative.sourceBytes||
        e.derivative.output.pixels[0]*e.derivative.output.pixels[1]>(e.kind==='pdf_page_region'?PACKET_REGION_LIMITS.pixels:PACKET_IMAGE_REGION_LIMITS.pixels)))
      ctx.addIssue({code:'custom',message:'Retain one of each crop kind, two distinct exact originals and bounded ordered pixels.'});
  });
export const PacketMixedPdfAssemblySchema=z.strictObject({version:z.literal('packet-mixed-pdf-assembly/1'),recipe:z.literal(PACKET_MIXED_PDF_RECIPE),
  entries:PacketMixedPdfAssemblyEntriesSchema,
  output:z.strictObject({sha256:hash,bytes:z.number().int().positive().max(PACKET_MIXED_PDF_LIMITS.bytes),
    contentType:z.literal('application/pdf'),pages:z.literal(2),processedPixels:z.number().int().positive().max(PACKET_MIXED_PDF_LIMITS.pixels),
    policy:z.literal(PACKET_MIXED_PDF_POLICY)})}).superRefine((assembly,ctx)=>{
    if(assembly.output.processedPixels!==assembly.entries.reduce((n,e)=>n+e.derivative.output.pixels[0]*e.derivative.output.pixels[1],0))
      ctx.addIssue({code:'custom',message:'Retain the exact cumulative rendered-pixel count.'});
  });
export const UspPacketMixedPdfReceiptSchema=z.strictObject({version:z.literal('packet-mixed-pdf/1'),packetId:z.uuid(),target,
  scope:UspSnapshotScopeSchema,format:z.literal('pdf'),artifact:UspAssetRefSchema,planId:z.uuid(),planVersion:z.number().int().positive(),
  planSha256:hash,confirmationId:z.uuid(),entries:z.tuple([
    z.strictObject({kind:PacketMixedEntryKindSchema,bindingId:hash,entrySha256:hash,outputPage:z.literal(1)}),
    z.strictObject({kind:PacketMixedEntryKindSchema,bindingId:hash,entrySha256:hash,outputPage:z.literal(2)})]).readonly(),
  assembly:PacketMixedPdfAssemblySchema,contentType:z.literal('application/pdf'),status:z.literal('complete'),
  createdAt:z.iso.datetime({offset:true}),commandSha256:hash}).superRefine((receipt,ctx)=>{
    if(receipt.entries.some((entry,i)=>entry.kind!==receipt.assembly.entries[i].kind)||receipt.entries[0].bindingId===receipt.entries[1].bindingId)
      ctx.addIssue({code:'custom',message:'Every mixed binding retains its exact kind and ordered output page.'});
  }).readonly();
export const UspMixedPdfPacketPlanExecutionSchema=z.strictObject({planId:z.uuid(),version:z.number().int().positive(),confirmationId:z.uuid(),
  packet:UspPacketMixedPdfReceiptSchema,omissions:z.array(z.never()).length(0).readonly()}).readonly();
export type MixedPdfAssemblyEntry=z.infer<typeof PacketMixedPdfAssemblyEntrySchema>;
