import type {PoolClient} from 'pg';
import {IFCResultSchema,SufficiencyProcessingSchema,type IFCResult,type SufficiencyRecordPinSchema} from '@ulpin/contracts/usp';
import type {z} from 'zod';
import {AppError,conflict} from '../../../infrastructure/errors';
import {fingerprint} from '../../cases/domain';
import {isIFCProtectedSource,ifcSourceTx,ifcStatusTx,ifcResultKey,ifcResultBytes,ifcArtifactKey} from './ifc';
import {assertIFCReadTools} from './ifc-config';
import {readFusionObject,fusionJson,fusionLive,type FusionBudget} from './source-fusion-authority';
import {meshBudget} from './sufficiency-mesh';

export type SufficiencyIFCDependencies={read?:typeof readFusionObject;tools?:typeof assertIFCReadTools};
export type SufficiencyIFCOptions={dependencies?:SufficiencyIFCDependencies;budget?:FusionBudget};
// Serialize the binding's bigint cursor only. Never alias raw reader/source pins.
const authorityFingerprint=(value:unknown)=>fingerprint(JSON.parse(JSON.stringify(value,(_key,item)=>typeof item==='bigint'?item.toString():item)));
const competingMarkers=['documentOriginal','objOriginal','gltfOriginal','cityjsonOriginal','dxfOriginal','kmlOriginal','citygmlOriginal','geoparquetOriginal','rasterOriginal','pointOriginal'];
const competingProfiles=new Set(['obj-native-v1','gltf-native-v1','cityjson-native-v1','dxf-native-v1','kml-native-v1','citygml-native-v1','geoparquet-native-v1']);
/** Captured and current markers must agree on one canonical retained original.
 * Null/malformed IFC markers, copied ancestry and mixed format markers fail closed. */
export async function sufficiencyIFCOriginalTx(client:PoolClient,captured:Record<string,any>,lock=false){
  const current=(await client.query('SELECT * FROM sources WHERE id=$1',[captured.id])).rows[0];
  if(!isIFCProtectedSource(captured)&&!(current&&isIFCProtectedSource(current)))return null;
  if(!current||[captured,current].some(row=>competingProfiles.has(row.profile)||
    competingMarkers.some(marker=>Object.hasOwn(row.inspection??{},marker))||Object.hasOwn(row.inspection??{},'copiedFrom')))
    throw new AppError(403,'SUFFICIENCY_IFC_DENIED','This retained IFC authority is unavailable, copied or ambiguous.');
  const source=await ifcSourceTx(client,current.case_id,current.id,lock);
  if(['id','case_id','family_id','revision','sha256','profile','object_key'].some(key=>captured[key]!==undefined&&captured[key]!==source.source[key])||
    captured.bytes!==undefined&&Number(captured.bytes)!==Number(source.source.bytes)||
    fingerprint(captured.inspection??null)!==fingerprint(source.source.inspection??null))
    conflict('The exact retained IFC original authority changed.');
  return source;
}
/** Read only the bounded accepted result receipt. Its artifact reference is
 * validated, never fetched; unit declarations/records/geometry stay unread. */
export async function sufficiencyIFCEvidenceTx(client:PoolClient,captured:Record<string,any>,options:SufficiencyIFCOptions={}){
  const deps=options.dependencies??{},budget=options.budget??meshBudget();fusionLive(budget);
  const source=await sufficiencyIFCOriginalTx(client,captured);if(!source)return null;
  const latestJob=async()=> (await client.query(`SELECT id FROM jobs WHERE case_id=$1 AND source_id=$2 AND operation=$3 ORDER BY created_at DESC,id LIMIT 1`,
    [source.current.id,source.source.id,'ifc-native'])).rows[0];
  const latest=await latestJob(),row=latest?await ifcStatusTx(client,source.current.id,source.source.id,latest.id):null;
  const toolCheck=()=>{if(row)(deps.tools??assertIFCReadTools)(row.input.tools,budget.deadlineAt);};
  let state='pending',resultSha256:string|null=null,tools:'not_checked'|'current'|'unavailable'='not_checked',
    code:string|null=null,summary:IFCResult['summary']|null=null;
  if(row){
    const error=row.job.error;code=typeof error==='string'?error.slice(0,100):typeof error?.code==='string'?error.code.slice(0,100):null;
    state=row.stale?'stale':row.job.status==='queued'?'pending':row.job.status==='running'?'running':row.job.status==='succeeded'?'inspected_metadata':'failed';
    if(!row.stale&&row.job.status==='succeeded'){
      try{toolCheck();tools='current';}catch(error){
        if(error instanceof AppError&&error.status===503){state='unavailable';tools='unavailable';code=error.code;}else throw error;
      }
      if(tools==='current'){
        const hash=row.job.result_ref.sha256,size=ifcResultBytes(row.job.result_ref,row.input.jobId),
          bytes=await (deps.read??readFusionObject)(ifcResultKey(row.input.jobId,hash),size,hash,budget),
          result=IFCResultSchema.parse(fusionJson(bytes,budget));
        if(fingerprint(result.input)!==fingerprint(row.input)||result.artifact.key!==ifcArtifactKey(row.input.jobId,result.artifact.sha256))
          throw new AppError(422,'SUFFICIENCY_IFC_RESULT_INTEGRITY','The IFC metadata receipt belongs to another original or accepted job.');
        summary=result.summary;resultSha256=hash;
      }
    }
  }
  const processing=SufficiencyProcessingSchema.parse({state,jobId:row?.job.id??null,resultSha256,nativeStatus:null,modelStatus:null,
    ifc:{inputSha256:row?fingerprint(row.input):null,readerSha256:row?.input.readerSha256??null,
      acceptedFence:row?.job.status==='succeeded'?Number(row.job.accepted_fence):null,tools,code,summary,
      sourceUnits:'native_artifact_not_read',coverage:'accepted_result_metadata_only; native_artifact_not_read'}}),
    authority={source,row},recordPins:z.infer<typeof SufficiencyRecordPinSchema>[]=row?[{authority:'job',id:row.job.id,
      revision:Number(row.job.accepted_fence??0),sha256:fingerprint(row.job)}]:[];
  const revalidate=async(lock=false)=>{
    fusionLive(budget);
    const currentSource=await sufficiencyIFCOriginalTx(client,captured,lock),currentLatest=await latestJob(),
      currentRow=currentLatest?await ifcStatusTx(client,source.current.id,source.source.id,currentLatest.id,lock):null;
    if(authorityFingerprint({source:currentSource,row:currentRow})!==authorityFingerprint(authority))
      conflict('The IFC case, source, job, result or accepted attempt changed during inspection.');
    if(tools==='current')toolCheck();fusionLive(budget);
  };
  await revalidate();
  return {processing,recordPins,evidenceSha256:authorityFingerprint({authority,processing}),revalidate};
}
