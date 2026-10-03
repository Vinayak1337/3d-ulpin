import type {PoolClient} from 'pg';
import type {DocumentInput,IFCInput,DXFInput,KMLInput,RequestContext} from '@ulpin/contracts/usp';
import {DocumentAssociationSourceSchema,type RegistryOcrDocumentCitation,type RegistryIFCCitation} from '@ulpin/contracts';
import {SOURCE_FUSION_LIMITS,SourceFusionLiteralObjectSchema,type SourceFusionContext,type SourceFusionSelection,type SourceFusionPin} from '../../../../../contracts/src/source-fusion';
import {transaction} from '../../../infrastructure/db';
import {AppError,conflict} from '../../../infrastructure/errors';
import {fingerprint} from '../../cases/domain';
import {lockSourceCaseDestinationTx} from '../../cases/source-case-lock';
import {associationDocumentInputTx} from './document-association-authority';
import {acceptedCityJSONTx} from './cityjson';
import {assembleSourceFusion} from './source-fusion';
import {fusionAuthorityBatch,fusionLive,readFusionResult,type FusionBudget,type FusionAuthority} from './source-fusion-authority';
import {registryIFCCitationSourceTx} from '../../registry/registry-ifc-citation-source';
import {verifyFusionIFCTools} from './source-fusion-ifc-authority';
import type {RegistryDXFCitation,RegistryKMLCitation} from '../../../../../contracts/src/registry-document-evidence';
import {registryDXFCitationSourceTx} from '../../registry/registry-dxf-citation-source';
import {verifyFusionDXFTools} from './source-fusion-dxf-authority';
import {registryKMLCitationSourceTx} from '../../registry/registry-kml-citation-source';
import {verifyFusionKMLTools} from './source-fusion-kml-authority';

export type FusionCitationDependencies={source:typeof associationDocumentInputTx;
  fusionResult?:typeof readFusionResult;cityjson?:typeof acceptedCityJSONTx;
  ifcSource?:typeof registryIFCCitationSourceTx;ifcTools?:typeof verifyFusionIFCTools;
  dxfSource?:typeof registryDXFCitationSourceTx;dxfTools?:typeof verifyFusionDXFTools;
  kmlSource?:typeof registryKMLCitationSourceTx;kmlTools?:typeof verifyFusionKMLTools};
export function citationReadBudget():FusionBudget{
  return {deadlineAt:Date.now()+SOURCE_FUSION_LIMITS.deadlineMs,signal:new AbortController().signal,reservedBytes:0};
}
/** Reuse the complete fusion authority on the caller's registry transaction.
 * Its complete case gate set must already be acquired before destination locks.
 * No independent transaction, write or trusted caller-supplied context exists. */
export async function resolveFusionCitationsTx(client:PoolClient,ctx:RequestContext,
  request:{contextSha256:string;selection:{sources:SourceFusionSelection[]}},dependencies:FusionCitationDependencies,siteId?:string){
  if(request.selection.sources.some(source=>source.kind==='kml')&&!siteId)
    throw new AppError(422,'SOURCE_FUSION_KML_CONTEXT_ONLY','KML citation selection requires its exact canonical building/floor target site.');
  if(request.selection.sources.some(source=>source.kind==='dxf')&&!siteId)
    throw new AppError(422,'SOURCE_FUSION_DXF_CONTEXT_ONLY','DXF citation selection requires its exact canonical building/floor target site.');
  if(request.selection.sources.some(source=>source.kind==='ifc')&&!siteId)
    throw new AppError(422,'SOURCE_FUSION_IFC_CONTEXT_ONLY','IFC citation selection requires its exact canonical target site.');
  const inTransaction:typeof transaction=async action=>action(client);
  const authorityDependencies={transaction:inTransaction,document:dependencies.source,
    cityjson:dependencies.cityjson??acceptedCityJSONTx,gate:lockSourceCaseDestinationTx,
    ifc:async(client:PoolClient,pin:SourceFusionPin,lock=false)=>
      (await (dependencies.ifcSource??registryIFCCitationSourceTx)(client,siteId!,pin,lock)).authority,
    ifcTools:dependencies.ifcTools??verifyFusionIFCTools,
    dxf:async(client:PoolClient,pin:SourceFusionPin,lock=false)=>
      (await (dependencies.dxfSource??registryDXFCitationSourceTx)(client,siteId!,pin,lock)).authority,
    dxfTools:dependencies.dxfTools??verifyFusionDXFTools,
    kml:async(client:PoolClient,pin:SourceFusionPin,lock=false)=>
      (await (dependencies.kmlSource??registryKMLCitationSourceTx)(client,siteId!,pin,lock)).authority,
    kmlTools:dependencies.kmlTools??verifyFusionKMLTools};
  const documents=new Map<string,{pin:SourceFusionPin;loaded:Extract<Awaited<ReturnType<typeof readFusionResult>>,{kind:'document'}>}>();
  const ifcs=new Map<string,{pin:SourceFusionPin;loaded:Extract<Awaited<ReturnType<typeof readFusionResult>>,{kind:'ifc'}>}>();
  const dxfs=new Map<string,{pin:SourceFusionPin;loaded:Extract<Awaited<ReturnType<typeof readFusionResult>>,{kind:'dxf'}>}>();
  const kmls=new Map<string,{pin:SourceFusionPin;loaded:Extract<Awaited<ReturnType<typeof readFusionResult>>,{kind:'kml'}>}>();
  let selected:SourceFusionSelection[]=[],captured:FusionAuthority[]=[],budget:FusionBudget|undefined;
  const context=await assembleSourceFusion(ctx,request.selection,{
    authority:async(ctx,selections,current,expected)=>{
      const authorities=await fusionAuthorityBatch(ctx,selections,current,expected,authorityDependencies);
      selected=selections;captured=authorities;budget=current;return authorities;
    },read:async(selection,authority,budget)=>{
      const loaded=await (dependencies.fusionResult??readFusionResult)(selection,authority,budget);
      if(loaded.kind==='document')documents.set(`${selection.pin.jobId}/${selection.pin.resultSha256}`,{pin:selection.pin,loaded});
      if(loaded.kind==='ifc')ifcs.set(`${selection.pin.jobId}/${selection.pin.resultSha256}`,{pin:selection.pin,loaded});
      if(loaded.kind==='dxf')dxfs.set(`${selection.pin.jobId}/${selection.pin.resultSha256}`,{pin:selection.pin,loaded});
      if(loaded.kind==='kml')kmls.set(`${selection.pin.jobId}/${selection.pin.resultSha256}`,{pin:selection.pin,loaded});
      return loaded;
    }});
  // All supported source variants stay in the exact context hash; no selected
  // fragment is silently dropped before the amendment is accepted.
  if(context.contextSha256!==request.contextSha256)conflict('The explicitly selected fusion context changed.');
  // assembleSourceFusion closes its own abort signal on completion. The final
  // write check shares its original deadline with a fresh unused read signal.
  const finalBudget={deadlineAt:budget!.deadlineAt,signal:new AbortController().signal,reservedBytes:budget!.reservedBytes};
  const inputs=new Map<string,DocumentInput>();
  const ifcInputs=new Map<string,IFCInput>();
  const dxfInputs=new Map<string,DXFInput>();
  const kmlInputs=new Map<string,KMLInput>();
  for(const [index,selection] of selected.entries()){
    const authority=captured[index];if(authority.kind==='document')inputs.set(selection.pin.sourceId,authority.input);
    if(authority.kind==='ifc')ifcInputs.set(selection.pin.sourceId,authority.input);
    if(authority.kind==='dxf')dxfInputs.set(selection.pin.sourceId,authority.input);
    if(authority.kind==='kml')kmlInputs.set(selection.pin.sourceId,authority.input);
  }
  return {context,inputs,ifcInputs,dxfInputs,kmlInputs,documents,ifcs,dxfs,kmls,revalidate:async()=>{
    fusionLive(finalBudget);await fusionAuthorityBatch(ctx,selected,finalBudget,captured,authorityDependencies);
  }};
}

export function kmlCitationFusionSelection(pin:RegistryKMLCitation):Extract<SourceFusionSelection,{kind:'kml'}>{
  return {kind:'kml',pin:{...pin.document,inputSha256:pin.inputSha256,readerSha256:pin.readerSha256,
    acceptedFence:pin.acceptedFence,resultBytes:pin.resultBytes},featureOrdinals:[pin.kml.featureOrdinal]};
}
/** Pin exactly one feature, independently of other selected citations. Original,
 * selected member/XML and literal native source IDs remain distinct. */
export function fusionKMLCitationFields(source:Extract<SourceFusionContext['sources'][number],{kind:'kml'}>,ordinal:number){
  const entry=source.features.find(entry=>entry.ordinal===ordinal);
  if(!entry)conflict('The exact selected KML feature is unavailable.');
  const {summary}=source;
  return {document:fusionCitationDocumentPin(source.pin),inputSha256:source.pin.inputSha256,readerSha256:source.pin.readerSha256,
    acceptedFence:source.pin.acceptedFence,resultBytes:source.pin.resultBytes,
    kml:{artifactSha256:source.artifactSha256,artifactBytes:source.artifactBytes,profile:'kml-native-inspection/1' as const,
      container:summary.container,member:summary.member,xmlSha256:summary.xmlSha256,inspectionStatus:summary.status,
      documentProfile:summary.documentProfile,horizontalReference:summary.horizontalReference,
      selectionSha256:fingerprint({version:'source-fusion-kml-selection/1',sourceSha256:source.pin.sourceSha256,
        member:summary.member,xmlSha256:summary.xmlSha256,artifact:{sha256:source.artifactSha256,bytes:source.artifactBytes},featureOrdinals:[ordinal]}),
      featureOrdinal:ordinal,featureType:entry.record.type,sourceId:SourceFusionLiteralObjectSchema.parse(entry.record.sourceId),
      recordPointer:entry.pointer,recordSha256:entry.recordSha256,locator:SourceFusionLiteralObjectSchema.parse(entry.record.locator),
      identifierScope:source.nativeIdentifierScope}};
}

export function dxfCitationFusionSelection(pin:RegistryDXFCitation):Extract<SourceFusionSelection,{kind:'dxf'}>{
  return {kind:'dxf',pin:{...pin.document,inputSha256:pin.inputSha256,readerSha256:pin.readerSha256,
    acceptedFence:pin.acceptedFence,resultBytes:pin.resultBytes},entityOrdinals:[pin.dxf.entityOrdinal]};
}
/** Pin a singleton entity selection so later removal of a different citation
 * does not change this immutable selection hash. Native handle states/tags and
 * locators are preserved literally, with no canonical identity assertion. */
export function fusionDXFCitationFields(source:Extract<SourceFusionContext['sources'][number],{kind:'dxf'}>,ordinal:number){
  const entry=source.entities.find(entry=>entry.ordinal===ordinal);
  if(!entry)conflict('The exact selected DXF entity is unavailable.');
  const fields=SourceFusionLiteralObjectSchema.parse(entry.record.fields);
  return {document:fusionCitationDocumentPin(source.pin),inputSha256:source.pin.inputSha256,readerSha256:source.pin.readerSha256,
    acceptedFence:source.pin.acceptedFence,resultBytes:source.pin.resultBytes,
    dxf:{artifactSha256:source.artifactSha256,artifactBytes:source.artifactBytes,profile:'dxf-native-inspection/1' as const,
      selectionSha256:fingerprint({version:'source-fusion-dxf-selection/1',sourceSha256:source.pin.sourceSha256,
        artifact:{sha256:source.artifactSha256,bytes:source.artifactBytes},entityOrdinals:[ordinal]}),
      entityOrdinal:ordinal,entityType:entry.record.type,handle:SourceFusionLiteralObjectSchema.parse(fields.handle),
      recordPointer:entry.pointer,recordSha256:entry.recordSha256,locator:SourceFusionLiteralObjectSchema.parse(entry.record.locator),
      identifierScope:source.nativeIdentifierScope}};
}

export function ifcCitationFusionSelection(pin:RegistryIFCCitation):Extract<SourceFusionSelection,{kind:'ifc'}>{
  return {kind:'ifc',pin:{...pin.document,inputSha256:pin.inputSha256,readerSha256:pin.readerSha256,
    acceptedFence:pin.acceptedFence,resultBytes:pin.resultBytes},stepIds:[pin.ifc.stepId]};
}
/** Store provenance and locators; literal native metadata stays in the original
 * accepted artifact and is exposed only through the exact authorized read. */
export function fusionIFCCitationFields(source:Extract<SourceFusionContext['sources'][number],{kind:'ifc'}>,stepId:number){
  const entry=source.entities.find(entry=>entry.record.stepId===stepId);
  if(!entry)conflict('The exact selected IFC record is unavailable.');
  const attributeLocators=Object.fromEntries(Object.entries(entry.record.attributes).map(([name,attribute])=>{
    if(!attribute||typeof attribute!=='object'||Array.isArray(attribute)||!Object.hasOwn(attribute,'locator'))
      conflict('The selected IFC attribute locator is unavailable.');
    return [name,attribute.locator];
  }));
  return {document:fusionCitationDocumentPin(source.pin),inputSha256:source.pin.inputSha256,readerSha256:source.pin.readerSha256,
    acceptedFence:source.pin.acceptedFence,resultBytes:source.pin.resultBytes,
    ifc:{artifactSha256:source.artifactSha256,artifactBytes:source.artifactBytes,profile:'ulpin-native-ifc/1' as const,
      stepId:entry.record.stepId,entityType:entry.record.entityType,recordPointer:entry.pointer,recordSha256:fingerprint(entry.record),
      locator:entry.record.locator,attributeLocators,identifierScope:source.nativeIdentifierScope}};
}

export function ocrCitationFusionSelection(pin:RegistryOcrDocumentCitation):Extract<SourceFusionSelection,{kind:'document_ocr'}>{
  return {kind:'document_ocr',pin:{...pin.document,inputSha256:pin.inputSha256,readerSha256:pin.readerSha256,
    acceptedFence:pin.acceptedFence,resultBytes:pin.resultBytes},itemOrdinals:[pin.itemOrdinal]};
}
export function fusionCitationDocumentPin(pin:SourceFusionPin){
  const {readerSha256:_,inputSha256:__,acceptedFence:___,resultBytes:____,...document}=pin;
  return DocumentAssociationSourceSchema.parse(document);
}
/** Literal source-bound fields only. Target and operator attribution are derived
 * by the registry amendment; text remains privately resolved from the result. */
export function fusionOcrCitationFields(source:Extract<SourceFusionContext['sources'][number],{kind:'document_ocr'}>,ordinal:number){
  const observation=source.observations.find(item=>item.ordinal===ordinal);
  if(!observation||!source.ocr||!source.ocrInput.selection||!source.ocrInput.configSha256)
    conflict('The explicitly selected accepted OCR observation is unavailable.');
  const {text:_,...itemLocator}=observation.item;
  return {document:fusionCitationDocumentPin(source.pin),inputSha256:source.pin.inputSha256,
    readerSha256:source.pin.readerSha256,acceptedFence:source.pin.acceptedFence,resultBytes:source.pin.resultBytes,
    ocrSelection:source.ocrInput.selection,ocrConfigSha256:source.ocrInput.configSha256,
    itemOrdinal:ordinal,itemSha256:observation.itemSha256,itemLocator,ocr:source.ocr};
}
