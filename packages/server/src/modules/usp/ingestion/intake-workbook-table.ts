import type { PoolClient } from 'pg';
import { z } from 'zod';
import { LARGE_ORIGINAL_LIMITS, TABULAR_STREAM_LIMITS, type TabularSelection, type IntakeCard }
  from '@ulpin/contracts/usp';
import { appendIntakeItemTx } from './events';
import type { IntakeSourceRow } from './intake-context';
import { queueBatchWorkbookTx, type IntakeDraftInput } from './intake-draft';
import { saveIntakeCardTx, writeIntakeDraftTx } from './intake-ledger';

export const workbookSheetsSchema = z.array(z.strictObject({ name: z.string().min(1).max(128),
  headerRow: z.number().int().positive().nullable(), rows: z.number().int().nonnegative().nullable(),
  skip: z.string().nullable(), sourceId: z.string().uuid().optional(), retry: z.boolean().optional(),
  headerBasis: z.literal('absent').optional(), titleRows: z.number().int().min(0).max(3).optional(),
  firstDataRow: z.number().int().positive().optional(),
  occupiedColumns: z.array(z.number().int().min(1).max(256)).min(1).max(256).optional(),
  markedCellsLeftEmpty: z.number().int().positive().optional(),
}).superRefine((sheet, context) => {
  if (sheet.headerBasis === 'absent' && (sheet.headerRow !== null || sheet.titleRows === undefined
    || sheet.firstDataRow === undefined || sheet.firstDataRow <= sheet.titleRows || !sheet.occupiedColumns
    || sheet.occupiedColumns.some((column, index, columns) => index > 0 && column <= columns[index - 1]!)))
    context.addIssue({ code: 'custom', message: 'A headerless sheet needs its title, data row and column positions.' });
})).max(16);
export type WorkbookSheet = z.infer<typeof workbookSheetsSchema>[number];

export function workbookReadingCard(card: IntakeCard, source: IntakeSourceRow): IntakeCard {
  const stored = workbookSheetsSchema.safeParse(source.inspection?.workbookSheets);
  if (stored.success && ['xlsx', 'ods'].includes(card.format)) return { ...card,
    sheets: stored.data.map(sheet => ({ name: sheet.name, count: sheet.rows })),
    limits: stored.data.map(workbookSheetWords) };
  const sheet = source.inspection?.workbookSheet;
  if (!sheet || card.format !== 'csv') return card;
  const header = sheet.headerState === 'officer_stated' ? 'officer-stated' : 'candidate';
  const description = sheet.headerBasis === 'absent'
    ? `states no column names; columns named by position; ${sheet.titleRows} title rows skipped`
    : `${header} header row ${sheet.headerRow}`;
  const words = `Workbook: ${sheet.workbook}; sheet ${sheet.sheet}; ${description}${markedWords(sheet)}. `
    + 'Change the header with "Read as a table" on that workbook. Nothing is recorded until you confirm it.';
  return { ...card, limits: [...card.limits, words] };
}

// The exporter writes a formula, error or no-value cell as an empty cell; it never writes a value the file lacks.
function markedWords(sheet: { markedCellsLeftEmpty?: number }): string {
  return sheet.markedCellsLeftEmpty ? `; ${sheet.markedCellsLeftEmpty} formula or error cells left empty` : '';
}

const sheetLimits: Record<string, string> = {
  TABULAR_STREAM_ROWS: `more than ${TABULAR_STREAM_LIMITS.rows.toLocaleString('en-US')} rows`,
  TABULAR_RECORD_BUDGET: `a record exceeds ${TABULAR_STREAM_LIMITS.recordBytes} bytes`,
  TABULAR_HEADER_ROW_LIMIT: 'the candidate header is beyond the 2,000-row header selection limit',
  SHEET_CSV_RECEIPT_BYTE_LIMIT: `CSV exceeds the ${LARGE_ORIGINAL_LIMITS.maxOriginalBytes}-byte receipt limit`,
  WORKBOOK_MARKED_CELLS_NOT_CSV: 'CSV cannot preserve a cell marked as formula, error, unknown or no stored value',
  WORKBOOK_SHEET_SECONDS_LIMIT: 'the sheet reader reached its 120-second limit',
  UPLOAD_SLOT_WAIT_ENDED: 'no upload slot became free within 30 minutes',
  WORKBOOK_SHEET_UNAVAILABLE: 'the sheet reader or byte receipt did not finish',
  WORKBOOK_SHEET_RECEIPT: 'the byte receipt refused the sheet CSV',
  WORKBOOK_SHEET_EXPORT: 'the sheet reader stopped before writing its CSV',
};

export function workbookSheetWords(sheet: WorkbookSheet): string {
  if (sheet.skip) return `Sheet ${sheet.name}: skipped (${sheetLimits[sheet.skip] ?? sheet.skip}); `
    + 'kept in the unchanged original.' + (sheet.retry ? ' Enrol this workbook again to retry.' : '');
  if (!sheet.headerRow && sheet.headerBasis !== 'absent')
    return `Which header row should be read in sheet ${sheet.name}? `
      + 'Choose it with "Read as a table" on this workbook.';
  const state = sheet.sourceId ? 'read as its own CSV table' : 'waiting for its CSV table';
  const header = sheet.headerBasis === 'absent'
    ? `states no column names; columns named by position; ${sheet.titleRows} title rows skipped`
    : `candidate header row ${sheet.headerRow}`;
  return `Sheet ${sheet.name}: ${state}; ${header}; ${sheet.rows} rows${markedWords(sheet)}. `
    + 'Change it with "Read as a table" on this workbook. Nothing is recorded until you confirm it.';
}

/** An officer's answer queues the same bounded job with a new header pin; earlier derivatives stay immutable. */
export async function refreshWorkbookSelectionTx(client: PoolClient, source: IntakeSourceRow,
  selection: TabularSelection, _records: number) {
  if (!['xlsx', 'ods'].includes(selection.format) || selection.headerRows.length !== 1) return;
  const item = (await client.query('SELECT * FROM usp_intake_items WHERE source_id=$1 AND parent_item_id IS NULL',
    [source.id])).rows[0];
  if (!item?.plan_ref?.workbookSheets) return;
  const headers = { ...source.inspection?.workbookHeaders, [selection.sheet]: selection.headerRows[0] };
  await client.query("UPDATE sources SET inspection=jsonb_set(inspection,'{workbookHeaders}',$2::jsonb) WHERE id=$1",
    [source.id, JSON.stringify(headers)]);
  const updated = { ...source, inspection: { ...source.inspection, workbookHeaders: headers } };
  await queueBatchWorkbookTx(client, updated, true);
}

/** The workbook lists every sheet; each successful sheet links to a separately retained and enrolled CSV. */
export async function publishWorkbookTablesTx(client: PoolClient, input: IntakeDraftInput,
  source: IntakeSourceRow, card: IntakeCard, sheets: WorkbookSheet[]) {
  const fullCard = { ...card, sheets: sheets.map(sheet => ({ name: sheet.name, count: sheet.rows })),
    limits: sheets.map(workbookSheetWords) };
  await client.query('UPDATE sources SET inspection=inspection||$2::jsonb WHERE id=$1',
    [source.id, JSON.stringify({ workbookTables: true, workbookSheets: sheets })]);
  await saveIntakeCardTx(client, input.itemId, fullCard);
  const { childrenTx } = await import('./intake-service');
  await childrenTx(client, source.case_id, input.itemId, fullCard);
  for (const sheet of sheets) {
    const changed = await client.query(`UPDATE usp_intake_items SET source_id=$3,state='read',
      placement=$4,limit_reason=$5,updated_at=now() WHERE parent_item_id=$1 AND member_path=$2 RETURNING item_id`,
    [input.itemId, sheet.name, sheet.sourceId ?? null,
      (sheet.headerRow || sheet.headerBasis === 'absent') && !sheet.skip ? 'attached' : 'undecided',
      workbookSheetWords(sheet)]);
    for (const row of changed.rows) await appendIntakeItemTx(client, source.case_id, row.item_id);
  }
  await writeIntakeDraftTx(client, source.case_id, input.itemId, { state: 'read',
    placement: sheets.some(sheet => !sheet.skip && !sheet.headerRow && sheet.headerBasis !== 'absent')
      ? 'needs_answer' : 'undecided',
    planRef: { workbookSheets: sheets, workbookRetry: sheets.some(sheet => sheet.retry) },
    recordsSeen: sheets.filter(sheet => !sheet.skip)
      .reduce((sum, sheet) => sum + (sheet.rows ?? 0), 0),
    limitReason: sheets.map(workbookSheetWords).join(' ').slice(0, 2000) });
}
