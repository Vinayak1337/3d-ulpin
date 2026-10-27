import {z} from 'zod';
import {GLTF_LIMITS,GltfSummarySchema} from './usp/gltf-ingestion';
import {SourceFusionPinSchema,SourceFusionLiteralObjectSchema,SourceFusionLiteralJsonSchema} from './source-fusion-common';

const hash=z.string().regex(/^[a-f0-9]{64}$/),index=z.number().int().min(0).max(9999);
export const SourceFusionGltfSelectionSchema=z.strictObject({kind:z.literal('gltf'),pin:SourceFusionPinSchema,
  nodeIndices:z.array(index).min(1).max(25).refine(value=>new Set(value).size===value.length,'Select each native node once.')});
/** Pointers address the unchanged accepted artifact. Record hashes use canonical
 * JSON (the existing fingerprint function), not a claim about source byte spans. */
const record=z.strictObject({pointer:z.string(),artifactPointer:z.string(),recordSha256:hash,record:SourceFusionLiteralObjectSchema});
const records=z.array(record).max(10000);
const sceneDeclaration=z.discriminatedUnion('state',[z.strictObject({state:z.literal('absent')}),
  z.strictObject({state:z.literal('declared'),scene:record})]);
export const SourceFusionGltfSchema=z.strictObject({kind:z.literal('gltf'),pin:SourceFusionPinSchema,
  namespace:z.string(),sourceSetRole:z.literal('operator_selected_fragment'),representation:z.literal('context_mesh'),
  summary:GltfSummarySchema,artifactSha256:hash,artifactBytes:z.number().int().positive().max(GLTF_LIMITS.artifactBytes),
  selectionSha256:hash,selectionHashBasis:z.literal('accepted_source_result_input_reader_fence_artifact_and_sorted_node_indices'),
  recordHashBasis:z.literal('canonical_json_of_exact_native_artifact_record'),
  nativeIdentifierScope:z.literal('source_native_only; not_canonical_registry_ids'),
  asset:SourceFusionLiteralObjectSchema,jsonLocator:SourceFusionLiteralObjectSchema,chunks:z.array(SourceFusionLiteralObjectSchema).max(10000),
  selectedScene:SourceFusionLiteralObjectSchema,selectedSceneDeclaration:sceneDeclaration,
  nodes:z.array(record.extend({index,key:z.string(),parentReferences:z.array(z.strictObject({nodeIndex:index,
    pointer:z.string(),childOrdinal:z.number().int().nonnegative(),childIndex:index})).max(10000)})).min(1).max(25),
  meshes:records,primitives:z.array(z.strictObject({pointer:z.string(),artifactPointer:z.string(),recordSha256:hash,
    metadata:SourceFusionLiteralObjectSchema,metadataSha256:hash,
    omittedArrays:z.array(z.strictObject({role:z.enum(['POSITION','indices']),artifactPointer:z.string(),
      state:z.enum(['present','absent','null']),count:z.number().int().nonnegative().nullable(),valueSha256:hash.nullable()})).length(2)})).max(10000),
  accessors:records,bufferViews:records,buffers:records,
  resources:z.strictObject({materials:records,textures:records,images:records,samplers:records,skins:records,cameras:records,
    animationChannels:records,animationSamplers:records}),
  extensions:z.strictObject({required:z.array(SourceFusionLiteralJsonSchema).max(10000),used:z.array(SourceFusionLiteralJsonSchema).max(10000),
    inventory:z.array(SourceFusionLiteralObjectSchema).max(10000)}),
  qualification:SourceFusionLiteralObjectSchema,
  coverage:z.strictObject({selectedNodes:z.number().int().positive().max(25),availableNativeNodes:z.number().int().nonnegative().max(10000),
    scope:z.literal('explicit_nodes; incident_core_declarations_and_reference_literals'),unselectedNodes:z.literal('not_expanded'),
    geometryArrays:z.literal('omitted; exact artifact pointers and canonical array hashes retained'),
    transformComposition:z.literal('not_performed'),externalResources:z.literal('not_fetched'),
    opaqueContent:z.literal('literal_only; extension_references_not_resolved'),geometryQualification:z.literal('not_assessed'),
    propertyMatching:z.literal('unsupported')})});
