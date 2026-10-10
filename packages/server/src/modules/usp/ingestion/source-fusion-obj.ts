import {z} from 'zod';
import type {ObjResult} from '../../../../../contracts/src/usp/obj-ingestion';
import {SourceFusionObjSchema,SourceFusionObjSelectionSchema} from '../../../../../contracts/src/source-fusion-obj';
import {SourceFusionLiteralObjectSchema} from '../../../../../contracts/src/source-fusion-common';
import type {SourceFusionContext,SourceFusionSelection} from '../../../../../contracts/src/source-fusion';
import {AppError} from '../../../infrastructure/errors';
import {fingerprint} from '../../cases/domain';

const fail=():never=>{throw new AppError(422,'SOURCE_FUSION_SELECTION','The requested accepted OBJ polygon selection is unavailable.');};
const records=(max:number)=>z.array(SourceFusionLiteralObjectSchema).max(max);
const nativeSchema=z.object({schemaVersion:z.literal('obj-source-context/1'),profile:SourceFusionObjSchema.shape.profile,
  encoding:SourceFusionObjSchema.shape.encoding,locatorBasis:SourceFusionObjSchema.shape.locatorBasis,
  sourceSha256:z.string(),sourceBytes:z.number(),status:z.string(),representation:z.literal('context_mesh'),
  vertices:records(100000),textures:records(100000),normals:records(100000),faces:records(100000),
  declarations:records(250000),resources:records(250000),unsupported:records(250000),qualification:SourceFusionLiteralObjectSchema});
const object=(v:unknown):Record<string,any>=>SourceFusionLiteralObjectSchema.safeParse(v).success?v as Record<string,any>:fail();
const ref=(v:unknown,length:number):number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<length?v:fail();
const literal=(record:Record<string,any>,artifactPointer:string)=>({artifactPointer,recordSha256:fingerprint(record),record});

/** Select unchanged source-native polygons and incident records only. All spans,
 * signed references, null components and projection reasons stay literal. */
export function fusionObjSourceProjection(selection:Extract<SourceFusionSelection,{kind:'obj'}>,
  loaded:{result:ObjResult;native:unknown}):Extract<SourceFusionContext['sources'][number],{kind:'obj'}>{
  if(!SourceFusionObjSelectionSchema.safeParse(selection).success)return fail();
  const {input,summary,artifact}=loaded.result,pin=selection.pin;
  if(input.caseId!==pin.caseId||input.caseRevision!==pin.caseRevision||input.sourceId!==pin.sourceId||
    input.sourceRevision!==pin.sourceRevision||input.sourceSha256!==pin.sourceSha256||input.jobId!==pin.jobId||
    input.readerSha256!==pin.readerSha256||fingerprint(input)!==pin.inputSha256)return fail();
  const native=nativeSchema.parse(loaded.native),q=native.qualification;
  if(native.sourceSha256!==input.sourceSha256||native.sourceBytes!==input.sourceBytes||native.status!==summary.status||
    native.faces.length!==summary.polygonCount||native.vertices.length!==summary.vertexCount||native.textures.length!==summary.textureCount||
    native.normals.length!==summary.normalCount||q.axes!=='unknown'||q.units!=='unknown'||q.crs!=='unknown'||q.heightReference!=='unknown'||
    q.globalPlacement!=='unknown'||q.analyticalGeometry!==false||q.measurements!==false||q.propertyIdentity!==false||q.registryAdmission!==false||q.learningTruth!==false)return fail();
  const sorted=[...selection.polygonIndices].sort((a,b)=>a-b),ns=`source:${pin.caseId}/${pin.sourceId}@${pin.sourceRevision}`;
  const vertices=new Set<number>(),textures=new Set<number>(),normals=new Set<number>(),declarations=new Set<number>();
  // Material-library declarations apply to the source as a whole, but other
  // polygons' active material/object/group records are not expanded.
  native.declarations.forEach((d,index)=>{if(d.index!==index)return fail();if(d.directive==='mtllib')declarations.add(index);});
  const polygons=sorted.map(index=>{
    const polygon=native.faces[ref(index,native.faces.length)];
    if(polygon.index!==index||!Array.isArray(polygon.references)||polygon.references.length<3||typeof polygon.projectionEligible!=='boolean')return fail();
    for(const value of polygon.references){const reference=object(value);
      for(const [name,set,stream] of [['vertex',vertices,native.vertices],['texture',textures,native.textures],['normal',normals,native.normals]] as const){
        if(reference[name]===null){if(name==='vertex')return fail();continue;}
        const binding=object(reference[name]);set.add(ref(binding.resolvedIndex,stream.length));
      }
    }
    const active=object(polygon.declarations);
    for(const field of ['object','groups','material','smoothing'])if(active[field]!==null)declarations.add(ref(active[field],native.declarations.length));
    return {...literal(polygon,`/faces/${index}`),index,key:`${ns}/polygon/${index}`};
  });
  const coordinates=(set:Set<number>,field:'vertices'|'textures'|'normals')=>[...set].sort((a,b)=>a-b).map(index=>{
    const record=native[field][index];if(record.index!==index)return fail();
    return {...literal(record,`/${field}/${index}`),index};
  });
  const selectedResources=native.resources.flatMap((record,index)=>declarations.has(ref(record.declarationIndex,native.declarations.length))
    ?[literal(record,`/resources/${index}`)]:[]);
  return SourceFusionObjSchema.parse({kind:'obj',pin,namespace:ns,sourceSetRole:'operator_selected_fragment',representation:'context_mesh',summary,
    artifactSha256:artifact.sha256,artifactBytes:artifact.bytes,selectionSha256:fingerprint({version:'source-fusion-obj-selection/1',pin,
      artifact:{sha256:artifact.sha256,bytes:artifact.bytes},polygonIndices:sorted}),
    selectionHashBasis:'accepted_source_result_input_reader_fence_artifact_and_sorted_polygon_indices',recordHashBasis:'canonical_json_of_exact_native_artifact_record',
    nativeIdentifierScope:'source_native_only; not_canonical_registry_ids',profile:native.profile,encoding:native.encoding,locatorBasis:native.locatorBasis,
    polygons,vertices:coordinates(vertices,'vertices'),textures:coordinates(textures,'textures'),normals:coordinates(normals,'normals'),
    declarations:[...declarations].sort((a,b)=>a-b).map(index=>({...literal(native.declarations[index],`/declarations/${index}`),declarationIndex:index})),
    resources:selectedResources,unsupported:native.unsupported.map((record,index)=>literal(record,`/unsupported/${index}`)),qualification:q,
    coverage:{selectedPolygons:polygons.length,availableNativePolygons:native.faces.length,selectedCoordinateRecords:vertices.size+textures.size+normals.size,
      selectedResourceDeclarations:selectedResources.length,scope:'explicit_polygons; incident_coordinates_and_active_declarations; global_material_libraries_and_unsupported_inventory',
      unselectedPolygons:'not_expanded',externalResources:'not_fetched',triangulation:'not_performed',geometryQualification:'not_assessed',propertyMatching:'unsupported'}});
}
