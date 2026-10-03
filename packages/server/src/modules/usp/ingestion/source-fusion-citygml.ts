import {z} from 'zod';
import type {CityGMLResult} from '../../../../../contracts/src/usp/citygml-ingestion';
import {SourceFusionCityGMLSchema,SourceFusionLiteralObjectSchema,
  type SourceFusionContext,type SourceFusionSelection} from '../../../../../contracts/src/source-fusion';
import {AppError} from '../../../infrastructure/errors';
import {fingerprint} from '../../cases/domain';

const fail=():never=>{throw new AppError(422,'SOURCE_FUSION_SELECTION','The requested accepted CityGML building selection is unavailable.');};
const literals=z.array(SourceFusionLiteralObjectSchema).max(25000);
const nativeSchema=z.object({schemaVersion:z.literal('ulpin-native-citygml/1'),status:z.enum(['available','partial']),
  scope:z.literal('source_native_literal_inventory'),source:SourceFusionLiteralObjectSchema,parser:SourceFusionLiteralObjectSchema,
  elements:literals,buildings:literals,coordinates:literals,identifiers:literals,references:literals,namespaces:literals,
  findings:z.array(SourceFusionLiteralObjectSchema).max(4),semantics:SourceFusionLiteralObjectSchema});

/** Partition literal XML containment only. Typed buildings come solely from
 * the accepted reader; opaque ADE payload never creates typed owners or facts.
 * A separately selected BuildingPart is not expanded by selecting its parent. */
export function fusionCityGMLSourceProjection(selection:Extract<SourceFusionSelection,{kind:'citygml'}>,
  loaded:{result:CityGMLResult;native:unknown}):Extract<SourceFusionContext['sources'][number],{kind:'citygml'}>{
  const {input,summary,artifact}=loaded.result,pin=selection.pin,ordinals=selection.buildingOrdinals;
  if(!ordinals.length||ordinals.length>25||new Set(ordinals).size!==ordinals.length||
    ordinals.some(n=>!Number.isSafeInteger(n)||n<0||n>24999))return fail();
  if(input.caseId!==pin.caseId||input.caseRevision!==pin.caseRevision||input.sourceId!==pin.sourceId||
    input.sourceRevision!==pin.sourceRevision||input.sourceSha256!==pin.sourceSha256||input.jobId!==pin.jobId||
    input.readerSha256!==pin.readerSha256||fingerprint(input)!==pin.inputSha256)return fail();
  const native=nativeSchema.parse(loaded.native);
  if(native.source.sha256!==input.sourceSha256||native.source.bytes!==input.sourceBytes||native.status!==summary.status||
    native.elements.length!==summary.elementCount||native.buildings.length!==summary.buildingAndPartCount||
    native.coordinates.length!==summary.coordinateDeclarationCount||native.references.length!==summary.referenceCount||
    native.semantics.globalTransformApplied!==false||native.semantics.canonicalIdentity!=='not_assessed'||
    native.semantics.floorsOrUnitsInferred!==false||native.semantics.externalResourcesResolved!==false)return fail();
  const roots=new Set<number>();
  for(const record of native.buildings){
    const element=record.element;
    if(typeof element!=='number'||!Number.isSafeInteger(element)||roots.has(element)||
      !['Building','BuildingPart'].includes(String(record.type)))return fail();
    const root=native.elements[element];
    if(!root||root.ordinal!==element||root.localName!==record.type||root.namespace!=='http://www.opengis.net/citygml/building/2.0'||
      !Array.isArray(record.properties)||!Array.isArray(record.lodDeclarations))return fail();
    roots.add(element);
  }
  const owners:(number|null)[]=native.elements.map((element,index)=>{
    if(element.ordinal!==index||!element.locator||typeof element.locator!=='object'||Array.isArray(element.locator))return fail();
    const parent=element.parent;
    if(parent!==null&&(typeof parent!=='number'||!Number.isSafeInteger(parent)||parent<0||parent>=index))return fail();
    return null;
  });
  for(const [index,element] of native.elements.entries())
    owners[index]=roots.has(index)?index:element.parent===null?null:owners[element.parent as number];
  const scoped=(owner:number|null)=>{
    const elements=native.elements.filter((_,index)=>owners[index]===owner),included=new Set(elements.map(e=>e.ordinal));
    return {elements,coordinates:native.coordinates.filter(c=>included.has(c.element)),
      identifiers:native.identifiers.filter(id=>Array.isArray(id.elements)&&id.elements.some(e=>included.has(e))),
      references:native.references.filter(r=>included.has(r.element))};
  };
  const sorted=[...ordinals].sort((a,b)=>a-b),ns=`source:${pin.caseId}/${pin.sourceId}@${pin.sourceRevision}`;
  const buildings=sorted.map(ordinal=>{
    const record=native.buildings[ordinal];if(!record)return fail();
    const fragment={record,...scoped(record.element as number)};
    return {ordinal,key:`${ns}/building/${ordinal}`,pointer:`/buildings/${ordinal}`,
      recordSha256:fingerprint(record),fragmentSha256:fingerprint(fragment),...fragment};
  });
  return SourceFusionCityGMLSchema.parse({kind:'citygml',pin,namespace:ns,sourceSetRole:'operator_selected_fragment',
    summary,artifactSha256:artifact.sha256,artifactBytes:artifact.bytes,
    selectionSha256:fingerprint({version:'source-fusion-citygml-selection/1',pin,
      artifact:{sha256:artifact.sha256,bytes:artifact.bytes},buildingOrdinals:sorted}),
    selectionHashBasis:'accepted_source_result_input_reader_fence_artifact_and_sorted_building_ordinals',
    nativeIdentifierScope:'source_native_only; not_canonical_registry_ids',source:native.source,parser:native.parser,
    namespaces:native.namespaces,sourceContext:scoped(null),buildings,findings:native.findings,semantics:native.semantics,
    coverage:{selectedBuildings:buildings.length,availableNativeBuildings:native.buildings.length,
      scope:'selected_building_literal_subtrees_and_separate_nonbuilding_source_context',unselectedBuildings:'not_expanded',
      opaqueContent:'literal_only',referenceResolution:'not_performed',geometryQualification:'not_assessed',propertyMatching:'unsupported'}});
}
