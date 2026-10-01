import {z} from 'zod';
import {CITYJSON_REFERENCE_LIMITS} from './registry-cityjson-reference';
import {RegistryDocumentReviewContextSchema} from './registry-document-evidence';

export const CITYJSON_REFERENCE_REVIEW_VERSION='registry-cityjson-reference-review/1' as const;
export const CITYJSON_REFERENCE_REVIEW_LIMITS=Object.freeze({bodyBytes:16*1024,resultBytes:32*1024});
const uuid=z.uuid().transform(v=>v.toLowerCase()),hash=z.string().regex(/^[a-f0-9]{64}$/),revision=z.number().int().positive();
const rationale=z.string().trim().min(1).max(512);
export const RegistryCityJSONReferenceReviewIdSchema=hash;
const conclusion=z.strictObject({referenceId:hash,
  purpose:z.enum(['reference_system_definition','delivery_convention','object_control_applicability']),
  disposition:z.enum(['supported','conflicting','irrelevant','needs_input','unsupported']),rationale,
}).superRefine((value,ctx)=>{
  if(value.purpose==='object_control_applicability'&&value.disposition==='supported')
    ctx.addIssue({code:'custom',message:'This reference-note profile cannot establish independent object controls.'});
});
const conclusions=z.array(conclusion).min(1).max(CITYJSON_REFERENCE_LIMITS.parts).refine(values=>
  new Set(values.map(v=>v.referenceId)).size===values.length,'Review each selected reference once.');
const objectControls=z.strictObject({disposition:z.enum(['needs_input','unsupported']),rationale});
export const RegistryCityJSONReferenceReviewRequestSchema=z.strictObject({requestKey:uuid,expectedDraftRevision:revision,
  candidateSha256:hash,selectionSha256:hash,referencesSha256:hash,conclusions,objectControls});
const scope=z.literal('selected_reference_conventions').describe('Officer judgment about exact reference excerpts and source-declared conventions; never independent controls or geometry qualification.');
const outcome=z.enum(['supports_declared_convention','partial','conflicting','irrelevant','needs_input','unsupported'])
  .describe('supports_declared_convention means only that the officer marked each reviewed definition/delivery excerpt supported. Object controls, measured accuracy, admission and recording remain unqualified.');
const authority=z.strictObject({draftId:uuid,draftRevision:revision,siteId:uuid,siteRevision:z.number().int().nonnegative(),recordId:uuid,
  candidateSha256:hash,selectionSha256:hash,referencesSha256:hash,authoritySha256:hash});
const body={version:z.literal(CITYJSON_REFERENCE_REVIEW_VERSION),id:hash,reviewSha256:hash,authority,scope,outcome,
  conclusions,objectControls,reviewedAt:z.iso.datetime(),attribution:z.literal('local_process'),currentness:z.literal('current_authority'),
  accuracy:z.literal('not_assessed'),accuracyMetres:z.null(),admission:z.literal('unavailable'),qualification:z.literal('not_assessed')};
export const RegistryCityJSONReferenceReviewReadSchema=z.strictObject(body);
/** Private operation result only: context/request key are excluded from read and admission projections. */
export const RegistryCityJSONReferenceReviewStoredSchema=z.strictObject({...body,requestKey:uuid,reviewContext:RegistryDocumentReviewContextSchema});
export const RegistryCityJSONReferenceReviewSummarySchema=z.strictObject({id:hash,reviewSha256:hash,authoritySha256:hash,scope,outcome,
  currentness:z.literal('current_authority'),objectControls:z.enum(['needs_input','unsupported']),accuracy:z.literal('not_assessed')});
export type RegistryCityJSONReferenceReviewRequest=z.infer<typeof RegistryCityJSONReferenceReviewRequestSchema>;
export type RegistryCityJSONReferenceReview=z.infer<typeof RegistryCityJSONReferenceReviewReadSchema>;
