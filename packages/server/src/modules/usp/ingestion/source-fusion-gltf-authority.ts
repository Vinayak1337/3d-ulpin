import type {PoolClient} from 'pg';
import {GLTF_LIMITS,GltfResultSchema,type GltfInput} from '../../../../../contracts/src/usp/gltf-ingestion';
import type {SourceFusionPin,SourceFusionSelection} from '../../../../../contracts/src/source-fusion';
import {AppError} from '../../../infrastructure/errors';
import {fingerprint} from '../../cases/domain';
import {gltfStatusTx,assertGltfJobRow,gltfResultBytes,gltfResultKey,gltfArtifactKey} from './gltf';
import {assertGltfReadTools} from './gltf-config';
import {gltfSummary} from './gltf-processor';
import {fusionLive,fusionJson,type FusionBudget,type readFusionObject} from './source-fusion-authority';

export type FusionGltfAuthority={kind:'gltf';input:GltfInput;acceptedFence:number};
/** Reuse canonical private/current source and exact accepted attempt authority. */
export async function acceptedFusionGltfTx(client:PoolClient,pin:SourceFusionPin,lock=true):Promise<FusionGltfAuthority>{
  const row=await gltfStatusTx(client,pin.caseId,pin.sourceId,pin.jobId,lock);
  if(row.stale||row.job.status!=='succeeded'||!row.job.result_ref)
    throw new AppError(409,'SOURCE_FUSION_STALE','The selected accepted glTF context changed.');
  assertGltfJobRow(row.job,row.input,true);
  if(row.input.caseRevision!==pin.caseRevision||row.input.sourceRevision!==pin.sourceRevision||row.input.sourceSha256!==pin.sourceSha256||
    row.job.result_ref.sha256!==pin.resultSha256||gltfResultBytes(row.job.result_ref,pin.jobId)!==pin.resultBytes)
    throw new AppError(409,'SOURCE_FUSION_STALE','The selected accepted glTF context changed.');
  return {kind:'gltf',input:row.input,acceptedFence:Number(row.job.accepted_fence)};
}
export function verifyFusionGltfTools(input:GltfInput,budget:FusionBudget){
  fusionLive(budget);assertGltfReadTools(input.tools,budget.deadlineAt);fusionLive(budget);
}
export async function readFusionGltfResult(selection:Extract<SourceFusionSelection,{kind:'gltf'}>,authority:FusionGltfAuthority,
  budget:FusionBudget,read:typeof readFusionObject){
  const pin=selection.pin;
  if(pin.resultBytes>GLTF_LIMITS.resultBytes)
    throw new AppError(422,'SOURCE_FUSION_INTEGRITY','Accepted glTF result exceeds its receipt profile.');
  const bytes=await read(gltfResultKey(pin.jobId,pin.resultSha256),pin.resultBytes,pin.resultSha256,budget);
  const result=GltfResultSchema.parse(fusionJson(bytes,budget));
  if(fingerprint(result.input)!==fingerprint(authority.input)||result.artifact.key!==gltfArtifactKey(pin.jobId,result.artifact.sha256))
    throw new AppError(422,'SOURCE_FUSION_INTEGRITY','Accepted glTF artifact belongs to another input.');
  const artifact=await read(result.artifact.key,result.artifact.bytes,result.artifact.sha256,budget),native=fusionJson(artifact,budget);
  if(fingerprint(gltfSummary(artifact,authority.input))!==fingerprint(result.summary))
    throw new AppError(422,'SOURCE_FUSION_INTEGRITY','Accepted glTF metadata differs from its summary.');
  fusionLive(budget);return {kind:'gltf' as const,result,native};
}
