import type {PoolClient} from 'pg';
import type {RegistryRecord} from '@ulpin/contracts';
import {DOCUMENT_LIMITS} from '@ulpin/contracts/usp';
import {RegistryRecordEvidenceRequestSchema,RegistryRecordEvidenceSchema,type RegistryRecordEvidenceRequest}
  from '../../../../contracts/src/registry-record-evidence';
import {SOURCE_FUSION_LIMITS} from '../../../../contracts/src/source-fusion';
import {transaction} from '../../infrastructure/db';
import {AppError,conflict,notFound} from '../../infrastructure/errors';
import {readObjectBounded} from '../../infrastructure/storage';
import {fingerprint} from '../cases/domain';
import {recordFrom,recordBodySchema} from './registry';
import {assertRegistryCurrentCitationTargetTx,assertRegistryDocumentCitationsTx,documentReviewContext,
  type RegistryDocumentDependencies} from './registry-document-evidence';
import {lockRegistryDocumentCasesTx,registryRegionCases} from './registry-document-locks';
import {registrySourceTx,registryDocumentSourceAccessTx} from './registry-metadata';
import {associationDocumentInputTx} from '../usp/ingestion/document-association-authority';
import {readDocumentResult} from '../usp/ingestion/documents';
import {fusionLive,readFusionResult,type FusionBudget} from '../usp/ingestion/source-fusion-authority';

const defaults:RegistryDocumentDependencies={source:associationDocumentInputTx,result:readDocumentResult,
  registrySource:registrySourceTx,citationSource:registryDocumentSourceAccessTx};
const bodyBytes=4*1024*1024,siteBytes=1024*1024,responseReserve=8192;
const newBudget=():FusionBudget=>({deadlineAt:Date.now()+SOURCE_FUSION_LIMITS.deadlineMs,
  signal:new AbortController().signal,reservedBytes:0});
type Capture={record:any;site:any;history:any;body:any;selectedBody:any;projectStatus:string|null};

function eligible(kind:unknown,revision:unknown,status:unknown){
  if(!['building','floor','space'].includes(String(kind)))
    throw new AppError(422,'REGISTRY_DOCUMENT_TARGET','Choose an exact committed building, floor or supported space revision.');
  if(!Number.isSafeInteger(revision)||Number(revision)<1||['retired','cancelled_error'].includes(String(status)))
    conflict('The committed citation target is unavailable.');
}
/** Lookup only: no alias resolution, legacy synchronization or draft creation. */
async function targetTx(client:PoolClient,input:RegistryRecordEvidenceRequest){
  const row=(await client.query(`SELECT r.id,r.site_id,r.kind,r.revision,c.status project_status
    FROM registry_records r LEFT JOIN usp_project_codes c ON c.record_id=r.id WHERE r.id=$1`,[input.recordId])).rows[0];
  if(!row)notFound();eligible(row.kind,Number(row.revision),row.project_status);
  if(input.revision>Number(row.revision))notFound('This committed revision could not be found.');
  return row;
}
/** Bound stored JSON before it crosses SQL; preserve raw immutable bodies, not a parsed replacement. */
async function captureTx(client:PoolClient,input:RegistryRecordEvidenceRequest,lock=false):Promise<Capture>{
  const row=(await client.query(`SELECT
    CASE WHEN octet_length((to_jsonb(r)-'body')::text)<=$3 THEN to_jsonb(r)-'body' END record,
    CASE WHEN octet_length((to_jsonb(h)-'body')::text)<=$3 THEN to_jsonb(h)-'body' END history,
    CASE WHEN octet_length(to_jsonb(s)::text)<=$4 THEN to_jsonb(s) END site,
    CASE WHEN octet_length(r.body::text)<=$3 THEN r.body END body,
    CASE WHEN octet_length(h.body::text)<=$3 THEN h.body END selected_body,c.status project_status
    FROM registry_records r JOIN registry_sites s ON s.id=r.site_id
    JOIN registry_revisions h ON h.record_id=r.id AND h.revision=$2
    LEFT JOIN usp_project_codes c ON c.record_id=r.id WHERE r.id=$1${lock?' FOR SHARE OF r,h':''}`,
    [input.recordId,input.revision,bodyBytes,siteBytes])).rows[0];
  if(!row)notFound('This committed revision could not be found.');
  if(!row.record||!row.history||!row.site||!row.body||!row.selected_body)
    throw new AppError(413,'REGISTRY_RECORD_EVIDENCE_LIMIT','The recorded evidence context exceeds its bounded read profile.');
  const capture:Capture={record:row.record,site:row.site,history:row.history,body:row.body,
    selectedBody:row.selected_body,projectStatus:row.project_status??null};
  eligible(capture.record.kind,Number(capture.record.revision),capture.projectStatus);
  if(capture.record.id!==input.recordId||capture.history.record_id!==input.recordId||
    capture.record.site_id!==capture.site.id||Number(capture.history.revision)!==input.revision||
    input.revision>Number(capture.record.revision)||capture.body.kind!==capture.record.kind||
    capture.selectedBody.kind!==capture.record.kind||Number(capture.history.site_revision)>Number(capture.site.revision)||
    (input.revision===Number(capture.record.revision)&&fingerprint(capture.body)!==fingerprint(capture.selectedBody)))
    conflict('The exact committed target, site or revision body changed.');
  recordBodySchema.parse(capture.body);recordBodySchema.parse(capture.selectedBody);
  return capture;
}
function records(capture:Capture,input:RegistryRecordEvidenceRequest){
  const current=recordFrom({...capture.record,body:capture.body}),
    selected=recordFrom({...capture.record,body:capture.selectedBody,revision:input.revision});
  if(selected.kind==='space'&&(selected.documentCitations??[]).some(pin=>
    !['registry-ifc-citation/1','registry-document-region-citation/1'].includes(pin.version)))
    throw new AppError(422,'REGISTRY_DOCUMENT_TARGET','Space revisions support explicit IFC or source-region citations only.');
  return {current,selected};
}
const cases=(records:RegistryRecord[])=>[...new Set(records.flatMap(record=>
  (record.documentCitations??[]).map(pin=>pin.document.caseId.toLowerCase())))].sort();
function same(expected:Capture,actual:Capture){
  if(fingerprint(expected)!==fingerprint(actual))conflict('The complete committed target, site or requested history changed during its evidence read.');
}
/** One budget covers native documents and every fusion artifact. Native receipts lack a byte count;
 * reserve their producer's maximum once per exact result instead of claiming a measured size. */
function boundedDependencies(dependencies:RegistryDocumentDependencies,budget:FusionBudget):RegistryDocumentDependencies{
  const native=new Map<string,ReturnType<RegistryDocumentDependencies['result']>>();
  return {...dependencies,result:async(input,hash)=>{
    fusionLive(budget);const key=`${input.jobId}/${hash}`;
    let pending=native.get(key);
    if(!pending){
      if(budget.reservedBytes+DOCUMENT_LIMITS.resultBytes>SOURCE_FUSION_LIMITS.aggregateArtifactBytes)
        throw new AppError(413,'SOURCE_FUSION_ARTIFACT_LIMIT','Select a smaller source context.');
      budget.reservedBytes+=DOCUMENT_LIMITS.resultBytes;
      pending=dependencies.result(input,hash,key=>readObjectBounded(key,DOCUMENT_LIMITS.resultBytes,budget.deadlineAt,budget.signal));
      native.set(key,pending);
    }
    const result=await pending;fusionLive(budget);return result;
  },fusionResult:async(selection,authority,_localBudget,read)=>{
    fusionLive(budget);
    const result=await (dependencies.fusionResult??readFusionResult)(selection,authority,budget,read);
    fusionLive(budget);return result;
  }};
}

export async function readRegistryRecordEvidenceTx(client:PoolClient,raw:RegistryRecordEvidenceRequest,
  dependencies:RegistryDocumentDependencies=defaults,budget:FusionBudget=newBudget()){
  const input=RegistryRecordEvidenceRequestSchema.parse(raw);fusionLive(budget);
  await targetTx(client,input);
  const access=fingerprint(documentReviewContext()),before=await captureTx(client,input),
    initial=records(before,input),held=cases([initial.current,initial.selected]);
  // Canonical order: all source-case gates precede destination/site/record/source locks.
  await lockRegistryDocumentCasesTx(client,held,registryRegionCases([initial.current,initial.selected]));
  await client.query('SELECT id FROM registry_sites WHERE id=$1 FOR SHARE',[before.site.id]);
  const locked=await captureTx(client,input,true);same(before,locked);
  const {current,selected}=records(locked,input),bounded=boundedDependencies(dependencies,budget);
  await assertRegistryCurrentCitationTargetTx(client,current.siteId,current,true,bounded);
  fusionLive(budget);
  const citations=await assertRegistryDocumentCitationsTx(client,current.siteId,selected,false,bounded,true);
  await assertRegistryCurrentCitationTargetTx(client,current.siteId,current,false,bounded);
  same(locked,await captureTx(client,input));
  if(fingerprint(documentReviewContext())!==access)
    throw new AppError(403,'REGISTRY_DOCUMENT_REVIEW_DENIED','The private document access context changed during this read.');
  fusionLive(budget);
  const response=RegistryRecordEvidenceSchema.parse({version:'registry-record-evidence/1',recordId:input.recordId,
    siteId:current.siteId,recordKind:selected.kind,recordRevision:input.revision,recordBodySha256:fingerprint(locked.selectedBody),
    siteRevision:Number(locked.history.site_revision),currentRecordRevision:current.revision,currentSiteRevision:Number(locked.site.revision),
    snapshotState:input.revision===current.revision?'current':'historical',citations,
    associationState:'operator_selected',qualification:'not_assessed'});
  if(Buffer.byteLength(JSON.stringify(response))>SOURCE_FUSION_LIMITS.responseBytes-responseReserve)
    throw new AppError(413,'REGISTRY_RECORD_EVIDENCE_LIMIT','Select a smaller explicit evidence context.');
  fusionLive(budget);return response;
}
export function readRegistryRecordEvidence(raw:RegistryRecordEvidenceRequest){
  const input=RegistryRecordEvidenceRequestSchema.parse(raw),budget=newBudget();
  return transaction(client=>readRegistryRecordEvidenceTx(client,input,defaults,budget),
    {deadlineAt:budget.deadlineAt,signal:budget.signal});
}
export class RegistryRecordEvidenceService{
  read(recordId:string,revision:number){return readRegistryRecordEvidence({recordId,revision});}
}
