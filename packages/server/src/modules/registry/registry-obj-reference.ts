import type {RegistryObjCitation} from '../../../../contracts/src/registry-document-evidence';
import {RegistryObjFragmentSchema,RegistryObjSpanSchema} from '../../../../contracts/src/registry-obj-reference';
import type {SourceFusionContext,SourceFusionSelection} from '../../../../contracts/src/source-fusion';
import {fingerprint} from '../cases/domain';
import {conflict} from '../../infrastructure/errors';
import {fusionCitationDocumentPin} from '../usp/ingestion/source-fusion-citations';
import {fusionSourceProjection} from '../usp/ingestion/source-fusion';
import type {readFusionResult} from '../usp/ingestion/source-fusion-authority';

type Source=Extract<SourceFusionContext['sources'][number],{kind:'obj'}>;
type Loaded=Extract<Awaited<ReturnType<typeof readFusionResult>>,{kind:'obj'}>;
export function objCitationFusionSelection(pin:RegistryObjCitation):Extract<SourceFusionSelection,{kind:'obj'}>{
  return {kind:'obj',pin:{...pin.document,inputSha256:pin.inputSha256,readerSha256:pin.readerSha256,
    acceptedFence:pin.acceptedFence,resultBytes:pin.resultBytes},polygonIndices:[...pin.obj.selectedPolygonIndices]};
}
export function objCitationFragment(source:Source,index:number,loaded:Loaded){
  if(!source.polygons.some(polygon=>polygon.index===index))conflict('The exact selected OBJ polygon reference is unavailable.');
  const projected=fusionSourceProjection({kind:'obj',pin:source.pin,polygonIndices:[index]},loaded);
  if(projected.kind!=='obj')conflict('The exact accepted OBJ artifact kind changed.');
  return RegistryObjFragmentSchema.parse(projected);
}
export function objCitationFields(source:Source,index:number,loaded:Loaded,combinedContextSha256:string){
  const fragment=objCitationFragment(source,index,loaded),polygon=fragment.polygons[0];
  return {document:fusionCitationDocumentPin(source.pin),inputSha256:source.pin.inputSha256,readerSha256:source.pin.readerSha256,
    acceptedFence:source.pin.acceptedFence,resultBytes:source.pin.resultBytes,
    obj:{purpose:'source_reference_only' as const,profile:'utf8-literal-polygons/1' as const,
      artifactSha256:source.artifactSha256,artifactBytes:source.artifactBytes,polygonIndex:index,sourceKey:polygon.key,
      recordPointer:polygon.artifactPointer,recordSha256:polygon.recordSha256,span:RegistryObjSpanSchema.parse(polygon.record.locator),fragmentSha256:fingerprint(fragment),selectionSha256:fragment.selectionSha256,
      selectedPolygonIndices:source.polygons.map(polygon=>polygon.index),sourceSelectionSha256:source.selectionSha256,combinedContextSha256,
      representation:'context_mesh' as const,identifierScope:source.nativeIdentifierScope,placement:'unknown' as const,
      geometryQualification:'not_assessed' as const,measurements:false as const,learningLabels:false as const}};
}
export function objCitationId(pin:RegistryObjCitation){
  return fingerprint({version:pin.version,document:pin.document,inputSha256:pin.inputSha256,readerSha256:pin.readerSha256,
    acceptedFence:pin.acceptedFence,resultBytes:pin.resultBytes,obj:pin.obj,target:pin.target});
}
