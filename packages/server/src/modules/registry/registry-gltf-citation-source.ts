import type {PoolClient} from 'pg';
import type {SourceFusionPin} from '../../../../contracts/src/source-fusion';
import {AppError,conflict} from '../../infrastructure/errors';
import {fingerprint} from '../cases/domain';
import {gltfSourceTx} from '../usp/ingestion/gltf';
import {acceptedFusionGltfTx} from '../usp/ingestion/source-fusion-gltf-authority';

export async function registryGltfCitationSourceTx(client:PoolClient,siteId:string,pin:SourceFusionPin,lock=false){
  const authority=await acceptedFusionGltfTx(client,pin,lock),current=await gltfSourceTx(client,pin.caseId,pin.sourceId,lock);
  if(current.current.site_id!==siteId||Object.hasOwn(current.source.inspection??{},'copiedFrom'))
    throw new AppError(403,'REGISTRY_GLTF_SOURCE_DENIED','This glTF reference is unavailable in the selected target site.');
  if(!current.latest||authority.input.readerSha256!==pin.readerSha256||fingerprint(authority.input)!==pin.inputSha256||authority.acceptedFence!==pin.acceptedFence)
    conflict('The exact glTF source, input, reader or accepted attempt changed.');
  return {authority,source:{...current.source,accessSha256:current.binding.access}};
}
