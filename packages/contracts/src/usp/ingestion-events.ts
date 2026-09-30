import { z } from 'zod';

const id = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const revision = z.number().int().positive();
export const CASE_INGESTION_VERSION = 'case-ingestion/1' as const;
/** SSE IDs encode a case/access binding and the durable bigint sequence as canonical decimal. */
export const CaseIngestionCursorSchema = z.string().max(97).regex(/^(0|[1-9]\d*)$/);
export const CaseIngestionChangeSchema = z.discriminatedUnion('kind', [
  z.strictObject({kind: z.literal('source.retained'), sourceId: id, sourceRevision: revision, status: z.literal('needs_input')}),
  z.strictObject({kind: z.literal('recipe.changed'), recipeId: id, recipeRevision: revision, sourceId: id,
    status: z.enum(['proposed', 'approved', 'executed'])}),
  z.strictObject({kind: z.literal('upload.changed'), uploadId: id, uploadRevision: revision,
    status: z.enum(['receiving', 'finalizing', 'retained', 'aborting', 'aborted'])}),
  z.strictObject({kind:z.literal('projected-vector.changed'),jobId:id,status:z.enum(['queued','running','succeeded','failed','stale'])}),
  z.strictObject({kind:z.literal('projected-vector.chunk'),jobId:id,sequence:z.number().int().min(1).max(128),
    records:z.number().int().min(1).max(733),sourceAccepted:z.literal(false)}),
  z.strictObject({kind:z.literal('private-mvt.changed'),jobId:id,version:z.number().int().min(1).max(32).nullable(),
    status:z.enum(['queued','running','partial','succeeded','failed','stale'])}),
  z.strictObject({kind:z.literal('sufficiency.changed'),sourceId:id,sourceRevision:revision,
    status:z.enum(['evaluated','answered','parked','stale'])}),
  z.strictObject({kind:z.literal('document.changed'),sourceId:id,sourceRevision:revision,jobId:id,
    status:z.enum(['queued','running','completed','failed','stale'])}),
  z.strictObject({kind:z.literal('raster-window.changed'),sourceId:id,sourceRevision:revision,jobId:id,
    status:z.enum(['queued','running','completed','failed','stale'])}),
  z.strictObject({kind:z.literal('cityjson-native.changed'),sourceId:id,sourceRevision:revision,jobId:id,
    status:z.enum(['queued','running','completed','failed','stale'])}),
  z.strictObject({kind:z.literal('point-batch.changed'),sourceId:id,sourceRevision:revision,jobId:id,
    status:z.enum(['queued','running','completed','failed','stale'])}),
  z.strictObject({kind:z.literal('streaming-vector.changed'),sourceId:id,sourceRevision:revision,jobId:id,
    status:z.enum(['queued','running','completed','completed_with_rejections','failed','stale'])}),
  z.strictObject({kind:z.literal('streaming-vector.chunk'),sourceId:id,sourceRevision:revision,jobId:id,
    chunkIndex:z.number().int().nonnegative().max(4096),status:z.enum(['ready','quarantined']),resultSha256:hash,
    records:z.number().int().nonnegative().max(100),sourceComplete:z.literal(false)}),
  z.strictObject({kind:z.literal('chunk-mapping.changed'),sourceId:id,sourceRevision:revision,jobId:id,rawJobId:id,
    status:z.enum(['queued','running','needs_input','disabled','unavailable','completed','completed_with_rejections','failed','stale'])}),
  z.strictObject({kind:z.literal('chunk-mapping.chunk'),sourceId:id,sourceRevision:revision,jobId:id,rawJobId:id,
    chunkIndex:z.number().int().nonnegative().max(4096),status:z.enum(['ready','quarantined']),resultSha256:hash,
    records:z.number().int().nonnegative().max(100),sourceComplete:z.literal(false)}),
  z.strictObject({kind:z.literal('streamed-profile.changed'),sourceId:id,sourceRevision:revision,jobId:id,rawJobId:id,
    status:z.enum(['queued','running','sealed','failed','stale'])}),
  z.strictObject({kind:z.literal('streamed-profile.generation'),sourceId:id,sourceRevision:revision,jobId:id,rawJobId:id,
    generation:z.number().int().nonnegative().max(4097),generationHash:hash,
    coverage:z.enum(['provisional','sealed']),recordsSeen:z.number().int().nonnegative()}),
]);
/** Intentionally separate from registry snapshot events. No original, filename or error text. */
export const CaseIngestionOutboxSchema = z.strictObject({
  version: z.literal(CASE_INGESTION_VERSION), caseId: id, caseRevision: z.number().int().nonnegative(),
  change: CaseIngestionChangeSchema,
});
export const CaseIngestionEventSchema = CaseIngestionOutboxSchema.extend({
  sequence: z.string().max(19).regex(/^[1-9]\d*$/), createdAt: z.string().datetime(), requiresRefresh: z.literal(true),
});
export const CaseIngestionControlSchema = z.strictObject({
  version: z.literal(CASE_INGESTION_VERSION), caseId: id, kind: z.enum(['ready', 'resync']),
  reason: z.enum(['connected', 'context_changed', 'cursor_out_of_range', 'replay_limit', 'event_gap', 'duration_limit']),
  cursor: CaseIngestionCursorSchema, headCursor: CaseIngestionCursorSchema,
  caseRevision: z.number().int().nonnegative(), requiresRefresh: z.literal(true),
});
export type CaseIngestionChange = z.infer<typeof CaseIngestionChangeSchema>;
export type CaseIngestionEvent = z.infer<typeof CaseIngestionEventSchema>;
export type CaseIngestionControl = z.infer<typeof CaseIngestionControlSchema>;
