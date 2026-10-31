import type { PoolClient } from 'pg';
import { z } from 'zod';
import { TABULAR_LIMITS, TABULAR_STREAM_LIMITS as limits, TableRowsPageSchema, TableRowsQuerySchema,
  TableWindowRowSchema, type AnyStreamingInput, type TableMappedCell, type TableWindowRow,
  type TabularPin } from '@ulpin/contracts/usp';
import { transaction } from '../../../infrastructure/db';
import { AppError, conflict, notFound } from '../../../infrastructure/errors';
import { localOperatorSubject } from '../principal';
import type { UspJobAttempt } from '../jobs';
import { appendCaseIngestionTx } from './events';
import type { StreamedTableWindow } from './tabular-stream';

const uuid = z.string().uuid();

/** A case original above the byte bound, or any XLSX/ODS (which may exceed the cell bound while small on disk),
 * takes the window reader rather than being sent back through the whole-file cell reader. */
export function isWindowedTable(input: { framing: string; tabular?: TabularPin; sourceBytes: number }) {
  return input.framing === 'tabular' && input.tabular !== undefined && 'admission' in input.tabular
    && (input.sourceBytes > TABULAR_LIMITS.bytes || ['xlsx', 'ods'].includes(input.tabular.selection.format));
}

/** The stored form of a window's records: every header position present, an absent cell null. Each record cites a
 * byte range of the original and that range's SHA-256; a workbook record also cites its sheet, the sheet's SHA-256
 * and its marked cells. */
export function windowRows(window: StreamedTableWindow, headers: string[]): TableWindowRow[] {
  return window.rows.map(row => TableWindowRowSchema.parse({ record: row.index, sourceRow: row.sourceRow,
    byteStart: row.byteStart, byteEnd: row.byteEnd, sha256: row.rawSha256,
    ...('sheet' in row ? { sheet: row.sheet, sheetSha256: row.sheetSha256, ...(row.marks ? { marks: row.marks } : {}),
      ...(row.rowElement ? { rowElement: row.rowElement, rowSha256: row.rowSha256 } : {}) } : {}),
    cells: headers.map((_, column) => row.cells[column] ?? null) }));
}

/** Writes one window under the raw job's watermark: windows are numbered without gaps and their first record
 * continues the job's count. A replayed window must match the stored one exactly. */
export async function writeTableWindowTx(client: PoolClient, input: AnyStreamingInput, attempt: UspJobAttempt,
  window: StreamedTableWindow, headers: string[]) {
  const state = (await client.query('SELECT * FROM usp_streaming_vector_imports WHERE job_id=$1 FOR UPDATE',
    [input.jobId])).rows[0];
  if (!state || !['queued', 'running'].includes(state.state) || state.source_revision !== input.sourceRevision
    || state.input_sha256 !== attempt.inputSha256) conflict('The streaming import changed before window acceptance.');
  const rows = windowRows(window, headers), first = rows[0]!.record, last = rows.at(-1)!.record;
  const prior = (await client.query('SELECT first_record,records,window_sha256,byte_start,byte_end FROM ' +
    'usp_table_windows WHERE job_id=$1 AND window_index=$2', [input.jobId, window.index])).rows[0];
  if (prior) {
    if (prior.first_record !== first || prior.records !== rows.length || prior.window_sha256 !== window.sha256
      || Number(prior.byte_start) !== window.byteStart || Number(prior.byte_end) !== window.byteEnd)
      throw new AppError(422, 'STREAMING_REPLAY_MISMATCH', 'A recovered window differs from the one accepted.');
    return;
  }
  if (state.next_publish_index !== window.index || state.records !== first || window.index >= limits.windows)
    throw new AppError(422, 'STREAMING_INDEX', 'A table window cannot be skipped or exceeded.');
  await client.query(`INSERT INTO usp_table_windows(job_id,source_id,source_revision,window_index,first_record,
    last_record,records,byte_start,byte_end,window_sha256,rows,attempt,fence)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [input.jobId, input.sourceId, input.sourceRevision,
    window.index, first, last, rows.length, window.byteStart, window.byteEnd, window.sha256, JSON.stringify(rows),
    attempt.number, attempt.fence]);
  await client.query(`UPDATE usp_streaming_vector_imports SET records=records+$2,accepted=accepted+$2,
    next_publish_index=next_publish_index+1,updated_at=now() WHERE job_id=$1`, [input.jobId, rows.length]);
  await appendCaseIngestionTx(client, input.caseId, { kind: 'streaming-vector.window', sourceId: input.sourceId,
    sourceRevision: input.sourceRevision, jobId: input.jobId, window: window.index, firstRecord: first,
    records: rows.length, sha256: window.sha256 }, input.subject);
}

export type StoredWindow = { index: number; firstRecord: number; sha256: string; rows: TableWindowRow[] };

/** One stored window of a raw job, read back and checked against its own counts. */
export async function readTableWindowTx(client: PoolClient, rawJobId: string, index: number)
  : Promise<StoredWindow | null> {
  const row = (await client.query('SELECT window_index,first_record,records,window_sha256,rows FROM ' +
    'usp_table_windows WHERE job_id=$1 AND window_index=$2 FOR SHARE', [rawJobId, index])).rows[0];
  if (!row) return null;
  const rows = z.array(TableWindowRowSchema).parse(row.rows);
  if (rows.length !== row.records || rows[0]?.record !== row.first_record
    || rows.some((item, offset) => item.record !== row.first_record + offset))
    throw new AppError(422, 'TABLE_WINDOW_INTEGRITY', `Window ${index} differs from its own record count.`);
  return { index: row.window_index, firstRecord: row.first_record, sha256: row.window_sha256, rows };
}

type MappedRow = { record: number; cells: TableMappedCell[] };
type WindowState = { window_index: number; first_record: number; last_record: number; records: number;
  status: 'mapped' | 'failed' | null; issue_code: string | null; issue: string | null };

/** The records of one window from `start`, sliced in SQL so a page never reads a whole window. */
async function sliceTx(client: PoolClient, rawJobId: string, mappingJobId: string | null, window: WindowState,
  start: number, take: number) {
  // A window without a mapped result gives NULL, never an array of nulls.
  const row = (await client.query(`SELECT (SELECT jsonb_agg(w.rows->g ORDER BY g)
    FROM generate_series($3::int,$4::int) g) AS rows,CASE WHEN m.rows IS NULL THEN NULL
    ELSE (SELECT jsonb_agg(m.rows->g ORDER BY g) FROM generate_series($3::int,$4::int) g) END AS mapped
    FROM usp_table_windows w LEFT JOIN usp_table_window_mappings m ON m.job_id=$5 AND m.window_index=w.window_index
    AND m.status='mapped' WHERE w.job_id=$1 AND w.window_index=$2`,
  [rawJobId, window.window_index, start, start + take - 1, mappingJobId])).rows[0];
  const rows = z.array(TableWindowRowSchema).length(take).parse(row?.rows);
  const mapped = row?.mapped as MappedRow[] | null;
  if (rows.some((item, offset) => item.record !== window.first_record + start + offset)
    || mapped && (mapped.length !== take || mapped.some((item, offset) => item?.record !== rows[offset]!.record)))
    throw new AppError(422, 'TABLE_WINDOW_INTEGRITY', `Window ${window.window_index} differs from its record count.`);
  return rows.map((item, offset) => ({ ...item, window: window.window_index,
    mapped: mapped?.[offset]?.cells ?? null }));
}

/** The newest raw streaming job of a source revision that has stored at least one window. */
export async function latestTableJobTx(client: PoolClient, caseId: string, sourceId: string, revision: number) {
  return (await client.query(`SELECT j.id FROM jobs j JOIN usp_streaming_vector_imports i ON i.job_id=j.id
    WHERE j.case_id=$1 AND j.source_id=$2 AND j.operation='streaming-vector' AND i.source_revision=$3
    AND EXISTS(SELECT 1 FROM usp_table_windows w WHERE w.job_id=j.id)
    ORDER BY j.created_at DESC,j.id DESC LIMIT 1`, [caseId, sourceId, revision])).rows[0];
}

/** Keyset page by record number. Mapped cells come from the newest mapping job that read the same raw job. */
export class TableRowsService {
  async page(caseValue: string, sourceValue: string, queryValue: unknown) {
    const caseId = uuid.parse(caseValue), sourceId = uuid.parse(sourceValue);
    const { after, limit } = TableRowsQuerySchema.parse(queryValue ?? {});
    const subject = localOperatorSubject();
    return transaction(async client => {
      const source = (await client.query('SELECT * FROM sources WHERE id=$1 AND case_id=$2 FOR SHARE',
        [sourceId, caseId])).rows[0] ?? notFound('Retained source not found in this workspace.');
      const profile = source.inspection?.manualProfile;
      if (profile?.version !== 'manual-tabular/1' || source.inspection?.actor !== subject)
        throw new AppError(403, 'SOURCE_OPERATOR', 'This table belongs to another local context or is not a table.');
      const raw = await latestTableJobTx(client, caseId, sourceId, source.revision);
      const mapping = raw ? (await client.query(`SELECT job_id FROM usp_chunk_mapping_imports WHERE raw_job_id=$1
        AND EXISTS(SELECT 1 FROM usp_table_window_mappings m WHERE m.job_id=usp_chunk_mapping_imports.job_id)
        ORDER BY created_at DESC,job_id DESC LIMIT 1`, [raw.id])).rows[0] : undefined;
      const windows: WindowState[] = raw ? (await client.query(`SELECT w.window_index,w.first_record,w.last_record,
        w.records,m.status,m.issue_code,m.issue FROM usp_table_windows w LEFT JOIN usp_table_window_mappings m
        ON m.job_id=$2 AND m.window_index=w.window_index WHERE w.job_id=$1 ORDER BY w.window_index`,
      [raw.id, mapping?.job_id ?? null])).rows : [];
      const rows: Awaited<ReturnType<typeof sliceTx>> = [];
      let cursor = after;
      for (const window of windows) {
        if (window.last_record <= cursor || rows.length === limit) continue;
        const start = Math.max(0, cursor + 1 - window.first_record);
        const take = Math.min(limit - rows.length, window.records - start);
        rows.push(...await sliceTx(client, raw.id, mapping?.job_id ?? null, window, start, take));
        cursor = rows.at(-1)!.record;
      }
      const end = windows.at(-1)?.last_record ?? -1;
      return TableRowsPageSchema.parse({ caseId, sourceId, sourceRevision: source.revision,
        sourceSha256: source.sha256, headers: profile.headers, records: profile.records, rawJobId: raw?.id ?? null,
        mappingJobId: mapping?.job_id ?? null, windows: { written: windows.length,
          mapped: windows.filter(window => window.status === 'mapped').length,
          failed: windows.filter(window => window.status === 'failed').map(window => ({
            window: window.window_index, firstRecord: window.first_record, lastRecord: window.last_record,
            issueCode: window.issue_code, message: window.issue })) },
        after, next: rows.length === limit && cursor < end ? cursor : null, rows });
    });
  }
}

/** A table source: a whole-file table receipt, or a large original that was read as a stream into a table. */
export function isTableSource(row: { profile: string; inspection?: { manualProfile?: { version?: string } } }) {
  return row.profile === 'tabular-manual-v1'
    || row.profile === 'large-original-v1' && row.inspection?.manualProfile?.version === 'manual-tabular/1';
}
