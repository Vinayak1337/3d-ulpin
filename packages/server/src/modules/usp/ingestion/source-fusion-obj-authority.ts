import type {PoolClient} from 'pg';
import {OBJ_LIMITS,ObjResultSchema,type ObjInput} from '../../../../../contracts/src/usp/obj-ingestion';
import type {SourceFusionPin,SourceFusionSelection} from '../../../../../contracts/src/source-fusion';
import {AppError} from '../../../infrastructure/errors';
import {fingerprint} from '../../cases/domain';
import {objStatusTx,assertObjJobRow,objResultBytes,objResultKey,objArtifactKey} from './obj';
import {assertObjReadTools} from './obj-config';
import {objSummary} from './obj-processor';
import {fusionLive,fusionJson,type FusionBudget,type readFusionObject} from './source-fusion-authority';

export type FusionObjAuthority={kind:'obj';input:ObjInput;acceptedFence:number};
/** Reuse canonical private/current source and exact accepted attempt authority. */
export async function acceptedFusionObjTx(client:PoolClient,pin:SourceFusionPin,lock=true):Promise<FusionObjAuthority>{
  const row=await objStatusTx(client,pin.caseId,pin.sourceId,pin.jobId,lock);
  if(row.stale||row.job.status!=='succeeded'||!row.job.result_ref)
    throw new AppError(409,'SOURCE_FUSION_STALE','The selected accepted OBJ context changed.');
  assertObjJobRow(row.job,row.input,true);
  if(row.input.caseRevision!==pin.caseRevision||row.input.sourceRevision!==pin.sourceRevision||row.input.sourceSha256!==pin.sourceSha256||
    row.job.result_ref.sha256!==pin.resultSha256||objResultBytes(row.job.result_ref,pin.jobId)!==pin.resultBytes)
    throw new AppError(409,'SOURCE_FUSION_STALE','The selected accepted OBJ context changed.');
  return {kind:'obj',input:row.input,acceptedFence:Number(row.job.accepted_fence)};
}
export function verifyFusionObjTools(input:ObjInput,budget:FusionBudget){
  fusionLive(budget);assertObjReadTools(input.tools,budget.deadlineAt);fusionLive(budget);
}
export async function readFusionObjResult(selection:Extract<SourceFusionSelection,{kind:'obj'}>,authority:FusionObjAuthority,
  budget:FusionBudget,read:typeof readFusionObject){
  const pin=selection.pin;
  if(pin.resultBytes>OBJ_LIMITS.resultBytes)
    throw new AppError(422,'SOURCE_FUSION_INTEGRITY','Accepted OBJ result exceeds its receipt profile.');
  const bytes=await read(objResultKey(pin.jobId,pin.resultSha256),pin.resultBytes,pin.resultSha256,budget);
  const result=ObjResultSchema.parse(fusionJson(bytes,budget));
  if(fingerprint(result.input)!==fingerprint(authority.input)||result.artifact.key!==objArtifactKey(pin.jobId,result.artifact.sha256))
    throw new AppError(422,'SOURCE_FUSION_INTEGRITY','Accepted OBJ artifact belongs to another input.');
  const artifact=await read(result.artifact.key,result.artifact.bytes,result.artifact.sha256,budget),native=fusionJson(artifact,budget);
  if(fingerprint(objSummary(artifact,authority.input))!==fingerprint(result.summary))
    throw new AppError(422,'SOURCE_FUSION_INTEGRITY','Accepted OBJ metadata differs from its summary.');
  fusionLive(budget);return {kind:'obj' as const,result,native};
}
