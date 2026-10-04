import {z} from 'zod';
import type {GltfResult} from '../../../../../contracts/src/usp/gltf-ingestion';
import {SourceFusionGltfSchema,SourceFusionGltfSelectionSchema} from '../../../../../contracts/src/source-fusion-gltf';
import {SourceFusionLiteralObjectSchema} from '../../../../../contracts/src/source-fusion-common';
import type {SourceFusionContext,SourceFusionSelection} from '../../../../../contracts/src/source-fusion';
import {AppError} from '../../../infrastructure/errors';
import {fingerprint} from '../../cases/domain';

const fail=():never=>{throw new AppError(422,'SOURCE_FUSION_SELECTION','The requested accepted glTF node selection is unavailable.');};
const records=z.array(SourceFusionLiteralObjectSchema).max(10000);
const nativeSchema=z.object({schemaVersion:z.literal('gltf-local-inspection/1'),sourceSha256:z.string(),sourceBytes:z.number(),
  status:z.string(),representation:z.literal('context_mesh'),asset:SourceFusionLiteralObjectSchema,jsonLocator:SourceFusionLiteralObjectSchema,
  chunks:records,selectedScene:SourceFusionLiteralObjectSchema,scenes:records,nodes:records,meshes:records,primitives:records,
  accessors:records,bufferViews:records,buffers:records,extensions:z.object({required:z.array(z.string()).max(10000),
    used:z.array(z.string()).max(10000),inventory:records}),resources:z.object({materials:records,textures:records,images:records,
    samplers:records,skins:records,cameras:records,animations:records}),qualification:SourceFusionLiteralObjectSchema});
const object=(value:unknown)=>SourceFusionLiteralObjectSchema.safeParse(value).success?value as Record<string,any>:fail();
const array=(value:unknown):any[]=>Array.isArray(value)?value:fail();
const ref=(value:unknown,length:number):number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<length?value:fail();
const literal=(record:Record<string,any>,pointer:string,artifactPointer:string)=>
  ({pointer,artifactPointer,recordSha256:fingerprint(record),record});

/** Source graph references only. No descendant expansion, external resolution,
 * transform composition, accessor decode or canonical property association. */
export function fusionGltfSourceProjection(selection:Extract<SourceFusionSelection,{kind:'gltf'}>,
  loaded:{result:GltfResult;native:unknown}):Extract<SourceFusionContext['sources'][number],{kind:'gltf'}>{
  const checked=SourceFusionGltfSelectionSchema.safeParse(selection);if(!checked.success)return fail();
  const {input,summary,artifact}=loaded.result,pin=selection.pin;
  if(input.caseId!==pin.caseId||input.caseRevision!==pin.caseRevision||input.sourceId!==pin.sourceId||
    input.sourceRevision!==pin.sourceRevision||input.sourceSha256!==pin.sourceSha256||input.jobId!==pin.jobId||
    input.readerSha256!==pin.readerSha256||fingerprint(input)!==pin.inputSha256)return fail();
  const native=nativeSchema.parse(loaded.native);
  if(native.sourceSha256!==input.sourceSha256||native.sourceBytes!==input.sourceBytes||native.status!==summary.status||
    native.nodes.length!==summary.nodeCount||native.primitives.length!==summary.primitiveCount||
    native.selectedScene.index!==summary.selectedSceneIndex||native.selectedScene.origin!==summary.selectedSceneOrigin||
    native.qualification.globalPlacement!=='unknown'||native.qualification.analyticalGeometry!==false||
    native.qualification.propertyIdentity!==false||native.qualification.measurements!==false||native.qualification.registryAdmission!==false)return fail();
  const sorted=[...selection.nodeIndices].sort((a,b)=>a-b),selected=new Set(sorted),ns=`source:${pin.caseId}/${pin.sourceId}@${pin.sourceRevision}`;
  const sets={meshes:new Set<number>(),accessors:new Set<number>(),bufferViews:new Set<number>(),buffers:new Set<number>(),
    materials:new Set<number>(),textures:new Set<number>(),images:new Set<number>(),samplers:new Set<number>(),skins:new Set<number>(),cameras:new Set<number>()};
  const add=(set:Set<number>,value:unknown,collection:readonly unknown[])=>set.add(ref(value,collection.length));
  // Inspect parent edges without disclosing or expanding the parent node record.
  const parents=new Map<number,{nodeIndex:number;pointer:string;childOrdinal:number;childIndex:number}[]>();
  native.nodes.forEach((node,nodeIndex)=>{
    if(node.sourceNodeIndex!==nodeIndex||node.pointer!==`/nodes/${nodeIndex}`)return fail();
    const declaration=object(node.declaration);
    if(Object.hasOwn(declaration,'children'))array(declaration.children).forEach((value,childOrdinal)=>{
      const childIndex=ref(value,native.nodes.length);if(!selected.has(childIndex))return;
      const entries=parents.get(childIndex)??[];entries.push({nodeIndex,pointer:`/nodes/${nodeIndex}/children/${childOrdinal}`,childOrdinal,childIndex});parents.set(childIndex,entries);
    });
  });
  const nodes=sorted.map(index=>{
    const node=native.nodes[ref(index,native.nodes.length)],declaration=object(node.declaration),transform=object(node.transform);
    if(transform.interpretation!=='local_column_major_matrix_or_TRS; no composition applied')return fail();
    for(const field of ['meshes','skins','cameras'] as const){const key={meshes:'mesh',skins:'skin',cameras:'camera'}[field];
      if(Object.hasOwn(declaration,key))add(sets[field],declaration[key],field==='meshes'?native.meshes:native.resources[field]);}
    return {...literal(node,`/nodes/${index}`,`/nodes/${index}`),index,key:`${ns}/node/${index}`,parentReferences:parents.get(index)??[]};
  });
  const accessorReferences=(declaration:Record<string,any>)=>{
    if(Object.hasOwn(declaration,'indices'))add(sets.accessors,declaration.indices,native.accessors);
    if(Object.hasOwn(declaration,'attributes'))for(const value of Object.values(object(declaration.attributes)))add(sets.accessors,value,native.accessors);
    if(Object.hasOwn(declaration,'targets'))for(const target of array(declaration.targets))
      for(const value of Object.values(object(target)))add(sets.accessors,value,native.accessors);
  };
  const primitives=native.primitives.flatMap((primitive,ordinal)=>{
    const mesh=ref(primitive.sourceMeshIndex,native.meshes.length);if(!sets.meshes.has(mesh))return [];
    const declaration=object(primitive.declaration);accessorReferences(declaration);
    if(Object.hasOwn(declaration,'material'))add(sets.materials,declaration.material,native.resources.materials);
    const metadata={...primitive},projection=primitive.projection===null?null:object(primitive.projection),artifactPointer=`/primitives/${ordinal}`;
    const omittedArrays=(['POSITION','indices'] as const).map(role=>{
      const observation=projection?object(projection[role]):null,hasValues=observation!==null&&Object.hasOwn(observation,'values'),value=observation?.values;
      if(hasValues&&value!==null&&!Array.isArray(value))return fail();
      return {role,artifactPointer:`${artifactPointer}/projection/${role}/values`,state:hasValues?(value===null?'null' as const:'present' as const):'absent' as const,
        count:hasValues&&value!==null?value.length:null,valueSha256:hasValues?fingerprint(value):null};
    });
    if(projection){const withoutValues=(role:string)=>{const {values,...rest}=object(projection[role]);return rest;};
      metadata.projection={POSITION:withoutValues('POSITION'),indices:withoutValues('indices')};}
    return [{pointer:String(primitive.pointer),artifactPointer,recordSha256:fingerprint(primitive),metadata,
      metadataSha256:fingerprint(metadata),omittedArrays}];
  });
  const wrap=(field:keyof typeof sets,collection:readonly Record<string,any>[],resource=false)=>
    [...sets[field]].sort((a,b)=>a-b).map(index=>literal(collection[index],`/${field}/${index}`,resource?`/resources/${field}/${index}`:`/${field}/${index}`));
  const declaration=(field:keyof typeof native.resources,index:number)=>object(native.resources[field][index].declaration);
  for(const index of sets.skins){const skin=declaration('skins',index);if(Object.hasOwn(skin,'inverseBindMatrices'))add(sets.accessors,skin.inverseBindMatrices,native.accessors);}
  const animationChannels:ReturnType<typeof literal>[]=[],animationSamplers:ReturnType<typeof literal>[]=[];
  native.resources.animations.forEach((entry,index)=>{
    const animation=object(entry.declaration),channels=array(animation.channels),samplers=array(animation.samplers),included=new Set<number>();
    channels.forEach((value,ordinal)=>{const channel=object(value),target=object(channel.target);
      if(!selected.has(target.node))return;
      included.add(ref(channel.sampler,samplers.length));animationChannels.push(literal(channel,`/animations/${index}/channels/${ordinal}`,
        `/resources/animations/${index}/declaration/channels/${ordinal}`));});
    [...included].sort((a,b)=>a-b).forEach(ordinal=>{const sampler=object(samplers[ordinal]);
      add(sets.accessors,sampler.input,native.accessors);add(sets.accessors,sampler.output,native.accessors);
      animationSamplers.push(literal(sampler,`/animations/${index}/samplers/${ordinal}`,`/resources/animations/${index}/declaration/samplers/${ordinal}`));});
  });
  for(const index of sets.materials){const material=declaration('materials',index),pbr=Object.hasOwn(material,'pbrMetallicRoughness')?object(material.pbrMetallicRoughness):{};
    for(const [parent,fields] of [[material,['normalTexture','occlusionTexture','emissiveTexture']],[pbr,['baseColorTexture','metallicRoughnessTexture']]] as const)
      for(const field of fields)if(Object.hasOwn(parent,field))add(sets.textures,object(parent[field]).index,native.resources.textures);}
  for(const index of sets.textures){const texture=declaration('textures',index);
    if(Object.hasOwn(texture,'source'))add(sets.images,texture.source,native.resources.images);
    if(Object.hasOwn(texture,'sampler'))add(sets.samplers,texture.sampler,native.resources.samplers);}
  for(const index of sets.images){const image=declaration('images',index);if(Object.hasOwn(image,'bufferView'))add(sets.bufferViews,image.bufferView,native.bufferViews);}
  for(const index of sets.accessors){const accessor=native.accessors[index];
    if(Object.hasOwn(accessor,'bufferView'))add(sets.bufferViews,accessor.bufferView,native.bufferViews);
    if(Object.hasOwn(accessor,'sparse'))for(const key of ['indices','values'])add(sets.bufferViews,object(object(accessor.sparse)[key]).bufferView,native.bufferViews);}
  for(const index of sets.bufferViews)add(sets.buffers,native.bufferViews[index].buffer,native.buffers);
  const sceneIndex=native.selectedScene.index,scene=sceneIndex===null?null:native.scenes[ref(sceneIndex,native.scenes.length)];
  const sourcePointers=[...nodes.map(n=>n.pointer),...Object.entries(sets).flatMap(([key,values])=>[...values].map(index=>`/${key}/${index}`)),
    ...animationChannels.map(r=>r.pointer),...animationSamplers.map(r=>r.pointer),'/asset',...(scene?[String(scene.pointer)]:[])];
  const includedPointers=new Set(sourcePointers);
  const includedExtension=(entry:Record<string,any>)=>{
    let pointer=entry.pointer;if(typeof pointer!=='string')return false;
    if(pointer.startsWith('/extensions/'))return true;
    // Walk bounded JSON-pointer ancestry instead of comparing each extension
    // with every selected declaration in a potentially quadratic inventory.
    while(pointer.includes('/')){pointer=pointer.slice(0,pointer.lastIndexOf('/'));if(includedPointers.has(pointer))return true;}
    return false;
  };
  return SourceFusionGltfSchema.parse({kind:'gltf',pin,namespace:ns,sourceSetRole:'operator_selected_fragment',representation:'context_mesh',summary,
    artifactSha256:artifact.sha256,artifactBytes:artifact.bytes,selectionSha256:fingerprint({version:'source-fusion-gltf-selection/1',pin,
      artifact:{sha256:artifact.sha256,bytes:artifact.bytes},nodeIndices:sorted}),
    selectionHashBasis:'accepted_source_result_input_reader_fence_artifact_and_sorted_node_indices',recordHashBasis:'canonical_json_of_exact_native_artifact_record',
    nativeIdentifierScope:'source_native_only; not_canonical_registry_ids',asset:native.asset,jsonLocator:native.jsonLocator,chunks:native.chunks,
    selectedScene:native.selectedScene,selectedSceneDeclaration:scene?{state:'declared',scene:literal(scene,String(scene.pointer),`/scenes/${sceneIndex}`)}:{state:'absent'},
    nodes,meshes:wrap('meshes',native.meshes),primitives,accessors:wrap('accessors',native.accessors),bufferViews:wrap('bufferViews',native.bufferViews),buffers:wrap('buffers',native.buffers),
    resources:{materials:wrap('materials',native.resources.materials,true),textures:wrap('textures',native.resources.textures,true),images:wrap('images',native.resources.images,true),
      samplers:wrap('samplers',native.resources.samplers,true),skins:wrap('skins',native.resources.skins,true),cameras:wrap('cameras',native.resources.cameras,true),animationChannels,animationSamplers},
    extensions:{required:native.extensions.required,used:native.extensions.used,inventory:native.extensions.inventory.filter(includedExtension)},
    qualification:native.qualification,coverage:{selectedNodes:nodes.length,availableNativeNodes:native.nodes.length,
      scope:'explicit_nodes; incident_core_declarations_and_reference_literals',unselectedNodes:'not_expanded',
      geometryArrays:'omitted; exact artifact pointers and canonical array hashes retained',transformComposition:'not_performed',externalResources:'not_fetched',
      opaqueContent:'literal_only; extension_references_not_resolved',geometryQualification:'not_assessed',propertyMatching:'unsupported'}});
}
