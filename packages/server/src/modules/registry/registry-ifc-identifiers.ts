import {RegistryDocumentCitationsSchema,type RegistryIFCCitation} from '@ulpin/contracts';
import type {SourceFusionIFCRecordSchema} from '../../../../contracts/src/source-fusion';
import type {z} from 'zod';
import type {UspIdentifierAssertionSchema} from '@ulpin/contracts/usp';
import {AppError,conflict} from '../../infrastructure/errors';
import {fingerprint} from '../cases/domain';
import {localRequestContext} from '../usp/principal';

type NativeRecord=z.infer<typeof SourceFusionIFCRecordSchema>;
export function ifcIdentityFields(kind:string,record:NativeRecord){
  if(!((kind==='building'&&record.entityType==='IfcBuilding')||(kind==='floor'&&record.entityType==='IfcBuildingStorey')))
    throw new AppError(422,'REGISTRY_IFC_IDENTITY_KIND','Confirm an IfcBuilding for a building or IfcBuildingStorey for a floor.');
  const raw=record.attributes.GlobalId,attribute=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:undefined;
  const value=attribute?.value,locator=attribute?.locator;
  if(attribute?.state!=='supplied'||typeof value!=='string'||!/^[0-3][0-9A-Za-z_$]{21}$/.test(value)||
    attribute.rawLiteral!==`'${value}'`||!locator||typeof locator!=='object'||Array.isArray(locator)||
    locator.attribute!=='GlobalId'||locator.stepId!==record.stepId||locator.entityType!==record.entityType||
    !Number.isSafeInteger(locator.byteStart)||!Number.isSafeInteger(locator.byteEnd)||
    Number(locator.byteEnd)-Number(locator.byteStart)!==24)
    throw new AppError(422,'REGISTRY_IFC_IDENTITY_LITERAL','The exact IFC record has no complete literal GlobalId.');
  return {globalId:value,attributeSha256:fingerprint(raw),attributeLocator:locator};
}
export function assertIFCIdentityEvidence(kind:string,pin:RegistryIFCCitation,record:NativeRecord,accessSha256:string){
  if(!pin.identityAssertion)return;
  const {subject,accessSha256:access,confirmedAt:_,...fields}=pin.identityAssertion;
  if(subject!==localRequestContext('registry-ifc-identity').principal.subject||access!==accessSha256||
    fingerprint(fields)!==fingerprint(ifcIdentityFields(kind,record)))
    conflict('The officer-confirmed IFC identity or its exact native attribute changed.');
}
/** Canonical private targets only. Caller must protect current record/source/job
 * authority for every returned citation before disclosing these assertions. */
export function assertedIFCCitations(body:{documentCitations?:unknown},kind:string){
  return RegistryDocumentCitationsSchema.parse(body.documentCitations??[]).filter((pin):pin is RegistryIFCCitation=>
    pin.version==='registry-ifc-citation/1'&&!!pin.identityAssertion).map(pin=>{
    if(!((kind==='building'&&pin.ifc.entityType==='IfcBuilding')||(kind==='floor'&&pin.ifc.entityType==='IfcBuildingStorey')))
      conflict('The confirmed IFC identity no longer agrees with the target kind.');
    if(fingerprint(pin.identityAssertion!.attributeLocator)!==fingerprint(pin.ifc.attributeLocators.GlobalId))
      conflict('The confirmed IFC GlobalId locator changed.');
    return pin;
  });
}
export function reviewedIFCIdentifiers(pins:readonly RegistryIFCCitation[]):z.infer<typeof UspIdentifierAssertionSchema>[] {
  return pins.map(pin=>({scheme:'ifc-globalid',value:pin.identityAssertion!.globalId,issuer:null,
    source:{ref:{namespace:'source_revision',id:pin.document.sourceId},revision:pin.document.sourceRevision},
    state:pins.some(other=>other.document.sourceId===pin.document.sourceId&&other.document.sourceRevision===pin.document.sourceRevision&&
      (other.ifc.stepId!==pin.ifc.stepId||other.identityAssertion!.globalId!==pin.identityAssertion!.globalId))?'disputed':'reviewed'}));
}
