import {z} from 'zod';
import {RegistryCityJSONControlRequestSchema,RegistryCityJSONControlAssessmentSchema} from './registry-cityjson-control-assessment';
import {RegistryDocumentReviewContextSchema} from './registry-document-evidence';

export const CITYJSON_CONTROL_REVIEW_VERSION='registry-cityjson-control-review/1' as const;
export const CITYJSON_CONTROL_REVIEW_LIMITS=Object.freeze({requestBytes:20*1024,resultBytes:160*1024});
const hash=z.string().regex(/^[a-f0-9]{64}$/),uuid=z.uuid().transform(value=>value.toLowerCase());
export const RegistryCityJSONControlReviewIdSchema=hash;
const decision=z.strictObject({disposition:z.enum(['reviewed','needs_input','rejected']),rationale:z.string().trim().min(1).max(1024)});
export const RegistryCityJSONControlReviewRequestSchema=z.strictObject({requestKey:uuid,
  comparison:RegistryCityJSONControlRequestSchema,expectedAssessmentSha256:hash,decision});
const authority=z.strictObject({draftId:uuid,draftRevision:z.number().int().positive(),siteId:uuid,
  siteRevision:z.number().int().nonnegative(),recordId:uuid,candidateSha256:hash,selectionSha256:hash,referencesSha256:hash,authoritySha256:hash});
const scope=z.literal('selected_point_control_comparison').describe('Scoped officer decision about this exact comparison; no accuracy, control qualification or admission approval.');
const body={version:z.literal(CITYJSON_CONTROL_REVIEW_VERSION),id:hash,reviewSha256:hash,authority,scope,
  assessment:RegistryCityJSONControlAssessmentSchema,decision,reviewedAt:z.iso.datetime(),attribution:z.literal('local_process'),
  currentness:z.literal('current_authority'),accuracy:z.literal('not_assessed'),admission:z.literal('unavailable'),
  qualification:z.literal('not_assessed'),learningQualification:z.literal('not_assessed')};
export const RegistryCityJSONControlReviewReadSchema=z.strictObject(body);
/** Private operation receipt; full request and raw reviewer context never enter read/summary projections. */
export const RegistryCityJSONControlReviewStoredSchema=z.strictObject({...body,
  request:RegistryCityJSONControlReviewRequestSchema,reviewContext:RegistryDocumentReviewContextSchema});
export const RegistryCityJSONControlReviewSummarySchema=z.strictObject({id:hash,reviewSha256:hash,authoritySha256:hash,
  assessmentSha256:hash,scope,disposition:decision.shape.disposition,comparisonState:RegistryCityJSONControlAssessmentSchema.shape.state,
  currentness:z.literal('current_authority'),accuracy:z.literal('not_assessed'),admission:z.literal('unavailable'),
  qualification:z.literal('not_assessed'),learningQualification:z.literal('not_assessed')});
export type RegistryCityJSONControlReviewRequest=z.infer<typeof RegistryCityJSONControlReviewRequestSchema>;
export type RegistryCityJSONControlReview=z.infer<typeof RegistryCityJSONControlReviewReadSchema>;
