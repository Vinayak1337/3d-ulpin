import type {PoolClient} from 'pg';
import type {PointBatchInput} from '@ulpin/contracts/usp';
import type {SourceFusionPin} from '../../../../../contracts/src/source-fusion';
import {SourceFusionPointSelectionSchema,type SourceFusionPointSelection} from '../../../../../contracts/src/source-fusion-point';
import {AppError} from '../../../infrastructure/errors';
import {fingerprint} from '../../cases/domain';
import {pointBatchCaptureTx,assertPointJobRow,readPointResult} from './point-batch';
import {fusionLive,readFusionObject,type FusionBudget} from './source-fusion-authority';

export type FusionPointAuthority={kind:'point';input:PointBatchInput;acceptedFence:number;resultSha256:string;capture:string};
const stale=():never=>{throw new AppError(409,'SOURCE_FUSION_STALE','The exact accepted point metadata batch changed.');};
const integrity=():never=>{throw new AppError(422,'SOURCE_FUSION_INTEGRITY','The accepted point metadata differs from its selection pins.');};

/** Reuse full canonical point authority, including registered enrollment and
 * accepted attempt. Its SHARE locks stay inside the complete-set capture. */
export async function acceptedFusionPointTx(client:PoolClient,pin:SourceFusionPin,_lock=true):Promise<FusionPointAuthority>{
  const row=await pointBatchCaptureTx(client,pin.caseId,pin.sourceId,pin.jobId),{input,job}=row;
  assertPointJobRow(job,input,true);
  if(row.stale||input.caseRevision!==pin.caseRevision||input.sourceRevision!==pin.sourceRevision||input.sourceSha256!==pin.sourceSha256||
    input.readerSha256!==pin.readerSha256||fingerprint(input)!==pin.inputSha256||job.result_ref.sha256!==pin.resultSha256||
    Number(job.accepted_fence)!==pin.acceptedFence)return stale();
  return {kind:'point',input,acceptedFence:Number(job.accepted_fence),resultSha256:job.result_ref.sha256,capture:row.capture};
}
/** Metadata-only read. Canonical receipt validation checks exact input, key and
 * default/explicit batch; shared streaming reserves/counts/hashes known bytes.
 * No native record artifact or additional batch is fetched. */
export async function readFusionPointResult(raw:SourceFusionPointSelection,authority:FusionPointAuthority,budget:FusionBudget,
  read:typeof readFusionObject=readFusionObject){
  const selection=SourceFusionPointSelectionSchema.parse(raw),pin=selection.pin;fusionLive(budget);
  if(authority.acceptedFence!==pin.acceptedFence||authority.resultSha256!==pin.resultSha256||fingerprint(authority.input)!==pin.inputSha256)return integrity();
  const result=await readPointResult(authority.input,pin.resultSha256,budget,
    (key,hash)=>read(key,pin.resultBytes,hash,budget));
  if(result.artifact.sha256!==selection.artifactSha256||fingerprint(result.metadata)!==selection.metadataSha256||
    fingerprint(result.metadata.batch)!==fingerprint(selection.batch))return integrity();
  fusionLive(budget);return {kind:'point' as const,result};
}
