import type {DocumentAssociationTarget} from '@ulpin/contracts';
import {FUSION_ASSOCIATION_LIMITS,FUSION_IFC_IDENTIFIER_SCHEME,FusionAssociationModelOutputSchema,
  type FusionAssociationRequest,type FusionAssociationResponse,type FusionAssociationCitation,type FusionAssociationAbstention}
  from '../../../../../contracts/src/source-fusion-associations';
import type {SourceFusionContext,SourceFusionSelection} from '../../../../../contracts/src/source-fusion';
import {fingerprint} from '../../cases/domain';
import {AppError} from '../../../infrastructure/errors';
import {validateExtraction,type AiPart} from '../../ai/officer-ai-validation';
import {minimizeStructuredText} from '../../model-gateway/redaction';
import {documentPartEligibleForProposal} from './document-model';
import {fusionContextProjection} from './source-fusion';

type WithoutQuote<T>=T extends unknown?Omit<T,'quote'>:never;
export type AssociationLiteral={citation:WithoutQuote<FusionAssociationCitation>;text:string;identifierText:string;eligible:boolean;
  textCompleteness:'native_derivative'|'unverified'|'native_ifc_attribute';reason:string|null};
export type AssociationIFCProjection=(selection:Extract<SourceFusionSelection,{kind:'ifc'}>)=>
  Extract<SourceFusionContext['sources'][number],{kind:'ifc'}>;
const ifcKey=(source:Extract<SourceFusionContext['sources'][number],{kind:'ifc'}>,stepId:number)=>
  `${source.namespace}/ifc/${stepId}/attribute/GlobalId`;
/** Exact comparison only; no case folding, fuzzy names, filenames or floor expansion. */
export function exactIdentifier(text:string,value:string){
  if(!value.trim()||value.trim()!==value||/\[redacted/i.test(value))return false;
  for(let start=text.indexOf(value);start>=0;start=text.indexOf(value,start+1)){
    const before=text[start-1],after=text[start+value.length];
    if((!before||!/[\p{L}\p{N}_./:-]/u.test(before))&&(!after||!/[\p{L}\p{N}_./:-]/u.test(after)))return true;
  }
  return false;
}
export function associationLiterals(context:SourceFusionContext,unsupportedSources:readonly string[]=[]):AssociationLiteral[]{
  const literals:AssociationLiteral[]=[];
  for(const source of context.sources){
    if(source.kind==='point')throw new AppError(422,'SOURCE_FUSION_POINT_CONTEXT_ONLY','Point metadata does not support association proposals.');
    if(source.kind==='raster')throw new AppError(422,'SOURCE_FUSION_RASTER_CONTEXT_ONLY','Raster metadata does not support association proposals.');
    if(source.kind==='geoparquet')throw new AppError(422,'SOURCE_FUSION_GEOPARQUET_CONTEXT_ONLY',
      'GeoParquet rows support source context only; property associations are unsupported.');
    if(source.kind==='citygml')throw new AppError(422,'SOURCE_FUSION_CITYGML_CONTEXT_ONLY',
      'CityGML fragments support source context only; property associations are unsupported.');
    if(source.kind==='kml')throw new AppError(422,'SOURCE_FUSION_KML_CONTEXT_ONLY',
      'KML fragments support source context only; property association proposals are unsupported.');
    if(source.kind==='dxf')throw new AppError(422,'SOURCE_FUSION_DXF_CONTEXT_ONLY',
      'DXF fragments support source context only; property association proposals are unsupported.');
    if(source.kind==='ifc'){
      // Only the schema-defined source identifier is eligible. Names, elevations,
      // STEP numbers and hierarchy remain context, even if they resemble an ID.
      for(const entry of source.entities){
        const raw=entry.record.attributes.GlobalId,attribute=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:undefined;
        const value=attribute?.value;
        let text='';try{if(typeof value==='string')text=minimizeStructuredText(value);}catch{}
        const eligible=attribute?.state==='supplied'&&typeof value==='string'&&/^[0-3][0-9A-Za-z_$]{21}$/.test(value)&&
          attribute.rawLiteral===`'${value}'`&&text===value&&!unsupportedSources.includes(source.pin.sourceId);
        const locator=attribute?.locator;
        const citation:Extract<AssociationLiteral['citation'],{kind:'ifc'}>={kind:'ifc',key:ifcKey(source,entry.record.stepId),pin:source.pin,
          artifactSha256:source.artifactSha256,artifactBytes:source.artifactBytes,profile:'ulpin-native-ifc/1',stepId:entry.record.stepId,
          entityType:entry.record.entityType as 'IfcBuilding'|'IfcBuildingStorey'|'IfcSpace',recordPointer:entry.pointer,
          recordSha256:fingerprint(entry.record),attribute:'GlobalId',attributePointer:entry.pointer+'/attributes/GlobalId',
          attributeSha256:fingerprint(raw??null),locator:entry.record.locator,
          attributeLocator:locator&&typeof locator==='object'&&!Array.isArray(locator)?locator:{},
          identifierScheme:FUSION_IFC_IDENTIFIER_SCHEME,identifierNamespace:source.namespace,
          quoteBasis:'native_attribute_decoded_value',identifierScope:source.nativeIdentifierScope};
        literals.push({citation,text,identifierText:text,eligible,textCompleteness:'native_ifc_attribute',
          reason:eligible?null:'ifc_identifier_nonliteral_or_missing'});
      }
      continue;
    }
    if(source.kind==='cityjson')continue;
    const add=(citation:AssociationLiteral['citation'],text:string,supported:boolean,textCompleteness:AssociationLiteral['textCompleteness'])=>{
      let minimized='';try{minimized=minimizeStructuredText(text);}catch{/* retain local evidence; no unsafe prompt fallback */}
      const eligible=supported&&!unsupportedSources.includes(source.pin.sourceId)&&!!minimized.trim()&&
        !/\[redacted/i.test(text)&&!/\[redacted/i.test(minimized);
      literals.push({citation,text:minimized.slice(0,FUSION_ASSOCIATION_LIMITS.excerptCharacters),identifierText:minimized,eligible,textCompleteness,
        reason:eligible?null:'nonliteral_redacted_or_unsupported_citation'});
    };
    if(source.kind==='document')for(const entry of source.parts)add({kind:'document',key:entry.key,pin:source.pin,
      partId:entry.part.id,partSha256:entry.part.sha256},entry.part.text,
      source.nativeStatus==='extracted'&&documentPartEligibleForProposal(entry.part),'native_derivative');
    else for(const entry of source.observations)add({kind:'document_ocr',key:entry.key,pin:source.pin,
      itemOrdinal:entry.ordinal,itemSha256:entry.itemSha256},entry.item.text,source.gap==='none','unverified');
  }
  return literals;
}
const active=(target:DocumentAssociationTarget)=>target.recordState==='recorded'&&target.sourceEvidence==='available';
const identifiers=(target:DocumentAssociationTarget)=>target.identifiers.filter(id=>
  ['supplied','reviewed'].includes(id.state)&&id.value.length<=512&&id.scheme.length<=256);
function literalIdentifiers(literal:AssociationLiteral,target:DocumentAssociationTarget){
  const cite=literal.citation;
  return identifiers(target).filter(id=>cite.kind!=='ifc'||id.scheme===FUSION_IFC_IDENTIFIER_SCHEME&&
    /^[0-3][0-9A-Za-z_$]{21}$/.test(id.value)&&
    id.source?.ref.namespace==='source_revision'&&id.source.ref.id===cite.pin.sourceId&&id.source.revision===cite.pin.sourceRevision);
}
export function literalTargets(literal:AssociationLiteral,targets:readonly DocumentAssociationTarget[]){
  return targets.filter(target=>active(target)&&literalIdentifiers(literal,target).some(id=>exactIdentifier(literal.identifierText,id.value)));
}
export function associationPreflight(literals:readonly AssociationLiteral[],targets:readonly DocumentAssociationTarget[]){
  const abstentions:FusionAssociationAbstention[]=[],eligible=literals.filter(literal=>literal.eligible);
  if(!targets.length)abstentions.push({reasonCode:'target_selection_unavailable',target:null,citationKeys:[]});
  if(!eligible.length)abstentions.push({reasonCode:'eligible_literal_selection_unavailable',target:null,citationKeys:[]});
  for(const literal of literals){
    if(!literal.eligible)abstentions.push({reasonCode:literal.reason!,target:null,citationKeys:[literal.citation.key]});
    else if(literalTargets(literal,targets).length>1)
      abstentions.push({reasonCode:'ambiguous_exact_identifiers',target:null,citationKeys:[literal.citation.key]});
    else if(literal.citation.kind==='ifc'&&!literalTargets(literal,targets).length)
      abstentions.push({reasonCode:'ifc_identifier_namespace_or_crosswalk_missing',target:null,citationKeys:[literal.citation.key]});
  }
  for(const target of targets){
    const grounded=eligible.filter(literal=>literalTargets(literal,targets).some(t=>t.pin.ref.id===target.pin.ref.id));
    if(!active(target)||!grounded.length)abstentions.push({reasonCode:!active(target)?'target_source_evidence_unavailable':
      'target_identifier_not_in_selected_literal',target:target.pin,citationKeys:[]});
    else if(!grounded.some(literal=>literalIdentifiers(literal,target).some(id=>exactIdentifier(literal.text,id.value))))
      abstentions.push({reasonCode:'target_identifier_outside_model_excerpt',target:target.pin,citationKeys:[]});
  }
  return {abstentions,canPropose:eligible.some(literal=>{
    const candidates=literalTargets(literal,targets);
    return candidates.length===1&&literalIdentifiers(literal,candidates[0]).some(id=>exactIdentifier(literal.text,id.value));
  })};
}
/** Legacy native/OCR contexts keep their source pins. IFC contexts keep cited
 * records plus the minimum nonattaching context for fusion's two-source bound. */
export function associationManualSelection(request:FusionAssociationRequest,context:SourceFusionContext,keys:readonly string[],
  ifcProjection?:AssociationIFCProjection){
  const selected=new Set(keys);
  const candidates=context.sources.flatMap<SourceFusionContext['sources'][number]>(source=>{
    if(source.kind==='point')throw new AppError(422,'SOURCE_FUSION_POINT_CONTEXT_ONLY','Point metadata does not support association proposals.');
    if(source.kind==='raster')throw new AppError(422,'SOURCE_FUSION_RASTER_CONTEXT_ONLY','Raster metadata does not support association proposals.');
    if(source.kind==='geoparquet')throw new AppError(422,'SOURCE_FUSION_GEOPARQUET_CONTEXT_ONLY',
      'GeoParquet rows support source context only; property associations are unsupported.');
    if(source.kind==='citygml')throw new AppError(422,'SOURCE_FUSION_CITYGML_CONTEXT_ONLY',
      'CityGML fragments support source context only; reviewed citation attachment is unsupported.');
    if(source.kind==='kml')throw new AppError(422,'SOURCE_FUSION_KML_CONTEXT_ONLY',
      'KML fragments support source context only; reviewed citation attachment is unsupported.');
    if(source.kind==='dxf')throw new AppError(422,'SOURCE_FUSION_DXF_CONTEXT_ONLY',
      'DXF fragments support source context only; reviewed citation attachment is unsupported.');
    if(source.kind==='ifc'){
      const stepIds=source.entities.filter(entry=>selected.has(ifcKey(source,entry.record.stepId))).map(entry=>entry.record.stepId);
      if(!stepIds.length)return [];
      // Reproject from the already verified full native artifact. Trimming the
      // entity list alone would retain extra relations/placements and a false hash.
      if(!ifcProjection)throw new AppError(422,'FUSION_ASSOCIATION_IFC_REASSEMBLY_REQUIRED','Exact native IFC reassembly is unavailable.');
      return [ifcProjection({kind:'ifc',pin:source.pin,stepIds})];
    }
    if(source.kind==='cityjson')return [source];
    if(source.kind==='document'){
      const parts=source.parts.filter(entry=>selected.has(entry.key));
      return [{...source,parts,coverage:{...source.coverage,selectedParts:parts.length},
        capability:source.nativeStatus!=='extracted'?'native_incomplete' as const:
          parts.length?'selected_native_text' as const:'selection_required' as const}];
    }
    const observations=source.observations.filter(entry=>selected.has(entry.key));
    const gap=source.gap==='none'&&!observations.length?'selection_required' as const:source.gap;
    return [{...source,observations,gap,coverage:{...source.coverage,selectedItems:observations.length},
      capability:observations.length?'selected_ocr_observations' as const:
        gap==='selection_required'?'selection_required' as const:'ocr_unavailable' as const}];
  });
  const hasCitation=(source:SourceFusionContext['sources'][number])=>source.kind==='ifc'||
    source.kind==='document'&&!!source.parts.length||source.kind==='document_ocr'&&!!source.observations.length;
  const cited=candidates.filter(hasCitation),order=new Map(context.sources.map((source,index)=>[source.pin.sourceId,index]));
  const sources=context.sources.some(source=>source.kind==='ifc')?
    [...cited,...candidates.filter(source=>!hasCitation(source)).slice(0,Math.max(0,2-cited.length))]
      .sort((a,b)=>order.get(a.pin.sourceId)!-order.get(b.pin.sourceId)!):candidates;
  if(sources.length<2)throw new AppError(422,'FUSION_ASSOCIATION_MANUAL_CONTEXT','The exact citations need a second contextual source without unrelated IFC attachments.');
  const reduced=fusionContextProjection(sources);
  const selection={sources:request.context.selection.sources.filter(selection=>sources.some(source=>source.pin.sourceId===selection.pin.sourceId)).map(selection=>{
    const source=sources.find(source=>source.pin.sourceId===selection.pin.sourceId)!;
    if(selection.kind==='document'&&source.kind==='document')return {...selection,partIds:source.parts.map(entry=>entry.part.id)};
    if(selection.kind==='document_ocr'&&source.kind==='document_ocr')return {...selection,itemOrdinals:source.observations.map(entry=>entry.ordinal)};
    if(selection.kind==='ifc'&&source.kind==='ifc')return {...selection,stepIds:source.entities.map(entry=>entry.record.stepId)};
    return selection;
  })};
  return {contextSha256:reduced.contextSha256,selection};
}
/** Model text has no authority. Adapt Officer AI quotation/identifier validation,
 * then enforce unique exact identifiers across the full selected excerpt. */
export function validateFusionAssociations(raw:unknown,request:FusionAssociationRequest,context:SourceFusionContext,
  targets:DocumentAssociationTarget[],literals:AssociationLiteral[],ifcProjection?:AssociationIFCProjection){
  const proposals:FusionAssociationResponse['proposals']=[],abstentions:FusionAssociationAbstention[]=[];
  const parsed=FusionAssociationModelOutputSchema.safeParse(raw);
  if(!parsed.success)return {proposals,abstentions:[{reasonCode:'model_output_schema_invalid',target:null,citationKeys:[]}]};
  const byKey=new Map(literals.map(literal=>[literal.citation.key,literal]));
  const citations=(supplied:{key:string;quote:string}[])=>supplied.map(cite=>{
    const literal=byKey.get(cite.key);
    return literal?.eligible&&cite.quote.trim()&&literal.text.includes(cite.quote)&&!/\[redacted/i.test(cite.quote)&&
      (literal.citation.kind!=='ifc'||cite.quote===literal.text)?literal:undefined;
  });
  for(const suggestion of parsed.data.suggestions){
    const target=targets.find(target=>target.pin.ref.id===suggestion.targetId),cited=citations(suggestion.citations);
    let reason:string|undefined;
    if(!target||!active(target))reason='model_target_unavailable';
    else if(cited.some(literal=>!literal))reason='model_citation_invalid';
    else if(!identifiers(target).some(id=>id.scheme===suggestion.scheme&&id.value===suggestion.matchedIdentifier)||
      suggestion.citations.some(cite=>!exactIdentifier(cite.quote,suggestion.matchedIdentifier)))reason='model_identifier_not_grounded';
    else if(cited.some(literal=>!literalIdentifiers(literal!,target).some(id=>
      id.scheme===suggestion.scheme&&id.value===suggestion.matchedIdentifier)))reason='model_identifier_namespace_unqualified';
    else if(cited.some(literal=>literalTargets(literal!,targets).length!==1))reason='ambiguous_exact_identifiers';
    else{
      const parts:AiPart[]=cited.map(literal=>({id:literal!.citation.key,sourceRevisionId:literal!.citation.pin.sourceId,
        locator:'selected literal',text:literal!.text,entityIds:[target.pin.ref.id]}));
      // The reused association branch does not read worldStatus; no property
      // world classification or fact candidate is supplied by this adapter.
      const checked=validateExtraction({candidates:[],questions:[],suggestions:suggestion.citations.map(cite=>({
        kind:'entity_association',partId:cite.key,entityId:target.pin.ref.id,matchedIdentifier:suggestion.matchedIdentifier,
        quote:cite.quote,rationale:suggestion.rationale}))},parts,[{id:target.pin.ref.id,
        identifiers:identifiers(target).map(id=>id.value)}] as Parameters<typeof validateExtraction>[2],[]);
      if(checked.errors.length)reason='model_citation_invalid';
    }
    if(reason){abstentions.push({reasonCode:reason,target:target?.pin??null,citationKeys:[]});continue;}
    const exactCitations=suggestion.citations.map((cite,index)=>({...cited[index]!.citation,quote:cite.quote}));
    const identifier={scheme:suggestion.scheme,value:suggestion.matchedIdentifier};
    const id=fingerprint({context:context.contextSha256,target:target!.pin,identifier,citations:exactCitations});
    if(proposals.some(proposal=>proposal.id===id))continue;
    let rationale='';try{rationale=minimizeStructuredText(suggestion.rationale);}catch{rationale='Inspect the exact selected identifier and citation.';}
    let manualSelection;
    try{manualSelection=associationManualSelection(request,context,exactCitations.map(cite=>cite.key),ifcProjection);}
    catch(error){
      if(!(error instanceof AppError)||!['FUSION_ASSOCIATION_MANUAL_CONTEXT','FUSION_ASSOCIATION_IFC_REASSEMBLY_REQUIRED'].includes(error.code))throw error;
      abstentions.push({reasonCode:'manual_context_sources_unavailable',target:target!.pin,citationKeys:exactCitations.map(cite=>cite.key)});continue;
    }
    proposals.push({id,state:'proposed',target:target!,identifier,citations:exactCitations,rationale,
      method:'ai_exact_identifier_association',qualification:'not_assessed',
      manualSelection});
  }
  const modelHeldKeys=new Set<string>();
  for(const abstention of parsed.data.abstentions){
    if(citations(abstention.citations).some(literal=>!literal)){
      abstentions.push({reasonCode:'model_citation_invalid',target:null,citationKeys:[]});continue;
    }
    for(const cite of abstention.citations)modelHeldKeys.add(cite.key);
    abstentions.push({reasonCode:`model_${abstention.reason}`,target:null,citationKeys:abstention.citations.map(cite=>cite.key)});
  }
  // Contradictory uses of one fragment must never force a winner.
  const conflicting=new Set(proposals.filter(proposal=>proposal.citations.some(cite=>modelHeldKeys.has(cite.key))||
    proposals.some(other=>other.target.pin.ref.id!==proposal.target.pin.ref.id&&
      other.citations.some(cite=>proposal.citations.some(own=>own.key===cite.key)))).map(proposal=>proposal.id));
  for(const proposal of proposals.filter(proposal=>conflicting.has(proposal.id)))
    abstentions.push({reasonCode:'conflicting_target_proposals',target:proposal.target.pin,citationKeys:proposal.citations.map(cite=>cite.key)});
  return {proposals:proposals.filter(proposal=>!conflicting.has(proposal.id)),abstentions};
}
