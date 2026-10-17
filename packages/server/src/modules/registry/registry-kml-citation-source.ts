import type {PoolClient} from 'pg';
import type {SourceFusionPin} from '../../../../contracts/src/source-fusion';
import {AppError,conflict} from '../../infrastructure/errors';
import {fingerprint} from '../cases/domain';
import {kmlSourceTx} from '../usp/ingestion/kml';
import {acceptedFusionKMLTx} from '../usp/ingestion/source-fusion-kml-authority';

/** Typed feature citation only; caller gates the complete source/target set. */
export async function registryKMLCitationSourceTx(client:PoolClient,siteId:string,pin:SourceFusionPin,lock=false){
  const authority=await acceptedFusionKMLTx(client,pin,lock),current=await kmlSourceTx(client,pin.caseId,pin.sourceId,lock);
  if(current.current.site_id!==siteId||Object.hasOwn(current.source.inspection??{},'copiedFrom'))
    throw new AppError(403,'REGISTRY_KML_SOURCE_DENIED','This KML citation is unavailable in the selected target site.');
  if(!current.latest||authority.input.readerSha256!==pin.readerSha256||fingerprint(authority.input)!==pin.inputSha256||
    authority.acceptedFence!==pin.acceptedFence)
    conflict('The exact KML source, input, reader or accepted attempt changed.');
  return {authority,source:{...current.source,accessSha256:current.binding.access}};
}
