import {z} from 'zod';
import {DocumentAssociationSourceSchema} from './document-association';
import {DocumentLocatorSchema,DocumentPartSchema,DocumentOcrItemSchema,DocumentOcrSelectionSchema} from './usp/document-ingestion';
import {SourceFusionRequestSchema,SourceFusionOcrSchema,SourceFusionIFCRecordSchema,SourceFusionLiteralObjectSchema,SourceFusionCityGMLSchema} from './source-fusion';
import {IFC_LIMITS} from './usp/ifc-ingestion';
import {DXF_LIMITS} from './usp/dxf-ingestion';
import {KML_LIMITS,KMLMemberPinSchema,KMLSummarySchema} from './usp/kml-ingestion';
import {CITYGML_LIMITS,CityGMLSummarySchema} from './usp/citygml-ingestion';
import {GEOPARQUET_LIMITS,GeoParquetSummarySchema,GeoParquetSelectionSchema,GeoParquetContinuationPinSchema} from './usp/geoparquet-ingestion';
import {SourceFusionGeoParquetSchema} from './source-fusion-geoparquet';
import {SourceFusionRasterSchema} from './source-fusion-raster';
import {RASTER_WINDOW_LIMITS,RasterPixelWindowSchema} from './usp/raster-window';
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
/** Explicit literal building fragment only; GML IDs/types/parent pointers do
 * not assert canonical identity, floor semantics or source applicability. */
export const RegistryCityGMLCitationSchema=z.strictObject({...citationBase,version:z.literal('registry-citygml-citation/1'),
  resultBytes:z.number().int().positive().max(CITYGML_LIMITS.resultBytes),
  citygml:z.strictObject({artifactSha256:hash,artifactBytes:z.number().int().positive().max(CITYGML_LIMITS.artifactBytes),
    profile:z.literal('ulpin-native-citygml/1'),selectionSha256:hash,sourceContextSha256:hash,
    inspectionStatus:CityGMLSummarySchema.shape.status,buildingOrdinal:z.number().int().min(0).max(24999),
    elementOrdinal:z.number().int().min(0).max(24999),sourceKey:z.string().min(1).max(512),
    buildingType:z.enum(['Building','BuildingPart']),nativeId:SourceFusionLiteralObjectSchema,
    recordPointer:z.string().regex(/^\/buildings\/\d+$/),recordSha256:hash,fragmentSha256:hash,
    locator:SourceFusionLiteralObjectSchema,identifierScope:z.literal('source_native_only; not_canonical_registry_ids')})});
export const RegistryCityGMLFragmentSchema=SourceFusionCityGMLSchema.extend({buildings:SourceFusionCityGMLSchema.shape.buildings.length(1)})
  .superRefine((fragment,ctx)=>{if(fragment.coverage.selectedBuildings!==1)
    ctx.addIssue({code:'custom',message:'A citation discloses exactly one selected building fragment.'});});
/** Explicit accepted row evidence. Names, coordinates and source-local IDs do
 * not establish target applicability or canonical identity. */
export const RegistryGeoParquetCitationSchema=z.strictObject({...citationBase,version:z.literal('registry-geoparquet-citation/1'),
  resultBytes:z.number().int().positive().max(GEOPARQUET_LIMITS.resultBytes),
  geoparquet:z.strictObject({artifactSha256:hash,artifactBytes:z.number().int().positive().max(GEOPARQUET_LIMITS.artifactBytes),
    profile:z.literal('usp-native-geoparquet/1'),selectionSha256:hash,sourceContextSha256:hash,fragmentSha256:hash,
    inspectionStatus:GeoParquetSummarySchema.shape.status,window:GeoParquetSummarySchema.shape.window,
    enrolledSelection:GeoParquetSelectionSchema,continuation:GeoParquetContinuationPinSchema.nullable(),
    rowIndex:SourceFusionGeoParquetSchema.shape.rows.element.shape.rowIndex,
    ordinal:SourceFusionGeoParquetSchema.shape.rows.element.shape.ordinal,
    rowGroupIndex:SourceFusionGeoParquetSchema.shape.rows.element.shape.rowGroupIndex,
    rowIndexInGroup:SourceFusionGeoParquetSchema.shape.rows.element.shape.rowIndexInGroup,
    sourceKey:z.string().min(1).max(512),recordPointer:z.string().regex(/^\/rows\/\d+$/),recordSha256:hash,
    columnLocators:SourceFusionLiteralObjectSchema,identifierScope:z.literal('source_native_only; not_canonical_registry_ids')})});
export const RegistryGeoParquetFragmentSchema=SourceFusionGeoParquetSchema.extend({rows:SourceFusionGeoParquetSchema.shape.rows.length(1)})
  .superRefine((fragment,ctx)=>{if(fragment.coverage.selectedRows!==1)
    ctx.addIssue({code:'custom',message:'A citation discloses exactly one selected row.'});});
/** Officer-selected accepted metadata only; the artifact digest is a receipt
 * reference, never a claim that TIFF bytes/pixels or spatial matching were checked. */
export const RegistryRasterCitationSchema=z.strictObject({...citationBase,version:z.literal('registry-raster-metadata-citation/1'),
  resultBytes:z.number().int().positive().max(RASTER_WINDOW_LIMITS.resultBytes),
  raster:z.strictObject({profile:z.literal('raster-window/1'),artifactSha256:hash,
    artifactBytes:z.number().int().positive().max(RASTER_WINDOW_LIMITS.artifactBytes),
    window:RasterPixelWindowSchema,metadataSha256:hash,selectionSha256:hash,fragmentSha256:hash,
    metadataPointer:z.literal('/metadata'),coverage:SourceFusionRasterSchema.shape.coverage})});
export const RegistryRasterFragmentSchema=SourceFusionRasterSchema;
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
  RegistryNativeDocumentCitationSchema,RegistryOcrDocumentCitationSchema,RegistryIFCCitationSchema,RegistryRegionCitationSchema,RegistryDXFCitationSchema,RegistryKMLCitationSchema,RegistryCityGMLCitationSchema,RegistryGeoParquetCitationSchema,RegistryRasterCitationSchema]);
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
  if(value.addFusion&&!value.addFusion.selection.sources.some(s=>s.kind==='document'?s.partIds.length:s.kind==='document_ocr'?s.itemOrdinals.length:s.kind==='ifc'?s.stepIds.length:s.kind==='dxf'?s.entityOrdinals.length:s.kind==='kml'?s.featureOrdinals.length:s.kind==='citygml'?s.buildingOrdinals.length:s.kind==='geoparquet'?s.rowIndices.length:s.kind==='raster'))
    ctx.addIssue({code:'custom',message:'Select at least one native document, OCR observation, IFC record, DXF entity, KML feature, CityGML building, GeoParquet row or raster metadata window to cite.'});
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
    z.strictObject({pin:RegistryCityGMLCitationSchema,fragment:RegistryCityGMLFragmentSchema}),
    z.strictObject({pin:RegistryGeoParquetCitationSchema,fragment:RegistryGeoParquetFragmentSchema}),
    z.strictObject({pin:RegistryRasterCitationSchema,fragment:RegistryRasterFragmentSchema}),
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
export type RegistryCityGMLCitation=z.infer<typeof RegistryCityGMLCitationSchema>;
export type RegistryGeoParquetCitation=z.infer<typeof RegistryGeoParquetCitationSchema>;
export type RegistryRasterCitation=z.infer<typeof RegistryRasterCitationSchema>;
export type RegistryRegionCitation=z.infer<typeof RegistryRegionCitationSchema>;
export type RegistryRegionOriginal=z.infer<typeof RegistryRegionOriginalSchema>;
export type RegistryRegionAddition=z.infer<typeof RegistryRegionAdditionSchema>;
export type RegistryDocumentReviewContext=z.infer<typeof RegistryDocumentReviewContextSchema>;
export type RegistryDocumentAmendment=z.infer<typeof RegistryDocumentAmendmentSchema>;
