import type {PoolClient} from 'pg';
import {z} from 'zod';
import {CITYJSON_REFERENCE_LIMITS,RegistryCityJSONCandidateSchema,RegistryCityJSONReferenceSchema,
  RegistryCityJSONReferencesSchema,RegistryCityJSONReferenceAttachSchema,RegistryCityJSONReferenceRemoveSchema,
  RegistryCityJSONReferenceReadSchema,RegistryCityJSONReferenceReceiptSchema,
  type RegistryCityJSONReference,type DocumentAssociationSource,type RegistryRecord} from '@ulpin/contracts';
import type {DocumentInput,DocumentPart} from '@ulpin/contracts/usp';
import {transaction} from '../../infrastructure/db';
import {AppError,conflict,notFound} from '../../infrastructure/errors';
import {fingerprint} from '../cases/domain';
import {lockSourceCaseDestinationTx} from '../cases/source-case-lock';
import {localRequestContext} from '../usp/principal';
import {associationDocumentInputTx} from '../usp/ingestion/document-association-authority';
import {readDocumentResult} from '../usp/ingestion/documents';
import {registryCityJSONAuthorityTx} from './cityjson-draft';
import {literalCitationParts,documentReviewContext} from './registry-document-evidence';

type Authority=Awaited<ReturnType<typeof registryCityJSONAuthorityTx>>;
type Dependencies={native:typeof registryCityJSONAuthorityTx;document:typeof associationDocumentInputTx;result:typeof readDocumentResult};
const defaults:Dependencies={native:registryCityJSONAuthorityTx,document:associationDocumentInputTx,result:readDocumentResult};
const uuid=z.uuid().transform(v=>v.toLowerCase());
const refs=(record:RegistryRecord)=>RegistryCityJSONReferencesSchema.parse(record.nativeExteriorReferences??[]);
function bounded<T>(value:T,limit:number){
  if(Buffer.byteLength(JSON.stringify(value))>limit)
    throw new AppError(413,'REGISTRY_CITYJSON_REFERENCE_LIMIT','Select fewer literal document reference parts for this private draft.');
  return value;
}
async function privateEvidence<T>(work:()=>Promise<T>):Promise<T>{
  try{return await work();}catch(error){
    if(error instanceof AppError&&(error.status===403||error.status===404))
      throw new AppError(404,'REGISTRY_CITYJSON_REFERENCE_UNAVAILABLE','The requested native draft reference evidence is unavailable.');
    throw error;
  }
}
/** Lookup only: discover the complete gate set without acquiring row locks or resolving private objects. */
function gateCases(draft:{case_id:string;records:RegistryRecord[]},extra?:DocumentAssociationSource){
  if(draft.records.length!==1)throw new AppError(422,'REGISTRY_CITYJSON_REFERENCE_DRAFT','Select one unrecorded native building draft.');
  const record=draft.records[0],candidate=RegistryCityJSONCandidateSchema.parse(record.nativeExteriorCandidate);
  return [...new Set([draft.case_id,candidate.input.caseId,...refs(record).map(pin=>pin.document.caseId),...(extra?[extra.caseId]:[])]
    .map(value=>uuid.parse(value)))].sort();
}
async function lockedAuthority(client:PoolClient,draftId:string,dependencies:Dependencies,extra?:DocumentAssociationSource){
  const lookup=(await client.query('SELECT site_id,case_id,records FROM registry_drafts WHERE id=$1',[draftId])).rows[0]??notFound();
  const cases=gateCases(lookup,extra);
  for(const caseId of cases)await lockSourceCaseDestinationTx(client,caseId);
  // Protect the lookup identities before invoking the single-case native helper:
  // a concurrent amendment may have changed its source or retained case set while
  // we waited for gates. Never let that helper acquire a newly discovered gate.
  const site=(await client.query('SELECT id FROM registry_sites WHERE id=$1 FOR UPDATE',[lookup.site_id])).rows[0]??notFound();
  const draft=(await client.query('SELECT * FROM registry_drafts WHERE id=$1 FOR UPDATE',[draftId])).rows[0]??notFound();
  if(draft.site_id!==site.id||draft.case_id!==lookup.case_id||fingerprint(gateCases(draft,extra))!==fingerprint(cases))
    conflict('The draft reference case set changed while acquiring its authority locks. Refresh the draft.');
  // The native helper reacquires its already-held gate before site/draft/source/job locks.
  // A newly discovered case is a conflict, never a gate acquired after destination rows.
  const current=await dependencies.native(client,draftId);
  if(current.draft.site_id!==lookup.site_id||current.draft.case_id!==lookup.case_id||fingerprint(gateCases(current.draft,extra))!==fingerprint(cases))
    conflict('The draft reference case set changed while acquiring its authority locks. Refresh the draft.');
  return current;
}
function target(current:Authority){return {draftId:current.draft.id,recordId:current.record.id,
  candidateSha256:fingerprint(current.candidate),selectionSha256:fingerprint(current.candidate.selection)};}
export function cityjsonReferenceId(pin:Pick<RegistryCityJSONReference,'document'|'partId'|'target'>){
  return fingerprint({document:pin.document,partId:pin.partId,target:pin.target});
}
async function acceptedFence(client:PoolClient,jobId:string){
  const fence=Number((await client.query('SELECT accepted_fence FROM usp_job_metadata WHERE job_id=$1',[jobId])).rows[0]?.accepted_fence);
  if(!Number.isSafeInteger(fence)||fence<1)conflict('The accepted document attempt is unavailable.');
  return fence;
}
function view(current:Authority,references:{pin:RegistryCityJSONReference;part:DocumentPart}[]){
  return bounded(RegistryCityJSONReferenceReadSchema.parse({draftId:current.draft.id,draftRevision:current.draft.revision,
    siteId:current.site.id,recordId:current.record.id,candidateSha256:fingerprint(current.candidate),nativeSelection:current.candidate.selection,
    referenceDeclaration:current.candidate.reference,references,associationState:'operator_selected',reviewedReference:'not_assessed',
    accuracy:'not_assessed',accuracyMetres:null,geographicRelationship:'not_assessed',globalPlacement:'not_qualified'}),CITYJSON_REFERENCE_LIMITS.readBytes);
}
/** Resolve every retained selection through the accepted document input/result authority. */
async function evidence(client:PoolClient,current:Authority,pins:RegistryCityJSONReference[],dependencies:Dependencies,
  add?:z.infer<typeof RegistryCityJSONReferenceAttachSchema>){
  const ctx=localRequestContext('registry-cityjson-references'),reviewContext=documentReviewContext();
  const groups=new Map<string,{document:DocumentAssociationSource;pins:RegistryCityJSONReference[];ids:string[]}>();
  for(const pin of pins){
    if(pin.selection.subject!==ctx.principal.subject)
      throw new AppError(403,'REGISTRY_CITYJSON_REFERENCE_DENIED','The selected document reference context is unavailable.');
    if(pin.id!==cityjsonReferenceId(pin)||fingerprint(pin.target)!==fingerprint(target(current)))
      conflict('The reference selection belongs to another native candidate.');
    const key=fingerprint(pin.document),group=groups.get(key)??{document:pin.document,pins:[],ids:[]};
    group.pins.push(pin);group.ids.push(pin.partId);groups.set(key,group);
  }
  if(add){
    const key=fingerprint(add.document),group=groups.get(key)??{document:add.document,pins:[],ids:[]};
    group.ids=[...new Set([...group.ids,...add.partIds])];groups.set(key,group);
  }
  const entries:{pin:RegistryCityJSONReference;part:DocumentPart}[]=[],added:RegistryCityJSONReference[]=[];
  const checked:{document:DocumentAssociationSource;input:DocumentInput;fence:number}[]=[];
  // All case gates are already held. Acquire remaining case/source/job rows in a stable order.
  const ordered=[...groups.values()].sort((a,b)=>a.document.caseId.localeCompare(b.document.caseId)||
    a.document.sourceId.localeCompare(b.document.sourceId)||a.document.jobId.localeCompare(b.document.jobId));
  for(const group of ordered){
    const input=await dependencies.document(client,ctx,group.document,undefined,true),fence=await acceptedFence(client,input.jobId);
    if(input.ocrSelection||input.archiveSelection)
      throw new AppError(422,'REGISTRY_CITYJSON_REFERENCE_NATIVE','Select literal native document parts without OCR or archive inventory.');
    const result=await dependencies.result(input,group.document.resultSha256),parts=literalCitationParts(result,input,group.ids);
    const byPart=new Map(parts.map(part=>[part.id,part]));
    for(const pin of group.pins){
      const part=byPart.get(pin.partId)!;
      if(pin.inputSha256!==fingerprint(input)||pin.readerSha256!==input.readerSha256||pin.acceptedFence!==fence||
        pin.selection.accessSha256!==input.accessSha256||pin.partSha256!==part.sha256||fingerprint(pin.locator)!==fingerprint(part.locator))
        conflict('The exact document input, reader, part, locator, access or accepted attempt changed.');
      entries.push({pin,part});
    }
    if(add&&fingerprint(add.document)===fingerprint(group.document))for(const id of add.partIds){
      const part=byPart.get(id)!,identity={document:add.document,partId:id,target:target(current)};
      if(pins.some(pin=>pin.id===cityjsonReferenceId(identity)))continue;
      const pin=RegistryCityJSONReferenceSchema.parse({...identity,id:cityjsonReferenceId(identity),version:'registry-cityjson-reference/1',
        inputSha256:fingerprint(input),readerSha256:input.readerSha256,acceptedFence:fence,partSha256:part.sha256,locator:part.locator,
        selection:{subject:ctx.principal.subject,accessSha256:input.accessSha256,selectedAt:new Date().toISOString()},
        associationState:'operator_selected',applicability:'not_assessed',accuracy:'not_assessed'});
      added.push(pin);entries.push({pin,part});
    }
    checked.push({document:group.document,input,fence});
  }
  // All object I/O is finished before the complete aggregate is revalidated.
  for(const item of checked){
    await dependencies.document(client,ctx,item.document,item.input,true);
    if(await acceptedFence(client,item.input.jobId)!==item.fence)conflict('The accepted document attempt changed during its private read.');
  }
  const heldDraft=(await client.query('SELECT * FROM registry_drafts WHERE id=$1 FOR UPDATE',[current.draft.id])).rows[0]??notFound();
  if(fingerprint(heldDraft)!==fingerprint(current.draft))conflict('The exact native draft changed during private reference I/O.');
  const after=await dependencies.native(client,current.draft.id);
  if(fingerprint(after)!==fingerprint(current)||fingerprint(documentReviewContext())!==fingerprint(reviewContext))
    conflict('The draft, native source or access aggregate changed during private reference I/O.');
  const next=bounded(RegistryCityJSONReferencesSchema.parse([...pins,...added]),CITYJSON_REFERENCE_LIMITS.pinBytes);
  const byId=new Map(entries.map(entry=>[entry.pin.id,entry]));
  const orderedEntries=next.map(pin=>byId.get(pin.id)!);
  view(current,orderedEntries); // A persisted selection must also fit its private read projection.
  return {pins:next,entries:orderedEntries};
}
async function mutate(client:PoolClient,draftId:string,raw:unknown,kind:'attach'|'remove',dependencies:Dependencies){
  draftId=uuid.parse(draftId);
  const request=kind==='attach'?RegistryCityJSONReferenceAttachSchema.parse(raw):RegistryCityJSONReferenceRemoveSchema.parse(raw);
  const add=kind==='attach'?RegistryCityJSONReferenceAttachSchema.parse(request):undefined;
  const removal=kind==='remove'?RegistryCityJSONReferenceRemoveSchema.parse(request):undefined;
  const current=await lockedAuthority(client,draftId,dependencies,add?.document),old=refs(current.record);
  const requestContext=documentReviewContext();
  const key=`registry-cityjson-reference-${kind}:${draftId}:${request.requestKey}`,
    digest=fingerprint({draftId,kind,request,context:requestContext});
  const prior=(await client.query("SELECT payload_hash,result FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind='registry-cityjson-reference'",
    [current.draft.case_id,key])).rows[0];
  if(prior){
    const receipt=RegistryCityJSONReferenceReceiptSchema.parse(prior.result);
    if(prior.payload_hash!==digest||receipt.draftId!==draftId||receipt.recordId!==current.record.id||
      receipt.draftRevision!==current.draft.revision||receipt.referencesSha256!==fingerprint(old))
      conflict('This reference request or its current draft changed.');
    await evidence(client,current,old,dependencies);return receipt;
  }
  if(current.draft.revision!==request.expectedDraftRevision)conflict('Pin the current draft revision before changing its exact references.');
  const remove=removal?.clearAll?old.map(pin=>pin.id):removal?.remove??[];
  if(remove.some(id=>!old.some(pin=>pin.id===id)))conflict('A selected reference to remove is absent from this draft.');
  // Removed sources need no private read or current authority. Retained/additional selections still do.
  const resolved=await evidence(client,current,old.filter(pin=>!remove.includes(pin.id)),dependencies,add);
  const changed=fingerprint(old)!==fingerprint(resolved.pins);
  if(changed){
    const {nativeExteriorReferences:_old,...body}=current.record;
    const next={...body,...(resolved.pins.length?{nativeExteriorReferences:resolved.pins}:{})};
    await client.query('UPDATE registry_drafts SET records=$2,revision=revision+1 WHERE id=$1',[draftId,JSON.stringify([next])]);
  }
  const receipt=RegistryCityJSONReferenceReceiptSchema.parse({draftId,draftRevision:current.draft.revision+(changed?1:0),
    recordId:current.record.id,referencesSha256:fingerprint(resolved.pins),changed,validation:'requires_current_draft_revision'});
  await client.query("INSERT INTO operations(case_id,operation_key,kind,payload_hash,result) VALUES($1,$2,'registry-cityjson-reference',$3,$4)",
    [current.draft.case_id,key,digest,receipt]);
  if(fingerprint(documentReviewContext())!==fingerprint(requestContext))
    throw new AppError(403,'REGISTRY_CITYJSON_REFERENCE_DENIED','The private operator context changed before the amendment completed.');
  return receipt;
}
export const attachRegistryCityJSONReferencesTx=(client:PoolClient,draftId:string,raw:unknown,dependencies:Dependencies=defaults)=>
  privateEvidence(()=>mutate(client,draftId,raw,'attach',dependencies));
export const removeRegistryCityJSONReferencesTx=(client:PoolClient,draftId:string,raw:unknown,dependencies:Dependencies=defaults)=>
  privateEvidence(()=>mutate(client,draftId,raw,'remove',dependencies));
export const attachRegistryCityJSONReferences=(draftId:string,raw:unknown)=>transaction(client=>attachRegistryCityJSONReferencesTx(client,draftId,raw));
export const removeRegistryCityJSONReferences=(draftId:string,raw:unknown)=>transaction(client=>removeRegistryCityJSONReferencesTx(client,draftId,raw));
export const readRegistryCityJSONReferencesTx=(client:PoolClient,draftValue:string,dependencies:Dependencies=defaults)=>privateEvidence(async()=>{
  const current=await lockedAuthority(client,uuid.parse(draftValue),dependencies);
  const resolved=await evidence(client,current,refs(current.record),dependencies);
  return view(current,resolved.entries);
});
export const readRegistryCityJSONReferences=(draftId:string)=>transaction(client=>readRegistryCityJSONReferencesTx(client,draftId));
