import type {PoolClient} from 'pg';
import {SufficiencyPlanarProcessingSchema,SufficiencyPlanarJobPinSchema,SUFFICIENCY_PLANAR_LIMITS,
  type SufficiencyPlanarDetail} from '../../../../../contracts/src/usp/sufficiency-planar';
import {DXFResultSchema,type DXFInput} from '../../../../../contracts/src/usp/dxf-ingestion';
import {GEOPARQUET_LIMITS,GeoParquetResultSchema,type GeoParquetInput,type GeoParquetResult} from '../../../../../contracts/src/usp/geoparquet-ingestion';
import {AppError,conflict} from '../../../infrastructure/errors';
import {fingerprint} from '../../cases/domain';
import {isDXFProtectedSource,dxfSourceTx,dxfStatusTx,dxfResultKey,dxfResultBytes,dxfArtifactKey} from './dxf';
import {isGeoParquetProtectedSource,geoparquetSourceTx,geoparquetStatusTx,geoparquetStatusAuthorityTx,geoparquetResultKey,
  geoparquetResultBytes,geoparquetArtifactKey,type GeoParquetReadOptions} from './geoparquet';
import {assertDXFReadTools} from './dxf-config';
import {assertGeoParquetReadTools} from './geoparquet-config';
import {readFusionObject,fusionJson,fusionLive,type FusionBudget} from './source-fusion-authority';

export type SufficiencyPlanarDependencies={read?:typeof readFusionObject;dxfTools?:typeof assertDXFReadTools;
  geoparquetTools?:typeof assertGeoParquetReadTools;geoparquetStatus?:typeof geoparquetStatusTx;
  geoparquetAuthority?:typeof geoparquetStatusAuthorityTx};
export type SufficiencyPlanarOptions={dependencies?:SufficiencyPlanarDependencies;budget?:FusionBudget};
const budgetForRead=():FusionBudget=>({deadlineAt:Date.now()+SUFFICIENCY_PLANAR_LIMITS.readMs,
  signal:AbortSignal.timeout(SUFFICIENCY_PLANAR_LIMITS.readMs),reservedBytes:0});
// Only the binding's bigint cursor becomes decimal JSON; raw pins stay exact.
const authorityFingerprint=(value:unknown)=>fingerprint(JSON.parse(JSON.stringify(value,(_key,item)=>typeof item==='bigint'?item.toString():item)));
const otherMarkers=['documentOriginal','ifcOriginal','objOriginal','gltfOriginal','cityjsonOriginal','kmlOriginal','citygmlOriginal','rasterOriginal','pointOriginal'];
const otherProfiles=new Set(['ifc-native-v1','obj-native-v1','gltf-native-v1','cityjson-native-v1','kml-native-v1','citygml-native-v1']);
type GeoParquetStatus=Awaited<ReturnType<typeof geoparquetStatusTx>>;
/** Only an independently captured SQL/input authority can support this outage
 * outcome. No result is admitted when canonical status cannot verify tools. */
async function planarGeoParquetStatus<T extends GeoParquetStatus>(captured:T,validate:()=>Promise<GeoParquetStatus>){
  if(captured.stale)return {row:captured,unavailableCode:null};
  try{
    const current=await validate(),base={ctx:captured.ctx,job:captured.job,input:captured.input};
    if(authorityFingerprint({ctx:current.ctx,job:current.job,input:current.input})!==authorityFingerprint(base))
      conflict('The GeoParquet authority changed during status validation.');
    return {row:{...captured,stale:current.stale},unavailableCode:null};
  }catch(error){
    if(error instanceof AppError&&error.status===503&&error.code.startsWith('GEOPARQUET_'))
      return {row:captured,unavailableCode:error.code};
    throw error;
  }
}
/** Cache verified receipt data, never SQL authority. After capture closes a new
 * parent/input/hash/size refuses instead of starting I/O under final locks. */
export function planarGeoParquetReceiptCache(budget:FusionBudget,read:typeof readFusionObject=readFusionObject){
  const receipts=new Map<string,GeoParquetResult>();let closed=false;
  const reader:NonNullable<GeoParquetReadOptions['readResult']>=async(input,hash,size,signal)=>{
    fusionLive(budget);
    if(signal?.aborted)throw new AppError(408,'GEOPARQUET_READ_TIMEOUT','The bounded GeoParquet parent read expired.');
    if(!Number.isSafeInteger(size)||size<1||size>GEOPARQUET_LIMITS.resultBytes)
      throw new AppError(413,'SUFFICIENCY_PLANAR_RESULT_LIMIT','The complete GeoParquet receipt exceeds its result ceiling.');
    const pin=fingerprint({input,hash,size}),saved=receipts.get(pin);if(saved)return GeoParquetResultSchema.parse(saved);
    if(closed)conflict('The exact accepted GeoParquet parent receipt changed during final validation.');
    const result=GeoParquetResultSchema.parse(fusionJson(await read(geoparquetResultKey(input.jobId,hash),size,hash,budget),budget));
    if(fingerprint(result.input)!==fingerprint(input)||result.artifact.key!==geoparquetArtifactKey(input.jobId,result.artifact.sha256))
      throw new AppError(422,'SUFFICIENCY_PLANAR_RESULT_INTEGRITY','The GeoParquet metadata receipt belongs to another original or accepted job.');
    fusionLive(budget);receipts.set(pin,result);return GeoParquetResultSchema.parse(result);
  };
  return {read:reader,close:()=>{closed=true;}};
}
/** Original receipt authority remains useful without installed native tools.
 * Present null/malformed, copied and mixed captured/current markers fail closed. */
export async function sufficiencyPlanarOriginalTx(client:PoolClient,captured:Record<string,any>,lock=false){
  const current=(await client.query('SELECT * FROM sources WHERE id=$1',[captured.id])).rows[0];
  const dxf=isDXFProtectedSource(captured)||Boolean(current&&isDXFProtectedSource(current)),
    geoparquet=isGeoParquetProtectedSource(captured)||Boolean(current&&isGeoParquetProtectedSource(current));
  if(!dxf&&!geoparquet)return null;
  if(!current||dxf&&geoparquet||[captured,current].some(row=>otherProfiles.has(row.profile)||
    otherMarkers.some(marker=>Object.hasOwn(row.inspection??{},marker))||Object.hasOwn(row.inspection??{},'copiedFrom')))
    throw new AppError(403,'SUFFICIENCY_PLANAR_DENIED','This retained planar authority is unavailable, copied or ambiguous.');
  const source=await (dxf?dxfSourceTx:geoparquetSourceTx)(client,current.case_id,current.id,lock);
  if(['id','case_id','family_id','revision','sha256','profile','object_key'].some(key=>captured[key]!==undefined&&captured[key]!==source.source[key])||
    captured.bytes!==undefined&&Number(captured.bytes)!==Number(source.source.bytes)||
    fingerprint(captured.inspection??null)!==fingerprint(source.source.inspection??null))
    conflict('The exact retained planar original authority changed.');
  return {kind:dxf?'dxf' as const:'geoparquet' as const,...source};
}

/** Inspect exact accepted producer receipt metadata only. Native artifacts,
 * coordinate arrays, records and other continuation windows stay unread. */
export async function sufficiencyPlanarEvidenceTx(client:PoolClient,captured:Record<string,any>,options:SufficiencyPlanarOptions={}){
  const deps=options.dependencies??{},budget=options.budget??budgetForRead();fusionLive(budget);
  const source=await sufficiencyPlanarOriginalTx(client,captured);if(!source)return null;
  const kind=source.kind,read=deps.read??readFusionObject;
  const readDXF=async(input:DXFInput,hash:string,size:number)=>{
    const result=DXFResultSchema.parse(fusionJson(await read(dxfResultKey(input.jobId,hash),size,hash,budget),budget));
    if(fingerprint(result.input)!==fingerprint(input)||result.artifact.key!==dxfArtifactKey(input.jobId,result.artifact.sha256))
      throw new AppError(422,'SUFFICIENCY_PLANAR_RESULT_INTEGRITY','The DXF metadata receipt belongs to another original or accepted job.');
    return result;
  };
  const receiptCache=planarGeoParquetReceiptCache(budget,read),readOptions:GeoParquetReadOptions={
    deadlineAt:budget.deadlineAt,signal:budget.signal,readResult:receiptCache.read};
  const latestJob=async()=> (await client.query(`SELECT id FROM jobs WHERE case_id=$1 AND source_id=$2 AND operation=$3 ORDER BY created_at DESC,id LIMIT 1`,
    [source.current.id,source.source.id,kind+'-native'])).rows[0];
  const status=async(jobId:string,lock=false)=>{
    if(kind==='dxf')return {row:await dxfStatusTx(client,source.current.id,source.source.id,jobId,lock),unavailableCode:null};
    fusionLive(budget);
    const captured=await (deps.geoparquetAuthority??geoparquetStatusAuthorityTx)(client,source.current.id,source.source.id,jobId,lock);
    fusionLive(budget);
    return planarGeoParquetStatus(captured,()=>
      (deps.geoparquetStatus??geoparquetStatusTx)(client,source.current.id,source.source.id,jobId,lock,readOptions));
  };
  const latest=await latestJob(),statusResult=latest?await status(latest.id):null,row=statusResult?.row??null;
  const toolCheck=()=>{fusionLive(budget);if(row){if(kind==='dxf')
    (deps.dxfTools??assertDXFReadTools)(row.input.tools,budget.deadlineAt);
    else (deps.geoparquetTools??assertGeoParquetReadTools)(row.input.tools,budget.deadlineAt);}fusionLive(budget);};
  let state:typeof SufficiencyPlanarProcessingSchema._output.state=source.latest?'pending':'stale',resultSha256:string|null=null,
    tools:'not_checked'|'current'|'unavailable'='not_checked',code:string|null=null;
  let summary:SufficiencyPlanarDetail['summary']=null;
  if(row){
    const error=row.job.error;code=typeof error==='string'?error.slice(0,100):typeof error?.code==='string'?error.code.slice(0,100):null;
    state=row.stale?'stale':row.job.status==='queued'?'pending':row.job.status==='running'?'running':row.job.status==='succeeded'?'inspected_metadata':'failed';
    if(statusResult?.unavailableCode){state='unavailable';tools='unavailable';code=statusResult.unavailableCode;}
    else if(!row.stale&&row.job.status==='succeeded'){
      try{toolCheck();tools='current';}catch(error){
        if(error instanceof AppError&&error.status===503){state='unavailable';tools='unavailable';code=error.code;}else throw error;
      }
      if(tools==='current'){
        const hash=row.job.result_ref.sha256;
        summary=kind==='dxf'?(await readDXF(row.input as DXFInput,hash,dxfResultBytes(row.job.result_ref,row.input.jobId))).summary
          :(await receiptCache.read(row.input as GeoParquetInput,hash,geoparquetResultBytes(row.job.result_ref,row.input.jobId),budget.signal)).summary;
        resultSha256=hash;
      }
    }
  }
  const metadata={inputSha256:row?fingerprint(row.input):null,readerSha256:row?.input.readerSha256??null,
    acceptedFence:row?.job.status==='succeeded'?Number(row.job.accepted_fence):null,tools,code,summary,
    coverage:'accepted_result_metadata_only; native_artifact_not_read' as const};
  const processing=SufficiencyPlanarProcessingSchema.parse({state,jobId:row?.job.id??null,resultSha256,nativeStatus:null,modelStatus:null,
    planar:kind==='dxf'?{...metadata,kind,selection:row?.input.selection??null,sourceUnits:summary?'result_summary':'summary_not_available'}
      :{...metadata,kind,selection:row?.input.selection??null,continuation:(row?.input as GeoParquetInput|undefined)?.continuation??null,
        sourceUnits:'native_artifact_not_read'}});
  if(Buffer.byteLength(JSON.stringify(processing))>SUFFICIENCY_PLANAR_LIMITS.receiptBytes)
    throw new AppError(413,'SUFFICIENCY_PLANAR_METADATA_LIMIT','The complete planar metadata exceeds the sufficiency receipt ceiling. No fields were omitted.');
  const parent=row&&'parent' in row?row.parent:null,authority={source,statusResult},
    recordPins=[row?.job,parent?.job].filter(Boolean).map(job=>SufficiencyPlanarJobPinSchema.parse({authority:'job',id:job.id,
      revision:Number(job.accepted_fence??0),sha256:fingerprint(job)}));
  const revalidate=async(lock=false)=>{
    fusionLive(budget);
    const currentSource=await sufficiencyPlanarOriginalTx(client,captured,lock),currentLatest=await latestJob(),
      currentStatus=currentLatest?await status(currentLatest.id,lock):null;
    if(authorityFingerprint({source:currentSource,statusResult:currentStatus})!==authorityFingerprint(authority))
      conflict('The planar case, source, latest job, result or accepted attempt changed during inspection.');
    if(tools==='current')toolCheck();fusionLive(budget);
  };
  receiptCache.close();await revalidate();
  // Lead takes these complete job locks in sorted order before revalidate(true).
  const jobIds=[...new Set(recordPins.map(pin=>pin.id))].sort();
  return {processing,recordPins,jobIds,evidenceSha256:authorityFingerprint({authority,processing}),revalidate};
}
