import {z} from 'zod';
import {DocumentPartSchema,DocumentFormatSchema} from './usp/document-ingestion';
import {UspTargetPinSchema,UspSnapshotScopeSchema} from './usp/common';
import {UspIdentifierAssertionSchema,UspResolvedTargetSchema} from './usp/domain';

export const DOCUMENT_ASSOCIATION_VERSION='document-association-preview/1' as const;
const revision=z.number().int().nonnegative(),hash=z.string().regex(/^[a-f0-9]{64}$/);
export const DocumentAssociationSourceSchema=z.strictObject({caseId:z.uuid(),caseRevision:revision,
  sourceId:z.uuid(),sourceRevision:z.number().int().positive(),sourceSha256:hash,jobId:z.uuid(),resultSha256:hash});
export const DocumentAssociationPreviewRequestSchema=z.strictObject({document:DocumentAssociationSourceSchema,
  partIds:z.array(z.uuid()).max(25),scope:UspSnapshotScopeSchema.nullable(),targets:z.array(UspTargetPinSchema).max(25)})
  .superRefine((value,ctx)=>{
    if(new Set(value.partIds).size!==value.partIds.length ||
      new Set(value.targets.map(pin=>`${pin.ref.namespace}:${pin.ref.id}`)).size!==value.targets.length)
      ctx.addIssue({code:'custom',message:'Choose each source part and target once.'});
    if(value.targets.length && !value.scope)
      ctx.addIssue({code:'custom',message:'Selected targets require their exact snapshot scope.'});
    if(value.scope && value.scope.stage!=='recorded')
      ctx.addIssue({code:'custom',message:'This preview supports recorded registry targets only.'});
    if(value.targets.some(pin=>pin.ref.namespace!=='registry_record'||pin.revision<1))
      ctx.addIssue({code:'custom',message:'Choose exact recorded registry building/floor pins.'});
  });
const targetFields=UspResolvedTargetSchema.unwrap().shape;
export const DocumentAssociationTargetSchema=z.strictObject({pin:UspTargetPinSchema,kind:z.enum(['building','floor']),
  label:targetFields.label,identifiers:targetFields.identifiers,recordState:targetFields.recordState,
  relationsWithinSelection:targetFields.relations,
  relationshipCoverage:z.enum(['complete','partial']),sourceEvidence:z.enum(['available','unavailable']),
  synthetic:z.boolean().nullable()});
export const DocumentAssociationPreviewSchema=z.strictObject({version:z.literal(DOCUMENT_ASSOCIATION_VERSION),
  state:z.enum(['available','needs_input','not_assessed']),document:DocumentAssociationSourceSchema,
  scope:UspSnapshotScopeSchema.nullable(),reasonCodes:z.array(z.string().min(1).max(120)).max(16),
  source:z.strictObject({format:DocumentFormatSchema,nativeStatus:z.enum(['extracted','needs_ocr','unsupported','encrypted','tool_error']),
    readerSha256:hash,code:z.string().nullable(),warnings:z.array(z.string().max(512)).max(100)}),
  citations:z.array(z.strictObject({part:DocumentPartSchema,
    identifierEligibility:z.strictObject({state:z.enum(['available','not_assessed']),reasonCode:z.string().nullable()})})).max(25),
  targets:z.array(DocumentAssociationTargetSchema).max(25),
  association:z.strictObject({state:z.literal('not_assessed'),reasonCode:z.literal('source_target_linkage_unqualified'),
    identifierOverlap:z.strictObject({state:z.literal('not_assessed'),reasonCode:z.literal('source_key_namespace_unqualified')}),
    population:z.literal('explicit_selection_only')}),
  ambiguities:z.strictObject({multipleFloors:z.array(UspTargetPinSchema).max(25),
    floorsWithoutSelectedParent:z.array(UspTargetPinSchema).max(25),
    duplicateIdentifiers:z.array(z.strictObject({scheme:z.string(),value:z.string(),
      occurrences:z.array(z.strictObject({target:UspTargetPinSchema,identifier:UspIdentifierAssertionSchema})).min(2).max(1600)})).max(800)})
});
export type DocumentAssociationSource=z.infer<typeof DocumentAssociationSourceSchema>;
export type DocumentAssociationPreviewRequest=z.infer<typeof DocumentAssociationPreviewRequestSchema>;
export type DocumentAssociationTarget=z.infer<typeof DocumentAssociationTargetSchema>;
export type DocumentAssociationPreview=z.infer<typeof DocumentAssociationPreviewSchema>;
