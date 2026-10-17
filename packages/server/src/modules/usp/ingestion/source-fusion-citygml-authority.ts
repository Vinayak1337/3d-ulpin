import type {PoolClient} from 'pg';
import type {CityGMLInput} from '../../../../../contracts/src/usp/citygml-ingestion';
import type {SourceFusionPin} from '../../../../../contracts/src/source-fusion';
import {AppError} from '../../../infrastructure/errors';
import {citygmlStatusTx,assertCityGMLJobRow,citygmlResultBytes} from './citygml';
import {assertCityGMLReadTools} from './citygml-config';

/** Canonical private original, current/latest source and accepted attempt,
 * inside fusion's complete-set capture. No additional access exception. */
export async function acceptedFusionCityGMLTx(client:PoolClient,pin:SourceFusionPin,lock=true){
  const row=await citygmlStatusTx(client,pin.caseId,pin.sourceId,pin.jobId,lock);
  if(row.stale||row.job.status!=='succeeded'||!row.job.result_ref)
    throw new AppError(409,'SOURCE_FUSION_STALE','The selected accepted CityGML context changed.');
  assertCityGMLJobRow(row.job,row.input,true);
  if(row.input.caseRevision!==pin.caseRevision||row.input.sourceRevision!==pin.sourceRevision||
    row.input.sourceSha256!==pin.sourceSha256||row.job.result_ref.sha256!==pin.resultSha256||
    citygmlResultBytes(row.job.result_ref,pin.jobId)!==pin.resultBytes)
    throw new AppError(409,'SOURCE_FUSION_STALE','The selected accepted CityGML context changed.');
  return {kind:'citygml' as const,input:row.input,acceptedFence:Number(row.job.accepted_fence)};
}
/** Full immutable-read tool assertion, outside SQL locks. No parser run. */
export function verifyFusionCityGMLTools(input:CityGMLInput,budget:{deadlineAt:number;signal:AbortSignal}){
  const live=()=>{if(budget.signal.aborted||Date.now()>=budget.deadlineAt)
    throw new AppError(503,'SOURCE_FUSION_DEADLINE','The bounded source context read expired.');};
  live();assertCityGMLReadTools(input.tools,budget.deadlineAt);live();
}
