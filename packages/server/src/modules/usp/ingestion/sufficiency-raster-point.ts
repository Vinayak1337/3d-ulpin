import type {PoolClient} from 'pg';
import {SufficiencyRasterPointEnvelopeSchema,type SufficiencyRasterPointEnvelope} from '../../../../../contracts/src/usp/sufficiency-raster-point';
import {RASTER_WINDOW_LIMITS,type RasterWindowInput,type RasterWindowResult} from '../../../../../contracts/src/usp/raster-window';
import {POINT_BATCH_LIMITS,type PointBatchInput,type PointBatchResult} from '../../../../../contracts/src/usp/point-batch';
import {SUFFICIENCY_LIMITS,SufficiencyRecordPinSchema} from '../../../../../contracts/src/usp/sufficiency';
import {SOURCE_FUSION_LIMITS} from '../../../../../contracts/src/source-fusion';
import type {FusionBudget} from './source-fusion-authority';
import {AppError,conflict} from '../../../infrastructure/errors';
import {fingerprint} from '../../cases/domain';
import {rasterSourceTx,rasterWindowCaptureTx,readRasterResult,rasterResultKey} from './raster-window';
import {pointSourceTx,pointBatchCaptureTx,readPointResult,pointResultKey} from './point-batch';
import {readRasterObject,rasterReadLive} from './raster-window-object';
import {readPointObject} from './point-batch-object';

export type SufficiencyRasterPointDependencies={rasterObject?:typeof readRasterObject;pointObject?:typeof readPointObject};
export type SufficiencyRasterPointOptions={dependencies?:SufficiencyRasterPointDependencies;budget?:FusionBudget};
const authorityFingerprint=(value:unknown)=>fingerprint(JSON.parse(JSON.stringify(value,(_key,item)=>typeof item==='bigint'?item.toString():item)));
const otherMarkers=['documentOriginal','ifcOriginal','objOriginal','gltfOriginal','cityjsonOriginal','dxfOriginal','kmlOriginal','citygmlOriginal','geoparquetOriginal'];
const otherProfiles=new Set(['ifc-native-v1','obj-native-v1','gltf-native-v1','cityjson-native-v1','dxf-native-v1','kml-native-v1','citygml-native-v1','geoparquet-native-v1','large-original-v1']);
const protectedKind=(row:Record<string,any>|undefined,kind:'raster'|'point')=>Boolean(row&&
  (row.profile===(kind==='raster'?'geotiff-raster-v1':'laz-point-v1')||Object.hasOwn(row.inspection??{},kind+'Original')));

/** Original retention is independent of installed tools or processing success.
 * Both captured and current null/malformed/copied/competing markers fail closed. */
export async function sufficiencyRasterPointOriginalTx(client:PoolClient,captured:Record<string,any>,lock=false){
  const current=(await client.query('SELECT * FROM sources WHERE id=$1',[captured.id])).rows[0],
    raster=protectedKind(captured,'raster')||protectedKind(current,'raster'),
    point=protectedKind(captured,'point')||protectedKind(current,'point');
  if(!raster&&!point)return null;
  if(!current||raster&&point||[captured,current].some(row=>otherProfiles.has(row.profile)||
    otherMarkers.some(marker=>Object.hasOwn(row.inspection??{},marker))||Object.hasOwn(row.inspection??{},'copiedFrom')))
    throw new AppError(403,'SUFFICIENCY_RASTER_POINT_DENIED','This retained raster/point authority is unavailable, copied or ambiguous.');
  const source=await (raster?rasterSourceTx:pointSourceTx)(client,current.case_id,current.id,lock);
  if(['id','case_id','family_id','revision','sha256','profile','object_key'].some(key=>captured[key]!==source.source[key])||
    Number(captured.bytes)!==Number(source.source.bytes)||
    fingerprint(captured.inspection??null)!==fingerprint(source.source.inspection??null))
    conflict('The exact retained raster/point original authority changed.');
  return {kind:raster?'raster' as const:'point' as const,...source};
}

// The legacy accepted asset ID has no length. Reserve the producer ceiling,
// HEAD/count/hash through the canonical reader, and report only measured bytes.
// Cache verified bytes/results per operation, never SQL/access/attempt authority.
type Loaded={kind:'raster';result:RasterWindowResult;bytes:number}|{kind:'point';result:PointBatchResult;bytes:number};
const receipts=new WeakMap<FusionBudget,Map<string,Promise<Loaded>>>();
async function receipt(kind:'raster'|'point',input:RasterWindowInput|PointBatchInput,hash:string,
  budget:FusionBudget,deps:SufficiencyRasterPointDependencies):Promise<Loaded>{
  rasterReadLive(budget);
  const key=(kind==='raster'?rasterResultKey:pointResultKey)(input.jobId,hash),identity=key+':'+fingerprint(input);
  let cache=receipts.get(budget);if(!cache){cache=new Map();receipts.set(budget,cache);}
  let pending=cache.get(identity);
  if(!pending){
    const limit=kind==='raster'?RASTER_WINDOW_LIMITS.resultBytes:POINT_BATCH_LIMITS.resultBytes;
    if(!Number.isSafeInteger(budget.reservedBytes)||budget.reservedBytes<0||
      budget.reservedBytes+limit>SOURCE_FUSION_LIMITS.aggregateArtifactBytes)
      throw new AppError(413,'SUFFICIENCY_RASTER_POINT_READ_LIMIT','The shared metadata read budget is exhausted.');
    budget.reservedBytes+=limit;
    pending=(async():Promise<Loaded>=>{
      let measured=0;
      if(kind==='raster'){
        const read:typeof readRasterObject=async(key,hash,size,bounds)=>{
          const bytes=await (deps.rasterObject??readRasterObject)(key,hash,size,bounds);measured=bytes.length;return bytes;
        };
        return {kind,result:await readRasterResult(input as RasterWindowInput,hash,budget,read),bytes:measured};
      }
      const read:typeof readPointObject=async(key,hash,size,bounds)=>{
        const bytes=await (deps.pointObject??readPointObject)(key,hash,size,bounds);measured=bytes.length;return bytes;
      };
      return {kind,result:await readPointResult(input as PointBatchInput,hash,budget,read),bytes:measured};
    })();
    cache.set(identity,pending);
  }
  const loaded=await pending;rasterReadLive(budget);return structuredClone(loaded);
}

/** Captures retain canonical case/source/job/metadata SHARE locks, including on
 * recapture. The caller owns transaction lifetime and the shared SQL deadline.
 * Before final revalidate(true), acquire the returned COMPLETE lock plan sorted:
 * admission keys first, then cases/sources/jobs/metadata/all job attempts. The
 * admission lock prevents a new latest job; SHARE alone does not block enqueue.
 * No TIFF/point-record artifact or any additional selection is ever fetched. */
export async function sufficiencyRasterPointEvidenceTx(client:PoolClient,captured:Record<string,any>,options:SufficiencyRasterPointOptions={}){
  const budget=options.budget??{deadlineAt:Date.now()+SOURCE_FUSION_LIMITS.deadlineMs,
    signal:AbortSignal.timeout(SOURCE_FUSION_LIMITS.deadlineMs),reservedBytes:0},deps=options.dependencies??{};
  rasterReadLive(budget);
  const source=await sufficiencyRasterPointOriginalTx(client,captured);if(!source)return null;
  const kind=source.kind,operation=kind==='raster'?'raster-window':'point-batch',
    capture=kind==='raster'?rasterWindowCaptureTx:pointBatchCaptureTx,
    latestJob=async()=> (await client.query('SELECT id FROM jobs WHERE case_id=$1 AND source_id=$2 AND operation=$3 ORDER BY created_at DESC,id LIMIT 1',
      [source.current.id,source.source.id,operation])).rows[0],
    latest=await latestJob(),row=latest?await capture(client,source.current.id,source.source.id,latest.id):null;
  let state:SufficiencyRasterPointEnvelope['state']=!source.latest||row?.stale?'stale':
    !row||row.job.status==='queued'?'pending':row.job.status==='running'?'running':row.job.status==='succeeded'?'inspected_metadata':'failed';
  const error=row?.job.error,code=typeof error==='string'?error.slice(0,100)||null:
    typeof error?.code==='string'?error.code.slice(0,100)||null:null;
  let loaded:Loaded|null=null,resultSha256:string|null=null;
  if(row&&state==='inspected_metadata'){
    resultSha256=row.job.result_ref.sha256;
    loaded=await receipt(kind,row.input,resultSha256!,budget,deps);
  }
  // No installed native tool inventory is read or claimed current. A result
  // declaration is retained metadata, not a qualified reference/measurement.
  const detail={inputSha256:row?fingerprint(row.input):null,readerSha256:row?.input.readerSha256??null,
    acceptedFence:row?.job.status==='succeeded'?Number(row.job.accepted_fence):null,code,
    tools:'not_checked',installedInventory:'not_read',coverage:'accepted_result_metadata_only; native_artifact_not_read',
    artifactVerification:'accepted_receipt_reference_only',otherSelections:'not_fetched',interpretation:'not_assessed',
    measuredResultBytes:loaded?.bytes??null},
    artifact=loaded?{sha256:loaded.result.artifact.sha256,bytes:loaded.result.artifact.bytes,mediaType:loaded.result.artifact.mediaType}:null,
    processing=SufficiencyRasterPointEnvelopeSchema.parse({state,jobId:row?.job.id??null,resultSha256,nativeStatus:null,modelStatus:null,
      rasterPoint:kind==='raster'?{...detail,kind,requestedWindow:row?(row.input as RasterWindowInput).window:null,
        metadata:loaded?.kind==='raster'?loaded.result.metadata:null,artifact}:
        {...detail,kind,requestedBatch:row?(row.input as PointBatchInput).batch:null,metadata:loaded?.kind==='point'?loaded.result.metadata:null,artifact}}),
    authority={source,row},recordPins=row?[SufficiencyRecordPinSchema.parse({authority:'job',id:row.job.id,
      revision:Number(row.job.accepted_fence??0),sha256:authorityFingerprint(row.job)})]:[],
    finalLockPlan={advisoryKeys:[operation+'-admission-v1'],caseIds:[source.current.id],sourceIds:[source.source.id],
      jobIds:row?[row.job.id]:[],metadataJobIds:row?[row.job.id]:[],attemptJobIds:row?[row.job.id]:[],
      observations:{canonicalCaptureUsesShare:Boolean(row),attemptsReadThroughAcceptedFence:true,
        caseRevision:source.current.revision,familyId:source.source.family_id,sourceRevision:source.source.revision,
        latestSource:source.latest,operation,latestJobId:row?.job.id??null,captureSha256:row?.capture??null,
        inputManifestId:row?.job.input_manifest_id??null,inputSha256:row?.job.input_sha256??null,
        acceptedFence:row?.job.accepted_fence??null,resultRef:row?.job.result_ref??null}},
    evidenceSha256=authorityFingerprint({authority,processing});
  if(Buffer.byteLength(JSON.stringify({processing,recordPins,evidenceSha256}))>SUFFICIENCY_LIMITS.receiptBytes)
    throw new AppError(413,'SUFFICIENCY_RECEIPT_LIMIT','The complete metadata exceeds the sufficiency receipt bound. No fields were truncated.');
  const revalidate=async(lock=false)=>{
    rasterReadLive(budget);
    const currentSource=await sufficiencyRasterPointOriginalTx(client,captured,lock),currentLatest=await latestJob(),
      currentRow=currentLatest?await capture(client,source.current.id,source.source.id,currentLatest.id):null;
    if(authorityFingerprint({source:currentSource,row:currentRow})!==authorityFingerprint(authority))
      conflict('The raster/point case, source, latest job, enrollment, result, accepted attempt or access changed during inspection.');
    rasterReadLive(budget);
  };
  await revalidate();
  return {original:source,processing,recordPins,evidenceSha256,finalLockPlan,revalidate};
}
