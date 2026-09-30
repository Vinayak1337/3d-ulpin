import {DocumentAssociationPreviewRequestSchema,DocumentAssociationPreviewSchema,DOCUMENT_ASSOCIATION_VERSION,
  type DocumentAssociationPreviewRequest,type DocumentAssociationPreview,type DocumentAssociationTarget} from '@ulpin/contracts';
import {DOCUMENT_LIMITS,type RequestContext,type DocumentResult} from '@ulpin/contracts/usp';
import {AppError,conflict} from '../../../infrastructure/errors';
import {canonical,fingerprint} from '../../cases/domain';
import {assertLocalUsp} from '../snapshots';
import {readDocumentResult} from './documents';
import {documentPartEligibleForProposal} from './document-model';
import {associationDocumentInput} from './document-association-authority';
import {associationTargets} from './document-association-targets';

type Dependencies={source:typeof associationDocumentInput;targets:typeof associationTargets;result:typeof readDocumentResult};
const defaults:Dependencies={source:associationDocumentInput,targets:associationTargets,result:readDocumentResult};

export function associationPreviewProjection(request:DocumentAssociationPreviewRequest,result:DocumentResult,
  targets:DocumentAssociationTarget[]):DocumentAssociationPreview{
  const byId=new Map(result.native.parts.map(part=>[part.id,part]));
  const citations=request.partIds.map(id=>{
    const part=byId.get(id);
    if(!part)throw new AppError(422,'DOCUMENT_ASSOCIATION_PART_SELECTION','Choose exact native part IDs from this accepted result.');
    const eligible=documentPartEligibleForProposal(part) && Boolean(part.text.trim()) && !/\[redacted/i.test(part.text);
    return {part,identifierEligibility:{state:eligible?'available' as const:'not_assessed' as const,
      reasonCode:eligible?null:'nonliteral_or_incomplete_native_text'}};
  });
  const nativeSupported=result.native.status==='extracted' && !result.input.archiveSelection;
  const floors=targets.filter(target=>target.kind==='floor');
  const identifiers=new Map<string,DocumentAssociationPreview['ambiguities']['duplicateIdentifiers'][number]>();
  for(const target of targets)for(const identifier of target.identifiers){
    const key=JSON.stringify([identifier.scheme,identifier.value]),prior=identifiers.get(key);
    const occurrence={target:target.pin,identifier};
    if(prior)prior.occurrences.push(occurrence);else identifiers.set(key,{scheme:identifier.scheme,value:identifier.value,occurrences:[occurrence]});
  }
  const duplicateIdentifiers=[...identifiers.values()].filter(group=>new Set(group.occurrences.map(row=>canonical(row.target))).size>1);
  const reasonCodes=[...(!nativeSupported?['native_parts_unsupported_for_preview']:[]),
    ...(!citations.length && nativeSupported?['source_part_selection_required']:[]),...(!targets.length?['target_selection_unavailable']:[]),
    ...(targets.some(target=>target.sourceEvidence==='unavailable')?['target_source_evidence_unavailable']:[])];
  return DocumentAssociationPreviewSchema.parse({version:DOCUMENT_ASSOCIATION_VERSION,
    state:!nativeSupported?'not_assessed':!citations.length||!targets.length?'needs_input':'available',
    document:request.document,scope:request.scope,reasonCodes,
    source:{format:result.native.format,nativeStatus:result.native.status,readerSha256:result.native.readerSha256,
      code:result.native.code,warnings:result.native.warnings},citations,targets,
    association:{state:'not_assessed',reasonCode:'source_target_linkage_unqualified',population:'explicit_selection_only',
      identifierOverlap:{state:'not_assessed',reasonCode:'source_key_namespace_unqualified'}},
    ambiguities:{multipleFloors:floors.length>1?floors.map(floor=>floor.pin):[],
      floorsWithoutSelectedParent:floors.filter(floor=>!floor.relationsWithinSelection.some(relation=>
        ['within','floor'].includes(relation.kind) && targets.some(target=>target.kind==='building' && canonical(target.pin)===canonical(relation.target))))
        .map(floor=>floor.pin),duplicateIdentifiers}});
}

export async function previewDocumentAssociation(ctx:RequestContext,raw:unknown,dependencies:Dependencies=defaults){
  const request=DocumentAssociationPreviewRequestSchema.parse(raw);assertLocalUsp(ctx);
  const input=await dependencies.source(ctx,request.document);
  const targets=await dependencies.targets(ctx,request.scope,request.targets);
  const result=await dependencies.result(input,request.document.resultSha256);
  if(fingerprint(result.input)!==fingerprint(input))conflict('The accepted source/job input changed.');
  const preview=associationPreviewProjection(request,result,targets);
  // Leave room for the bounded USP metadata envelope added by the controller.
  if(Buffer.byteLength(JSON.stringify(preview))>DOCUMENT_LIMITS.resultBytes-4096)
    throw new AppError(413,'DOCUMENT_ASSOCIATION_RESULT_LIMIT','Select fewer citations or targets.');
  // Recheck both canonical authorities after object I/O; never rescope a response.
  await dependencies.source(ctx,request.document,input);
  const currentTargets=await dependencies.targets(ctx,request.scope,request.targets);
  if(fingerprint(currentTargets)!==fingerprint(targets))conflict('The selected target evidence context changed.');
  assertLocalUsp(ctx);return preview;
}
export class DocumentAssociationService{
  preview(ctx:RequestContext,input:unknown){return previewDocumentAssociation(ctx,input);}
}
