import type {PoolClient} from 'pg';
import type {DocumentInput,RequestContext} from '@ulpin/contracts/usp';
import {DocumentAssociationSourceSchema,type RegistryOcrDocumentCitation} from '@ulpin/contracts';
import {SOURCE_FUSION_LIMITS,type SourceFusionContext,type SourceFusionSelection,type SourceFusionPin} from '../../../../../contracts/src/source-fusion';
import {transaction} from '../../../infrastructure/db';
import {AppError,conflict} from '../../../infrastructure/errors';
import {fingerprint} from '../../cases/domain';
import {lockSourceCaseDestinationTx} from '../../cases/source-case-lock';
import {associationDocumentInputTx} from './document-association-authority';
import {acceptedCityJSONTx} from './cityjson';
import {assembleSourceFusion} from './source-fusion';
import {fusionAuthorityBatch,fusionLive,readFusionResult,type FusionBudget,type FusionAuthority} from './source-fusion-authority';

export type FusionCitationDependencies={source:typeof associationDocumentInputTx;
  fusionResult?:typeof readFusionResult;cityjson?:typeof acceptedCityJSONTx};
export function citationReadBudget():FusionBudget{
  return {deadlineAt:Date.now()+SOURCE_FUSION_LIMITS.deadlineMs,signal:new AbortController().signal,reservedBytes:0};
}
/** Reuse the complete fusion authority on the caller's registry transaction.
 * Its complete case gate set must already be acquired before destination locks.
 * No independent transaction, write or trusted caller-supplied context exists. */
export async function resolveFusionCitationsTx(client:PoolClient,ctx:RequestContext,
  request:{contextSha256:string;selection:{sources:SourceFusionSelection[]}},dependencies:FusionCitationDependencies){
  if(request.selection.sources.some(source=>source.kind==='ifc'))
    throw new AppError(422,'SOURCE_FUSION_IFC_CONTEXT_ONLY','IFC context is not supported by the reviewed document citation profile.');
  const inTransaction:typeof transaction=async action=>action(client);
  const authorityDependencies={transaction:inTransaction,document:dependencies.source,
    cityjson:dependencies.cityjson??acceptedCityJSONTx,gate:lockSourceCaseDestinationTx};
  const documents=new Map<string,{pin:SourceFusionPin;loaded:Extract<Awaited<ReturnType<typeof readFusionResult>>,{kind:'document'}>}>();
  let selected:SourceFusionSelection[]=[],captured:FusionAuthority[]=[],budget:FusionBudget|undefined;
  const context=await assembleSourceFusion(ctx,request.selection,{
    authority:async(ctx,selections,current,expected)=>{
      const authorities=await fusionAuthorityBatch(ctx,selections,current,expected,authorityDependencies);
      selected=selections;captured=authorities;budget=current;return authorities;
    },read:async(selection,authority,budget)=>{
      const loaded=await (dependencies.fusionResult??readFusionResult)(selection,authority,budget);
      if(loaded.kind==='document')documents.set(`${selection.pin.jobId}/${selection.pin.resultSha256}`,{pin:selection.pin,loaded});
      return loaded;
    }});
  if(context.contextSha256!==request.contextSha256)conflict('The explicitly selected fusion context changed.');
  // Keep the existing registry consumer's union restricted to supported
  // document/OCR/CityJSON context without changing its write/access authority.
  const citationContext={...context,sources:context.sources.map(source=>{
    if(source.kind==='ifc')throw new AppError(422,'SOURCE_FUSION_IFC_CONTEXT_ONLY','IFC context is not supported by the reviewed document citation profile.');
    return source;
  })};
  // assembleSourceFusion closes its own abort signal on completion. The final
  // write check shares its original deadline with a fresh unused read signal.
  const finalBudget={deadlineAt:budget!.deadlineAt,signal:new AbortController().signal,reservedBytes:budget!.reservedBytes};
  const inputs=new Map<string,DocumentInput>();
  for(const [index,selection] of selected.entries()){
    const authority=captured[index];if(authority.kind==='document')inputs.set(selection.pin.sourceId,authority.input);
  }
  return {context:citationContext,inputs,documents,revalidate:async()=>{
    fusionLive(finalBudget);await fusionAuthorityBatch(ctx,selected,finalBudget,captured,authorityDependencies);
  }};
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
