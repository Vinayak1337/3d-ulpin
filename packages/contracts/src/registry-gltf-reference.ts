import {z} from 'zod';
import {GLTF_LIMITS} from './usp/gltf-ingestion';
import {SourceFusionGltfSchema} from './source-fusion-gltf';

const hash=z.string().regex(/^[a-f0-9]{64}$/),nodeIndex=z.number().int().min(0).max(9999);
/** Disclosure is always reconstructed from the accepted artifact, not by
 * trimming a multi-node context and retaining its unrelated resource metadata. */
export const RegistryGltfFragmentSchema=SourceFusionGltfSchema.extend({nodes:SourceFusionGltfSchema.shape.nodes.length(1)})
  .superRefine((fragment,ctx)=>{if(fragment.coverage.selectedNodes!==1)
    ctx.addIssue({code:'custom',message:'A reference discloses exactly one selected glTF node.'});});
export const RegistryGltfReferenceFieldsSchema=z.strictObject({resultBytes:z.number().int().positive().max(GLTF_LIMITS.resultBytes),
  gltf:z.strictObject({purpose:z.literal('source_reference_only'),profile:z.literal('gltf-local-inspection/1'),
    artifactSha256:hash,artifactBytes:z.number().int().positive().max(GLTF_LIMITS.artifactBytes),
    nodeIndex,sourceKey:z.string().min(1).max(1024),recordPointer:z.string().regex(/^\/nodes\/\d+$/),recordSha256:hash,
    fragmentSha256:hash,selectionSha256:hash,
    selectedNodeIndices:z.array(nodeIndex).min(1).max(25).refine(indices=>new Set(indices).size===indices.length),
    sourceSelectionSha256:hash,
    combinedContextSha256:hash.meta({description:'Exact full combined context verified at the original officer amendment; subsequent disclosure revalidates attached source references, not an association or continued applicability of uncited context.'}),
    representation:z.literal('context_mesh'),identifierScope:z.literal('source_native_only; not_canonical_registry_ids'),
    placement:z.literal('unknown'),geometryQualification:z.literal('not_assessed'),measurements:z.literal(false),learningLabels:z.literal(false)})});
