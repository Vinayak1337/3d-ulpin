import {z} from 'zod';
import {DocumentAssociationSourceSchema} from './document-association';
import {DocumentLocatorSchema,DocumentPartSchema} from './usp/document-ingestion';
import {RegistryCityJSONCandidateSchema} from './registry-cityjson-draft';

export const CITYJSON_REFERENCE_LIMITS=Object.freeze({parts:25,bodyBytes:16*1024,pinBytes:64*1024,readBytes:128*1024});
const id=z.uuid().transform(v=>v.toLowerCase()),hash=z.string().regex(/^[a-f0-9]{64}$/),revision=z.number().int().positive();
export const RegistryCityJSONReferenceSchema=z.strictObject({
  version:z.literal('registry-cityjson-reference/1'),id:hash,document:DocumentAssociationSourceSchema,
  inputSha256:hash,readerSha256:hash,acceptedFence:revision,partId:id,partSha256:hash,locator:DocumentLocatorSchema,
  target:z.strictObject({draftId:id,recordId:id,candidateSha256:hash,selectionSha256:hash}),
  selection:z.strictObject({subject:z.string().min(1).max(256),accessSha256:hash,selectedAt:z.iso.datetime()}),
  associationState:z.literal('operator_selected'),applicability:z.literal('not_assessed'),accuracy:z.literal('not_assessed'),
});
export const RegistryCityJSONReferencesSchema=z.array(RegistryCityJSONReferenceSchema).max(CITYJSON_REFERENCE_LIMITS.parts)
  .superRefine((items,ctx)=>{
    if(new Set(items.map(v=>v.id)).size!==items.length)
      ctx.addIssue({code:'custom',message:'Select each exact native reference part once.'});
  });
const partIds=z.array(id).min(1).max(CITYJSON_REFERENCE_LIMITS.parts).refine(v=>new Set(v).size===v.length,'Select each native part once.');
export const RegistryCityJSONReferenceAttachSchema=z.strictObject({requestKey:id,expectedDraftRevision:revision,
  document:DocumentAssociationSourceSchema,partIds});
export const RegistryCityJSONReferenceRemoveSchema=z.strictObject({requestKey:id,expectedDraftRevision:revision,
  remove:z.array(hash).max(CITYJSON_REFERENCE_LIMITS.parts).default([]),clearAll:z.literal(true).optional(),
}).superRefine((v,ctx)=>{
  if((!v.remove.length&&!v.clearAll)||(v.clearAll&&v.remove.length)||new Set(v.remove).size!==v.remove.length)
    ctx.addIssue({code:'custom',message:'Remove exact reference IDs or explicitly clear all references.'});
});
export const RegistryCityJSONReferenceReceiptSchema=z.strictObject({draftId:id,draftRevision:revision,recordId:id,
  referencesSha256:hash,changed:z.boolean(),validation:z.literal('requires_current_draft_revision')});
export const RegistryCityJSONReferenceReadSchema=z.strictObject({draftId:id,draftRevision:revision,siteId:id,recordId:id,
  candidateSha256:hash,nativeSelection:RegistryCityJSONCandidateSchema.shape.selection,
  referenceDeclaration:RegistryCityJSONCandidateSchema.shape.reference,
  references:z.array(z.strictObject({pin:RegistryCityJSONReferenceSchema,part:DocumentPartSchema})).max(CITYJSON_REFERENCE_LIMITS.parts),
  associationState:z.literal('operator_selected'),reviewedReference:z.literal('not_assessed'),accuracy:z.literal('not_assessed'),
  accuracyMetres:z.null(),geographicRelationship:z.literal('not_assessed'),globalPlacement:z.literal('not_qualified'),
});
export type RegistryCityJSONReference=z.infer<typeof RegistryCityJSONReferenceSchema>;
