import type {PoolClient} from 'pg';
import {z} from 'zod';
import {CITYJSON_CONTROL_REVIEW_VERSION,CITYJSON_CONTROL_REVIEW_LIMITS,RegistryCityJSONControlReviewIdSchema,
  RegistryCityJSONControlReviewRequestSchema,RegistryCityJSONControlReviewReadSchema,RegistryCityJSONControlReviewStoredSchema,
  RegistryCityJSONControlReviewSummarySchema,type RegistryCityJSONControlReviewRequest} from '../../../../contracts/src/registry-cityjson-control-review';
import {transaction} from '../../infrastructure/db';
import {AppError,conflict,notFound} from '../../infrastructure/errors';
import {fingerprint} from '../cases/domain';
import {documentReviewContext} from './registry-document-evidence';
import {readRegistryCityJSONReferenceAuthorityTx} from './cityjson-reference';
import {registryCityJSONAuthorityTx,readRegistryCityJSONDraftTx} from './cityjson-draft';
import {associationDocumentInputTx} from '../usp/ingestion/document-association-authority';
import {readDocumentResult} from '../usp/ingestion/documents';
import {prepareCityJSONControls,cityjsonControlSourcesTx,type CityJSONControlDependencies} from './cityjson-control-assessment';

type Aggregate=Awaited<ReturnType<typeof readRegistryCityJSONReferenceAuthorityTx>>;
type Sources=Awaited<ReturnType<typeof cityjsonControlSourcesTx>>;
type Context=ReturnType<typeof documentReviewContext>;
const kind=CITYJSON_CONTROL_REVIEW_VERSION,uuid=z.uuid().transform(value=>value.toLowerCase());
const key=(draft:string,id:string)=>`registry-cityjson-control-review:${draft}:${id}`;
const identity=(draft:string,caseId:string,requestKey:string)=>fingerprint({version:kind,draftId:draft,caseId,requestKey});
function bounded<T>(value:T,limit=CITYJSON_CONTROL_REVIEW_LIMITS.resultBytes){
  if(Buffer.byteLength(JSON.stringify(value))>limit)throw new AppError(413,'CITYJSON_CONTROL_REVIEW_LIMIT','Use a smaller bounded control review.');
  return value;
}
async function privateReview<T>(work:()=>Promise<T>){try{return await work();}catch(error){
  if(error instanceof AppError&&[403,404].includes(error.status))
    throw new AppError(404,'CITYJSON_CONTROL_REVIEW_UNAVAILABLE','The requested private control review is unavailable.');
  throw error;
}}
function assertContext(context:Context){if(fingerprint(context)!==fingerprint(documentReviewContext()))
  throw new AppError(403,'CITYJSON_CONTROL_REVIEW_DENIED','The control review context is unavailable.');}
function authority(aggregate:Aggregate,sources:Sources,context:Context){const {current,references}=aggregate;
  return {draftId:current.draft.id,draftRevision:current.draft.revision,siteId:current.site.id,siteRevision:current.site.revision,
    recordId:current.record.id,candidateSha256:fingerprint(current.candidate),selectionSha256:fingerprint(current.candidate.selection),
    referencesSha256:fingerprint(references.references.map(entry=>entry.pin)),authoritySha256:fingerprint({aggregate,sources,context})};
}
function assertPins(request:RegistryCityJSONControlReviewRequest,pins:ReturnType<typeof authority>){const comparison=request.comparison;
  if(comparison.expectedDraftRevision!==pins.draftRevision||comparison.candidateSha256!==pins.candidateSha256||
    comparison.selectionSha256!==pins.selectionSha256||comparison.referencesSha256!==pins.referencesSha256)
    conflict('Review the exact current native selection and controls.');
}
function assertDecision(request:RegistryCityJSONControlReviewRequest,assessment:z.infer<typeof RegistryCityJSONControlReviewReadSchema>['assessment']){
  if(request.expectedAssessmentSha256!==assessment.assessmentSha256)conflict('The current recomputed control comparison changed.');
  if(request.decision.disposition==='reviewed'&&(assessment.state!=='comparison_computed'||assessment.metrics===null||assessment.missing.length))
    conflict('Missing or incomplete controls cannot receive a reviewed comparison decision.');
}
function publicReview(stored:z.infer<typeof RegistryCityJSONControlReviewStoredSchema>){
  const {request:_request,reviewContext:_context,...view}=stored;
  return bounded(RegistryCityJSONControlReviewReadSchema.parse(view));
}
function checked(row:{payload_hash:string;result:unknown},aggregate:Aggregate,sources:Sources,context:Context,id:string){
  const stored=bounded(RegistryCityJSONControlReviewStoredSchema.parse(row.result)),{reviewSha256,...body}=stored;
  if(fingerprint(stored.reviewContext)!==fingerprint(context))throw new AppError(403,'CITYJSON_CONTROL_REVIEW_DENIED','The control review context is unavailable.');
  const pins=authority(aggregate,sources,context),{assessmentSha256,...assessmentBody}=stored.assessment;
  assertPins(stored.request,pins);assertDecision(stored.request,stored.assessment);
  if(stored.id!==id||identity(pins.draftId,aggregate.current.draft.case_id,stored.request.requestKey)!==id||
    stored.reviewSha256!==fingerprint(body)||row.payload_hash!==fingerprint({request:stored.request,context})||
    fingerprint(stored.authority)!==fingerprint(pins)||assessmentSha256!==fingerprint(assessmentBody)||
    fingerprint(stored.decision)!==fingerprint(stored.request.decision)||
    fingerprint(stored.assessment.draft)!==fingerprint({id:pins.draftId,draftRevision:pins.draftRevision,recordId:pins.recordId,
      candidateSha256:pins.candidateSha256,selectionSha256:pins.selectionSha256,referencesSha256:pins.referencesSha256}))
    conflict('The exact comparison, reviewer or native/reference authority changed; preserve this receipt and create a new review.');
  assertContext(context);return publicReview(stored);
}
/** Per-call verified object cache: preparation reads originals; publication uses
 * cached immutable results only after the existing authority rechecks input/access/fence.
 * This changes no source reader and admits no object I/O in the insertion transaction. */
export function cityjsonControlDocumentCache(reader=readDocumentResult){
  const results=new Map<string,Awaited<ReturnType<typeof readDocumentResult>>>();let publishing=false;
  const result:typeof readDocumentResult=async(input,resultSha256)=>{
    const id=fingerprint({input,resultSha256});
    if(publishing)return structuredClone(results.get(id)??conflict('The exact prepared document result is unavailable.'));
    const value=await reader(input,resultSha256);results.set(id,structuredClone(value));return value;
  };
  return {result,publication:()=>{publishing=true;}};
}
function session(dependencies?:CityJSONControlDependencies){
  if(dependencies)return {dependencies,publication:()=>dependencies};
  const cache=cityjsonControlDocumentCache();
  const deps:CityJSONControlDependencies={transaction,native:readRegistryCityJSONDraftTx,
    references:(client,draft,revision)=>readRegistryCityJSONReferenceAuthorityTx(client,draft,revision,
      {native:registryCityJSONAuthorityTx,document:associationDocumentInputTx,result:cache.result})};
  return {dependencies:deps,publication:()=>{cache.publication();return deps;}};
}
export const createRegistryCityJSONControlReview=(draftValue:string,raw:unknown,dependencies?:CityJSONControlDependencies)=>privateReview(async()=>{
  const draftId=uuid.parse(draftValue),request=RegistryCityJSONControlReviewRequestSchema.parse(raw),runtime=session(dependencies);
  bounded(request,CITYJSON_CONTROL_REVIEW_LIMITS.requestBytes);
  const prepared=await prepareCityJSONControls(draftId,request.comparison,runtime.dependencies),context=prepared.context;
  assertDecision(request,prepared.assessment);const preparedPins=authority(prepared.aggregate,prepared.sources,context);
  const deps=runtime.publication();
  return deps.transaction(async client=>{
    const aggregate=await deps.references(client,draftId,request.comparison.expectedDraftRevision);
    const sources=await cityjsonControlSourcesTx(client,aggregate,request.comparison),pins=authority(aggregate,sources,context);
    if(fingerprint(pins)!==fingerprint(preparedPins))conflict('The complete comparison authority changed before review publication.');
    assertPins(request,pins);assertContext(context);
    const id=identity(draftId,aggregate.current.draft.case_id,request.requestKey),digest=fingerprint({request,context});
    const prior=(await client.query('SELECT payload_hash,result FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind=$3',
      [aggregate.current.draft.case_id,key(draftId,id),kind])).rows[0];
    if(prior){if(prior.payload_hash!==digest)conflict('This request key already names a different control review.');
      const view=checked(prior,aggregate,sources,context,id);
      if(view.assessment.assessmentSha256!==prepared.assessment.assessmentSha256)conflict('The replayed comparison changed.');return view;}
    const body={version:kind,id,authority:pins,scope:'selected_point_control_comparison',assessment:prepared.assessment,decision:request.decision,
      reviewedAt:new Date().toISOString(),attribution:'local_process',currentness:'current_authority',accuracy:'not_assessed',admission:'unavailable',
      qualification:'not_assessed',learningQualification:'not_assessed',request,reviewContext:context};
    const stored=bounded(RegistryCityJSONControlReviewStoredSchema.parse({...body,reviewSha256:fingerprint(body)}));
    assertContext(context);await client.query('INSERT INTO operations(case_id,operation_key,kind,payload_hash,result) VALUES($1,$2,$3,$4,$5)',
      [aggregate.current.draft.case_id,key(draftId,id),kind,digest,stored]);
    assertContext(context);return publicReview(stored);
  });
});
/** Same-client admission consumer: complete reference/native gates must already
 * be held. This reads a receipt and source rows, never a new object or case gate. */
export const readRegistryCityJSONControlReviewForAuthorityTx=(client:PoolClient,aggregate:Aggregate,idValue:string)=>privateReview(async()=>{
  const id=RegistryCityJSONControlReviewIdSchema.parse(idValue),context=documentReviewContext();
  const row=(await client.query('SELECT payload_hash,result FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind=$3',
    [aggregate.current.draft.case_id,key(aggregate.current.draft.id,id),kind])).rows[0]??notFound();
  const stored=RegistryCityJSONControlReviewStoredSchema.parse(row.result);
  const sources=await cityjsonControlSourcesTx(client,aggregate,stored.request.comparison);
  return checked(row,aggregate,sources,context,id);
});
export const readRegistryCityJSONControlReview=(draftValue:string,idValue:string,dependencies?:CityJSONControlDependencies)=>privateReview(async()=>{
  const deps=dependencies??session().dependencies,draftId=uuid.parse(draftValue),id=RegistryCityJSONControlReviewIdSchema.parse(idValue);
  return deps.transaction(async client=>readRegistryCityJSONControlReviewForAuthorityTx(client,await deps.references(client,draftId),id));
});
export function cityjsonControlReviewSummary(review:z.infer<typeof RegistryCityJSONControlReviewReadSchema>){
  return RegistryCityJSONControlReviewSummarySchema.parse({id:review.id,reviewSha256:review.reviewSha256,
    authoritySha256:review.authority.authoritySha256,assessmentSha256:review.assessment.assessmentSha256,scope:review.scope,
    disposition:review.decision.disposition,comparisonState:review.assessment.state,currentness:review.currentness,
    accuracy:review.accuracy,admission:review.admission,qualification:review.qualification,learningQualification:review.learningQualification});
}
export class CityJSONControlReviewService{
  create(draftId:string,raw:unknown){return createRegistryCityJSONControlReview(draftId,raw);}
  read(draftId:string,id:string){return readRegistryCityJSONControlReview(draftId,id);}
}
