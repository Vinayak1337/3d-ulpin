import {z} from 'zod';
import {DocumentAssociationSourceSchema} from './document-association';
import {DocumentPartSchema,DocumentFormatSchema,DocumentOcrItemSchema,DocumentOcrSelectionSchema,DocumentStatusSchema} from './usp/document-ingestion';
import {IFCSummarySchema,IFC_LIMITS} from './usp/ifc-ingestion';
import {DXFSummarySchema,DXF_LIMITS} from './usp/dxf-ingestion';
import {KMLSummarySchema,KML_LIMITS} from './usp/kml-ingestion';
import {CityGMLSummarySchema,CITYGML_LIMITS} from './usp/citygml-ingestion';

export const SOURCE_FUSION_VERSION='source-fusion-context/1' as const;
export const SOURCE_FUSION_LIMITS=Object.freeze({sources:8,selections:25,requestBytes:64*1024,
  responseBytes:1024*1024,aggregateArtifactBytes:64*1024*1024,deadlineMs:30_000});
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const id=z.uuid().transform(value=>value.toLowerCase());
export type SourceFusionJsonValue=string|number|boolean|null|SourceFusionJsonValue[]|{[key:string]:SourceFusionJsonValue};
/** Validate without rebuilding records: z.json()/z.record() deliberately omit
 * own __proto__ keys. Inspect data descriptors only; never invoke accessors or
 * assign dynamic keys, so literal JSON stays intact without prototype writes. */
function literalJson(value:unknown):boolean{
  const stack=[{value,depth:0}];let count=0;
  while(stack.length){
    const {value,depth}=stack.pop()!;
    if(++count>2_000_000)return false;
    if(value===null||typeof value==='string'||typeof value==='boolean')continue;
    if(typeof value==='number'){if(!Number.isFinite(value))return false;continue;}
    if(typeof value!=='object'||depth>=64)return false;
    const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);
    if(array?prototype!==Array.prototype:prototype!==Object.prototype&&prototype!==null)return false;
    const keys=Reflect.ownKeys(value);
    if(keys.length-(array?1:0)+count+stack.length>2_000_000)return false;
    // JSON arrays are dense, with no extra properties silently lost on the wire.
    if(array&&keys.length!==value.length+1)return false;
    for(const key of keys){
      if(array&&key==='length')continue;
      if(typeof key!=='string')return false;
      if(array&&(!/^(0|[1-9]\d*)$/.test(key)||Number(key)>=value.length))return false;
      const descriptor=Object.getOwnPropertyDescriptor(value,key)!;
      if(!descriptor.enumerable||!Object.hasOwn(descriptor,'value'))return false;
      stack.push({value:descriptor.value,depth:depth+1});
    }
  }
  return true;
}
const literalDescription='Literal finite JSON; all own keys retained, including __proto__; depth <=64 and values <=2000000; no accessors or non-JSON values';
// OpenAPI's JSON wire universe is recursive implicitly: unconstrained array
// items/object values can be any JSON value. Runtime checks apply at every depth.
export const SourceFusionLiteralJsonSchema=z.custom<SourceFusionJsonValue>(literalJson,'A bounded literal JSON value is required.')
  .meta({description:literalDescription,anyOf:[{type:'string'},{type:'number'},{type:'boolean'},
    {type:'string',nullable:true,enum:[null]},{type:'array',items:{}},{type:'object',additionalProperties:true}]});
export const SourceFusionLiteralObjectSchema=z.custom<Record<string,SourceFusionJsonValue>>(
  value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&literalJson(value),'A bounded literal JSON object is required.')
  .meta({description:literalDescription,type:'object',additionalProperties:true});
export const SourceFusionPinSchema=DocumentAssociationSourceSchema.extend({caseId:id,sourceId:id,jobId:id,readerSha256:hash,inputSha256:hash,
  acceptedFence:z.number().int().positive(),resultBytes:z.number().int().positive().max(4*1024*1024)});
export const SourceFusionSelectionSchema=z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('document'),pin:SourceFusionPinSchema,partIds:z.array(id).max(25)}),
  z.strictObject({kind:z.literal('cityjson'),pin:SourceFusionPinSchema,
    objectIds:z.array(z.string().min(1).max(512)).min(1).max(25)}),
  z.strictObject({kind:z.literal('document_ocr'),pin:SourceFusionPinSchema,
    itemOrdinals:z.array(z.number().int().min(0).max(63)).max(25)}),
  z.strictObject({kind:z.literal('ifc'),pin:SourceFusionPinSchema,
    stepIds:z.array(z.number().int().positive()).min(1).max(25)}),
  z.strictObject({kind:z.literal('dxf'),pin:SourceFusionPinSchema,
    entityOrdinals:z.array(z.number().int().min(0).max(9999)).min(1).max(25)}),
  z.strictObject({kind:z.literal('kml'),pin:SourceFusionPinSchema,
    featureOrdinals:z.array(z.number().int().min(0).max(9999)).min(1).max(25)}),
  z.strictObject({kind:z.literal('citygml'),pin:SourceFusionPinSchema,
    buildingOrdinals:z.array(z.number().int().min(0).max(24999)).min(1).max(25)})]);
export const SourceFusionRequestSchema=z.strictObject({sources:z.array(SourceFusionSelectionSchema).min(2).max(8)})
  .superRefine((value,ctx)=>{
    const keys=value.sources.map(s=>s.pin.sourceId.toLowerCase());
    if(new Set(keys).size!==keys.length)ctx.addIssue({code:'custom',message:'Select each source once.'});
    let count=0;
    for(const source of value.sources){
      const ids=source.kind==='document'?source.partIds:source.kind==='cityjson'?source.objectIds:
        source.kind==='ifc'?source.stepIds:source.kind==='dxf'?source.entityOrdinals:
          source.kind==='kml'?source.featureOrdinals:source.kind==='citygml'?source.buildingOrdinals:source.itemOrdinals;count+=ids.length;
      const uniqueIds=source.kind==='document'?source.partIds.map(id=>id.toLowerCase()):ids;
      if(new Set<string|number>(uniqueIds).size!==ids.length)
        ctx.addIssue({code:'custom',message:'Select each native part, OCR ordinal, object, IFC STEP ID, DXF entity, KML feature or CityGML building ordinal once.'});
      if(source.kind==='cityjson'&&source.pin.resultBytes>16*1024)
        ctx.addIssue({code:'custom',message:'CityJSON result receipts have a 16 KiB profile.'});
      if(source.kind==='ifc'&&source.pin.resultBytes>IFC_LIMITS.resultBytes)
        ctx.addIssue({code:'custom',message:'IFC result receipts have a 16 KiB profile.'});
      if(source.kind==='dxf'&&source.pin.resultBytes>DXF_LIMITS.resultBytes)
        ctx.addIssue({code:'custom',message:'DXF result receipts have a 16 KiB profile.'});
      if(source.kind==='kml'&&source.pin.resultBytes>KML_LIMITS.resultBytes)
        ctx.addIssue({code:'custom',message:'KML result receipts have a 512 KiB profile.'});
      if(source.kind==='citygml'&&source.pin.resultBytes>CITYGML_LIMITS.resultBytes)
        ctx.addIssue({code:'custom',message:'CityGML result receipts have a 512 KiB profile.'});
    }
    if(count>25)ctx.addIssue({code:'custom',message:'Select at most 25 native parts/objects total.'});
  });
const declaration=z.discriminatedUnion('state',[
  z.strictObject({state:z.literal('absent')}),
  z.strictObject({state:z.literal('declared'),value:SourceFusionLiteralJsonSchema})]);
const base={pin:SourceFusionPinSchema,namespace:z.string(),sourceSetRole:z.literal('operator_selected_fragment')};
export const SourceFusionDocumentSchema=z.strictObject({...base,kind:z.literal('document'),
  format:DocumentFormatSchema,nativeStatus:z.enum(['extracted','needs_ocr','unsupported','encrypted','tool_error']),
  code:z.string().nullable(),warnings:z.array(z.string().max(512)).max(100),
  capability:z.enum(['selected_native_text','selection_required','native_incomplete']),
  coverage:z.strictObject({selectedParts:z.number().int().nonnegative(),availableNativeParts:z.number().int().nonnegative(),
    scope:z.literal('explicit_selection_only'),assistedExtraction:z.literal('outside_profile')}),
  parts:z.array(z.strictObject({key:z.string(),part:DocumentPartSchema,
    textState:z.enum(['native_derivative','redacted_native_derivative'])})).max(25)});
export const SourceFusionCityJSONSchema=z.strictObject({...base,kind:z.literal('cityjson'),
  nativeStatus:z.enum(['supported','partial_unsupported']),artifactSha256:hash,
  reference:z.strictObject({frame:SourceFusionLiteralObjectSchema,metadata:declaration,transform:declaration}),
  objects:z.array(z.strictObject({key:z.string(),id:z.string(),pointer:z.string(),type:z.string(),geometryState:z.enum(['present','absent']),
    attributes:declaration,parents:declaration,children:declaration,
    geometries:z.array(z.strictObject({pointer:z.string(),type:z.string(),status:z.string(),lod:declaration})).max(1000)})).max(25),
  coverage:z.strictObject({selectedObjects:z.number().int().nonnegative(),availableNativeObjects:z.number().int().nonnegative(),
    scope:z.literal('explicit_selection_only'),geometryArrays:z.literal('omitted; exact artifact references retained')}),
  hierarchyIssues:z.array(SourceFusionLiteralJsonSchema).max(1000)});
export const SourceFusionOcrSchema=z.strictObject({...base,kind:z.literal('document_ocr'),
  format:DocumentFormatSchema,nativeStatus:SourceFusionDocumentSchema.shape.nativeStatus,
  nativeCode:SourceFusionDocumentSchema.shape.code,nativeWarnings:SourceFusionDocumentSchema.shape.warnings,
  ocrInput:z.strictObject({selection:DocumentOcrSelectionSchema.nullable(),configSha256:hash.nullable()}),
  ocr:DocumentStatusSchema.shape.ocr.unwrap(),
  capability:z.enum(['selected_ocr_observations','selection_required','ocr_unavailable']),
  gap:z.enum(['none','selection_required','ocr_missing','ocr_failed','ocr_unavailable','ocr_empty']),
  coverage:z.strictObject({selectedItems:z.number().int().nonnegative().max(25),availableItems:z.number().int().nonnegative().max(64),
    storedItems:z.number().int().nonnegative().max(64),scope:z.literal('explicit_selection_only'),nativeExtraction:z.literal('separate')}),
  itemHashBasis:z.literal('accepted_result_pin_item_ordinal_and_literal_observation'),
  observations:z.array(z.strictObject({key:z.string(),ordinal:z.number().int().min(0).max(63),itemSha256:hash,item:DocumentOcrItemSchema})).max(25)});
/** Exact metadata records from the accepted native artifact, including attribute
 * states, raw literals and original byte spans. STEP IDs/GlobalIds are not registry IDs. */
export const SourceFusionIFCRecordSchema=z.strictObject({stepId:z.number().int().positive(),entityType:z.string().min(1).max(128),
  locator:SourceFusionLiteralObjectSchema,attributes:SourceFusionLiteralObjectSchema});
const ifcRecordReference=z.strictObject({pointer:z.string(),record:SourceFusionIFCRecordSchema});
export const SourceFusionIFCMetadataSchema=z.strictObject({summary:IFCSummarySchema,artifactSha256:hash,
  artifactBytes:z.number().int().positive().max(IFC_LIMITS.artifactBytes),
  nativeIdentifierScope:z.literal('source_native_only; not_canonical_registry_ids'),
  source:SourceFusionLiteralObjectSchema,parser:SourceFusionLiteralObjectSchema,
  entities:z.array(ifcRecordReference).min(1).max(25),relations:z.array(ifcRecordReference).max(10000),
  supportRecords:z.array(ifcRecordReference).max(10000),
  reference:z.strictObject({projectUnits:z.array(SourceFusionLiteralJsonSchema).max(10000),
    georeference:SourceFusionLiteralObjectSchema,semantics:SourceFusionLiteralObjectSchema}),
  findings:z.array(SourceFusionLiteralJsonSchema).max(10000),
  hierarchy:z.array(z.strictObject({stepId:z.number().int().positive(),
    parentState:z.enum(['missing','supplied','multiple_parents']),parentStepIds:z.array(z.number().int().positive()).max(10000),
    relationStepIds:z.array(z.number().int().positive()).max(10000)})).max(25),
  coverage:z.strictObject({selectedEntities:z.number().int().positive().max(25),availableNativeEntities:z.number().int().nonnegative().max(10000),
    scope:z.literal('explicit_entities; incident_relation_literals; referenced_placements; source_units_and_reference_metadata'),
    unselectedEntityMetadata:z.literal('not_expanded'),geometry:z.literal('unsupported'),
    hierarchyQualification:z.literal('source_edges_only; not_canonical_relationships')})});
export const SourceFusionIFCSchema=SourceFusionIFCMetadataSchema.extend({...base,kind:z.literal('ifc')});
/** Literal native records only. Handles, layer names, coordinates and drawing
 * text remain source-local observations, never application property identifiers. */
export const SourceFusionDXFMetadataSchema=z.strictObject({summary:DXFSummarySchema,artifactSha256:hash,
  artifactBytes:z.number().int().positive().max(DXF_LIMITS.artifactBytes),selectionSha256:hash,
  selectionHashBasis:z.literal('accepted_artifact_source_and_sorted_entity_ordinals'),
  nativeIdentifierScope:z.literal('source_native_only; not_canonical_registry_ids'),
  parser:SourceFusionLiteralObjectSchema,
  entities:z.array(z.strictObject({ordinal:z.number().int().min(0).max(9999),pointer:z.string(),recordSha256:hash,
    record:SourceFusionLiteralObjectSchema})).min(1).max(25),
  reference:z.strictObject({encoding:SourceFusionLiteralObjectSchema,units:SourceFusionLiteralObjectSchema,
    headerVariables:SourceFusionLiteralObjectSchema,layers:z.array(SourceFusionLiteralObjectSchema).max(10000),
    blocks:z.array(SourceFusionLiteralObjectSchema).max(10000)}),
  findings:z.array(SourceFusionLiteralJsonSchema).max(10000),qualification:SourceFusionLiteralObjectSchema,
  limitations:z.array(z.string().max(1000)).max(100),
  coverage:z.strictObject({selectedEntities:z.number().int().positive().max(25),availableNativeEntities:z.number().int().nonnegative().max(10000),
    scope:z.literal('explicit_entity_records; source_reference_metadata; referenced_block_definitions_only'),
    unselectedEntities:z.literal('not_expanded'),blockExpansion:z.literal('not_performed'),
    geometryQualification:z.literal('not_assessed'),propertyMatching:z.literal('unsupported')})});
export const SourceFusionDXFSchema=SourceFusionDXFMetadataSchema.extend({...base,kind:z.literal('dxf')});
/** Exact source-native feature records; specification defaults remain separate
 * from declarations. Coordinate/reference data never establish property identity. */
export const SourceFusionKMLMetadataSchema=z.strictObject({summary:KMLSummarySchema,artifactSha256:hash,
  artifactBytes:z.number().int().positive().max(KML_LIMITS.artifactBytes),selectionSha256:hash,
  selectionHashBasis:z.literal('original_member_xml_artifact_and_sorted_feature_ordinals'),
  nativeIdentifierScope:z.literal('source_native_only; not_canonical_registry_ids'),
  document:SourceFusionLiteralObjectSchema,memberInventory:z.array(SourceFusionLiteralObjectSchema).max(256),
  features:z.array(z.strictObject({ordinal:z.number().int().min(0).max(9999),pointer:z.string(),recordSha256:hash,
    record:SourceFusionLiteralObjectSchema})).min(1).max(25),
  findings:z.strictObject({unsupported:z.array(SourceFusionLiteralJsonSchema).max(100000),
    references:z.array(SourceFusionLiteralJsonSchema).max(100000)}),qualification:SourceFusionLiteralObjectSchema,
  coverage:z.strictObject({selectedFeatures:z.number().int().positive().max(25),availableNativeFeatures:z.number().int().nonnegative().max(10000),
    scope:z.literal('explicit_feature_records; source_document_member_metadata_and_findings'),
    unselectedFeatures:z.literal('not_expanded'),referenceResolution:z.literal('not_performed'),
    geometryQualification:z.literal('not_assessed'),propertyMatching:z.literal('unsupported')})});
export const SourceFusionKMLSchema=SourceFusionKMLMetadataSchema.extend({...base,kind:z.literal('kml')});
const citygmlLiterals=z.strictObject({elements:z.array(SourceFusionLiteralObjectSchema).max(25000),
  coordinates:z.array(SourceFusionLiteralObjectSchema).max(25000),
  identifiers:z.array(SourceFusionLiteralObjectSchema).max(25000),references:z.array(SourceFusionLiteralObjectSchema).max(25000)});
/** Literal XML inventory scoped to selected native buildings. Unselected
 * building subtrees and link targets are never expanded or made registry identities. */
export const SourceFusionCityGMLSchema=z.strictObject({...base,kind:z.literal('citygml'),summary:CityGMLSummarySchema,
  artifactSha256:hash,artifactBytes:z.number().int().positive().max(CITYGML_LIMITS.artifactBytes),selectionSha256:hash,
  selectionHashBasis:z.literal('accepted_source_result_input_reader_fence_artifact_and_sorted_building_ordinals'),
  nativeIdentifierScope:z.literal('source_native_only; not_canonical_registry_ids'),
  source:SourceFusionLiteralObjectSchema,parser:SourceFusionLiteralObjectSchema,
  namespaces:z.array(SourceFusionLiteralObjectSchema).max(25000),sourceContext:citygmlLiterals,
  buildings:z.array(citygmlLiterals.extend({ordinal:z.number().int().min(0).max(24999),key:z.string(),pointer:z.string(),
    record:SourceFusionLiteralObjectSchema,recordSha256:hash,fragmentSha256:hash})).min(1).max(25),
  findings:z.array(SourceFusionLiteralObjectSchema).max(4),semantics:SourceFusionLiteralObjectSchema,
  coverage:z.strictObject({selectedBuildings:z.number().int().positive().max(25),availableNativeBuildings:z.number().int().nonnegative().max(25000),
    scope:z.literal('selected_building_literal_subtrees_and_separate_nonbuilding_source_context'),
    unselectedBuildings:z.literal('not_expanded'),opaqueContent:z.literal('literal_only'),
    referenceResolution:z.literal('not_performed'),geometryQualification:z.literal('not_assessed'),propertyMatching:z.literal('unsupported')})});
export const SourceFusionContextSchema=z.strictObject({version:z.literal(SOURCE_FUSION_VERSION),contextSha256:hash,
  sources:z.array(z.union([SourceFusionDocumentSchema,SourceFusionCityJSONSchema,SourceFusionOcrSchema,SourceFusionIFCSchema,SourceFusionDXFSchema,SourceFusionKMLSchema,SourceFusionCityGMLSchema])).min(2).max(8),
  association:z.strictObject({state:z.literal('not_assessed'),membership:z.literal('operator_selection'),
    reason:z.literal('source_set_membership_does_not_establish_relationships'),
    canonicalTargets:z.array(z.never()).max(0),crossSourceFrameAlignment:z.literal('not_assessed'),
    conflicts:z.literal('literal_values_retained_per_source; not_reconciled')}),
  capabilities:z.strictObject({contextAssembly:z.literal('available'),matching:z.literal('not_assessed'),
    recordedBuildingRequired:z.literal(false),geometryQualification:z.literal('not_assessed'),rights:z.literal('not_assessed')})});
export type SourceFusionPin=z.infer<typeof SourceFusionPinSchema>;
export type SourceFusionSelection=z.infer<typeof SourceFusionSelectionSchema>;
export type SourceFusionRequest=z.infer<typeof SourceFusionRequestSchema>;
export type SourceFusionContext=z.infer<typeof SourceFusionContextSchema>;
