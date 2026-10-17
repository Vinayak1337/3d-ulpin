import type {PoolClient} from 'pg';
import type {SourceFusionPin} from '../../../../contracts/src/source-fusion';
import {AppError,conflict} from '../../infrastructure/errors';
import {fingerprint} from '../cases/domain';
import {rasterSourceTx} from '../usp/ingestion/raster-window';
import {acceptedFusionRasterTx} from '../usp/ingestion/source-fusion-raster-authority';

/** Exact accepted metadata authority, gated to the selected recorded target
 * site. Caller owns the complete source/target lock set; no TIFF is read. */
export async function registryRasterCitationSourceTx(client:PoolClient,siteId:string,pin:SourceFusionPin,lock=false){
  const authority=await acceptedFusionRasterTx(client,pin,lock),current=await rasterSourceTx(client,pin.caseId,pin.sourceId,lock);
  if(current.current.site_id!==siteId||Object.hasOwn(current.source.inspection??{},'copiedFrom'))
    throw new AppError(403,'REGISTRY_RASTER_SOURCE_DENIED','This raster metadata citation is unavailable in the selected target site.');
  if(!current.latest||authority.input.readerSha256!==pin.readerSha256||fingerprint(authority.input)!==pin.inputSha256||
    authority.acceptedFence!==pin.acceptedFence)
    conflict('The exact raster source, input, reader or accepted attempt changed.');
  return {authority,source:{...current.source,accessSha256:current.binding.access}};
}
