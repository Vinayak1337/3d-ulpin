import type { PoolClient } from 'pg';
import { z } from 'zod';
import { TabularSelectionSchema, type TabularSelection, type IntakeCard } from '@ulpin/contracts/usp';
import { AppError } from '../../../infrastructure/errors';
import { openObjectStream } from '../../../infrastructure/storage';
import { fingerprint } from '../../cases/domain';
import { appendCaseIngestionTx, appendIntakeItemTx } from './events';
import type { IntakeSourceRow } from './intake-context';
import { intakeDraftKey, queueIntakeDraftTx, type IntakeDraftInput } from './intake-draft';
import { citeIntakeReceipt, registerIntakeItemTx, saveIntakeCardTx, writeIntakeDraftTx } from './intake-ledger';
import { profileWorkbook } from './tabular-stream';

const sheetsSchema = z.array(z.strictObject({ name: z.string().min(1).max(128),
  headerRow: z.number().int().positive().nullable(), rows: z.number().int().nonnegative().nullable(),
  skip: z.string().nullable() })).max(16);
export type WorkbookSheet = z.infer<typeof sheetsSchema>[number];

export async function readWorkbookLayouts(source: IntakeSourceRow): Promise<WorkbookSheet[]> {
  const object = await openObjectStream(source.object_key, Number(source.bytes), 120000,
    source.inspection?.largeOriginal?.objectEtag);
  try {
    const read = await profileWorkbook(object.body, Number(source.bytes));
    if (read.bytes !== Number(source.bytes) || read.sha256 !== source.sha256)
      throw new AppError(422, 'SOURCE_INTEGRITY', 'The workbook differs from its original byte receipt.');
    const sheets = sheetsSchema.parse(read.sheets);
    if (new Set(sheets.map(sheet => sheet.name)).size !== sheets.length)
      throw new AppError(422, 'WORKBOOK_SHEETS', 'The workbook repeats a sheet name.');
    return sheets;
  } finally {
    object.body.destroy();
  }
}

export function workbookSheetWords(sheet: WorkbookSheet): string {
  if (sheet.skip) return `Sheet ${sheet.name}: skipped (${sheet.skip}); kept in the unchanged original.`;
  if (!sheet.headerRow) return `Which header row should be read in sheet ${sheet.name}? `
    + 'Choose it with "Read as a table".';
  return `Sheet ${sheet.name}: candidate header row ${sheet.headerRow}; ${sheet.rows} rows read. `
    + 'Change it with "Read as a table". Nothing is recorded until you confirm it.';
}

/** Each sheet owns a reading/recipe, not another byte copy. Its original receipt and locator remain explicit. */
async function sheetSourceTx(client: PoolClient, input: IntakeDraftInput, source: IntakeSourceRow,
  card: IntakeCard, sheet: WorkbookSheet) {
  const sourceId = intakeDraftKey(input.itemId, source.revision, `workbook-sheet:${sheet.name}`);
  const selection = sheet.headerRow ? TabularSelectionSchema.parse({ format: card.format, sheet: sheet.name,
    table: null, headerRows: [sheet.headerRow] }) : null;
  const { manualProfile: _profile, ...inspection } = source.inspection ?? {};
  const lineage = { parentSourceId: source.id, parentSourceRevision: source.revision,
    parentSha256: source.sha256, sheet: sheet.name, selection };
  await client.query(`INSERT INTO sources(id,case_id,family_id,revision,name,profile,mime_type,bytes,sha256,
    object_key,status,inspection) SELECT $1,case_id,$1,1,$2,profile,mime_type,bytes,sha256,object_key,
    'needs_input',$3 FROM sources WHERE id=$4 AND case_id=$5 ON CONFLICT(id) DO NOTHING`,
  [sourceId, `${source.name} · ${sheet.name}`, { ...inspection, workbookSheet: lineage }, source.id, source.case_id]);
  const child: IntakeSourceRow = (await client.query('SELECT * FROM sources WHERE case_id=$1 AND id=$2',
    [source.case_id, sourceId])).rows[0];
  const item = await registerIntakeItemTx(client, child);
  const childCard = citeIntakeReceipt({ ...card, sheets: [{ name: sheet.name, count: sheet.rows }], members: [],
    counts: { ...card.counts, rows: sheet.rows, members: null }, limits: [workbookSheetWords(sheet)] }, child);
  if (item.state === 'received') await saveIntakeCardTx(client, item.item_id, childCard);
  await client.query(`UPDATE usp_intake_items SET source_id=$3,card=$4,card_sha256=$5,limit_reason=$6,
    updated_at=now() WHERE parent_item_id=$1 AND member_path=$2 AND source_id IS NULL`,
  [input.itemId, sheet.name, sourceId, childCard, fingerprint(childCard), workbookSheetWords(sheet)]);
  await appendCaseIngestionTx(client, source.case_id,
    { kind: 'source.retained', sourceId, sourceRevision: 1, status: 'needs_input' });
  await queueIntakeDraftTx(client, child, childCard);
  if (!selection && item.state === 'received') {
    await writeIntakeDraftTx(client, source.case_id, item.item_id, { state: 'read', placement: 'needs_answer',
      planRef: null, recordsSeen: 0, limitReason: workbookSheetWords(sheet) });
  }
  // Candidate wording stays on the item while its existing table job proposes meanings for review.
  await client.query(`UPDATE usp_intake_items SET limit_reason=$2 WHERE item_id=$1
    AND state='reading' AND plan_ref IS NULL`, [item.item_id, workbookSheetWords(sheet)]);
  await appendIntakeItemTx(client, source.case_id, item.item_id);
}

/** A manual header answer replaces the candidate wording, never the original bytes or a reviewed recipe. */
export async function refreshWorkbookSelectionTx(client: PoolClient, source: IntakeSourceRow,
  selection: TabularSelection, records: number) {
  const lineage = source.inspection?.workbookSheet;
  if (!lineage) return;
  await client.query(`UPDATE sources SET inspection=jsonb_set(inspection,'{workbookSheet,selection}',$2::jsonb)
    WHERE id=$1`, [source.id, JSON.stringify(selection)]);
  await client.query(`UPDATE usp_intake_items SET plan_ref=jsonb_set(plan_ref,'{workbookSheets}',
    (SELECT jsonb_agg(CASE WHEN entry->>'name'=$2 THEN entry || jsonb_build_object('headerRow',$3::int,
      'rows',$4::int) ELSE entry END) FROM jsonb_array_elements(plan_ref->'workbookSheets') entry)),
    limit_reason='Each sheet has its own table reading. Nothing is recorded until you confirm it.',updated_at=now()
    WHERE source_id=$1 AND parent_item_id IS NULL AND plan_ref ? 'workbookSheets'`,
  [lineage.parentSourceId, lineage.sheet, selection.headerRows[0], records]);
  const item = (await client.query('SELECT * FROM usp_intake_items WHERE source_id=$1 AND parent_item_id IS NULL',
    [source.id])).rows[0];
  if (!item?.card || item.plan_ref) return;
  const words = `Sheet ${selection.sheet}: header rows ${selection.headerRows.join(', ')}; ${records} rows read. `
    + 'Nothing is recorded until you confirm it.';
  const card = { ...item.card, sheets: [{ name: selection.sheet, count: records }],
    counts: { ...item.card.counts, rows: records }, limits: [words] };
  await client.query(`UPDATE usp_intake_items SET card=$2,card_sha256=$3,limit_reason=$4,updated_at=now()
    WHERE item_id=$1`, [item.item_id, card, fingerprint(card), words]);
  if (!lineage.selection) {
    await writeIntakeDraftTx(client, source.case_id, item.item_id, { state: 'probed', placement: 'undecided',
      planRef: null, recordsSeen: 0, limitReason: words });
    await queueIntakeDraftTx(client, { ...source, inspection: { ...source.inspection,
      workbookSheet: { ...lineage, selection } } }, card);
  }
  await appendIntakeItemTx(client, source.case_id, item.item_id);
}

/** Publication is fenced by the parent draft attempt; replay reuses sheet identities and never overwrites review. */
export async function publishWorkbookTablesTx(client: PoolClient, input: IntakeDraftInput,
  source: IntakeSourceRow, card: IntakeCard, sheets: WorkbookSheet[]) {
  const fullCard = { ...card, sheets: sheets.map(sheet => ({ name: sheet.name, count: sheet.rows })),
    limits: sheets.map(workbookSheetWords) };
  await saveIntakeCardTx(client, input.itemId, fullCard);
  const { childrenTx } = await import('./intake-service');
  await childrenTx(client, source.case_id, input.itemId, fullCard);
  for (const sheet of sheets) {
    if (!sheet.skip) await sheetSourceTx(client, input, source, card, sheet);
    else {
      const changed = await client.query(`UPDATE usp_intake_items SET state='read',placement='attached',
        limit_reason=$3,updated_at=now() WHERE parent_item_id=$1 AND member_path=$2 AND source_id IS NULL
        RETURNING item_id`, [input.itemId, sheet.name, workbookSheetWords(sheet)]);
      for (const row of changed.rows) await appendIntakeItemTx(client, source.case_id, row.item_id);
    }
  }
  await writeIntakeDraftTx(client, source.case_id, input.itemId, { state: 'read', placement: 'undecided',
    planRef: { workbookSheets: sheets }, recordsSeen: sheets.filter(sheet => !sheet.skip)
      .reduce((sum, sheet) => sum + (sheet.rows ?? 0), 0),
    limitReason: sheets.map(workbookSheetWords).join(' ').slice(0, 2000) });
}
