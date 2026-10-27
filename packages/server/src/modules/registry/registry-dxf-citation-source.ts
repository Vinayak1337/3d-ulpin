import type {PoolClient} from 'pg';
import type {SourceFusionPin} from '../../../../contracts/src/source-fusion';
import {AppError,conflict} from '../../infrastructure/errors';
import {fingerprint} from '../cases/domain';
import {dxfSourceTx} from '../usp/ingestion/dxf';
import {acceptedFusionDXFTx} from '../usp/ingestion/source-fusion-dxf-authority';

/** Typed citation bridge only. Generic source/recording/copy policies stay
 * unchanged; callers acquire the complete case gate set before target locks. */
export async function registryDXFCitationSourceTx(client:PoolClient,siteId:string,pin:SourceFusionPin,lock=false){
  const authority=await acceptedFusionDXFTx(client,pin,lock),current=await dxfSourceTx(client,pin.caseId,pin.sourceId,lock);
  if(current.current.site_id!==siteId||Object.hasOwn(current.source.inspection??{},'copiedFrom'))
    throw new AppError(403,'REGISTRY_DXF_SOURCE_DENIED','This DXF citation is unavailable in the selected target site.');
  if(!current.latest||authority.input.readerSha256!==pin.readerSha256||fingerprint(authority.input)!==pin.inputSha256||
    authority.acceptedFence!==pin.acceptedFence)
    conflict('The exact DXF source, input, reader or accepted attempt changed.');
  return {authority,source:{...current.source,accessSha256:current.binding.access}};
}
