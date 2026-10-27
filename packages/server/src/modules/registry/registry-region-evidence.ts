import type {PoolClient} from 'pg';
import type {RegistryRegionOriginal,RegistryRegionCitation,RegistryRegionAddition} from '@ulpin/contracts';
import {PacketRegionProvenanceSchema,PacketRegionWorkerSchema} from '../../../../contracts/src/packet-region';
import {documentPageAuthorityTx} from '../usp/ingestion/document-pages';
import {PacketRegionService,assertCleanRegionPng,packetRegionTransform} from '../usp/packets/region-extract';
import {ingestionBinding} from '../usp/ingestion/events';
import {AppError,conflict} from '../../infrastructure/errors';
import {sha256} from '../../infrastructure/storage';
import {canonical,fingerprint} from '../cases/domain';

/** Caller acquires all region case gates/rows before destination/recording locks.
 * Locking a case prevents original replacement, family extension and access/site
 * changes while this transaction holds source/target publication authority. */
export async function registryRegionSourceTx(client:PoolClient,siteId:string,original:RegistryRegionOriginal,protect=false){
  const sourceCase=(await client.query(`SELECT id,site_id,revision,archived FROM cases WHERE id=$1${protect?' FOR SHARE':''}`,
    [original.caseId])).rows[0];
  if(!sourceCase||sourceCase.archived||sourceCase.site_id!==siteId)
    throw new AppError(403,'REGISTRY_REGION_SOURCE_DENIED','The original is unavailable in this selected site.');
  const source=(await client.query(`SELECT id,case_id,inspection FROM sources WHERE id=$1${protect?' FOR SHARE':''}`,
    [original.sourceId])).rows[0];
  if(!source||source.case_id!==original.caseId)conflict('The selected original case changed.');
  // This first source-original profile has no copied ancestry to discover late.
  // Original access on a copy must use a separately qualified lineage profile.
  if(Object.hasOwn(source.inspection??{},'copiedFrom'))
    throw new AppError(422,'REGISTRY_REGION_COPY_UNSUPPORTED','Select the canonical retained original for this region.');
  const authority=await documentPageAuthorityTx(client,original.sourceId,
    {revision:original.sourceRevision,sha256:original.sourceSha256});
  if(authority.caseId!==original.caseId||authority.caseRevision!==original.caseRevision||
    authority.sourceBytes!==original.sourceBytes)conflict('The exact original source or case pin changed.');
  const accessSha256=ingestionBinding(original.caseId).access;
  return {authority,accessSha256};
}
export type RegistryRegionPrepared={requestSha256:string;source:Awaited<ReturnType<typeof registryRegionSourceTx>>;
  validation:RegistryRegionCitation['validation']};
const regionService=new PacketRegionService();
/** Only invoked outside a locking mutation. Uses the accepted RGB crop service;
 * its original and authority checks validate actual page/frame, not caller flags. */
export async function prepareRegistryRegion(addition:RegistryRegionAddition,
  source:RegistryRegionPrepared['source'],extract:PacketRegionService['extract']=regionService.extract.bind(regionService)){
  const result=await extract(addition.document.sourceId,addition.page,{revision:String(addition.document.sourceRevision),
    sha256:addition.document.sourceSha256,purpose:'private_source_preview',selection:addition.region});
  const proof=PacketRegionProvenanceSchema.parse(result.provenance);
  if(proof.sourceId!==addition.document.sourceId||proof.caseId!==addition.document.caseId||
    proof.sourceRevision!==addition.document.sourceRevision||proof.caseRevision!==addition.document.caseRevision||
    proof.sourceSha256!==addition.document.sourceSha256||proof.sourceBytes!==addition.document.sourceBytes||proof.page!==addition.page||
    canonical(proof.selection)!==canonical(addition.region)||sha256(result.bytes)!==proof.output.sha256||
    result.bytes.length!==proof.output.bytes||canonical(proof.transform)!==canonical(packetRegionTransform(addition.region)))
    conflict('The validated crop does not match the exact original selection.');
  assertCleanRegionPng(result.bytes,proof.output.pixels);
  const {caseId:_,caseRevision:__,sourceId:___,sourceRevision:____,purpose:_____,...worker}=proof;
  return {requestSha256:fingerprint(addition),source,validation:PacketRegionWorkerSchema.parse({...worker,version:'packet-region-local/1'})};
}
export function regionCitationId(pin:Pick<RegistryRegionCitation,'document'|'page'|'region'|'purpose'|'target'|'validation'|'authoritySha256'>){
  return fingerprint({version:'registry-document-region-citation/1',document:pin.document,page:pin.page,region:pin.region,
    purpose:pin.purpose,target:pin.target,validation:pin.validation,authoritySha256:pin.authoritySha256});
}
export function assertRegionCitation(pin:RegistryRegionCitation,current:RegistryRegionPrepared['source']){
  const proof=pin.validation,transform=packetRegionTransform(pin.region);
  if(pin.id!==regionCitationId(pin)||pin.authoritySha256!==current.authority.authoritySha256||
    pin.selection.accessSha256!==current.accessSha256||proof.sourceSha256!==pin.document.sourceSha256||
    proof.sourceBytes!==pin.document.sourceBytes||proof.page!==pin.page||canonical(proof.selection)!==canonical(pin.region)||
    canonical(proof.transform)!==canonical(transform)||
    proof.output.pixels[0]!==transform.pixelRegion[2]-transform.pixelRegion[0]||
    proof.output.pixels[1]!==transform.pixelRegion[3]-transform.pixelRegion[1])
    conflict('The region validation, original or current access pin changed.');
}
