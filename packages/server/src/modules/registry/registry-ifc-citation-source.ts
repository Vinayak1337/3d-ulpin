import type {PoolClient} from 'pg';
import type {SourceFusionPin} from '../../../../contracts/src/source-fusion';
import {AppError,conflict} from '../../infrastructure/errors';
import {fingerprint} from '../cases/domain';
import {ifcSourceTx} from '../usp/ingestion/ifc';
import {acceptedFusionIFCTx} from '../usp/ingestion/source-fusion-ifc-authority';

/** IFC citation only. Generic document/snapshot/copy/readiness policies remain
 * unchanged. Callers discover all case gates before destination locks. */
export async function registryIFCCitationSourceTx(client:PoolClient,siteId:string,pin:SourceFusionPin,lock=false){
  const authority=await acceptedFusionIFCTx(client,pin,lock),current=await ifcSourceTx(client,pin.caseId,pin.sourceId,lock);
  if(current.current.site_id!==siteId||Object.hasOwn(current.source.inspection??{},'copiedFrom'))
    throw new AppError(403,'REGISTRY_IFC_SOURCE_DENIED','This IFC citation is unavailable in the selected target site.');
  if(!current.latest||authority.input.readerSha256!==pin.readerSha256||fingerprint(authority.input)!==pin.inputSha256||
    authority.acceptedFence!==pin.acceptedFence)
    conflict('The exact IFC source, input, reader or accepted attempt changed.');
  return {authority,source:{...current.source,accessSha256:current.binding.access}};
}
