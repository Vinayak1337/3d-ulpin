import type {PoolClient} from 'pg';
import type {IFCInput} from '@ulpin/contracts/usp';
import type {SourceFusionPin} from '../../../../../contracts/src/source-fusion';
import {AppError} from '../../../infrastructure/errors';
import {ifcStatusTx,assertIFCJobRow,ifcResultBytes} from './ifc';
import {assertIFCReadTools} from './ifc-config';

/** Reuse canonical source/access/latest-family/current-reader and attempt checks
 * on the aggregate fusion transaction; never reinterpret job success as acceptance. */
export async function acceptedFusionIFCTx(client:PoolClient,pin:SourceFusionPin,lock=true){
  const row=await ifcStatusTx(client,pin.caseId,pin.sourceId,pin.jobId,lock);
  if(row.stale||row.job.status!=='succeeded'||!row.job.result_ref)
    throw new AppError(409,'SOURCE_FUSION_STALE','The selected accepted IFC context changed.');
  assertIFCJobRow(row.job,row.input,true);
  if(row.input.caseRevision!==pin.caseRevision||row.input.sourceRevision!==pin.sourceRevision||
    row.input.sourceSha256!==pin.sourceSha256||row.job.result_ref.sha256!==pin.resultSha256||
    ifcResultBytes(row.job.result_ref,pin.jobId)!==pin.resultBytes)
    throw new AppError(409,'SOURCE_FUSION_STALE','The selected accepted IFC context changed.');
  return {kind:'ifc' as const,input:row.input,acceptedFence:Number(row.job.accepted_fence)};
}

/** Match the canonical artifact route's tool checks before and after private I/O.
 * Keep runtime inventory I/O outside the aggregate database lock scope. */
export function verifyFusionIFCTools(input:IFCInput,budget:{deadlineAt:number;signal:AbortSignal}){
  const live=()=>{if(budget.signal.aborted||Date.now()>=budget.deadlineAt)
    throw new AppError(503,'SOURCE_FUSION_DEADLINE','The bounded source context read expired.');};
  live();assertIFCReadTools(input.tools,budget.deadlineAt);live();
}
