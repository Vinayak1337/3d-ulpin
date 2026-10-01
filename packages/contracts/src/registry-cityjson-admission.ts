import {z} from 'zod';
import {RegistryCityJSONCandidateSchema} from './registry-cityjson-draft';
import {RegistryCityJSONValidationStatusSchema,CityJSONValidatorPinsSchema} from './registry-cityjson-validation';
import {DataSufficiencyVerdictSchema} from './usp/geometry';
import {CITYJSON_REFERENCE_LIMITS} from './registry-cityjson-reference';

export const CITYJSON_ADMISSION_VERSION='registry-cityjson-admission/1' as const;
export const CITYJSON_ADMISSION_MAX_BYTES=32*1024;
const id=z.uuid().transform(v=>v.toLowerCase()),hash=z.string().regex(/^[a-f0-9]{64}$/),rev=z.number().int().nonnegative();
export const RegistryCityJSONAdmissionRequestSchema=z.strictObject({expectedDraftRevision:rev.min(1),validationJobId:id.optional()});
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
    referenceEvidence:z.literal('not_bound').describe('Reviewed applicable reference evidence is not bound; authorized operator selections are reported separately.'),
    selections:z.strictObject({state:z.enum(['none','operator_selected']),count:rev.max(CITYJSON_REFERENCE_LIMITS.parts),
      ids:z.array(hash).max(CITYJSON_REFERENCE_LIMITS.parts),referencesSha256:hash}),
    reviewedReference:z.literal('not_assessed'),accuracy:z.literal('not_assessed'),accuracyMetres:z.null(),globalPlacement:z.literal('not_assessed')}),
  validation:z.strictObject({inputSha256:hash,acceptedFence:rev.min(1).nullable(),validator:CityJSONValidatorPinsSchema,
    status:RegistryCityJSONValidationStatusSchema}).nullable(),
  findings:z.strictObject({sourceIntegrity:z.strictObject({state:z.literal('current_authority'),nativeArtifact:z.literal('verified'),originalBytes:z.literal('not_reverified')}),
    structuralValidity:z.enum(['not_assessed','passed','pending','failed','stale','invalid','unsupported']),referenceAccuracy:z.literal('not_assessed'),
    admission:z.literal('unavailable'),qualification:z.literal('not_assessed')}),
  sufficiency:DataSufficiencyVerdictSchema,
  missing:z.array(z.strictObject({requirement:z.string().min(1).max(100),reason:z.string().min(1).max(512),
    state:z.enum(['needs_input','needs_validation','producer_unavailable'])})).min(1).max(8),
  actions:z.array(z.strictObject({kind:z.enum(['inspect_original','inspect_native','inspect_validation','request_validation','inspect_reference_selections','bind_reference_evidence']),
    method:z.enum(['GET','POST']),path:z.string().startsWith('/api/v1/').max(512)})).min(5).max(6),
  capabilities:z.strictObject({inspect:z.literal(true),requestValidation:z.literal('requires_configured_validator'),bindReferenceEvidence:z.literal(true),
    reviewAdmission:z.literal(false),recordNativeExterior:z.literal(false),qualifyGeometry:z.literal(false),analyticalGeometry:z.literal(false),exportQualifiedGeometry:z.literal(false)}),
}).superRefine((value,ctx)=>{
  if(JSON.stringify(value.missing.map(v=>v.requirement))!==JSON.stringify(value.sufficiency.missing))
    ctx.addIssue({code:'custom',message:'Missing admission findings must match the exact sufficiency requirements.'});
  const selections=value.reference.selections;
  if(selections.count!==selections.ids.length||new Set(selections.ids).size!==selections.ids.length||
    selections.state!==(selections.count?'operator_selected':'none'))
    ctx.addIssue({code:'custom',message:'Reference selection summary must describe the exact authorized set.'});
  const inspect=value.actions.filter(action=>action.kind==='inspect_validation');
  if(value.validation===null?(value.findings.structuralValidity!=='not_assessed'||inspect.length!==0):
    (value.findings.structuralValidity==='not_assessed'||inspect.length!==1))
    ctx.addIssue({code:'custom',message:'Only a selected validation supplies a validation result and inspection action.'});
});
export type RegistryCityJSONAdmissionAssessment=z.infer<typeof RegistryCityJSONAdmissionAssessmentSchema>;
