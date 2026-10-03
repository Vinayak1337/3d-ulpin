import type {PoolClient} from 'pg';
import type {RasterWindowInput} from '@ulpin/contracts/usp';
import type {SourceFusionPin} from '../../../../../contracts/src/source-fusion';
import {SourceFusionRasterSelectionSchema,type SourceFusionRasterSelection} from '../../../../../contracts/src/source-fusion-raster';
import {AppError} from '../../../infrastructure/errors';
import {fingerprint} from '../../cases/domain';
import {rasterWindowCaptureTx,assertRasterJobRow,readRasterResult} from './raster-window';
import {fusionLive,readFusionObject,type FusionBudget} from './source-fusion-authority';

export type FusionRasterAuthority={kind:'raster';input:RasterWindowInput;acceptedFence:number;resultSha256:string;capture:string};
const stale=():never=>{throw new AppError(409,'SOURCE_FUSION_STALE','The exact accepted raster metadata window changed.');};
const integrity=():never=>{throw new AppError(422,'SOURCE_FUSION_INTEGRITY','The accepted raster metadata differs from its selection pins.');};

/** Reuse full canonical raster authority, including registered enrollment and
 * accepted attempt. Its SHARE locks stay inside the complete-set capture. */
export async function acceptedFusionRasterTx(client:PoolClient,pin:SourceFusionPin,_lock=true):Promise<FusionRasterAuthority>{
  const row=await rasterWindowCaptureTx(client,pin.caseId,pin.sourceId,pin.jobId),{input,job}=row;
  assertRasterJobRow(job,input,true);
  if(row.stale||input.caseRevision!==pin.caseRevision||input.sourceRevision!==pin.sourceRevision||input.sourceSha256!==pin.sourceSha256||
    input.readerSha256!==pin.readerSha256||fingerprint(input)!==pin.inputSha256||job.result_ref.sha256!==pin.resultSha256||
    Number(job.accepted_fence)!==pin.acceptedFence)return stale();
  return {kind:'raster',input,acceptedFence:Number(job.accepted_fence),resultSha256:job.result_ref.sha256,capture:row.capture};
}
/** Metadata-only read. Canonical receipt validation checks exact input, key and
 * default/explicit window; shared streaming reserves/counts/hashes known bytes.
 * No TIFF artifact or additional window is fetched. */
export async function readFusionRasterResult(raw:SourceFusionRasterSelection,authority:FusionRasterAuthority,budget:FusionBudget,
  read:typeof readFusionObject=readFusionObject){
  const selection=SourceFusionRasterSelectionSchema.parse(raw),pin=selection.pin;fusionLive(budget);
  if(authority.acceptedFence!==pin.acceptedFence||authority.resultSha256!==pin.resultSha256||fingerprint(authority.input)!==pin.inputSha256)return integrity();
  const result=await readRasterResult(authority.input,pin.resultSha256,budget,
    (key,hash)=>read(key,pin.resultBytes,hash,budget));
  if(result.artifact.sha256!==selection.artifactSha256||fingerprint(result.metadata)!==selection.metadataSha256||
    fingerprint(result.metadata.window)!==fingerprint(selection.window))return integrity();
  fusionLive(budget);return {kind:'raster' as const,result};
}
