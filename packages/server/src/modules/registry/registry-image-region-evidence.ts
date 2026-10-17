import type {PoolClient} from 'pg';
import type {RegistryRegionOriginal,RegistryImageRegionCitation,RegistryImageRegionAddition} from '../../../../contracts/src/registry-document-evidence';
import {PacketImageRegionProvenanceSchema,PacketImageRegionWorkerSchema,PACKET_IMAGE_REGION_LIMITS as limits}
  from '../../../../contracts/src/packet-image-region';
import {documentImageAuthorityTx} from '../usp/ingestion/document-images';
import {PacketImageRegionService,assertCleanImageRegionPng,packetImageRegionTransform} from '../usp/packets/image-region';
import {ingestionBinding} from '../usp/ingestion/events';
import {AppError,conflict} from '../../infrastructure/errors';
import {sha256} from '../../infrastructure/storage';
import {canonical,fingerprint} from '../cases/domain';

/** All source-case gates/rows must precede destination/recording locks. */
export async function registryImageRegionSourceTx(client:PoolClient,siteId:string,original:RegistryRegionOriginal,protect=false){
  const sourceCase=(await client.query(`SELECT id,site_id,revision,archived FROM cases WHERE id=$1${protect?' FOR SHARE':''}`,
    [original.caseId])).rows[0];
  if(!sourceCase||sourceCase.archived||sourceCase.site_id!==siteId)
    throw new AppError(403,'REGISTRY_IMAGE_REGION_SOURCE_DENIED','The original image is unavailable in this selected site.');
  const source=(await client.query(`SELECT id,case_id,inspection FROM sources WHERE id=$1${protect?' FOR SHARE':''}`,
    [original.sourceId])).rows[0];
  if(!source||source.case_id!==original.caseId)conflict('The selected original image case changed.');
  if(Object.hasOwn(source.inspection??{},'copiedFrom'))
    throw new AppError(422,'REGISTRY_IMAGE_REGION_COPY_UNSUPPORTED','Select the canonical retained image original.');
  const authority=await documentImageAuthorityTx(client,original.sourceId,
    {revision:original.sourceRevision,sha256:original.sourceSha256});
  if(authority.caseId!==original.caseId||authority.caseRevision!==original.caseRevision||authority.sourceBytes!==original.sourceBytes)
    conflict('The exact image original source or case pin changed.');
  return {authority,accessSha256:ingestionBinding(original.caseId).access};
}
export type RegistryImageRegionPrepared={requestSha256:string;source:Awaited<ReturnType<typeof registryImageRegionSourceTx>>;
  validation:RegistryImageRegionCitation['validation']};

function assertValidation(addition:RegistryImageRegionAddition,proof:RegistryImageRegionCitation['validation'],
  current:RegistryImageRegionPrepared['source']){
  const plan=packetImageRegionTransform(addition.region),info=proof.sourceImage,o=info.orientation.applied;
  const frame={kind:'image_oriented_top_left_pixels',width:o>=5?info.frame.height:info.frame.width,
    height:o>=5?info.frame.width:info.frame.height,orientation:info.orientation};
  if(proof.sourceSha256!==addition.document.sourceSha256||proof.sourceBytes!==addition.document.sourceBytes||
    info.format!==current.authority.format||canonical(frame)!==canonical(addition.region.frame)||
    canonical(proof.selection)!==canonical(addition.region)||canonical(proof.transform)!==canonical(plan.transform)||
    canonical(proof.output.pixels)!==canonical(plan.pixels)||proof.output.pixels[0]*proof.output.pixels[1]>limits.pixels||
    info.frame.width*info.frame.height>limits.sourcePixels||info.color.embeddedIcc||info.color.declaredSrgb===false||
    !['RGB','RGBA','L','LA','P','1'].includes(info.mode)||
    proof.output.mode!==(info.color.transparency==='supplied'?'RGBA':'RGB')||
    Buffer.byteLength(JSON.stringify(proof))>limits.provenanceBytes)
    conflict('The image-region validation differs from its exact original frame, selection, transform or display profile.');
}
const imageRegionService=new PacketImageRegionService();
/** Server-only crop preparation; never called while mutation locks are held. */
export async function prepareRegistryImageRegion(addition:RegistryImageRegionAddition,
  source:RegistryImageRegionPrepared['source'],extract:PacketImageRegionService['extract']=imageRegionService.extract.bind(imageRegionService)){
  const result=await extract(addition.document.sourceId,{revision:String(addition.document.sourceRevision),
    sha256:addition.document.sourceSha256,purpose:'private_source_preview',selection:addition.region});
  const proof=PacketImageRegionProvenanceSchema.parse(result.provenance);
  if(proof.sourceId!==addition.document.sourceId||proof.caseId!==addition.document.caseId||
    proof.sourceRevision!==addition.document.sourceRevision||proof.caseRevision!==addition.document.caseRevision||
    sha256(result.bytes)!==proof.output.sha256||result.bytes.length!==proof.output.bytes)
    conflict('The validated image crop differs from the exact retained original.');
  assertCleanImageRegionPng(result.bytes,proof.output.pixels,proof.output.mode);
  const {caseId:_,caseRevision:__,sourceId:___,sourceRevision:____,purpose:_____,locator:______,
    calibration:_______,applicability:________,...worker}=proof;
  const validation=PacketImageRegionWorkerSchema.parse({...worker,version:'packet-image-region-local/1'});
  assertValidation(addition,validation,source);
  return {requestSha256:fingerprint(addition),source,validation};
}
export function imageRegionCitationId(pin:Pick<RegistryImageRegionCitation,'document'|'region'|'purpose'|'target'|'validation'|'authoritySha256'>){
  return fingerprint({version:'registry-image-region-citation/1',document:pin.document,region:pin.region,
    purpose:pin.purpose,target:pin.target,validation:pin.validation,authoritySha256:pin.authoritySha256});
}
export function assertImageRegionCitation(pin:RegistryImageRegionCitation,current:RegistryImageRegionPrepared['source']){
  if(pin.id!==imageRegionCitationId(pin)||pin.authoritySha256!==current.authority.authoritySha256||
    pin.selection.accessSha256!==current.accessSha256)
    conflict('The image-region validation, original or current access pin changed.');
  assertValidation(pin,pin.validation,current);
}
