import type {PoolClient} from 'pg';
import {GeoParquetInputSchema,GeoParquetResultSchema,type GeoParquetInput} from '../../../../../contracts/src/usp/geoparquet-ingestion';
import {SourceFusionGeoParquetSelectionSchema,type SourceFusionGeoParquetSelection} from '../../../../../contracts/src/source-fusion-geoparquet';
import type {SourceFusionPin} from '../../../../../contracts/src/source-fusion';
import {AppError} from '../../../infrastructure/errors';
import {fingerprint} from '../../cases/domain';
import {geoparquetSourceTx,geoparquetInput,assertGeoParquetJobRow,geoparquetResultBytes,geoparquetResultKey,geoparquetArtifactKey} from './geoparquet';
import {assertGeoParquetReadTools} from './geoparquet-config';
import {geoparquetSummary} from './geoparquet-processor';
import {fusionLive,fusionJson,readFusionObject,type FusionBudget} from './source-fusion-authority';

type Parent={input:GeoParquetInput;resultSha256:string;resultBytes:number;acceptedFence:number};
export type FusionGeoParquetAuthority={kind:'geoparquet';input:GeoParquetInput;acceptedFence:number;parent:Parent|null};
type CaptureDependencies={source:typeof geoparquetSourceTx;input:typeof geoparquetInput};
const defaults:CaptureDependencies={source:geoparquetSourceTx,input:geoparquetInput};
const stale=():never=>{throw new AppError(409,'SOURCE_FUSION_STALE','The selected accepted GeoParquet window or parent changed.');};
const integrity=():never=>{throw new AppError(422,'SOURCE_FUSION_INTEGRITY','The exact accepted GeoParquet window differs from its pins.');};

/** Read adapter over canonical source/input/attempt predicates. No result I/O or
 * tool scan while fusion holds the complete-set SQL locks. One direct accepted
 * parent is captured; its exact window receipt is checked outside the locks. */
export async function acceptedFusionGeoParquetTx(client:PoolClient,pin:SourceFusionPin,lock=true,deps:CaptureDependencies=defaults):Promise<FusionGeoParquetAuthority>{
  const ctx=await deps.source(client,pin.caseId,pin.sourceId,lock);
  const capture=async(jobId:string)=>{
    const job=(await client.query(`SELECT j.*,m.result_ref,m.input_sha256,m.logical_state,m.accepted_fence,
      a.state attempt_state,a.fence attempt_fence,a.input_sha256 attempt_input_sha256,a.completion_sha256
      FROM jobs j JOIN usp_job_metadata m ON m.job_id=j.id LEFT JOIN usp_job_attempts a ON a.job_id=j.id AND a.fence=m.accepted_fence
      WHERE j.id=$1 AND j.case_id=$2 AND j.source_id=$3 AND j.operation='geoparquet-native'${lock?' FOR SHARE OF j,m':''}`,
      [jobId,pin.caseId,pin.sourceId])).rows[0];
    if(!job)return stale();
    const input=GeoParquetInputSchema.parse(job.payload);assertGeoParquetJobRow(job,input,true);
    if(!ctx.latest||fingerprint(deps.input(ctx,input.jobId,input.selection,input.tools,input.continuation))!==fingerprint(input))return stale();
    return {job,input,resultSha256:job.result_ref.sha256,resultBytes:geoparquetResultBytes(job.result_ref,jobId),acceptedFence:Number(job.accepted_fence)};
  };
  const current=await capture(pin.jobId),input=current.input;
  if(input.caseRevision!==pin.caseRevision||input.sourceRevision!==pin.sourceRevision||input.sourceSha256!==pin.sourceSha256||
    input.readerSha256!==pin.readerSha256||fingerprint(input)!==pin.inputSha256||current.resultSha256!==pin.resultSha256||
    current.resultBytes!==pin.resultBytes||current.acceptedFence!==pin.acceptedFence)return stale();
  let parent:Parent|null=null;
  if(input.continuation){
    const p=input.continuation;if(p.jobId===input.jobId||p.nextRowIndex!==input.selection.startRowIndex)return stale();
    const accepted=await capture(p.jobId);
    if(accepted.resultSha256!==p.resultSha256||fingerprint(accepted.input)!==p.inputSha256||accepted.acceptedFence!==p.acceptedFence||
      p.nextRowIndex<=accepted.input.selection.startRowIndex||fingerprint(accepted.input.tools)!==fingerprint(input.tools))return stale();
    parent={input:accepted.input,resultSha256:accepted.resultSha256,resultBytes:accepted.resultBytes,acceptedFence:accepted.acceptedFence};
  }
  return {kind:'geoparquet',input,acceptedFence:current.acceptedFence,parent};
}
/** Same exact tool pins also cover the captured parent; no immutable exemption. */
export function verifyFusionGeoParquetTools(input:GeoParquetInput,budget:Pick<FusionBudget,'deadlineAt'|'signal'>){
  fusionLive(budget);assertGeoParquetReadTools(input.tools,budget.deadlineAt);fusionLive(budget);
}
/** Called after complete-set capture/tool verification and before the final
 * aggregate reauthorization. Reuses the shared bounded hash/JSON primitives. */
export async function readFusionGeoParquetResult(raw:SourceFusionGeoParquetSelection,authority:FusionGeoParquetAuthority,budget:FusionBudget,
  read:typeof readFusionObject=readFusionObject){
  const selection=SourceFusionGeoParquetSelectionSchema.parse(raw),pin=selection.pin;
  if(authority.kind!=='geoparquet'||authority.acceptedFence!==pin.acceptedFence||fingerprint(authority.input)!==pin.inputSha256)return integrity();
  const readResult=async(input:GeoParquetInput,hash:string,size:number)=>{
    const bytes=await read(geoparquetResultKey(input.jobId,hash),size,hash,budget),result=GeoParquetResultSchema.parse(fusionJson(bytes,budget));
    if(fingerprint(result.input)!==fingerprint(input)||result.artifact.key!==geoparquetArtifactKey(input.jobId,result.artifact.sha256))return integrity();
    return result;
  };
  const result=await readResult(authority.input,pin.resultSha256,pin.resultBytes);
  if(result.artifact.sha256!==selection.artifactSha256)return integrity();
  const continuation=authority.input.continuation,parent=authority.parent;
  if(Boolean(continuation)!==Boolean(parent))return integrity();
  if(continuation&&parent){
    if(parent.input.jobId!==continuation.jobId||parent.resultSha256!==continuation.resultSha256||
      fingerprint(parent.input)!==continuation.inputSha256||parent.acceptedFence!==continuation.acceptedFence||
      fingerprint(parent.input.tools)!==fingerprint(authority.input.tools))return integrity();
    const prior=await readResult(parent.input,parent.resultSha256,parent.resultBytes);
    if(prior.artifact.sha256!==continuation.artifactSha256||prior.summary.window.status!=='available'||
      prior.summary.window.nextRowIndex!==continuation.nextRowIndex||continuation.nextRowIndex!==authority.input.selection.startRowIndex||
      continuation.nextRowIndex<=parent.input.selection.startRowIndex)return integrity();
  }
  const artifact=await read(result.artifact.key,result.artifact.bytes,result.artifact.sha256,budget),native=fusionJson(artifact,budget);
  if(fingerprint(geoparquetSummary(artifact,authority.input))!==fingerprint(result.summary))return integrity();
  fusionLive(budget);return {kind:'geoparquet' as const,result,native};
}
