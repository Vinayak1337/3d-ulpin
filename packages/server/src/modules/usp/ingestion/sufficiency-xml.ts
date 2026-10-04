import type {PoolClient} from 'pg';
import {SufficiencyProcessingSchema,type SufficiencyRecordPinSchema} from '@ulpin/contracts/usp';
import {KMLInputSchema,KMLResultSchema,type KMLResult} from '../../../../../contracts/src/usp/kml-ingestion';
import {CityGMLResultSchema,type CityGMLResult} from '../../../../../contracts/src/usp/citygml-ingestion';
import type {z} from 'zod';
import {AppError,conflict} from '../../../infrastructure/errors';
import {fingerprint} from '../../cases/domain';
import {isKMLProtectedSource,kmlSourceTx,kmlStatusTx,kmlResultKey,kmlResultBytes,kmlArtifactKey} from './kml';
import {isCityGMLProtectedSource,citygmlSourceTx,citygmlStatusTx,citygmlResultKey,citygmlResultBytes,citygmlArtifactKey} from './citygml';
import {assertKMLReadTools} from './kml-config';
import {assertCityGMLReadTools} from './citygml-config';
import {readFusionObject,fusionJson,fusionLive,type FusionBudget} from './source-fusion-authority';
import {meshBudget} from './sufficiency-mesh';

export type SufficiencyXMLDependencies={read?:typeof readFusionObject;kmlTools?:typeof assertKMLReadTools;citygmlTools?:typeof assertCityGMLReadTools};
export type SufficiencyXMLOptions={dependencies?:SufficiencyXMLDependencies;budget?:FusionBudget};
const authorityFingerprint=(value:unknown)=>fingerprint(JSON.parse(JSON.stringify(value,(_key,item)=>typeof item==='bigint'?item.toString():item)));
const competingMarkers=['documentOriginal','ifcOriginal','objOriginal','gltfOriginal','cityjsonOriginal','dxfOriginal','geoparquetOriginal','rasterOriginal','pointOriginal'];
const competingProfiles=new Set(['ifc-native-v1','obj-native-v1','gltf-native-v1','cityjson-native-v1','dxf-native-v1','geoparquet-native-v1']);
/** Select one protected XML authority from BOTH captured and current source.
 * Own null/malformed markers, copied originals and competing formats cannot fall back. */
export async function sufficiencyXMLOriginalTx(client:PoolClient,captured:Record<string,any>,lock=false){
  const current=(await client.query('SELECT * FROM sources WHERE id=$1',[captured.id])).rows[0],
    kml=isKMLProtectedSource(captured)||Boolean(current&&isKMLProtectedSource(current)),
    citygml=isCityGMLProtectedSource(captured)||Boolean(current&&isCityGMLProtectedSource(current));
  if(!kml&&!citygml)return null;
  if(!current||kml&&citygml||[captured,current].some(row=>competingProfiles.has(row.profile)||
    competingMarkers.some(marker=>Object.hasOwn(row.inspection??{},marker))||Object.hasOwn(row.inspection??{},'copiedFrom')))
    throw new AppError(403,'SUFFICIENCY_XML_DENIED','This retained XML authority is unavailable, copied or ambiguous.');
  const source=await (kml?kmlSourceTx:citygmlSourceTx)(client,current.case_id,current.id,lock);
  if(['id','case_id','family_id','revision','sha256','profile','object_key'].some(key=>captured[key]!==undefined&&captured[key]!==source.source[key])||
    captured.bytes!==undefined&&Number(captured.bytes)!==Number(source.source.bytes)||
    fingerprint(captured.inspection??null)!==fingerprint(source.source.inspection??null))
    conflict('The exact retained XML original authority changed.');
  return {kind:kml?'kml' as const:'citygml' as const,...source};
}
/** Accepted result metadata only. No native artifact, XML member or coordinate
 * array is fetched/reparsed, and no incomplete summary is truncated/replaced. */
export async function sufficiencyXMLEvidenceTx(client:PoolClient,captured:Record<string,any>,options:SufficiencyXMLOptions={}){
  const deps=options.dependencies??{},budget=options.budget??meshBudget();fusionLive(budget);
  const source=await sufficiencyXMLOriginalTx(client,captured);if(!source)return null;
  const kind=source.kind,status=kind==='kml'?kmlStatusTx:citygmlStatusTx,
    latestJob=async()=> (await client.query(`SELECT id FROM jobs WHERE case_id=$1 AND source_id=$2 AND operation=$3 ORDER BY created_at DESC,id LIMIT 1`,
      [source.current.id,source.source.id,kind+'-native'])).rows[0],latest=await latestJob(),
    row=latest?await status(client,source.current.id,source.source.id,latest.id):null;
  const toolCheck=()=>{if(row){if(kind==='kml')(deps.kmlTools??assertKMLReadTools)(row.input.tools,budget.deadlineAt);
    else (deps.citygmlTools??assertCityGMLReadTools)(row.input.tools,budget.deadlineAt);}};
  let state='pending',resultSha256:string|null=null,tools:'not_checked'|'current'|'unavailable'='not_checked',code:string|null=null,
    kmlSummary:KMLResult['summary']|null=null,citygmlSummary:CityGMLResult['summary']|null=null;
  if(row){
    const error=row.job.error;code=typeof error==='string'?error.slice(0,100):typeof error?.code==='string'?error.code.slice(0,100):null;
    state=row.stale?'stale':row.job.status==='queued'?'pending':row.job.status==='running'?'running':row.job.status==='succeeded'?'inspected_metadata':'failed';
    if(!row.stale&&row.job.status==='succeeded'){
      try{toolCheck();tools='current';}catch(error){
        if(error instanceof AppError&&error.status===503){state='unavailable';tools='unavailable';code=error.code;}else throw error;
      }
      if(tools==='current'){
        const hash=row.job.result_ref.sha256,size=(kind==='kml'?kmlResultBytes:citygmlResultBytes)(row.job.result_ref,row.input.jobId),
          key=(kind==='kml'?kmlResultKey:citygmlResultKey)(row.input.jobId,hash),
          bytes=await (deps.read??readFusionObject)(key,size,hash,budget),raw=fusionJson(bytes,budget),
          result=kind==='kml'?KMLResultSchema.parse(raw):CityGMLResultSchema.parse(raw),
          artifactKey=(kind==='kml'?kmlArtifactKey:citygmlArtifactKey)(row.input.jobId,result.artifact.sha256);
        if(fingerprint(result.input)!==fingerprint(row.input)||result.artifact.key!==artifactKey)
          throw new AppError(422,'SUFFICIENCY_XML_RESULT_INTEGRITY','The XML metadata receipt belongs to another original or accepted job.');
        if(kind==='kml')kmlSummary=KMLResultSchema.parse(result).summary;else citygmlSummary=CityGMLResultSchema.parse(result).summary;
        resultSha256=hash;
      }
    }
  }
  const detail={inputSha256:row?fingerprint(row.input):null,readerSha256:row?.input.readerSha256??null,
    acceptedFence:row?.job.status==='succeeded'?Number(row.job.accepted_fence):null,tools,code,
    sourceUnits:'native_artifact_not_read',coverage:'accepted_result_metadata_only; native_artifact_not_read'},
    processing=SufficiencyProcessingSchema.parse({state,jobId:row?.job.id??null,resultSha256,nativeStatus:null,modelStatus:null,
      xml:kind==='kml'?{...detail,kind,requestedMember:row?KMLInputSchema.parse(row.input).selection:null,summary:kmlSummary}:
        {...detail,kind,summary:citygmlSummary}}),
    authority={source,row},recordPins:z.infer<typeof SufficiencyRecordPinSchema>[]=row?[{authority:'job',id:row.job.id,
      revision:Number(row.job.accepted_fence??0),sha256:fingerprint(row.job)}]:[];
  const revalidate=async(lock=false)=>{
    fusionLive(budget);
    const currentSource=await sufficiencyXMLOriginalTx(client,captured,lock),currentLatest=await latestJob(),
      currentRow=currentLatest?await status(client,source.current.id,source.source.id,currentLatest.id,lock):null;
    if(authorityFingerprint({source:currentSource,row:currentRow})!==authorityFingerprint(authority))
      conflict('The XML case, source, job, result or accepted attempt changed during inspection.');
    if(tools==='current')toolCheck();fusionLive(budget);
  };
  await revalidate();
  return {processing,recordPins,evidenceSha256:authorityFingerprint({authority,processing}),revalidate};
}
