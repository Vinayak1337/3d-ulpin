import { z } from 'zod';
import { CanonicalMappedValueSchema } from '../canonical/mapping-plan';
import { CanonicalTargetSchema } from '../canonical/targets';
import { TABULAR_LIMITS, TABULAR_STREAM_LIMITS as limits, TabularProvenanceSchema,
  TabularSelectionSchema } from './ingestion';

const id = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const record = z.number().int().nonnegative().max(limits.rows - 1);
const issue = z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/);

/** An original already retained (large-original/1) becomes a table source: up to 16 MiB it is read whole, a CSV above
 * that is read as a stream by a job; a workbook keeps the 16 MiB bound. */
export const TableFromOriginalSchema = z.strictObject({
  requestKey: id, expectedWorkspaceRevision: z.number().int().nonnegative(), selection: TabularSelectionSchema,
  ...TabularProvenanceSchema.partial().shape,
});

/** TP1. The job that reads a large CSV as a stream, in the shared job status words; a stop keeps the reader's code
 * and its officer words. */
export const TableProfileJobSchema = z.strictObject({
  version: z.literal('table-profile/1'), jobId: id, caseId: id, sourceId: id,
  sourceRevision: z.number().int().positive(),
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled', 'stale']),
  issueCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/).nullable(), message: z.string().min(1).max(600).nullable(),
});

/** One record as written: its number among the table's records (the first is 0), its logical row in the file
 * (the header is 1), its byte range in the unchanged original and that range's SHA-256. An absent cell is null;
 * an empty cell stays the empty string. */
const WindowRowObject = z.strictObject({
  record, sourceRow: z.number().int().min(2), byteStart: z.number().int().nonnegative(),
  byteEnd: z.number().int().nonnegative(), sha256: hash,
  cells: z.array(z.string().nullable()).min(1).max(TABULAR_LIMITS.columns),
});
const ordered = (row: { byteStart: number; byteEnd: number }) => row.byteEnd >= row.byteStart;
export const TableWindowRowSchema = WindowRowObject.refine(ordered, 'A record ends where it starts or later.');

/** A mapped cell of a window, without the citation list: the record's locator cites it. */
export const TableMappedCellSchema = CanonicalMappedValueSchema.pick({ value: true, state: true, unit: true,
  issueCode: true }).extend({ sourceField: z.string().min(1).max(512), target: CanonicalTargetSchema });

export const TableRowsQuerySchema = z.strictObject({
  after: z.coerce.number().int().min(-1).max(limits.rows - 1).default(-1),
  limit: z.coerce.number().int().min(1).max(limits.pageRows).default(100),
});

export const TableWindowIssueSchema = z.strictObject({ window: z.number().int().nonnegative(),
  firstRecord: record, lastRecord: record, issueCode: issue, message: z.string().min(1).max(500) });

/** One keyset page of a streamed table, read from its windows by record number. */
export const TableRowsPageSchema = z.strictObject({
  caseId: id, sourceId: id, sourceRevision: z.number().int().positive(), sourceSha256: hash,
  headers: z.array(z.string().max(400)).min(1).max(TABULAR_LIMITS.columns),
  records: z.number().int().positive().max(limits.rows),
  rawJobId: id.nullable(), mappingJobId: id.nullable(),
  windows: z.strictObject({ written: z.number().int().nonnegative().max(limits.windows),
    mapped: z.number().int().nonnegative().max(limits.windows),
    failed: z.array(TableWindowIssueSchema).max(limits.windows) }),
  after: z.number().int().min(-1), next: record.nullable(),
  rows: z.array(WindowRowObject.extend({ window: z.number().int().nonnegative(),
    mapped: z.array(TableMappedCellSchema).max(TABULAR_LIMITS.columns).nullable() })
    .refine(ordered, 'A record ends where it starts or later.')).max(limits.pageRows),
});

export type TableWindowRow = z.infer<typeof TableWindowRowSchema>;
export type TableProfileJob = z.infer<typeof TableProfileJobSchema>;
export type TableMappedCell = z.infer<typeof TableMappedCellSchema>;
export type TableRowsPage = z.infer<typeof TableRowsPageSchema>;
