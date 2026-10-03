import {DocumentResultSchema,CityJSONResultSchema,IFCResultSchema,IFC_LIMITS,type DocumentInput,type CityJSONInput,type IFCInput} from '@ulpin/contracts/usp';
import {DXFResultSchema,DXF_LIMITS,type DXFInput} from '@ulpin/contracts/usp';
import type {RequestContext} from '@ulpin/contracts/usp';
import {SOURCE_FUSION_LIMITS,type SourceFusionSelection} from '../../../../../contracts/src/source-fusion';
import {transaction} from '../../../infrastructure/db';
import {AppError} from '../../../infrastructure/errors';
import {openObjectStream,sha256} from '../../../infrastructure/storage';
import {fingerprint} from '../../cases/domain';
import {lockSourceCaseDestinationTx} from '../../cases/source-case-lock';
import {assertLocalUsp} from '../snapshots';
import {associationDocumentInputTx} from './document-association-authority';
import {acceptedCityJSONTx,cityjsonResultKey,cityjsonArtifactKey} from './cityjson';
import {documentResultKey} from './documents';
import {ifcResultKey,ifcArtifactKey} from './ifc';
import {ifcSummary} from './ifc-processor';
import {acceptedFusionIFCTx,verifyFusionIFCTools} from './source-fusion-ifc-authority';
import {dxfResultKey,dxfArtifactKey} from './dxf';
import {dxfSummary} from './dxf-processor';
import {acceptedFusionDXFTx,verifyFusionDXFTools} from './source-fusion-dxf-authority';
import {KMLResultSchema,KML_LIMITS,type KMLInput} from '@ulpin/contracts/usp';
import {kmlResultKey,kmlArtifactKey} from './kml';
import {kmlSummary} from './kml-processor';
import {acceptedFusionKMLTx,verifyFusionKMLTools} from './source-fusion-kml-authority';
import {CityGMLResultSchema,CITYGML_LIMITS,type CityGMLInput} from '../../../../../contracts/src/usp/citygml-ingestion';
import {citygmlResultKey,citygmlArtifactKey} from './citygml';
import {citygmlSummary} from './citygml-processor';
import {acceptedFusionCityGMLTx,verifyFusionCityGMLTools} from './source-fusion-citygml-authority';

import {acceptedFusionGeoParquetTx,verifyFusionGeoParquetTools,readFusionGeoParquetResult,type FusionGeoParquetAuthority} from './source-fusion-geoparquet-authority';

export type FusionAuthority=FusionGeoParquetAuthority|{kind:'document';input:DocumentInput;acceptedFence:number}|
  {kind:'cityjson';input:CityJSONInput;acceptedFence:number}|{kind:'ifc';input:IFCInput;acceptedFence:number}|
  {kind:'dxf';input:DXFInput;acceptedFence:number}|{kind:'kml';input:KMLInput;acceptedFence:number}|{kind:'citygml';input:CityGMLInput;acceptedFence:number};
export type FusionBudget={deadlineAt:number;signal:AbortSignal;reservedBytes:number};
export function fusionLive(budget:Pick<FusionBudget,'deadlineAt'|'signal'>){
  if(budget.signal.aborted||Date.now()>=budget.deadlineAt)
    throw new AppError(503,'SOURCE_FUSION_DEADLINE','The bounded source context read expired.');
}
type AuthorityDependencies={transaction:typeof transaction;document:typeof associationDocumentInputTx;
  cityjson:typeof acceptedCityJSONTx;gate:typeof lockSourceCaseDestinationTx;
  ifc?:typeof acceptedFusionIFCTx;ifcTools?:typeof verifyFusionIFCTools;
  dxf?:typeof acceptedFusionDXFTx;dxfTools?:typeof verifyFusionDXFTools;
  kml?:typeof acceptedFusionKMLTx;kmlTools?:typeof verifyFusionKMLTools;
  citygml?:typeof acceptedFusionCityGMLTx;citygmlTools?:typeof verifyFusionCityGMLTools;
  geoparquet?:typeof acceptedFusionGeoParquetTx;geoparquetTools?:typeof verifyFusionGeoParquetTools};
const defaults:AuthorityDependencies={transaction,document:associationDocumentInputTx,cityjson:acceptedCityJSONTx,gate:lockSourceCaseDestinationTx};

/** All final rows share one transaction after ALL object I/O. No persistent write. */
export async function fusionAuthorityBatch(ctx:RequestContext,selections:SourceFusionSelection[],
  budget:FusionBudget,expected?:FusionAuthority[],deps:AuthorityDependencies=defaults):Promise<FusionAuthority[]>{
  assertLocalUsp(ctx);fusionLive(budget);
  const captured=await deps.transaction(async client=>{
    // Both captures use short owned lock scopes. The deadline-aware transaction
    // runs a SELECT guard before this callback, so SET TRANSACTION isolation is
    // too late here. Canonical mutation locks provide a coherent capture without
    // changing that shared deadline helper or holding locks across object I/O.
    const cases=[...new Set(selections.map(s=>s.pin.caseId))].sort();
    for(const caseId of cases)await deps.gate(client,caseId);
    await client.query('SELECT id FROM cases WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[cases]);
    // The document helper reads its source before its own SHARE lock. Lock all
    // selected rows first so even a same-revision direct source update cannot
    // race that read in either aggregate capture.
    await client.query('SELECT id FROM sources WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE',
      [[...new Set(selections.map(s=>s.pin.sourceId))].sort()]);
    const result:FusionAuthority[]=[];
    for(const [index,selection] of selections.entries()){
      fusionLive(budget);
      const pin=selection.pin;
      let authority:FusionAuthority;
      if(selection.kind==='ifc'){
        authority=await (deps.ifc??acceptedFusionIFCTx)(client,pin,true);
      }else if(selection.kind==='dxf'){
        authority=await (deps.dxf??acceptedFusionDXFTx)(client,pin,true);
      }else if(selection.kind==='kml'){
        authority=await (deps.kml??acceptedFusionKMLTx)(client,pin,true);
      }else if(selection.kind==='citygml'){
        authority=await (deps.citygml??acceptedFusionCityGMLTx)(client,pin,true);
      }else if(selection.kind==='geoparquet'){
        authority=await (deps.geoparquet??acceptedFusionGeoParquetTx)(client,pin,true);
      }else if(selection.kind!=='cityjson'){
        const prior=expected?.[index];
        const input=await deps.document(client,ctx,pin,prior?.kind==='document'?prior.input:undefined,true);
        const row=(await client.query('SELECT accepted_fence FROM usp_job_metadata WHERE job_id=$1',[pin.jobId])).rows[0];
        authority={kind:'document',input,acceptedFence:Number(row?.accepted_fence)};
      }else{
        const row=await deps.cityjson(client,pin,true);
        authority={kind:'cityjson',input:row.input,acceptedFence:Number(row.job.accepted_fence)};
      }
      if(authority.input.readerSha256!==pin.readerSha256||fingerprint(authority.input)!==pin.inputSha256||
        authority.acceptedFence!==pin.acceptedFence||
        (expected&&fingerprint(authority)!==fingerprint(expected[index])))
        throw new AppError(409,'SOURCE_FUSION_STALE','The selected accepted context changed.');
      result.push(authority);
    }
    fusionLive(budget);assertLocalUsp(ctx);return result;
  },{deadlineAt:budget.deadlineAt,signal:budget.signal});
  for(const authority of captured){
    if(authority.kind==='ifc')(deps.ifcTools??verifyFusionIFCTools)(authority.input,budget);
    if(authority.kind==='dxf')(deps.dxfTools??verifyFusionDXFTools)(authority.input,budget);
    if(authority.kind==='kml')(deps.kmlTools??verifyFusionKMLTools)(authority.input,budget);
    if(authority.kind==='citygml')(deps.citygmlTools??verifyFusionCityGMLTools)(authority.input,budget);
    if(authority.kind==='geoparquet')(deps.geoparquetTools??verifyFusionGeoParquetTools)(authority.input,budget);
  }
  fusionLive(budget);assertLocalUsp(ctx);return captured;
}

export async function readFusionObject(key:string,size:number,hash:string,budget:FusionBudget,open:typeof openObjectStream=openObjectStream){
  fusionLive(budget);
  if(!Number.isSafeInteger(size)||size<1||budget.reservedBytes+size>SOURCE_FUSION_LIMITS.aggregateArtifactBytes)
    throw new AppError(413,'SOURCE_FUSION_ARTIFACT_LIMIT','Select a smaller source context.');
  budget.reservedBytes+=size;
  const object=await open(key,size,Math.max(1,budget.deadlineAt-Date.now()),undefined,budget.signal);
  const chunks:Buffer[]=[];let count=0;
  try{
    for await(const chunk of object.body){
      fusionLive(budget);count+=chunk.length;
      if(count>size)throw new AppError(422,'SOURCE_FUSION_INTEGRITY','Accepted evidence size differs from its pin.');
      chunks.push(Buffer.from(chunk));
    }
    const bytes=Buffer.concat(chunks,count);
    if(count!==size||sha256(bytes)!==hash)
      throw new AppError(422,'SOURCE_FUSION_INTEGRITY','Accepted evidence differs from its exact hash/length.');
    fusionLive(budget);return bytes;
  }finally{object.body.destroy();}
}

/** Depth preflight before JSON allocation, with the same absolute read deadline. */
export function fusionJson(bytes:Uint8Array,budget:Pick<FusionBudget,'deadlineAt'|'signal'>):unknown{
  let depth=0,string=false,escape=false;
  for(let i=0;i<bytes.length;i++){
    if(i%4096===0)fusionLive(budget);
    const value=bytes[i];
    if(string){if(escape)escape=false;else if(value===92)escape=true;else if(value===34)string=false;}
    else if(value===34)string=true;
    else if(value===91||value===123){if(++depth>64)throw new AppError(422,'SOURCE_FUSION_JSON','Accepted evidence exceeds its JSON depth profile.');}
    else if(value===93||value===125)depth--;
  }
  const result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  const stack:unknown[]=[result];let count=0;
  while(stack.length){
    if(++count%4096===0)fusionLive(budget);
    if(count>2_000_000)throw new AppError(422,'SOURCE_FUSION_JSON','Accepted evidence exceeds its value profile.');
    const value=stack.pop();
    if(typeof value==='number'&&!Number.isFinite(value))throw new AppError(422,'SOURCE_FUSION_JSON','Nonfinite evidence is unavailable.');
    if(value&&typeof value==='object')for(const child of Object.values(value))stack.push(child);
  }
  fusionLive(budget);return result;
}

/** Existing readDocumentResult/readCityJSONResult buffer before checking size and
 * expose no cancellation parameter. Reuse their schemas, keys and integrity
 * conventions over the existing bounded stream; no shared reader is changed. */
export async function readFusionResult(selection:SourceFusionSelection,authority:FusionAuthority,budget:FusionBudget,
  read:typeof readFusionObject=readFusionObject){
  if(selection.kind==='geoparquet'){
    if(authority.kind!=='geoparquet')throw new AppError(422,'SOURCE_FUSION_INTEGRITY','Accepted source kind differs from its selected adapter.');
    return readFusionGeoParquetResult(selection,authority,budget,read);
  }
  const pin=selection.pin;
  if((selection.kind==='ifc'&&authority.kind!=='ifc')||(selection.kind==='dxf'&&authority.kind!=='dxf')||(selection.kind==='cityjson'&&authority.kind!=='cityjson')||
    (selection.kind==='kml'&&authority.kind!=='kml')||
    (selection.kind==='citygml'&&authority.kind!=='citygml')||
    ((selection.kind==='document'||selection.kind==='document_ocr')&&authority.kind!=='document'))
    throw new AppError(422,'SOURCE_FUSION_INTEGRITY','Accepted source kind differs from its selected adapter.');
  if(selection.kind==='ifc'&&pin.resultBytes>IFC_LIMITS.resultBytes)
    throw new AppError(422,'SOURCE_FUSION_INTEGRITY','Accepted IFC result exceeds its receipt profile.');
  if(selection.kind==='dxf'&&pin.resultBytes>DXF_LIMITS.resultBytes)
    throw new AppError(422,'SOURCE_FUSION_INTEGRITY','Accepted DXF result exceeds its receipt profile.');
  if(selection.kind==='kml'&&pin.resultBytes>KML_LIMITS.resultBytes)
    throw new AppError(422,'SOURCE_FUSION_INTEGRITY','Accepted KML result exceeds its receipt profile.');
  if(selection.kind==='citygml'&&pin.resultBytes>CITYGML_LIMITS.resultBytes)
    throw new AppError(422,'SOURCE_FUSION_INTEGRITY','Accepted CityGML result exceeds its receipt profile.');
  const key=selection.kind==='citygml'?citygmlResultKey(pin.jobId,pin.resultSha256):selection.kind==='kml'?kmlResultKey(pin.jobId,pin.resultSha256):selection.kind==='dxf'?dxfResultKey(pin.jobId,pin.resultSha256):selection.kind==='ifc'?ifcResultKey(pin.jobId,pin.resultSha256):
    selection.kind==='cityjson'?cityjsonResultKey(pin.jobId,pin.resultSha256):documentResultKey(pin.jobId,pin.resultSha256);
  const bytes=await read(key,pin.resultBytes,pin.resultSha256,budget);
  const value=fusionJson(bytes,budget);
  if((selection.kind==='document'||selection.kind==='document_ocr')&&authority.kind==='document'){
    const result=DocumentResultSchema.parse(value);
    if(fingerprint(result.input)!==fingerprint(authority.input)||result.native.readerSha256!==pin.readerSha256)
      throw new AppError(422,'SOURCE_FUSION_INTEGRITY','Accepted document input differs from its pin.');
    const units=new Map<string,typeof result.native.parts>();
    for(const part of result.native.parts){
      if(part.sourceId!==pin.sourceId||part.sourceRevision!==pin.sourceRevision||part.sourceSha256!==pin.sourceSha256||sha256(part.text)!==part.sha256)
        throw new AppError(422,'SOURCE_FUSION_INTEGRITY','Accepted native part differs from its source/text pin.');
      if(part.locator.unitId){const list=units.get(part.locator.unitId)??[];list.push(part);units.set(part.locator.unitId,list);}
    }
    for(const group of units.values()){
      const ordered=[...group].sort((a,b)=>a.locator.segmentIndex!-b.locator.segmentIndex!);
      const first=ordered[0];let end=0;
      for(const [i,part] of ordered.entries()){
        if(part.locator.segmentIndex!==i||part.locator.segmentCount!==first.locator.segmentCount||
          part.locator.unitSha256!==first.locator.unitSha256||part.locator.characterStart!==end)
          throw new AppError(422,'SOURCE_FUSION_INTEGRITY','Accepted native continuation is incomplete.');
        end=part.locator.characterEnd;
      }
      if(ordered.length!==first.locator.segmentCount||sha256(ordered.map(p=>p.text).join(''))!==first.locator.unitSha256)
        throw new AppError(422,'SOURCE_FUSION_INTEGRITY','Accepted native unit differs from its text pin.');
    }
    return {kind:'document' as const,result};
  }
  if(selection.kind==='cityjson'&&authority.kind==='cityjson'){
    const result=CityJSONResultSchema.parse(value);
    if(fingerprint(result.input)!==fingerprint(authority.input)||result.artifact.key!==cityjsonArtifactKey(pin.jobId,result.artifact.sha256))
      throw new AppError(422,'SOURCE_FUSION_INTEGRITY','Accepted native artifact belongs to another input.');
    const artifact=await read(result.artifact.key,result.artifact.bytes,result.artifact.sha256,budget);
    return {kind:'cityjson' as const,result,native:fusionJson(artifact,budget)};
  }
  if(selection.kind==='ifc'&&authority.kind==='ifc'){
    const result=IFCResultSchema.parse(value);
    if(fingerprint(result.input)!==fingerprint(authority.input)||result.artifact.key!==ifcArtifactKey(pin.jobId,result.artifact.sha256))
      throw new AppError(422,'SOURCE_FUSION_INTEGRITY','Accepted IFC artifact belongs to another input.');
    const artifact=await read(result.artifact.key,result.artifact.bytes,result.artifact.sha256,budget);
    const native=fusionJson(artifact,budget);
    if(fingerprint(ifcSummary(artifact,authority.input))!==fingerprint(result.summary))
      throw new AppError(422,'SOURCE_FUSION_INTEGRITY','Accepted IFC metadata differs from its summary.');
    return {kind:'ifc' as const,result,native};
  }
  if(selection.kind==='dxf'&&authority.kind==='dxf'){
    const result=DXFResultSchema.parse(value);
    if(fingerprint(result.input)!==fingerprint(authority.input)||result.artifact.key!==dxfArtifactKey(pin.jobId,result.artifact.sha256))
      throw new AppError(422,'SOURCE_FUSION_INTEGRITY','Accepted DXF artifact belongs to another input.');
    const artifact=await read(result.artifact.key,result.artifact.bytes,result.artifact.sha256,budget);
    const native=fusionJson(artifact,budget);
    if(fingerprint(dxfSummary(artifact,authority.input))!==fingerprint(result.summary))
      throw new AppError(422,'SOURCE_FUSION_INTEGRITY','Accepted DXF metadata differs from its summary.');
    return {kind:'dxf' as const,result,native};
  }
  if(selection.kind==='kml'&&authority.kind==='kml'){
    const result=KMLResultSchema.parse(value);
    if(fingerprint(result.input)!==fingerprint(authority.input)||result.artifact.key!==kmlArtifactKey(pin.jobId,result.artifact.sha256))
      throw new AppError(422,'SOURCE_FUSION_INTEGRITY','Accepted KML artifact belongs to another input.');
    const artifact=await read(result.artifact.key,result.artifact.bytes,result.artifact.sha256,budget);
    const native=fusionJson(artifact,budget);
    if(fingerprint(kmlSummary(artifact,authority.input))!==fingerprint(result.summary))
      throw new AppError(422,'SOURCE_FUSION_INTEGRITY','Accepted KML metadata differs from its summary.');
    return {kind:'kml' as const,result,native};
  }
  if(selection.kind==='citygml'&&authority.kind==='citygml'){
    const result=CityGMLResultSchema.parse(value);
    if(fingerprint(result.input)!==fingerprint(authority.input)||result.artifact.key!==citygmlArtifactKey(pin.jobId,result.artifact.sha256))
      throw new AppError(422,'SOURCE_FUSION_INTEGRITY','Accepted CityGML artifact belongs to another input.');
    const artifact=await read(result.artifact.key,result.artifact.bytes,result.artifact.sha256,budget);
    const native=fusionJson(artifact,budget);
    if(fingerprint(citygmlSummary(artifact,authority.input))!==fingerprint(result.summary))
      throw new AppError(422,'SOURCE_FUSION_INTEGRITY','Accepted CityGML metadata differs from its summary.');
    return {kind:'citygml' as const,result,native};
  }
  throw new AppError(422,'SOURCE_FUSION_INTEGRITY','Accepted source kind differs from its selected adapter.');
}
