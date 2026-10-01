import type {PoolClient} from 'pg';
import {z} from 'zod';
import {RegistryCityJSONPrepareSchema,RegistryCityJSONCandidateSchema,RegistryCityJSONReceiptSchema,
  RegistryCityJSONRemoveSchema,RegistryCityJSONRemovalReceiptSchema,RegistryCityJSONReadSchema,type RegistryCityJSONCandidate,
  type RegistryCityJSONPrepare,type RegistryBody,type RegistryRecord} from '@ulpin/contracts';
import type {CityJSONInput,CityJSONResult} from '@ulpin/contracts/usp';
import {transaction} from '../../infrastructure/db';
import {AppError,conflict,notFound} from '../../infrastructure/errors';
import {sha256} from '../../infrastructure/storage';
import {fingerprint} from '../cases/domain';
import {lockSourceCaseDestinationTx} from '../cases/source-case-lock';
import {ingestionBinding,assertIngestionBinding} from '../usp/ingestion/events';
import {acceptedCityJSONTx,readCityJSONResult,boundedCityJSONObject} from '../usp/ingestion/cityjson';
import {createRegistryDraftTx,createRegistrySiteTx,openRegistryRing} from './registry';

const MAX_READ_BYTES=1024*1024;
const uuid=z.uuid().transform(value=>value.toLowerCase());
const coordinate=z.tuple([z.number().finite(),z.number().finite(),z.number().finite()]);
const nativeSchema=z.object({schemaVersion:z.literal('source-native-cityjson/1'),sourceSha256:z.string(),sourceBytes:z.number(),
  sourceDocument:z.unknown(),verticesPointer:z.string(),transformPointer:z.string().nullable(),
  frame:z.object({referenceSystemState:z.string(),referenceSystem:z.unknown().optional()}),
  objects:z.array(z.object({id:z.string(),pointer:z.string(),type:z.string(),geometries:z.array(z.object({
    pointer:z.string(),type:z.string(),lod:z.unknown().optional(),status:z.string(),
    surfaces:z.array(z.object({pointer:z.string(),ringPointers:z.array(z.string())}))}))})).max(1000)});
type Dependencies={accepted:typeof acceptedCityJSONTx;result:typeof readCityJSONResult;
  artifact:typeof boundedCityJSONObject;createDraft:typeof createRegistryDraftTx;createSite:typeof createRegistrySiteTx};
const defaults:Dependencies={accepted:acceptedCityJSONTx,result:readCityJSONResult,artifact:boundedCityJSONObject,
  createDraft:createRegistryDraftTx,createSite:createRegistrySiteTx};
const sourcePin=(candidate:RegistryCityJSONCandidate)=>({...candidate.input,resultSha256:candidate.resultSha256});
function reject(code:string,message:string):never{throw new AppError(422,code,message);}
function bounded<T>(value:T):T{
  if(Buffer.byteLength(JSON.stringify(value))>MAX_READ_BYTES)
    throw new AppError(413,'REGISTRY_CITYJSON_READ_LIMIT','This geometry exceeds the bounded draft view; native original and artifact remain available.');
  return value;
}
/** RFC6901 lookup within the already accepted native artifact, never a URL/path. */
export function nativePointer(document:unknown,pointer:string):any{
  if(!pointer.startsWith('/'))reject('REGISTRY_CITYJSON_LOCATOR','Use an exact native pointer.');
  let value:any=document;
  for(const encoded of pointer.slice(1).split('/')){
    if(/~(?![01])/u.test(encoded))reject('REGISTRY_CITYJSON_LOCATOR','Invalid native pointer encoding.');
    const key=encoded.replaceAll('~1','/').replaceAll('~0','~');
    if(value===null||typeof value!=='object'||!Object.hasOwn(value,key))
      reject('REGISTRY_CITYJSON_LOCATOR','The exact source locator is unavailable.');
    value=value[key];
  }
  return value;
}
/** Resolve one existing geometry, actual parent and planar face; no new reader. */
export function selectCityJSONExterior(bytes:Uint8Array,input:CityJSONInput,result:CityJSONResult,
  selection:Pick<RegistryCityJSONPrepare,'buildingObjectId'|'objectId'|'geometryPointer'|'footprintSurfacePointer'>){
  if(bytes.length!==result.artifact.bytes||sha256(bytes)!==result.artifact.sha256)
    reject('REGISTRY_CITYJSON_ARTIFACT','Native artifact differs from its accepted hash/length.');
  const native=nativeSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
  if(native.sourceSha256!==input.sourceSha256||native.sourceBytes!==input.sourceBytes)
    reject('REGISTRY_CITYJSON_SOURCE','Native artifact belongs to another source.');
  if(native.frame.referenceSystemState!=='declared'||native.frame.referenceSystem!=='https://www.opengis.net/def/crs/EPSG/0/7415')
    reject('REGISTRY_CITYJSON_REFERENCE','This slice needs a declared EPSG:7415/NAP source; other or missing references remain unsupported.');
  const building=native.objects.find(o=>o.id===selection.buildingObjectId),object=native.objects.find(o=>o.id===selection.objectId);
  if(!building||building.type!=='Building'||!object||!['Building','BuildingPart'].includes(object.type))
    reject('REGISTRY_CITYJSON_BUILDING','Select one source building or its actual BuildingPart.');
  const buildingBody=nativePointer(native.sourceDocument,building.pointer),objectBody=nativePointer(native.sourceDocument,object.pointer);
  if(object.id!==building.id&&(!Array.isArray(objectBody.parents)||objectBody.parents.length!==1||objectBody.parents[0]!==building.id||
    !Array.isArray(buildingBody.children)||!buildingBody.children.includes(object.id)))
    reject('REGISTRY_CITYJSON_PARENT','The selection needs one explicitly recorded native building parent.');
  const geometry=object.geometries.find(g=>g.pointer===selection.geometryPointer);
  if(!geometry||geometry.status!=='supported'||!['Solid','MultiSurface'].includes(geometry.type))
    reject('REGISTRY_CITYJSON_GEOMETRY','Choose an existing supported exterior geometry.');
  const footprintGeometry=building.geometries.find(g=>g.type==='MultiSurface'&&g.lod==='0'&&g.status==='supported'&&
    g.surfaces.some(s=>s.pointer===selection.footprintSurfacePointer));
  const surface=footprintGeometry?.surfaces.find(s=>s.pointer===selection.footprintSurfacePointer);
  if(!surface||surface.ringPointers.length!==1)
    reject('REGISTRY_CITYJSON_FOOTPRINT','A source-supplied LoD0 planar face with one ring is required; holes or missing faces stay unsupported.');
  const vertices=z.array(coordinate).max(100000).parse(nativePointer(native.sourceDocument,native.verticesPointer));
  const transform=native.transformPointer===null?null:nativePointer(native.sourceDocument,native.transformPointer);
  const decodedTransform=transform===null?{scale:[1,1,1],translate:[0,0,0]}:
    z.object({scale:coordinate,translate:coordinate}).parse(transform);
  const indices=z.array(z.number().int().nonnegative()).min(3).max(500).parse(nativePointer(native.sourceDocument,surface.ringPointers[0]));
  const points=indices.map(index=>{
    const vertex=vertices[index];if(!vertex)reject('REGISTRY_CITYJSON_FOOTPRINT','Footprint refers to a missing encoded vertex.');
    return vertex.map((v,i)=>v*decodedTransform.scale[i]+decodedTransform.translate[i]);
  });
  if(points.some(p=>p.some(v=>!Number.isFinite(v)||Math.abs(v)>1000000)||p[2]!==points[0][2]))
    reject('REGISTRY_CITYJSON_FOOTPRINT','The selected face must be horizontal in the declared source frame.');
  const footprint=openRegistryRing(points.map(p=>[p[0],p[1]] as [number,number]));
  if(footprint.length<3)reject('REGISTRY_CITYJSON_FOOTPRINT','The selected ring needs at least three source positions.');
  const rawGeometry=nativePointer(native.sourceDocument,geometry.pointer);
  const footprintSurface=nativePointer(native.sourceDocument,surface.pointer);
  return bounded({native:{building:buildingBody,object:objectBody,geometry:rawGeometry,encodedVertices:vertices,transform,footprintSurface},
    footprint,selection:{buildingObjectId:building.id,objectId:object.id,buildingPointer:building.pointer,objectPointer:object.pointer,
      geometryPointer:geometry.pointer,geometrySha256:fingerprint(rawGeometry),objectSha256:fingerprint(objectBody),
      footprintSurfacePointer:surface.pointer,footprintSha256:fingerprint(footprintSurface),verticesPointer:native.verticesPointer,
      verticesSha256:fingerprint(vertices),transformPointer:native.transformPointer,transformSha256:fingerprint(transform)}});
}
function sourceFrame(){return {id:'EPSG:7415',horizontalUnit:'m' as const,verticalUnit:'m' as const,benchmark:'NAP'};}
function compatibleSite(site:any){
  if(site.synthetic||fingerprint(site.frame)!==fingerprint(sourceFrame()))
    reject('REGISTRY_CITYJSON_SITE','Use a separate nonsynthetic source-declared EPSG:7415/NAP draft site. No reference qualification is asserted.');
}
function receipt(draft:any,record:RegistryRecord){return RegistryCityJSONReceiptSchema.parse({draftId:draft.id,
  draftRevision:draft.revision,recordId:record.id,siteId:draft.site_id,state:'unrecorded',qualification:'not_assessed'});}
function compareAuthority(before:Awaited<ReturnType<typeof acceptedCityJSONTx>>,after:Awaited<ReturnType<typeof acceptedCityJSONTx>>){
  if(fingerprint(before.input)!==fingerprint(after.input)||before.job.accepted_fence!==after.job.accepted_fence||
    fingerprint(before.job.result_ref)!==fingerprint(after.job.result_ref))conflict('The accepted native attempt changed during object I/O.');
}
async function lockedDraft(client:PoolClient,draftId:string,protectedSourceCaseId?:string,lookup?:{site_id:string}){
  const initial=lookup??(await client.query('SELECT site_id FROM registry_drafts WHERE id=$1',[draftId])).rows[0]??notFound();
  const site=(await client.query('SELECT * FROM registry_sites WHERE id=$1 FOR UPDATE',[initial.site_id])).rows[0]??notFound();
  const draft=(await client.query('SELECT * FROM registry_drafts WHERE id=$1 FOR UPDATE',[draftId])).rows[0]??notFound();
  if(draft.site_id!==site.id||draft.status!=='draft')conflict('Choose an active native exterior draft.');
  if(protectedSourceCaseId&&uuid.parse(RegistryCityJSONCandidateSchema.parse(nativeRecord(draft).nativeExteriorCandidate).input.caseId)!==protectedSourceCaseId)
    conflict('The native draft source case changed while acquiring its authority locks.');
  return {site,draft};
}
function nativeRecord(draft:any){
  if(draft.records.length!==1)reject('REGISTRY_CITYJSON_DRAFT','This profile contains one building candidate.');
  const record=draft.records[0] as RegistryRecord;
  if(record.kind!=='building'||record.revision!==0||!record.nativeExteriorCandidate)
    reject('REGISTRY_CITYJSON_DRAFT','This draft has no unrecorded native exterior candidate.');
  return record;
}
function currentCandidate(site:any,draft:any,record:RegistryRecord){
  const candidate=RegistryCityJSONCandidateSchema.parse(record.nativeExteriorCandidate),binding=ingestionBinding(candidate.input.caseId);
  if(binding.subject!==candidate.input.subject||binding.access!==candidate.input.accessSha256)
    throw new AppError(403,'REGISTRY_CITYJSON_DENIED','This native candidate is unavailable to the current private context.');
  assertIngestionBinding(binding);compatibleSite(site);
  if(candidate.site.id!==site.id||candidate.site.revision!==site.revision||candidate.site.frameSha256!==fingerprint(site.frame)||
    record.siteId!==site.id||fingerprint(candidate.representation)!==fingerprint(nativeRepresentation(record.id,candidate.input.jobId)))
    conflict('The draft site or representation pins changed.');
  return candidate;
}
function nativeRepresentation(recordId:string,jobId:string){return {ref:{namespace:'representation',id:recordId},revision:0,
  entity:{namespace:'registry_record',id:recordId},frame:null,role:'exterior',geometry:{profile:'asset',
    asset:{ref:{namespace:'asset',id:`cityjson:${jobId}`},revision:1},format:'source-native-cityjson/1'},sourceParts:[]};}
export async function prepareRegistryCityJSONDraftTx(client:PoolClient,raw:unknown,dependencies:Dependencies=defaults){
  const request=RegistryCityJSONPrepareSchema.parse(raw),binding=ingestionBinding(request.source.caseId);
  await lockSourceCaseDestinationTx(client,request.source.caseId);
  let site:any;
  if(request.destination.kind==='existing_site'){
    site=(await client.query('SELECT * FROM registry_sites WHERE id=$1 FOR UPDATE',[request.destination.siteId])).rows[0]??notFound();
    compatibleSite(site);if(site.revision!==request.destination.expectedSiteRevision)conflict('Pin the current destination site.');
  }
  const operationKey=`registry-cityjson-draft:${request.requestKey}`,digest=fingerprint({request,access:binding.access});
  const intent=fingerprint({destination:request.destination.kind==='source_site'?request.destination:{kind:'existing_site',siteId:site.id},
    source:request.source,buildingObjectId:request.buildingObjectId,objectId:request.objectId,
    geometryPointer:request.geometryPointer,footprintSurfacePointer:request.footprintSurfacePointer,access:binding.access});
  const prior=(await client.query("SELECT payload_hash,result FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind='registry-cityjson-draft'",
    [request.source.caseId,operationKey])).rows[0];
  if(prior&&prior.payload_hash!==digest)conflict('This request key names a different native draft selection.');
  const duplicate=prior??(await client.query("SELECT result FROM operations WHERE case_id=$1 AND kind='registry-cityjson-draft' AND result->>'intentSha256'=$2 LIMIT 1",
    [request.source.caseId,intent])).rows[0];
  if(duplicate){
    const state=await lockedDraft(client,duplicate.result.receipt.draftId);
    if(state.draft.revision!==duplicate.result.receipt.draftRevision)
      conflict('The existing native draft was amended or removed; no duplicate was created.');
    const record=nativeRecord(state.draft);
    const candidate=currentCandidate(state.site,state.draft,record);
    if(candidate.intentSha256!==intent||uuid.parse(candidate.input.caseId)!==request.source.caseId||
      record.id!==duplicate.result.receipt.recordId||state.site.id!==duplicate.result.receipt.siteId)
      conflict('The existing native draft was amended or removed; no duplicate was created.');
    const authority=await dependencies.accepted(client,sourcePin(candidate),true);
    if(fingerprint(authority.input)!==fingerprint(candidate.input)||Number(authority.job.accepted_fence)!==candidate.acceptedFence)
      conflict('The retained candidate no longer names its exact accepted attempt.');
    if(!prior)await client.query("INSERT INTO operations(case_id,operation_key,kind,payload_hash,result) VALUES($1,$2,'registry-cityjson-draft',$3,$4)",
      [request.source.caseId,operationKey,digest,duplicate.result]);
    assertIngestionBinding(binding);
    return RegistryCityJSONReceiptSchema.parse(duplicate.result.receipt);
  }
  // A generic draft can already own this key on an existing site. Its canonical
  // replay must never become permission to replace an unrelated draft payload.
  if(site&&(await client.query('SELECT id FROM registry_drafts WHERE site_id=$1 AND request_key=$2 FOR UPDATE',
    [site.id,request.requestKey])).rowCount)
    conflict('This request key already names another registry draft. Use a fresh native preparation key.');
  const before=await dependencies.accepted(client,request.source,true),result=await dependencies.result(before.input,request.source.resultSha256);
  const bytes=await dependencies.artifact(result.artifact.key,result.artifact.bytes),selected=selectCityJSONExterior(bytes,before.input,result,request);
  const after=await dependencies.accepted(client,request.source,true);compareAuthority(before,after);
  if(!site)site=await dependencies.createSite(client,'Source-native exterior review',sourceFrame(),false);
  compatibleSite(site);
  // The revision-zero identity reservation carries no private source geometry.
  // Only the dedicated draft payload below receives the derived footprint.
  const body:RegistryBody={alias:'Source exterior',name:'Source-native building exterior',kind:'building',footprint:[],
    links:[],rights:[],evidence:[],synthetic:false};
  const created=await dependencies.createDraft(client,site.id,undefined,body,request.requestKey);
  const record=created.records[0];
  const candidate=RegistryCityJSONCandidateSchema.parse({version:'registry-cityjson-draft/1',state:'unrecorded',qualification:'not_assessed',
    intentSha256:intent,input:before.input,resultSha256:request.source.resultSha256,acceptedFence:Number(before.job.accepted_fence),artifact:result.artifact,
    site:{id:site.id,revision:site.revision,frameSha256:fingerprint(site.frame)},selection:selected.selection,
    reference:{state:'declared',crs:'EPSG:7415',vertical:'NAP',qualification:'not_assessed'},
    representation:nativeRepresentation(record.id,before.input.jobId)});
  const records=[{...record,footprint:selected.footprint,nativeExteriorCandidate:candidate}];
  await client.query('UPDATE registry_drafts SET records=$2 WHERE id=$1',[created.id,JSON.stringify(records)]);
  const response=receipt({id:created.id,revision:created.revision,site_id:site.id},record);
  assertIngestionBinding(binding);
  await client.query("INSERT INTO operations(case_id,operation_key,kind,payload_hash,result) VALUES($1,$2,'registry-cityjson-draft',$3,$4)",
    [request.source.caseId,operationKey,digest,{intentSha256:intent,receipt:response}]);
  assertIngestionBinding(binding);
  return response;
}
export const prepareRegistryCityJSONDraft=(raw:unknown)=>transaction(client=>prepareRegistryCityJSONDraftTx(client,raw));
/** Current same-client authority for validation. Source gate precedes destination/job locks; no process I/O. */
export async function registryCityJSONAuthorityTx(client:PoolClient,draftId:string,accepted=acceptedCityJSONTx){
  draftId=uuid.parse(draftId);
  const lookup=(await client.query('SELECT site_id,records FROM registry_drafts WHERE id=$1',[draftId])).rows[0]??notFound();
  const sourceCaseId=uuid.parse(RegistryCityJSONCandidateSchema.parse(nativeRecord(lookup).nativeExteriorCandidate).input.caseId);
  await lockSourceCaseDestinationTx(client,sourceCaseId);
  const {site,draft}=await lockedDraft(client,draftId,sourceCaseId,lookup),record=nativeRecord(draft),candidate=currentCandidate(site,draft,record);
  const authority=await accepted(client,sourcePin(candidate),true);
  if(fingerprint(authority.input)!==fingerprint(candidate.input)||Number(authority.job.accepted_fence)!==candidate.acceptedFence)
    conflict('The retained candidate no longer names its exact accepted attempt.');
  return {site,draft,record,candidate};
}
export async function readRegistryCityJSONDraftTx(client:PoolClient,draftId:string,dependencies:Dependencies=defaults){
  draftId=uuid.parse(draftId);
  // Lookup only: acquire the source-case gate before destination rows, then
  // revalidate both lookup identities under their canonical row locks.
  const lookup=(await client.query('SELECT site_id,records FROM registry_drafts WHERE id=$1',[draftId])).rows[0]??notFound();
  const sourceCaseId=uuid.parse(RegistryCityJSONCandidateSchema.parse(nativeRecord(lookup).nativeExteriorCandidate).input.caseId);
  await lockSourceCaseDestinationTx(client,sourceCaseId);
  const {site,draft}=await lockedDraft(client,draftId,sourceCaseId,lookup),record=nativeRecord(draft),candidate=currentCandidate(site,draft,record);
  const before=await dependencies.accepted(client,sourcePin(candidate),true);
  if(fingerprint(before.input)!==fingerprint(candidate.input)||Number(before.job.accepted_fence)!==candidate.acceptedFence)
    conflict('The retained candidate no longer names its exact accepted attempt.');
  const result=await dependencies.result(candidate.input,candidate.resultSha256);
  if(fingerprint(result.artifact)!==fingerprint(candidate.artifact))conflict('The native artifact receipt changed.');
  const selected=selectCityJSONExterior(await dependencies.artifact(result.artifact.key,result.artifact.bytes),candidate.input,result,candidate.selection);
  if(fingerprint(selected.selection)!==fingerprint(candidate.selection)||fingerprint(selected.footprint)!==fingerprint(record.footprint))
    conflict('The native selection or derived footprint changed.');
  compareAuthority(before,await dependencies.accepted(client,sourcePin(candidate),true));currentCandidate(site,draft,record);
  return bounded(RegistryCityJSONReadSchema.parse({draftId,draftRevision:draft.revision,recordId:record.id,candidate,native:selected.native}));
}
export const readRegistryCityJSONDraft=(draftId:string)=>transaction(client=>readRegistryCityJSONDraftTx(client,draftId));
/** Removal needs current local draft authority, never revoked source pins or I/O. */
export async function removeRegistryCityJSONDraftTx(client:PoolClient,draftId:string,raw:unknown){
  draftId=uuid.parse(draftId);
  const request=RegistryCityJSONRemoveSchema.parse(raw),{site,draft}=await lockedDraft(client,draftId);
  const binding=ingestionBinding(draft.case_id),key=`registry-cityjson-remove:${request.requestKey}`,
    digest=fingerprint({request,draftId,access:binding.access});
  const prior=(await client.query("SELECT payload_hash,result FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind='registry-cityjson-remove'",
    [draft.case_id,key])).rows[0];
  if(prior){if(prior.payload_hash!==digest||prior.result.draftRevision!==draft.revision)conflict('This removal request or draft changed.');
    assertIngestionBinding(binding);return RegistryCityJSONRemovalReceiptSchema.parse(prior.result);}
  if(draft.revision!==request.expectedDraftRevision)conflict('Pin the current draft before removing its native candidate.');
  const record=nativeRecord(draft);if(record.id!==request.recordId)conflict('Choose the exact draft record.');
  const {nativeExteriorCandidate:_removed,nativeExteriorReferences:_removedReferences,...remaining}=record;
  await client.query('UPDATE registry_drafts SET records=$2,revision=revision+1 WHERE id=$1',[draftId,JSON.stringify([{...remaining,footprint:[]}])]);
  const response=RegistryCityJSONRemovalReceiptSchema.parse({draftId,draftRevision:draft.revision+1,recordId:record.id,siteId:site.id,state:'removed'});
  await client.query("INSERT INTO operations(case_id,operation_key,kind,payload_hash,result) VALUES($1,$2,'registry-cityjson-remove',$3,$4)",
    [draft.case_id,key,digest,response]);assertIngestionBinding(binding);return response;
}
export const removeRegistryCityJSONDraft=(draftId:string,raw:unknown)=>transaction(client=>removeRegistryCityJSONDraftTx(client,draftId,raw));
