import {z} from 'zod';
import {RegistryCityJSONCandidateSchema} from './registry-cityjson-draft';
import {RegistryCityJSONValidationStatusSchema,CityJSONValidatorPinsSchema} from './registry-cityjson-validation';
import {DataSufficiencyVerdictSchema} from './usp/geometry';

export const CITYJSON_ADMISSION_VERSION='registry-cityjson-admission/1' as const;
export const CITYJSON_ADMISSION_MAX_BYTES=32*1024;
const id=z.uuid().transform(v=>v.toLowerCase()),hash=z.string().regex(/^[a-f0-9]{64}$/),rev=z.number().int().nonnegative();
export const RegistryCityJSONAdmissionRequestSchema=z.strictObject({expectedDraftRevision:rev.min(1),validationJobId:id});
export const RegistryCityJSONAdmissionAssessmentSchema=z.strictObject({version:z.literal(CITYJSON_ADMISSION_VERSION),assessmentSha256:hash,
  draft:z.strictObject({id,draftRevision:rev.min(1),siteId:id,siteRevision:rev,recordId:id,recordRevision:z.literal(0),
    state:z.literal('unrecorded'),candidateSha256:hash,footprintSha256:hash}),
  source:z.strictObject({caseId:id,caseRevision:rev,caseContextSha256:hash,id,familyId:id,revision:rev.min(1),sha256:hash,bytes:rev.min(1),readerSha256:hash}),
  native:z.strictObject({jobId:id,resultSha256:hash,acceptedFence:rev.min(1),artifactSha256:hash,artifactBytes:rev.min(1),
    selection:RegistryCityJSONCandidateSchema.shape.selection,
    geometry:z.strictObject({type:z.enum(['Solid','MultiSurface']),lod:z.discriminatedUnion('state',[
      z.strictObject({state:z.literal('absent')}),z.strictObject({state:z.literal('null')}),
      z.strictObject({state:z.literal('known'),value:z.union([z.string().max(64),z.number().finite()])})])})}),
  reference:z.strictObject({declaration:RegistryCityJSONCandidateSchema.shape.reference,siteFrameSha256:hash,
    horizontalUnit:z.literal('m'),verticalUnit:z.literal('m'),qualifiedFrame:z.null(),qualifiedTransform:z.null(),
    referenceEvidence:z.literal('not_bound'),accuracy:z.literal('not_assessed'),accuracyMetres:z.null(),globalPlacement:z.literal('not_assessed')}),
  validation:z.strictObject({inputSha256:hash,acceptedFence:rev.min(1).nullable(),validator:CityJSONValidatorPinsSchema,
    status:RegistryCityJSONValidationStatusSchema}),
  findings:z.strictObject({sourceIntegrity:z.strictObject({state:z.literal('current_authority'),nativeArtifact:z.literal('verified'),originalBytes:z.literal('not_reverified')}),
    structuralValidity:z.enum(['passed','pending','failed','stale','invalid','unsupported']),referenceAccuracy:z.literal('not_assessed'),
    admission:z.literal('unavailable'),qualification:z.literal('not_assessed')}),
  sufficiency:DataSufficiencyVerdictSchema,
  missing:z.array(z.strictObject({requirement:z.string().min(1).max(100),reason:z.string().min(1).max(512),
    state:z.enum(['needs_input','needs_validation','producer_unavailable'])})).min(1).max(8),
  actions:z.array(z.strictObject({kind:z.enum(['inspect_original','inspect_native','inspect_validation','request_validation','inspect_reference_selections','bind_reference_evidence']),
    method:z.enum(['GET','POST']),path:z.string().startsWith('/api/v1/').max(512)})).length(6),
  capabilities:z.strictObject({inspect:z.literal(true),requestValidation:z.literal('requires_configured_validator'),bindReferenceEvidence:z.literal(true),
    reviewAdmission:z.literal(false),recordNativeExterior:z.literal(false),qualifyGeometry:z.literal(false),analyticalGeometry:z.literal(false),exportQualifiedGeometry:z.literal(false)}),
}).superRefine((value,ctx)=>{
  if(JSON.stringify(value.missing.map(v=>v.requirement))!==JSON.stringify(value.sufficiency.missing))
    ctx.addIssue({code:'custom',message:'Missing admission findings must match the exact sufficiency requirements.'});
});
export type RegistryCityJSONAdmissionAssessment=z.infer<typeof RegistryCityJSONAdmissionAssessmentSchema>;
