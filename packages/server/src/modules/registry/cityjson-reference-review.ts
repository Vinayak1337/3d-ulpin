import type {PoolClient} from 'pg';
import {z} from 'zod';
import {CITYJSON_REFERENCE_REVIEW_VERSION,CITYJSON_REFERENCE_REVIEW_LIMITS,RegistryCityJSONReferenceReviewRequestSchema,
  RegistryCityJSONReferenceReviewIdSchema,RegistryCityJSONReferenceReviewReadSchema,RegistryCityJSONReferenceReviewStoredSchema,
  RegistryCityJSONReferenceReviewSummarySchema,type RegistryCityJSONReferenceReviewRequest,type RegistryCityJSONReferenceReview} from '@ulpin/contracts';
import {transaction} from '../../infrastructure/db';
import {AppError,conflict,notFound} from '../../infrastructure/errors';
import {fingerprint} from '../cases/domain';
import {documentReviewContext} from './registry-document-evidence';
import {readRegistryCityJSONReferenceAuthorityTx} from './cityjson-reference';

type Aggregate=Awaited<ReturnType<typeof readRegistryCityJSONReferenceAuthorityTx>>;
type Context=ReturnType<typeof documentReviewContext>;
type Dependencies={references:typeof readRegistryCityJSONReferenceAuthorityTx};
const defaults:Dependencies={references:readRegistryCityJSONReferenceAuthorityTx};
const uuid=z.uuid().transform(v=>v.toLowerCase());
const kind=CITYJSON_REFERENCE_REVIEW_VERSION;
const operationKey=(draftId:string,reviewId:string)=>`registry-cityjson-reference-review:${draftId}:${reviewId}`;
const reviewId=(draftId:string,caseId:string,requestKey:string)=>fingerprint({version:kind,draftId,caseId,requestKey});
function bounded<T>(value:T,limit=CITYJSON_REFERENCE_REVIEW_LIMITS.resultBytes){
  if(Buffer.byteLength(JSON.stringify(value))>limit)
    throw new AppError(413,'CITYJSON_REFERENCE_REVIEW_LIMIT','Use a smaller bounded reference review.');
  return value;
}
async function privateReview<T>(work:()=>Promise<T>):Promise<T>{
  try{return await work();}catch(error){
    if(error instanceof AppError&&(error.status===403||error.status===404))
      throw new AppError(404,'CITYJSON_REFERENCE_REVIEW_UNAVAILABLE','The requested native reference review is unavailable.');
    throw error;
  }
}
function assertContext(context:Context){
  if(fingerprint(context)!==fingerprint(documentReviewContext()))
    throw new AppError(403,'CITYJSON_REFERENCE_REVIEW_DENIED','The reference review context is unavailable.');
}
function authority(aggregate:Aggregate,context:Context){
  const {current,references}=aggregate;
  return {draftId:current.draft.id,draftRevision:current.draft.revision,siteId:current.site.id,siteRevision:current.site.revision,
    recordId:current.record.id,candidateSha256:fingerprint(current.candidate),selectionSha256:fingerprint(current.candidate.selection),
    referencesSha256:fingerprint(references.references.map(v=>v.pin)),authoritySha256:fingerprint({current,references,context})};
}
function assertRequest(request:RegistryCityJSONReferenceReviewRequest,aggregate:Aggregate,context:Context){
  const pins=authority(aggregate,context),ids=aggregate.references.references.map(v=>v.pin.id);
  if(request.expectedDraftRevision!==pins.draftRevision||request.candidateSha256!==pins.candidateSha256||
    request.selectionSha256!==pins.selectionSha256||request.referencesSha256!==pins.referencesSha256||
    fingerprint(request.conclusions.map(v=>v.referenceId).sort())!==fingerprint([...ids].sort()))
    conflict('Review the exact current native candidate and every selected reference once.');
  return pins;
}
function outcome(request:Pick<RegistryCityJSONReferenceReviewRequest,'conclusions'>):RegistryCityJSONReferenceReview['outcome']{
  const values=request.conclusions,conventions=values.filter(v=>v.purpose!=='object_control_applicability');
  if(values.some(v=>v.disposition==='conflicting'))return 'conflicting';
  if(conventions.length&&conventions.every(v=>v.disposition==='supported'))return 'supports_declared_convention';
  if(values.every(v=>v.disposition==='irrelevant'))return 'irrelevant';
  if(values.every(v=>v.disposition==='unsupported'))return 'unsupported';
  if(!values.some(v=>v.disposition==='supported')&&values.some(v=>v.disposition==='needs_input'))return 'needs_input';
  return 'partial';
}
function publicReview(stored:z.infer<typeof RegistryCityJSONReferenceReviewStoredSchema>){
  const {requestKey:_requestKey,reviewContext:_context,...view}=stored;
  return bounded(RegistryCityJSONReferenceReviewReadSchema.parse(view));
}
function checked(row:{payload_hash:string;result:unknown},aggregate:Aggregate,context:Context,id:string){
  const stored=RegistryCityJSONReferenceReviewStoredSchema.parse(row.result),{reviewSha256,...body}=stored;
  if(fingerprint(stored.reviewContext)!==fingerprint(context))
    throw new AppError(403,'CITYJSON_REFERENCE_REVIEW_DENIED','The reference review context is unavailable.');
  if(stored.id!==id||reviewId(aggregate.current.draft.id,aggregate.current.draft.case_id,stored.requestKey)!==id||
    reviewSha256!==fingerprint(body)||fingerprint(stored.authority)!==fingerprint(authority(aggregate,context)))
    conflict('The exact reviewed native/reference/access aggregate changed; preserve this review and create a new one.');
  const request=RegistryCityJSONReferenceReviewRequestSchema.parse({requestKey:stored.requestKey,expectedDraftRevision:stored.authority.draftRevision,
    candidateSha256:stored.authority.candidateSha256,selectionSha256:stored.authority.selectionSha256,referencesSha256:stored.authority.referencesSha256,
    conclusions:stored.conclusions,objectControls:stored.objectControls});
  if(row.payload_hash!==fingerprint({request,context})||stored.outcome!==outcome(request))
    conflict('The immutable reference review receipt changed.');
  assertRequest(request,aggregate,context);assertContext(context);return publicReview(stored);
}
/** Entry point: the complete sorted reference/native/workspace gate set is held
 * through accepted document I/O/final authority checks and immutable receipt insert. */
export const createRegistryCityJSONReferenceReviewTx=(client:PoolClient,draftValue:string,raw:unknown,dependencies:Dependencies=defaults)=>privateReview(async()=>{
  const draftId=uuid.parse(draftValue),request=RegistryCityJSONReferenceReviewRequestSchema.parse(raw),context=documentReviewContext();
  bounded(request,CITYJSON_REFERENCE_REVIEW_LIMITS.bodyBytes);
  const aggregate=await dependencies.references(client,draftId,request.expectedDraftRevision),pins=assertRequest(request,aggregate,context);
  assertContext(context);
  const id=reviewId(draftId,aggregate.current.draft.case_id,request.requestKey),key=operationKey(draftId,id),digest=fingerprint({request,context});
  const prior=(await client.query('SELECT payload_hash,result FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind=$3',
    [aggregate.current.draft.case_id,key,kind])).rows[0];
  if(prior){if(prior.payload_hash!==digest)conflict('This request key already names a different reference review.');return checked(prior,aggregate,context,id);}
  const body={version:kind,id,authority:pins,scope:'selected_reference_conventions',outcome:outcome(request),
    conclusions:request.conclusions,objectControls:request.objectControls,reviewedAt:new Date().toISOString(),attribution:'local_process',
    currentness:'current_authority',accuracy:'not_assessed',accuracyMetres:null,admission:'unavailable',qualification:'not_assessed',
    requestKey:request.requestKey,reviewContext:context};
  const stored=bounded(RegistryCityJSONReferenceReviewStoredSchema.parse({...body,reviewSha256:fingerprint(body)}));
  const view=publicReview(stored);assertContext(context);
  await client.query('INSERT INTO operations(case_id,operation_key,kind,payload_hash,result) VALUES($1,$2,$3,$4,$5)',
    [aggregate.current.draft.case_id,key,kind,digest,stored]);
  assertContext(context);return view;
});
/** Same-client consumer helper. Call only after complete reference authority and
 * its final private I/O checks; this helper acquires no new case gates. */
export const readRegistryCityJSONReferenceReviewForAuthorityTx=(client:PoolClient,aggregate:Aggregate,idValue:string)=>privateReview(async()=>{
  const id=RegistryCityJSONReferenceReviewIdSchema.parse(idValue),context=documentReviewContext();
  const row=(await client.query('SELECT payload_hash,result FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind=$3',
    [aggregate.current.draft.case_id,operationKey(aggregate.current.draft.id,id),kind])).rows[0]??notFound();
  return checked(row,aggregate,context,id);
});
export const readRegistryCityJSONReferenceReviewTx=(client:PoolClient,draftValue:string,idValue:string,dependencies:Dependencies=defaults)=>privateReview(async()=>{
  const id=RegistryCityJSONReferenceReviewIdSchema.parse(idValue);
  const aggregate=await dependencies.references(client,uuid.parse(draftValue));
  return readRegistryCityJSONReferenceReviewForAuthorityTx(client,aggregate,id);
});
export const createRegistryCityJSONReferenceReview=(draftId:string,raw:unknown)=>transaction(client=>createRegistryCityJSONReferenceReviewTx(client,draftId,raw));
export const readRegistryCityJSONReferenceReview=(draftId:string,id:string)=>transaction(client=>readRegistryCityJSONReferenceReviewTx(client,draftId,id));
export function cityjsonReferenceReviewSummary(review:RegistryCityJSONReferenceReview){
  return RegistryCityJSONReferenceReviewSummarySchema.parse({id:review.id,reviewSha256:review.reviewSha256,authoritySha256:review.authority.authoritySha256,
    scope:review.scope,outcome:review.outcome,currentness:review.currentness,objectControls:review.objectControls.disposition,accuracy:review.accuracy});
}
