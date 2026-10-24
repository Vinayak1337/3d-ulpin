import type {PoolClient} from 'pg';
import type {SourceFusionPin} from '../../../../contracts/src/source-fusion';
import {AppError,conflict} from '../../infrastructure/errors';
import {fingerprint} from '../cases/domain';
import {geoparquetSourceTx} from '../usp/ingestion/geoparquet';
import {acceptedFusionGeoParquetTx} from '../usp/ingestion/source-fusion-geoparquet-authority';

/** Typed citation authority; caller gates the complete source/target set.
 * Preserve the exact direct parent authority for final reauthorization. */
export async function registryGeoParquetCitationSourceTx(client:PoolClient,siteId:string,pin:SourceFusionPin,lock=false){
  const authority=await acceptedFusionGeoParquetTx(client,pin,lock),current=await geoparquetSourceTx(client,pin.caseId,pin.sourceId,lock);
  if(current.current.site_id!==siteId||Object.hasOwn(current.source.inspection??{},'copiedFrom'))
    throw new AppError(403,'REGISTRY_GEOPARQUET_SOURCE_DENIED','This GeoParquet citation is unavailable in the selected target site.');
  if(!current.latest||authority.input.readerSha256!==pin.readerSha256||fingerprint(authority.input)!==pin.inputSha256||
    authority.acceptedFence!==pin.acceptedFence)
    conflict('The exact GeoParquet source, input, reader or accepted attempt changed.');
  return {authority,source:{...current.source,accessSha256:current.binding.access}};
}
