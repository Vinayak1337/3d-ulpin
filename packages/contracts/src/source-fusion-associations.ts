import {z} from 'zod';
import {SourceFusionRequestSchema,SourceFusionContextSchema,SourceFusionPinSchema,SourceFusionLiteralObjectSchema} from './source-fusion';
import {DocumentAssociationTargetSchema} from './document-association';
import {UspSnapshotScopeSchema,UspTargetPinSchema} from './usp/common';
import {UspModelGatewayResultSchema} from './usp/ports';

export const FUSION_ASSOCIATION_VERSION='source-fusion-associations/1' as const;
export const FUSION_ASSOCIATION_PROMPT='source-fusion-exact-associations/2' as const;
/** Native IFC identity requires an explicit target assertion in this scheme,
 * whose source_revision reference matches the selected original revision. */
export const FUSION_IFC_IDENTIFIER_SCHEME='ifc-globalid' as const;
export const FUSION_ASSOCIATION_LIMITS=Object.freeze({targets:8,proposals:8,citations:25,requestBytes:64*1024,
  responseBytes:1024*1024,promptBytes:24*1024,excerptCharacters:1000,deadlineMs:30_000});
const hash=z.string().regex(/^[a-f0-9]{64}$/),key=z.string().min(1).max(1024),quote=z.string().min(1).max(1000);
export const FusionAssociationSelectionSchema=z.strictObject({contextSha256:hash,selection:SourceFusionRequestSchema});
export const FusionAssociationRequestSchema=z.strictObject({requestKey:z.uuid(),context:FusionAssociationSelectionSchema,
  scope:UspSnapshotScopeSchema.nullable(),targets:z.array(UspTargetPinSchema).max(FUSION_ASSOCIATION_LIMITS.targets)})
  .superRefine((value,ctx)=>{
    if(value.targets.length&&!value.scope||value.scope&&value.scope.stage!=='recorded')
      ctx.addIssue({code:'custom',message:'Choose current recorded targets in an exact snapshot scope.'});
    if(value.targets.some(pin=>pin.ref.namespace!=='registry_record'||pin.revision<1)||
      new Set(value.targets.map(pin=>pin.ref.id)).size!==value.targets.length)
      ctx.addIssue({code:'custom',message:'Choose each exact recorded building/floor once.'});
  });
const modelCitation=z.strictObject({key,quote});
export const FusionAssociationModelOutputSchema=z.strictObject({suggestions:z.array(z.strictObject({
  targetId:z.string().min(1).max(256),scheme:z.string().min(1).max(256),matchedIdentifier:z.string().min(1).max(512),
  citations:z.array(modelCitation).min(1).max(8),rationale:z.string().min(1).max(500)})).max(8),
  abstentions:z.array(z.strictObject({reason:z.enum(['identifier_missing','ambiguous_evidence','conflicting_evidence']),
    citations:z.array(modelCitation).min(1).max(8)})).max(8)})
  .superRefine((value,ctx)=>{
    if([...value.suggestions,...value.abstentions].reduce((count,item)=>count+item.citations.length,0)>25)
      ctx.addIssue({code:'custom',message:'Use at most 25 cited fragments in the proposal response.'});
  });
export const FusionAssociationCitationSchema=z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('document'),key,quote,pin:SourceFusionPinSchema,partId:z.uuid(),partSha256:hash}),
  z.strictObject({kind:z.literal('document_ocr'),key,quote,pin:SourceFusionPinSchema,
    itemOrdinal:z.number().int().min(0).max(63),itemSha256:hash}),
  z.strictObject({kind:z.literal('ifc'),key,quote,pin:SourceFusionPinSchema,
    artifactSha256:hash,artifactBytes:z.number().int().positive().max(16*1024*1024),profile:z.literal('ulpin-native-ifc/1'),
    stepId:z.number().int().positive(),entityType:z.enum(['IfcBuilding','IfcBuildingStorey','IfcSpace']),
    recordPointer:z.string().regex(/^\/records\/\d+$/),recordSha256:hash,
    attribute:z.literal('GlobalId'),attributePointer:z.string().regex(/^\/records\/\d+\/attributes\/GlobalId$/),
    attributeSha256:hash,locator:SourceFusionLiteralObjectSchema,attributeLocator:SourceFusionLiteralObjectSchema,
    identifierScheme:z.literal(FUSION_IFC_IDENTIFIER_SCHEME),identifierNamespace:key,
    quoteBasis:z.literal('native_attribute_decoded_value'),
    identifierScope:z.literal('source_native_only; not_canonical_registry_ids')})]);
export const FusionAssociationProposalSchema=z.strictObject({id:hash,state:z.literal('proposed'),
  target:DocumentAssociationTargetSchema,identifier:z.strictObject({scheme:z.string(),value:z.string()}),
  citations:z.array(FusionAssociationCitationSchema).min(1).max(8),rationale:z.string().max(500),
  method:z.literal('ai_exact_identifier_association'),qualification:z.literal('not_assessed'),
  manualSelection:FusionAssociationSelectionSchema});
export const FusionAssociationAbstentionSchema=z.strictObject({reasonCode:z.string().min(1).max(120),
  target:UspTargetPinSchema.nullable(),citationKeys:z.array(key).max(25)});
export const FusionAssociationResponseSchema=z.strictObject({version:z.literal(FUSION_ASSOCIATION_VERSION),
  state:z.enum(['proposed','needs_input','unavailable']),context:SourceFusionContextSchema,
  scope:UspSnapshotScopeSchema.nullable(),targets:z.array(DocumentAssociationTargetSchema).max(8),
  proposals:z.array(FusionAssociationProposalSchema).max(8),abstentions:z.array(FusionAssociationAbstentionSchema).max(80),
  manualSelection:FusionAssociationSelectionSchema,
  provenance:z.strictObject({method:z.enum(['not_run','governed_model_gateway']),promptVersion:z.literal(FUSION_ASSOCIATION_PROMPT),
    promptSha256:hash,inputSha256:hash,gatewayPolicySha256:hash.nullable(),modelId:z.string().nullable(),
    outputSha256:hash.nullable(),receipt:UspModelGatewayResultSchema.unwrap().shape.receipt.unwrap().nullable(),replayed:z.boolean(),
    learningQualification:z.literal('not_assessed')}),
  association:z.strictObject({state:z.literal('not_assessed'),population:z.literal('explicit_selection_only'),
    acceptance:z.literal('operator_selection_then_existing_registry_review'),geometry:z.literal('not_assessed'),rights:z.literal('not_assessed')})});
export type FusionAssociationRequest=z.infer<typeof FusionAssociationRequestSchema>;
export type FusionAssociationResponse=z.infer<typeof FusionAssociationResponseSchema>;
export type FusionAssociationCitation=z.infer<typeof FusionAssociationCitationSchema>;
export type FusionAssociationAbstention=z.infer<typeof FusionAssociationAbstentionSchema>;
