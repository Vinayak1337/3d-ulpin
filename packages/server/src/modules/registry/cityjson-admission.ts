import {z} from 'zod';
import {CITYJSON_ADMISSION_VERSION,CITYJSON_ADMISSION_MAX_BYTES,RegistryCityJSONAdmissionRequestSchema,
  RegistryCityJSONAdmissionAssessmentSchema,RegistryCityJSONValidationStatusSchema} from '@ulpin/contracts';
import {transaction} from '../../infrastructure/db';
import {AppError,conflict,notFound} from '../../infrastructure/errors';
import {fingerprint} from '../cases/domain';
import {registryCityJSONAuthorityTx,readRegistryCityJSONDraftTx} from './cityjson-draft';
import {cityjsonValidationStatusTx,readCityJSONValidationStatus,assertCityJSONValidationAuthority,validationSelections} from './cityjson-validation';
import {readRegistryCityJSONReferenceAuthorityTx} from './cityjson-reference';
import {readRegistryCityJSONReferenceReviewForAuthorityTx,cityjsonReferenceReviewSummary} from './cityjson-reference-review';
import {readRegistryCityJSONControlReviewForAuthorityTx,cityjsonControlReviewSummary} from './cityjson-control-review';

type Authority=Awaited<ReturnType<typeof registryCityJSONAuthorityTx>>;
type Validation=Awaited<ReturnType<typeof cityjsonValidationStatusTx>>;
type Dependencies={transaction:typeof transaction;references:typeof readRegistryCityJSONReferenceAuthorityTx;
  validation:typeof cityjsonValidationStatusTx;native:typeof readRegistryCityJSONDraftTx;status:typeof readCityJSONValidationStatus;
  review:typeof readRegistryCityJSONReferenceReviewForAuthorityTx;controlReview?:typeof readRegistryCityJSONControlReviewForAuthorityTx};
const defaults:Dependencies={transaction,references:readRegistryCityJSONReferenceAuthorityTx,validation:cityjsonValidationStatusTx,
  native:readRegistryCityJSONDraftTx,status:readCityJSONValidationStatus,review:readRegistryCityJSONReferenceReviewForAuthorityTx};
const uuid=z.uuid().transform(v=>v.toLowerCase());
// Deliberately omit lease/timestamps: only the exact identity, state and accepted
// evidence are relevant to this aggregate; a benign heartbeat need not invalidate it.
function authorityPin(current:Authority,row:Validation|null){
  return fingerprint({site:current.site,draft:current.draft,record:current.record,candidate:current.candidate,validation:row&&{input:row.input,
    jobId:row.job.id,status:row.job.status,error:row.job.error,logicalState:row.job.logical_state,
    inputSha256:row.job.input_sha256,resultRef:row.job.result_ref,acceptedFence:row.job.accepted_fence,
    attemptState:row.job.attempt_state,attemptFence:row.job.attempt_fence,completionSha256:row.job.completion_sha256}});
}
function matched(current:Authority,row:Validation,jobId:string){
  assertCityJSONValidationAuthority(row.input,current);
  if(row.input.jobId!==jobId||row.job.id!==jobId||fingerprint(row.input.selections)!==fingerprint(validationSelections(current.candidate)))
    conflict('Select the validation of this exact current native geometry.');
}
/** No writes: resolve accepted authorities, perform their private object reads,
 * then repeat the entire aggregate authority before returning a public projection. */
export async function assessCityJSONAdmission(draftValue:string,raw:unknown,dependencies:Dependencies=defaults){
  try{return await currentAssessment(draftValue,raw,dependencies);}
  catch(error){
    // Missing, unrelated and inaccessible supplied evidence have the same private
    // response. Current authorized evidence that changed still returns conflict.
    if(error instanceof AppError&&(error.status===403||error.status===404))
      throw new AppError(404,'CITYJSON_ADMISSION_UNAVAILABLE','The requested native admission evidence is unavailable.');
    throw error;
  }
}
async function currentAssessment(draftValue:string,raw:unknown,dependencies:Dependencies){
  const draftId=uuid.parse(draftValue),request=RegistryCityJSONAdmissionRequestSchema.parse(raw);
  const resolve=(readNative=false)=>dependencies.transaction(async client=>{
    // Discover/lock all retained reference cases before native/destination locks.
    // Document object I/O and final aggregate checks remain in that authority.
    const {current,references}=await dependencies.references(client,draftId,request.expectedDraftRevision);
    if(current.draft.revision!==request.expectedDraftRevision)conflict('Pin the current native draft revision.');
    const review=request.referenceReviewId?await dependencies.review(client,{current,references},request.referenceReviewId):null;
    const controlReview=request.controlReviewId?await (dependencies.controlReview??readRegistryCityJSONControlReviewForAuthorityTx)(client,{current,references},request.controlReviewId):null;
    let row:Validation|null=null;
    if(request.validationJobId){
      // Scope the supplied ID before resolving its private payload or result.
      if(!(await client.query("SELECT id FROM jobs WHERE id=$1 AND operation='cityjson-validation' AND payload->>'draftId'=$2",
        [request.validationJobId,draftId])).rowCount)notFound();
      // Reuse the same resolved authority on this client; its source gate precedes job locks.
      row=await dependencies.validation(client,draftId,request.validationJobId,async()=>current);
      matched(current,row,request.validationJobId);
    }
    // The native reader reacquires only gates already held by reference authority.
    const native=readNative?await dependencies.native(client,draftId):null;
    return {current,row,references,native,review,controlReview};
  });
  const before=await resolve(true),native=before.native!;
  if(native.draftId!==draftId||native.draftRevision!==before.current.draft.revision||native.recordId!==before.current.record.id||
    fingerprint(native.candidate)!==fingerprint(before.current.candidate))conflict('Native evidence changed during the assessment.');
  const status=request.validationJobId?RegistryCityJSONValidationStatusSchema.parse(await dependencies.status(draftId,request.validationJobId)):null;
  if(status&&before.row){
    if(status.jobId!==request.validationJobId||status.draftId!==draftId||status.draftRevision!==request.expectedDraftRevision)
      conflict('Validation evidence belongs to another draft or revision.');
    const expected=before.row.job.logical_state==='cancelled'?'failed':before.row.job.status==='succeeded'?'completed':before.row.job.status;
    if(status.status!==expected||status.result?.resultSha256!==(before.row.job.result_ref?.sha256??undefined)||
      (status.result&&fingerprint(status.result.summary.validator)!==fingerprint(before.row.input.validator))||
      (status.result&&fingerprint(status.result.summary.sourceLocators)!==fingerprint(before.row.input.selections)))
      conflict('Validation result changed during the assessment.');
  }
  const after=await resolve();
  if(authorityPin(before.current,before.row)!==authorityPin(after.current,after.row)||
    fingerprint(before.references)!==fingerprint(after.references)||fingerprint(before.review)!==fingerprint(after.review)||
    fingerprint(before.controlReview)!==fingerprint(after.controlReview))
    conflict('Admission evidence changed during private object I/O; refresh the assessment.');
  const {current,row}=after,{candidate}=current,s=candidate.input;
  const geometry=z.object({type:z.enum(['Solid','MultiSurface']),lod:z.union([z.string().max(64),z.number().finite()]).nullable().optional()}).parse(native.native.geometry);
  const lod=Object.hasOwn(geometry,'lod')?geometry.lod===null?{state:'null' as const}:{state:'known' as const,value:geometry.lod!}:{state:'absent' as const};
  const structural=status===null?'not_assessed':status.status==='queued'||status.status==='running'?'pending':status.status==='stale'?'stale':status.status==='failed'?'failed':
    status.result?.summary.outcome==='valid'&&status.result.summary.documentSchema==='valid'&&status.result.summary.selectedGeometry==='valid'?'passed':
    status.result?.summary.outcome==='invalid'?'invalid':'unsupported';
  const missing:{requirement:string;reason:string;state:'needs_input'|'needs_validation'|'producer_unavailable'}[]=[];
  if(structural!=='passed')missing.push({requirement:'accepted_structural_validation',state:'needs_validation',reason:
    status===null?'No validation was selected for this assessment. Select or request validation of this exact current draft; admission needs accepted full-document and selected-geometry validity.':
    `The selected validation is ${structural}; admission needs accepted full-document and selected-geometry validity on these exact pins.`});
  if(geometry.type!=='Solid')missing.push({requirement:'solid_exterior_profile',state:'needs_input',reason:
    'A valid MultiSurface is surface evidence; this selection does not supply a Solid exterior for solid admission.'});
  missing.push({requirement:'reviewed_reference_evidence',state:'needs_input',reason:
    'Reviewed applicable independent reference/control evidence with exact source identity, geometry, date and horizontal/vertical reference is still required. Operator-selected document attachments do not establish reviewed applicability or accuracy.'},
  {requirement:'reference_accuracy_check',state:'producer_unavailable',reason:
    'Reference accuracy needs reviewed control comparisons, documented tolerances and any required transform for this selection. The native reference-check path is unavailable; a declared CRS and encoded scale/translate do not establish accuracy.'},
  {requirement:'native_admission_review',state:'producer_unavailable',reason:
    'A native admission review must accept this exact candidate, structural validation and reference evidence; generic draft review excludes native exterior candidates.'},
  {requirement:'post_write_qualification',state:'producer_unavailable',reason:
    'Recording must qualify the resulting canonical geometry revision using accepted source, validity, reference and admission-review evidence. This recording and qualification path is unavailable.'});
  const requirements=['current_source_native_evidence','accepted_structural_validation','solid_exterior_profile',
    'reviewed_reference_evidence','reference_accuracy_check','native_admission_review','post_write_qualification'];
  const value={version:CITYJSON_ADMISSION_VERSION,
    draft:{id:draftId,draftRevision:current.draft.revision,siteId:current.site.id,siteRevision:current.site.revision,recordId:current.record.id,
      recordRevision:0 as const,state:candidate.state,candidateSha256:fingerprint(candidate),footprintSha256:fingerprint(current.record.footprint)},
    source:{caseId:s.caseId,caseRevision:s.caseRevision,caseContextSha256:s.caseContextSha256,id:s.sourceId,familyId:s.sourceFamilyId,
      revision:s.sourceRevision,sha256:s.sourceSha256,bytes:s.sourceBytes,readerSha256:s.readerSha256},
    native:{jobId:s.jobId,resultSha256:candidate.resultSha256,acceptedFence:candidate.acceptedFence,artifactSha256:candidate.artifact.sha256,
      artifactBytes:candidate.artifact.bytes,selection:candidate.selection,geometry:{type:geometry.type,lod}},
    reference:{declaration:candidate.reference,siteFrameSha256:candidate.site.frameSha256,horizontalUnit:current.site.frame.horizontalUnit,verticalUnit:current.site.frame.verticalUnit,qualifiedFrame:null,
      qualifiedTransform:null,referenceEvidence:'not_bound',
      selections:{state:after.references.references.length?'operator_selected':'none',count:after.references.references.length,
        ids:after.references.references.map(entry=>entry.pin.id),referencesSha256:fingerprint(after.references.references.map(entry=>entry.pin))},
      reviewedReference:'not_assessed',accuracy:'not_assessed',accuracyMetres:null,globalPlacement:'not_assessed'},
    validation:row&&status?{inputSha256:row.job.input_sha256,acceptedFence:row.job.accepted_fence===null?null:Number(row.job.accepted_fence),validator:row.input.validator,status}:null,
    ...(after.review?{referenceReview:cityjsonReferenceReviewSummary(after.review)}:{}),
    ...(after.controlReview?{controlReview:cityjsonControlReviewSummary(after.controlReview)}:{}),
    findings:{sourceIntegrity:{state:'current_authority',nativeArtifact:'verified',originalBytes:'not_reverified'},structuralValidity:structural,
      referenceAccuracy:'not_assessed',admission:'unavailable',qualification:'not_assessed'},
    sufficiency:{task:'native-exterior-admission',requirements,missing:missing.map(v=>v.requirement),outcome:'partial'},missing,
    actions:[{kind:'inspect_original',method:'GET',path:`/api/v1/ingestion/cases/${s.caseId}/sources/${s.sourceId}/cityjson/original`},
      {kind:'inspect_native',method:'GET',path:`/api/v1/registry-drafts/${draftId}/native-exterior`},
      ...(status?[{kind:'inspect_validation',method:'GET',path:`/api/v1/registry-drafts/${draftId}/native-exterior/validations/${request.validationJobId}`}]:[]),
      {kind:'request_validation',method:'POST',path:`/api/v1/registry-drafts/${draftId}/native-exterior/validations`},
      {kind:'inspect_reference_selections',method:'GET',path:`/api/v1/registry-drafts/${draftId}/native-exterior/references`},
      {kind:'bind_reference_evidence',method:'POST',path:`/api/v1/registry-drafts/${draftId}/native-exterior/references`},
      {kind:'request_reference_review',method:'POST',path:`/api/v1/registry-drafts/${draftId}/native-exterior/references/reviews`},
      {kind:'request_control_review',method:'POST',path:`/api/v1/registry-drafts/${draftId}/native-exterior/control-assessment/reviews`},
      ...(after.controlReview?[{kind:'inspect_control_review',method:'GET',path:`/api/v1/registry-drafts/${draftId}/native-exterior/control-assessment/reviews/${after.controlReview.id}`}]:[]),
      ...(after.review?[{kind:'inspect_reference_review',method:'GET',path:`/api/v1/registry-drafts/${draftId}/native-exterior/references/reviews/${after.review.id}`}]:[])],
    capabilities:{inspect:true,requestValidation:'requires_configured_validator',bindReferenceEvidence:true,reviewAdmission:false,recordNativeExterior:false,
      qualifyGeometry:false,analyticalGeometry:false,exportQualifiedGeometry:false}};
  // Application evidence fingerprint, never the SQL post-write qualification hash or a recording capability.
  const assessment=RegistryCityJSONAdmissionAssessmentSchema.parse({...value,assessmentSha256:fingerprint(value)});
  if(Buffer.byteLength(JSON.stringify(assessment))>CITYJSON_ADMISSION_MAX_BYTES)
    throw new AppError(413,'CITYJSON_ADMISSION_LIMIT','The admission evidence exceeds its bounded private profile.');
  return assessment;
}
