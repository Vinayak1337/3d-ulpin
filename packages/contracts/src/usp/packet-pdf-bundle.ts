import {z} from 'zod';
import {UspSnapshotScopeSchema,UspTargetPinSchema} from './common';
import {PacketRegionWorkerSchema,PACKET_REGION_LIMITS} from '../packet-region';
import {PACKET_PDF_RECIPE,PACKET_PDF_MULTI_RECIPE,PACKET_PDF_ORIGINALS_RECIPE,PACKET_PDF_LIMITS,PACKET_PDF_MULTI_LIMITS} from './packet-pdf';
import {PACKET_IMAGE_REGION_LIMITS} from '../packet-image-region';
import {PACKET_IMAGE_PDF_RECIPE,PACKET_IMAGE_PDF_LIMITS,PACKET_IMAGE_PDF_POLICY,PacketImagePdfAssemblySchema} from './packet-image-pdf';

export const PACKET_PDF_BUNDLE_LIMITS=Object.freeze({manifestBytes:64*1024,archiveBytes:34*1024**2,seconds:30});
const hash=z.string().regex(/^[a-f0-9]{64}$/);
/** Explicit safe projections only: no raw plan, actor, database body or object key. */
export const PacketPdfBundleManifestSchema=z.strictObject({
  version:z.literal('packet-pdf-bundle-manifest/1'),representation:z.literal('private_accepted_packet_download'),
  packet:z.strictObject({packetId:z.uuid(),receiptVersion:z.enum(['packet-pdf/1','packet-pdf/2','packet-pdf/3']),
    receiptSha256:hash,createdAt:z.iso.datetime({offset:true}),
    target:UspTargetPinSchema,scope:UspSnapshotScopeSchema,
    plan:z.strictObject({planId:z.uuid(),version:z.number().int().positive(),sha256:hash}),
    confirmationId:z.uuid(),targetBodySha256:hash,
    recipe:z.enum([PACKET_PDF_RECIPE,PACKET_PDF_MULTI_RECIPE,PACKET_PDF_ORIGINALS_RECIPE])}),
  pdf:z.strictObject({filename:z.literal('packet.pdf'),sha256:hash,
    bytes:z.number().int().positive().max(PACKET_PDF_MULTI_LIMITS.bytes),
    pages:z.number().int().min(1).max(4),contentType:z.literal('application/pdf'),
    policy:z.literal('fresh_rgb_image_only; no_source_pdf_objects/1')}),
  entries:z.array(z.strictObject({outputPage:z.number().int().min(1).max(4),required:z.literal(true),
    bindingId:hash,entrySha256:hash,applicabilitySha256:hash.nullable(),
    associationState:z.literal('operator_selected'),qualification:z.literal('not_assessed'),
    source:z.strictObject({sha256:hash,revision:z.number().int().positive(),
      bytes:z.number().int().positive().max(PACKET_REGION_LIMITS.sourceBytes)}),
    derivative:PacketRegionWorkerSchema})).min(1).max(4),
  qualification:z.strictObject({documentRole:z.literal('generated_compilation'),
    certifiedOriginal:z.literal(false),titleDetermination:z.literal('unsupported'),officialIssuance:z.literal('unsupported'),
    propertyMatching:z.literal('not_assessed'),geometry:z.literal('not_assessed'),
    sourcePermissions:z.literal('not_assessed'),learning:z.literal('not_assessed')}),
}).superRefine((v,ctx)=>{
  if(v.packet.target.ref.namespace!=='registry_record'||v.packet.target.revision<1||
    v.pdf.pages!==v.entries.length||new Set(v.entries.map(e=>e.bindingId)).size!==v.entries.length||
    v.entries.some((e,i)=>e.outputPage!==i+1||e.source.sha256!==e.derivative.sourceSha256||e.source.bytes!==e.derivative.sourceBytes)||
    (v.packet.receiptVersion==='packet-pdf/1'&&(v.entries.length!==1||v.pdf.bytes>PACKET_PDF_LIMITS.bytes||v.packet.recipe!==PACKET_PDF_RECIPE))||
    (v.packet.receiptVersion!=='packet-pdf/1'&&v.entries.length<2)||
    (v.packet.receiptVersion==='packet-pdf/2'&&v.packet.recipe!==PACKET_PDF_MULTI_RECIPE)||
    (v.packet.receiptVersion==='packet-pdf/3'&&v.packet.recipe!==PACKET_PDF_ORIGINALS_RECIPE))
    ctx.addIssue({code:'custom',message:'Retain the exact supported PDF recipe and ordered source/derivative provenance.'});
});
export type PacketPdfBundleManifest=z.infer<typeof PacketPdfBundleManifestSchema>;

/** Image originals retain their own selection/runtime/transform vocabulary;
 * no PDF source page, renderer or job pin is implied. */
export const PacketImagePdfBundleManifestSchema=z.strictObject({
  version:z.literal('packet-image-pdf-bundle-manifest/1'),representation:z.literal('private_accepted_packet_download'),
  packet:PacketPdfBundleManifestSchema.shape.packet.omit({receiptVersion:true,recipe:true}).extend({
    receiptVersion:z.literal('packet-image-pdf/1'),recipe:z.literal(PACKET_IMAGE_PDF_RECIPE)}),
  pdf:z.strictObject({filename:z.literal('packet.pdf'),sha256:hash,
    bytes:z.number().int().positive().max(PACKET_IMAGE_PDF_LIMITS.bytes),pages:z.literal(1),
    contentType:z.literal('application/pdf'),policy:z.literal(PACKET_IMAGE_PDF_POLICY)}),
  entries:z.tuple([z.strictObject({outputPage:z.literal(1),required:z.literal(true),
    bindingId:hash,entrySha256:hash,applicabilitySha256:hash.nullable(),
    associationState:z.literal('operator_selected'),qualification:z.literal('not_assessed'),
    applicability:z.literal('explicit_officer_inclusion; effective_after_canonical_commit'),
    source:z.strictObject({sha256:hash,revision:z.number().int().positive(),
      bytes:z.number().int().positive().max(PACKET_IMAGE_REGION_LIMITS.originalBytes)}),
    locator:z.strictObject({kind:z.literal('original_image'),frame:z.literal(0)}),calibration:z.null(),
    derivative:PacketImagePdfAssemblySchema.shape.region})]),
  qualification:PacketPdfBundleManifestSchema.shape.qualification,
}).superRefine((v,ctx)=>{
  const entry=v.entries[0];
  if(v.packet.target.ref.namespace!=='registry_record'||v.packet.target.revision<1||
    entry.source.sha256!==entry.derivative.sourceSha256||entry.source.bytes!==entry.derivative.sourceBytes)
    ctx.addIssue({code:'custom',message:'Retain the exact image source and accepted derivative provenance.'});
});
export const UspAnyPacketPdfBundleManifestSchema=z.discriminatedUnion('version',[
  PacketPdfBundleManifestSchema,PacketImagePdfBundleManifestSchema]);
export type PacketImagePdfBundleManifest=z.infer<typeof PacketImagePdfBundleManifestSchema>;
