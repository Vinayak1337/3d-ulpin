import {z} from 'zod';
import {DocumentAssociationSourceSchema} from './document-association';
import {DocumentPartSchema,DocumentFormatSchema} from './usp/document-ingestion';

export const SOURCE_FUSION_VERSION='source-fusion-context/1' as const;
export const SOURCE_FUSION_LIMITS=Object.freeze({sources:8,selections:25,requestBytes:64*1024,
  responseBytes:1024*1024,aggregateArtifactBytes:64*1024*1024,deadlineMs:30_000});
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const id=z.uuid().transform(value=>value.toLowerCase());
export const SourceFusionPinSchema=DocumentAssociationSourceSchema.extend({caseId:id,sourceId:id,jobId:id,readerSha256:hash,inputSha256:hash,
  acceptedFence:z.number().int().positive(),resultBytes:z.number().int().positive().max(4*1024*1024)});
export const SourceFusionSelectionSchema=z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('document'),pin:SourceFusionPinSchema,partIds:z.array(id).max(25)}),
  z.strictObject({kind:z.literal('cityjson'),pin:SourceFusionPinSchema,
    objectIds:z.array(z.string().min(1).max(512)).min(1).max(25)})]);
export const SourceFusionRequestSchema=z.strictObject({sources:z.array(SourceFusionSelectionSchema).min(2).max(8)})
  .superRefine((value,ctx)=>{
    const keys=value.sources.map(s=>s.pin.sourceId.toLowerCase());
    if(new Set(keys).size!==keys.length)ctx.addIssue({code:'custom',message:'Select each source once.'});
    let count=0;
    for(const source of value.sources){
      const ids=source.kind==='document'?source.partIds:source.objectIds;count+=ids.length;
      if(new Set(ids.map(id=>source.kind==='document'?id.toLowerCase():id)).size!==ids.length)
        ctx.addIssue({code:'custom',message:'Select each native part or object once.'});
      if(source.kind==='cityjson'&&source.pin.resultBytes>16*1024)
        ctx.addIssue({code:'custom',message:'CityJSON result receipts have a 16 KiB profile.'});
    }
    if(count>25)ctx.addIssue({code:'custom',message:'Select at most 25 native parts/objects total.'});
  });
const declaration=z.discriminatedUnion('state',[
  z.strictObject({state:z.literal('absent')}),
  z.strictObject({state:z.literal('declared'),value:z.json()})]);
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
  reference:z.strictObject({frame:z.record(z.string(),z.json()),metadata:declaration,transform:declaration}),
  objects:z.array(z.strictObject({key:z.string(),id:z.string(),pointer:z.string(),type:z.string(),geometryState:z.enum(['present','absent']),
    attributes:declaration,parents:declaration,children:declaration,
    geometries:z.array(z.strictObject({pointer:z.string(),type:z.string(),status:z.string(),lod:declaration})).max(1000)})).max(25),
  coverage:z.strictObject({selectedObjects:z.number().int().nonnegative(),availableNativeObjects:z.number().int().nonnegative(),
    scope:z.literal('explicit_selection_only'),geometryArrays:z.literal('omitted; exact artifact references retained')}),
  hierarchyIssues:z.array(z.json()).max(1000)});
export const SourceFusionContextSchema=z.strictObject({version:z.literal(SOURCE_FUSION_VERSION),contextSha256:hash,
  sources:z.array(z.union([SourceFusionDocumentSchema,SourceFusionCityJSONSchema])).min(2).max(8),
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
