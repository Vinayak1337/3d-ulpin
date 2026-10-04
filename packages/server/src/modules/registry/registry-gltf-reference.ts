import type {RegistryGltfCitation} from '../../../../contracts/src/registry-document-evidence';
import {RegistryGltfFragmentSchema} from '../../../../contracts/src/registry-gltf-reference';
import type {SourceFusionContext,SourceFusionSelection} from '../../../../contracts/src/source-fusion';
import {fingerprint} from '../cases/domain';
import {conflict} from '../../infrastructure/errors';
import {fusionCitationDocumentPin} from '../usp/ingestion/source-fusion-citations';
import {fusionSourceProjection} from '../usp/ingestion/source-fusion';
import type {readFusionResult} from '../usp/ingestion/source-fusion-authority';

type Source=Extract<SourceFusionContext['sources'][number],{kind:'gltf'}>;
type Loaded=Extract<Awaited<ReturnType<typeof readFusionResult>>,{kind:'gltf'}>;
export function gltfCitationFusionSelection(pin:RegistryGltfCitation):Extract<SourceFusionSelection,{kind:'gltf'}>{
  return {kind:'gltf',pin:{...pin.document,inputSha256:pin.inputSha256,readerSha256:pin.readerSha256,
    acceptedFence:pin.acceptedFence,resultBytes:pin.resultBytes},nodeIndices:[...pin.gltf.selectedNodeIndices]};
}
export function gltfCitationFragment(source:Source,index:number,loaded:Loaded){
  if(!source.nodes.some(node=>node.index===index))conflict('The exact selected glTF node reference is unavailable.');
  const projected=fusionSourceProjection({kind:'gltf',pin:source.pin,nodeIndices:[index]},loaded);
  if(projected.kind!=='gltf')conflict('The exact accepted glTF artifact kind changed.');
  return RegistryGltfFragmentSchema.parse(projected);
}
export function gltfCitationFields(source:Source,index:number,loaded:Loaded,combinedContextSha256:string){
  const fragment=gltfCitationFragment(source,index,loaded),node=fragment.nodes[0];
  return {document:fusionCitationDocumentPin(source.pin),inputSha256:source.pin.inputSha256,readerSha256:source.pin.readerSha256,
    acceptedFence:source.pin.acceptedFence,resultBytes:source.pin.resultBytes,
    gltf:{purpose:'source_reference_only' as const,profile:'gltf-local-inspection/1' as const,
      artifactSha256:source.artifactSha256,artifactBytes:source.artifactBytes,nodeIndex:index,sourceKey:node.key,
      recordPointer:node.artifactPointer,recordSha256:node.recordSha256,fragmentSha256:fingerprint(fragment),selectionSha256:fragment.selectionSha256,
      selectedNodeIndices:source.nodes.map(node=>node.index),sourceSelectionSha256:source.selectionSha256,combinedContextSha256,
      representation:'context_mesh' as const,identifierScope:source.nativeIdentifierScope,placement:'unknown' as const,
      geometryQualification:'not_assessed' as const,measurements:false as const,learningLabels:false as const}};
}
export function gltfCitationId(pin:RegistryGltfCitation){
  return fingerprint({version:pin.version,document:pin.document,inputSha256:pin.inputSha256,readerSha256:pin.readerSha256,
    acceptedFence:pin.acceptedFence,resultBytes:pin.resultBytes,gltf:pin.gltf,target:pin.target});
}
