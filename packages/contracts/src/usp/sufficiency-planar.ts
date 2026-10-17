import {z} from 'zod';
import {DXFSummarySchema} from './dxf-ingestion';
import {GeoParquetSummarySchema,GeoParquetSelectionSchema,GeoParquetContinuationPinSchema} from './geoparquet-ingestion';

// Keep this leaf independent of the root sufficiency union. Lead composition
// adds its optional detail without a circular contract import.
export const SUFFICIENCY_PLANAR_LIMITS=Object.freeze({receiptBytes:64*1024,readMs:30_000});
const hash=z.string().regex(/^[a-f0-9]{64}$/),revision=z.number().int().nonnegative();
const metadata={inputSha256:hash.nullable(),readerSha256:hash.nullable(),acceptedFence:revision.positive().nullable(),
  tools:z.enum(['not_checked','current','unavailable']),code:z.string().max(100).nullable(),
  coverage:z.literal('accepted_result_metadata_only; native_artifact_not_read')};
export const SufficiencyDXFDetailSchema=z.strictObject({...metadata,kind:z.literal('dxf'),summary:DXFSummarySchema.nullable(),
  selection:z.literal('complete_bounded_source').nullable(),sourceUnits:z.enum(['summary_not_available','result_summary'])});
export const SufficiencyGeoParquetDetailSchema=z.strictObject({...metadata,kind:z.literal('geoparquet'),
  summary:GeoParquetSummarySchema.nullable(),selection:GeoParquetSelectionSchema.nullable(),
  continuation:GeoParquetContinuationPinSchema.nullable(),sourceUnits:z.literal('native_artifact_not_read')});
export const SufficiencyPlanarDetailSchema=z.discriminatedUnion('kind',[SufficiencyDXFDetailSchema,SufficiencyGeoParquetDetailSchema]);
/** Base fields match the accepted sufficiency processing vocabulary. Native
 * document/model states stay null: these are producer metadata receipts. */
export const SufficiencyPlanarProcessingSchema=z.strictObject({
  state:z.enum(['pending','running','failed','stale','unavailable','inspected_metadata']),jobId:z.uuid().nullable(),
  resultSha256:hash.nullable(),nativeStatus:z.null(),modelStatus:z.null(),planar:SufficiencyPlanarDetailSchema});
export const SufficiencyPlanarJobPinSchema=z.strictObject({authority:z.literal('job'),id:z.uuid(),revision,sha256:hash});
export type SufficiencyPlanarDetail=z.infer<typeof SufficiencyPlanarDetailSchema>;
export type SufficiencyPlanarProcessing=z.infer<typeof SufficiencyPlanarProcessingSchema>;
export type SufficiencyPlanarJobPin=z.infer<typeof SufficiencyPlanarJobPinSchema>;
