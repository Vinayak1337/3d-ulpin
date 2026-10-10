import {z} from 'zod';
import {OBJ_LIMITS,ObjSummarySchema} from './usp/obj-ingestion';
import {SourceFusionPinSchema,SourceFusionLiteralObjectSchema} from './source-fusion-common';

const hash=z.string().regex(/^[a-f0-9]{64}$/),index=z.number().int().min(0).max(99999);
export const SourceFusionObjSelectionSchema=z.strictObject({kind:z.literal('obj'),pin:SourceFusionPinSchema,
  polygonIndices:z.array(index).min(1).max(25).refine(v=>new Set(v).size===v.length,'Select each native polygon once.')});
const record=z.strictObject({artifactPointer:z.string(),recordSha256:hash,record:SourceFusionLiteralObjectSchema});
const indexed=record.extend({index});
export const SourceFusionObjSchema=z.strictObject({kind:z.literal('obj'),pin:SourceFusionPinSchema,namespace:z.string(),
  sourceSetRole:z.literal('operator_selected_fragment'),representation:z.literal('context_mesh'),summary:ObjSummarySchema,
  artifactSha256:hash,artifactBytes:z.number().int().positive().max(OBJ_LIMITS.artifactBytes),selectionSha256:hash,
  selectionHashBasis:z.literal('accepted_source_result_input_reader_fence_artifact_and_sorted_polygon_indices'),
  recordHashBasis:z.literal('canonical_json_of_exact_native_artifact_record'),
  nativeIdentifierScope:z.literal('source_native_only; not_canonical_registry_ids'),
  profile:z.literal('utf8-literal-polygons/1'),encoding:z.enum(['utf8','utf8_bom']),
  locatorBasis:z.literal('original-file-bytes-zero-based-end-exclusive; physical-lines-one-based'),
  polygons:z.array(indexed.extend({key:z.string()})).min(1).max(25),
  vertices:z.array(indexed).max(100000),textures:z.array(indexed).max(100000),normals:z.array(indexed).max(100000),
  declarations:z.array(record.extend({declarationIndex:z.number().int().min(0).max(249999)})).max(250000),
  resources:z.array(record).max(250000),unsupported:z.array(record).max(250000),qualification:SourceFusionLiteralObjectSchema,
  coverage:z.strictObject({selectedPolygons:z.number().int().positive().max(25),availableNativePolygons:z.number().int().nonnegative().max(100000),
    selectedCoordinateRecords:z.number().int().nonnegative().max(100000),selectedResourceDeclarations:z.number().int().nonnegative().max(250000),
    scope:z.literal('explicit_polygons; incident_coordinates_and_active_declarations; global_material_libraries_and_unsupported_inventory'),
    unselectedPolygons:z.literal('not_expanded'),externalResources:z.literal('not_fetched'),
    triangulation:z.literal('not_performed'),geometryQualification:z.literal('not_assessed'),propertyMatching:z.literal('unsupported')})});
