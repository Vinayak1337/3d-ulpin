import {z} from 'zod';
import {DocumentAssociationSourceSchema} from './document-association';
import {DocumentLocatorSchema,DocumentPartSchema,DocumentOcrItemSchema,DocumentOcrSelectionSchema} from './usp/document-ingestion';
import {SourceFusionRequestSchema,SourceFusionOcrSchema,SourceFusionIFCRecordSchema,SourceFusionLiteralObjectSchema} from './source-fusion';
import {IFC_LIMITS} from './usp/ifc-ingestion';
import {DXF_LIMITS} from './usp/dxf-ingestion';
import {KML_LIMITS,KMLMemberPinSchema,KMLSummarySchema} from './usp/kml-ingestion';
import {PacketRegionSelectionSchema,PacketRegionPageSchema,PacketRegionWorkerSchema,PACKET_REGION_LIMITS} from './packet-region';

const hash=z.string().regex(/^[a-f0-9]{64}$/),revision=z.number().int().positive();
const citationBase={id:hash,document:DocumentAssociationSourceSchema,
  inputSha256:hash,readerSha256:hash,acceptedFence:revision,
  target:z.strictObject({recordId:z.uuid(),revision,bodySha256:hash}),
  selection:z.strictObject({subject:z.string().min(1).max(256),accessSha256:hash,selectedAt:z.iso.datetime()}),
  associationState:z.literal('operator_selected'),qualification:z.literal('not_assessed'),
};
export const RegistryNativeDocumentCitationSchema=z.strictObject({...citationBase,
  version:z.literal('registry-document-citation/1'),partId:z.uuid(),partSha256:hash,locator:DocumentLocatorSchema});
export const RegistryOcrDocumentCitationSchema=z.strictObject({...citationBase,
  version:z.literal('registry-document-ocr-citation/1'),resultBytes:z.number().int().positive().max(4*1024*1024),
  ocrSelection:DocumentOcrSelectionSchema,ocrConfigSha256:hash,
  itemOrdinal:z.number().int().min(0).max(63),itemSha256:hash,
  itemLocator:DocumentOcrItemSchema.omit({text:true}),ocr:SourceFusionOcrSchema.shape.ocr.unwrap()});
/** The historical `document` envelope identifies the actual IFC original/job,
 * solely for common source-case collection. No document input/part is created. */
export const RegistryIFCCitationSchema=z.strictObject({...citationBase,version:z.literal('registry-ifc-citation/1'),
  /** Explicit officer confirmation, never implied by ordinary attachment. All
   * source/artifact/STEP/target pins are inherited from this exact citation. */
  identityAssertion:z.strictObject({globalId:z.string().regex(/^[0-3][0-9A-Za-z_$]{21}$/),
    attributeSha256:hash,attributeLocator:SourceFusionLiteralObjectSchema,
    subject:z.string().min(1).max(256),accessSha256:hash,confirmedAt:z.iso.datetime()}).optional(),
  resultBytes:z.number().int().positive().max(IFC_LIMITS.resultBytes),
  ifc:z.strictObject({artifactSha256:hash,artifactBytes:z.number().int().positive().max(IFC_LIMITS.artifactBytes),
    profile:z.literal('ulpin-native-ifc/1'),stepId:z.number().int().positive(),
    entityType:z.enum(['IfcBuilding','IfcBuildingStorey','IfcSpace']),recordPointer:z.string().regex(/^\/records\/\d+$/),
    recordSha256:hash,locator:SourceFusionLiteralObjectSchema,attributeLocators:SourceFusionLiteralObjectSchema,
    identifierScope:z.literal('source_native_only; not_canonical_registry_ids')})});
/** Exact officer-selected source entity. The common document envelope names
 * the DXF original/job only; it does not create a document part or native ID. */
export const RegistryDXFCitationSchema=z.strictObject({...citationBase,version:z.literal('registry-dxf-citation/1'),
  resultBytes:z.number().int().positive().max(DXF_LIMITS.resultBytes),
  dxf:z.strictObject({artifactSha256:hash,artifactBytes:z.number().int().positive().max(DXF_LIMITS.artifactBytes),
    profile:z.literal('dxf-native-inspection/1'),selectionSha256:hash,
    entityOrdinal:z.number().int().min(0).max(9999),entityType:z.string().min(1).max(128),
    handle:SourceFusionLiteralObjectSchema,recordPointer:z.string().regex(/^\/entities\/\d+$/),recordSha256:hash,
    locator:SourceFusionLiteralObjectSchema,identifierScope:z.literal('source_native_only; not_canonical_registry_ids')})});
/** Explicit feature evidence; KML membership/names/IDs do not assert identity. */
export const RegistryKMLCitationSchema=z.strictObject({...citationBase,version:z.literal('registry-kml-citation/1'),
  resultBytes:z.number().int().positive().max(KML_LIMITS.resultBytes),
  kml:z.strictObject({artifactSha256:hash,artifactBytes:z.number().int().positive().max(KML_LIMITS.artifactBytes),
    profile:z.literal('kml-native-inspection/1'),selectionSha256:hash,container:KMLSummarySchema.shape.container,
    member:KMLMemberPinSchema.nullable(),xmlSha256:hash,inspectionStatus:z.enum(['inspected','partial']),
    documentProfile:z.enum(['kml_2_2','unnamespaced_feature_fragment']),horizontalReference:KMLSummarySchema.shape.horizontalReference,
    featureOrdinal:z.number().int().min(0).max(9999),featureType:z.string().min(1).max(128),sourceId:SourceFusionLiteralObjectSchema,
    recordPointer:z.string().regex(/^\/features\/\d+$/),recordSha256:hash,locator:SourceFusionLiteralObjectSchema,
    identifierScope:z.literal('source_native_only; not_canonical_registry_ids')})});
/** Source-original selection: no extraction job/result/input/fence is implied. */
export const RegistryRegionOriginalSchema=z.strictObject({caseId:z.uuid(),caseRevision:z.number().int().nonnegative(),
  sourceId:z.uuid(),sourceRevision:revision,sourceSha256:hash,
  sourceBytes:z.number().int().positive().max(PACKET_REGION_LIMITS.sourceBytes)});
export const RegistryRegionAdditionSchema=z.strictObject({document:RegistryRegionOriginalSchema,
  page:PacketRegionPageSchema,region:PacketRegionSelectionSchema,purpose:z.literal('record_evidence')});
export const RegistryRegionCitationSchema=z.strictObject({
  version:z.literal('registry-document-region-citation/1'),id:hash,document:RegistryRegionOriginalSchema,
  page:PacketRegionPageSchema,region:PacketRegionSelectionSchema,purpose:z.literal('record_evidence'),
  target:citationBase.target,selection:citationBase.selection,authoritySha256:hash,
  validation:PacketRegionWorkerSchema,
  applicability:z.literal('explicit_officer_inclusion; effective_after_canonical_commit'),
  associationState:z.literal('operator_selected'),qualification:z.literal('not_assessed'),
});
export const RegistryDocumentCitationSchema=z.discriminatedUnion('version',[
  RegistryNativeDocumentCitationSchema,RegistryOcrDocumentCitationSchema,RegistryIFCCitationSchema,RegistryRegionCitationSchema,RegistryDXFCitationSchema,RegistryKMLCitationSchema]);
export const RegistryDocumentCitationsSchema=z.array(RegistryDocumentCitationSchema).max(25)
  .superRefine((items,ctx)=>{
    if(new Set(items.map(item=>item.id)).size!==items.length)
      ctx.addIssue({code:'custom',message:'Each exact citation may be attached once.'});
  });
export const RegistryDocumentAmendmentSchema=z.strictObject({requestKey:z.uuid(),expectedDraftRevision:revision,
  recordId:z.uuid(),expectedRecordRevision:revision,
  add:z.strictObject({document:DocumentAssociationSourceSchema,partIds:z.array(z.uuid()).min(1).max(25)}).optional(),
  addFusion:z.strictObject({contextSha256:hash,selection:SourceFusionRequestSchema}).optional(),
  addRegion:RegistryRegionAdditionSchema.optional(),
  assertIFCIdentity:hash.optional(),
  remove:z.array(hash).max(25).default([]),
  clearAll:z.literal(true).optional(),
}).superRefine((value,ctx)=>{
  if(!value.add&&!value.addFusion&&!value.addRegion&&!value.assertIFCIdentity&&!value.remove.length&&!value.clearAll)ctx.addIssue({code:'custom',message:'Select citations to add, confirm IFC identity, remove or explicitly clear.'});
  if(value.assertIFCIdentity&&(value.add||value.addFusion||value.addRegion||value.remove.length||value.clearAll))
    ctx.addIssue({code:'custom',message:'Confirm one existing exact IFC citation as a separate amendment. Withdraw it by removing the citation.'});
  if([value.add,value.addFusion,value.addRegion].filter(Boolean).length>1)ctx.addIssue({code:'custom',message:'Use one explicit addition per amendment.'});
  if(value.addFusion&&!value.addFusion.selection.sources.some(s=>s.kind==='document'?s.partIds.length:s.kind==='document_ocr'?s.itemOrdinals.length:s.kind==='ifc'?s.stepIds.length:s.kind==='dxf'?s.entityOrdinals.length:s.kind==='kml'?s.featureOrdinals.length:false))
    ctx.addIssue({code:'custom',message:'Select at least one native document, OCR observation, IFC record, DXF entity or KML feature to cite.'});
  if(value.clearAll&&(value.add||value.addFusion||value.addRegion||value.remove.length))
    ctx.addIssue({code:'custom',message:'Clear all citations as a separate amendment.'});
  if(value.add && new Set(value.add.partIds).size!==value.add.partIds.length)
    ctx.addIssue({code:'custom',message:'Select each native part once.'});
  if(new Set(value.remove).size!==value.remove.length)
    ctx.addIssue({code:'custom',message:'Remove each citation once.'});
});
export const RegistryDocumentEvidenceSchema=z.strictObject({draftId:z.uuid(),draftRevision:revision,
  recordId:z.uuid(),recordRevision:revision,
  citations:z.array(z.union([z.strictObject({pin:RegistryNativeDocumentCitationSchema,part:DocumentPartSchema}),
    z.strictObject({pin:RegistryOcrDocumentCitationSchema,item:DocumentOcrItemSchema}),
    z.strictObject({pin:RegistryIFCCitationSchema,record:SourceFusionIFCRecordSchema}),
    z.strictObject({pin:RegistryDXFCitationSchema,entity:SourceFusionLiteralObjectSchema}),
    z.strictObject({pin:RegistryKMLCitationSchema,feature:SourceFusionLiteralObjectSchema}),
    z.strictObject({pin:RegistryRegionCitationSchema})])).max(25),
  associationState:z.literal('operator_selected'),qualification:z.literal('not_assessed'),
});
export const RegistryDocumentAmendmentReceiptSchema=z.strictObject({draftId:z.uuid(),draftRevision:revision,
  recordId:z.uuid(),recordRevision:revision,changed:z.boolean()});
export const RegistryDocumentReviewContextSchema=z.strictObject({subject:z.string().min(1).max(256),
  accessViewId:z.string().min(1).max(256),policyVersion:z.string().min(1).max(256),
  entitlementVersion:z.string().min(1).max(256)});
export type RegistryDocumentCitation=z.infer<typeof RegistryDocumentCitationSchema>;
export type RegistryNativeDocumentCitation=z.infer<typeof RegistryNativeDocumentCitationSchema>;
export type RegistryOcrDocumentCitation=z.infer<typeof RegistryOcrDocumentCitationSchema>;
export type RegistryIFCCitation=z.infer<typeof RegistryIFCCitationSchema>;
export type RegistryDXFCitation=z.infer<typeof RegistryDXFCitationSchema>;
export type RegistryKMLCitation=z.infer<typeof RegistryKMLCitationSchema>;
export type RegistryRegionCitation=z.infer<typeof RegistryRegionCitationSchema>;
export type RegistryRegionOriginal=z.infer<typeof RegistryRegionOriginalSchema>;
export type RegistryRegionAddition=z.infer<typeof RegistryRegionAdditionSchema>;
export type RegistryDocumentReviewContext=z.infer<typeof RegistryDocumentReviewContextSchema>;
export type RegistryDocumentAmendment=z.infer<typeof RegistryDocumentAmendmentSchema>;
