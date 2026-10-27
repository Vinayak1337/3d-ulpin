import type {PoolClient} from 'pg';
import type {DXFInput} from '@ulpin/contracts/usp';
import type {SourceFusionPin} from '../../../../../contracts/src/source-fusion';
import {AppError} from '../../../infrastructure/errors';
import {dxfStatusTx,assertDXFJobRow,dxfResultBytes} from './dxf';
import {assertDXFReadTools} from './dxf-config';

/** Same canonical source/current family/reader/access/accepted-attempt admission
 * as the private DXF reader, on fusion's already protected aggregate client. */
export async function acceptedFusionDXFTx(client:PoolClient,pin:SourceFusionPin,lock=true){
  const row=await dxfStatusTx(client,pin.caseId,pin.sourceId,pin.jobId,lock);
  if(row.stale||row.job.status!=='succeeded'||!row.job.result_ref)
    throw new AppError(409,'SOURCE_FUSION_STALE','The selected accepted DXF context changed.');
  assertDXFJobRow(row.job,row.input,true);
  if(row.input.caseRevision!==pin.caseRevision||row.input.sourceRevision!==pin.sourceRevision||
    row.input.sourceSha256!==pin.sourceSha256||row.job.result_ref.sha256!==pin.resultSha256||
    dxfResultBytes(row.job.result_ref,pin.jobId)!==pin.resultBytes)
    throw new AppError(409,'SOURCE_FUSION_STALE','The selected accepted DXF context changed.');
  return {kind:'dxf' as const,input:row.input,acceptedFence:Number(row.job.accepted_fence)};
}

/** Canonical immutable-read verification stays outside database locks and within
 * the aggregate deadline; current writers retain their strict tool assertion. */
export function verifyFusionDXFTools(input:DXFInput,budget:{deadlineAt:number;signal:AbortSignal}){
  const live=()=>{if(budget.signal.aborted||Date.now()>=budget.deadlineAt)
    throw new AppError(503,'SOURCE_FUSION_DEADLINE','The bounded source context read expired.');};
  live();assertDXFReadTools(input.tools,budget.deadlineAt);live();
}
