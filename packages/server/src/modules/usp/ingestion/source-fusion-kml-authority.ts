import type {PoolClient} from 'pg';
import type {KMLInput} from '@ulpin/contracts/usp';
import type {SourceFusionPin} from '../../../../../contracts/src/source-fusion';
import {AppError} from '../../../infrastructure/errors';
import {kmlStatusTx,assertKMLJobRow,kmlResultBytes} from './kml';
import {assertKMLReadTools} from './kml-config';

/** Canonical source/current family/reader/access and exact accepted attempt,
 * using fusion's already protected complete-set client. */
export async function acceptedFusionKMLTx(client:PoolClient,pin:SourceFusionPin,lock=true){
  const row=await kmlStatusTx(client,pin.caseId,pin.sourceId,pin.jobId,lock);
  if(row.stale||row.job.status!=='succeeded'||!row.job.result_ref)
    throw new AppError(409,'SOURCE_FUSION_STALE','The selected accepted KML context changed.');
  assertKMLJobRow(row.job,row.input,true);
  if(row.input.caseRevision!==pin.caseRevision||row.input.sourceRevision!==pin.sourceRevision||
    row.input.sourceSha256!==pin.sourceSha256||row.job.result_ref.sha256!==pin.resultSha256||
    kmlResultBytes(row.job.result_ref,pin.jobId)!==pin.resultBytes)
    throw new AppError(409,'SOURCE_FUSION_STALE','The selected accepted KML context changed.');
  return {kind:'kml' as const,input:row.input,acceptedFence:Number(row.job.accepted_fence)};
}

/** Runtime/tool inventory checks stay outside SQL locks. No native execution. */
export function verifyFusionKMLTools(input:KMLInput,budget:{deadlineAt:number;signal:AbortSignal}){
  const live=()=>{if(budget.signal.aborted||Date.now()>=budget.deadlineAt)
    throw new AppError(503,'SOURCE_FUSION_DEADLINE','The bounded source context read expired.');};
  live();assertKMLReadTools(input.tools,budget.deadlineAt);live();
}
