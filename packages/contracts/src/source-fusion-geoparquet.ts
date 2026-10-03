import {z} from 'zod';
import {SourceFusionPinSchema,SourceFusionLiteralObjectSchema} from './source-fusion';
import {GEOPARQUET_LIMITS,GeoParquetSummarySchema,GeoParquetSelectionSchema,GeoParquetContinuationPinSchema} from './usp/geoparquet-ingestion';

const hash=z.string().regex(/^[a-f0-9]{64}$/),rowIndex=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER-1000);
// Lazy common fields allow the shared contract to import these leaves for its
// unions after integration, without evaluating common schemas in an import cycle.
export const SourceFusionGeoParquetPinSchema=z.lazy(()=>SourceFusionPinSchema.extend({
  resultBytes:z.number().int().positive().max(GEOPARQUET_LIMITS.resultBytes)}));
const literal=z.lazy(()=>SourceFusionLiteralObjectSchema);
export const SourceFusionGeoParquetSelectionSchema=z.strictObject({kind:z.literal('geoparquet'),
  pin:SourceFusionGeoParquetPinSchema,artifactSha256:hash,rowIndices:z.array(rowIndex).min(1).max(25)})
  .superRefine((v,ctx)=>{if(new Set(v.rowIndices).size!==v.rowIndices.length)
    ctx.addIssue({code:'custom',message:'Select each source-native row index once.'});});
export const SourceFusionGeoParquetSchema=z.strictObject({kind:z.literal('geoparquet'),pin:SourceFusionGeoParquetPinSchema,
  namespace:z.string(),sourceSetRole:z.literal('operator_selected_fragment'),summary:GeoParquetSummarySchema,
  artifactSha256:hash,artifactBytes:z.number().int().positive().max(GEOPARQUET_LIMITS.artifactBytes),selectionSha256:hash,
  selectionHashBasis:z.literal('accepted_source_result_input_reader_fence_artifact_window_parent_and_sorted_row_indices'),
  nativeIdentifierScope:z.literal('source_native_only; not_canonical_registry_ids'),
  enrolledSelection:GeoParquetSelectionSchema,continuation:GeoParquetContinuationPinSchema.nullable(),
  source:literal,reader:literal,schema:literal,geoMetadata:literal,profile:literal,
  rowGroups:z.array(literal).max(128),semantics:literal,
  rows:z.array(z.strictObject({rowIndex,ordinal:z.number().int().nonnegative().max(999),
    rowGroupIndex:z.number().int().nonnegative().max(127),rowIndexInGroup:z.number().int().nonnegative().max(99999),
    key:z.string(),pointer:z.string(),recordSha256:hash,record:literal})).min(1).max(25),
  coverage:z.strictObject({selectedRows:z.number().int().positive().max(25),availableNativeRows:z.number().int().nonnegative().max(1000),
    totalSourceRows:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    scope:z.literal('explicit_row_records_and_exact_window_metadata'),unselectedRows:z.literal('not_expanded'),
    continuationRowsFetch:z.literal('not_performed'),geometryQualification:z.literal('not_assessed'),propertyMatching:z.literal('unsupported')})});
export type SourceFusionGeoParquetSelection=z.infer<typeof SourceFusionGeoParquetSelectionSchema>;
export type SourceFusionGeoParquet=z.infer<typeof SourceFusionGeoParquetSchema>;
