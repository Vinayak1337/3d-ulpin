import {z} from 'zod';
import {OBJ_LIMITS} from './usp/obj-ingestion';
import {SourceFusionObjSchema} from './source-fusion-obj';

const hash=z.string().regex(/^[a-f0-9]{64}$/),polygonIndex=z.number().int().min(0).max(99999);
/** Exact original-file span; no inferred placement or polygon triangulation. */
export const RegistryObjSpanSchema=z.strictObject({
  byteStart:z.number().int().nonnegative().max(OBJ_LIMITS.originalBytes),
  byteEnd:z.number().int().positive().max(OBJ_LIMITS.originalBytes),
  lineStart:z.number().int().positive(),lineEnd:z.number().int().positive(),spanSha256:hash,
}).refine(span=>span.byteEnd>span.byteStart&&span.lineEnd>=span.lineStart,'The original polygon span must be complete.');
/** Reproject from the accepted artifact so incident coordinates, active declarations
 * and unresolved resources belong to this polygon rather than a trimmed capture. */
export const RegistryObjFragmentSchema=SourceFusionObjSchema.extend({polygons:SourceFusionObjSchema.shape.polygons.length(1)})
  .superRefine((fragment,ctx)=>{if(fragment.coverage.selectedPolygons!==1)
    ctx.addIssue({code:'custom',message:'A reference discloses exactly one selected OBJ polygon.'});});
export const RegistryObjReferenceFieldsSchema=z.strictObject({resultBytes:z.number().int().positive().max(OBJ_LIMITS.resultBytes),
  obj:z.strictObject({purpose:z.literal('source_reference_only'),profile:z.literal('utf8-literal-polygons/1'),
    artifactSha256:hash,artifactBytes:z.number().int().positive().max(OBJ_LIMITS.artifactBytes),
    polygonIndex,sourceKey:z.string().min(1).max(1024),recordPointer:z.string().regex(/^\/faces\/\d+$/),recordSha256:hash,span:RegistryObjSpanSchema,
    fragmentSha256:hash,selectionSha256:hash,
    selectedPolygonIndices:z.array(polygonIndex).min(1).max(25).refine(indices=>new Set(indices).size===indices.length),
    sourceSelectionSha256:hash,
    combinedContextSha256:hash.meta({description:'Exact full combined context verified at the original officer amendment; subsequent disclosure revalidates attached references, not continued applicability of uncited context.'}),
    representation:z.literal('context_mesh'),identifierScope:z.literal('source_native_only; not_canonical_registry_ids'),
    placement:z.literal('unknown'),geometryQualification:z.literal('not_assessed'),measurements:z.literal(false),learningLabels:z.literal(false)
  }).superRefine((value,ctx)=>{if(!value.selectedPolygonIndices.includes(value.polygonIndex)||value.recordPointer!==`/faces/${value.polygonIndex}`)
    ctx.addIssue({code:'custom',message:'The cited native polygon must belong to the full source selection and exact artifact pointer.'});})});
