import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createReadStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { z } from 'zod';
import { INTAKE_PROBE_LIMITS, LARGE_ORIGINAL_LIMITS, TABULAR_STREAM_LIMITS } from '@ulpin/contracts/usp';
import { settings } from '../../../infrastructure/config';
import { AppError } from '../../../infrastructure/errors';
import { openObjectStream } from '../../../infrastructure/storage';
import type { IntakeSourceRow } from './intake-context';
import { assertIntakeDraftTx, intakeDraftKey, type IntakeDraftInput } from './intake-draft';
import { receiveSheetDerivative, type NativeDerivativeDependencies } from './intake-native-derivative';
import { workbookSheetsSchema, type WorkbookSheet } from './intake-workbook-table';
import { profileWorkbook } from './tabular-stream';

export type WorkbookDerivativeDependencies = Pick<NativeDerivativeDependencies,
  'transaction' | 'large' | 'register' | 'waitForSlot'> & { open: typeof openObjectStream };
const receiptSchema = z.union([z.strictObject({ skip: z.string().min(1).max(100) }), z.strictObject({
  bytes: z.number().int().positive().max(LARGE_ORIGINAL_LIMITS.maxOriginalBytes),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), rows: z.number().int().nonnegative().max(TABULAR_STREAM_LIMITS.rows),
})]);

/** A single sheet is exported to disk, never held whole. The subprocess has the existing row/record/ZIP bounds. */
export async function exportSheetCsv(path: string, output: string, sheet: WorkbookSheet, timeout = 120000) {
  const result = await promisify(execFile)(process.env.ULPIN_PROFILE_PYTHON ?? 'python', [
    join(settings.repositoryRoot, 'scripts/agent/export_workbook_sheet.py'),
    join(settings.repositoryRoot, 'services/geo'), path, output, '--sheet', sheet.name,
    '--header', String(sheet.headerRow), '--rows', String(TABULAR_STREAM_LIMITS.rows),
    '--record-bytes', String(TABULAR_STREAM_LIMITS.recordBytes),
    '--member-bytes', String(INTAKE_PROBE_LIMITS.expandedBytes),
    '--ratio', String(INTAKE_PROBE_LIMITS.compressionRatio), '--bytes', String(LARGE_ORIGINAL_LIMITS.maxOriginalBytes),
  ], { timeout, maxBuffer: 4096, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  return receiptSchema.parse(JSON.parse(result.stdout));
}

function statedHeader(source: IntakeSourceRow, name: string): number | null {
  const headers = source.inspection?.workbookHeaders;
  if (!headers || !Object.hasOwn(headers, name)) return null;
  return z.number().int().min(1).max(2000).parse(headers[name]);
}

/** Stable upload requests also recover a crash after retention but before lineage or enrolment was published. */
async function keepSheet(input: IntakeDraftInput, source: IntakeSourceRow, sheet: WorkbookSheet,
  ordinal: number, path: string, dependencies: WorkbookDerivativeDependencies, waiting: () => Promise<void>,
  wait: { deadline: number | null }) {
  if (sheet.headerRow! > 2000) return { ...sheet, skip: 'TABULAR_HEADER_ROW_LIMIT' };
  const output = join(dirname(path), 'sheet.csv');
  try {
    const receipt = await exportSheetCsv(path, output, sheet);
    if ('skip' in receipt) return { ...sheet, skip: receipt.skip };
    const lineage = { version: 'workbook-sheet-csv/1', parentSourceId: source.id,
      parentSourceRevision: source.revision, parentSha256: source.sha256, parentItemId: input.itemId,
      workbook: source.name, sheet: sheet.name, sheetIndex: ordinal, headerRow: sheet.headerRow,
      headerState: statedHeader(source, sheet.name) === null ? 'candidate' : 'officer_stated',
      csvSha256: receipt.sha256, csvBytes: receipt.bytes };
    const key = intakeDraftKey(input.itemId, source.revision, `sheet-csv:${ordinal}:${sheet.headerRow}`);
    const name = `${source.name.slice(0, 65)} · ${sheet.name.slice(0, 70)}.csv`.replace(/[\/\\\x00-\x1f]/g, '_');
    const sourceId = await receiveSheetDerivative(input.caseId, { sourceId: source.id,
      acquiredAt: source.inspection!.largeOriginal.provenance.acquiredAt }, { name, ...receipt },
    () => createReadStream(output), key, dependencies, waiting, wait);
    await dependencies.transaction(async client => {
      await assertIntakeDraftTx(client, input);
      await client.query("UPDATE sources SET inspection=inspection||jsonb_build_object('workbookSheet',$2::jsonb) "
        + 'WHERE id=$1 AND case_id=$3', [sourceId, lineage, input.caseId]);
    });
    return { ...sheet, rows: receipt.rows, sourceId };
  } finally {
    await rm(output, { force: true });
  }
}

/** The existing fenced workbook job retains every CSV before enrolling any, just like native GIS layers. */
export async function deriveWorkbookSheets(input: IntakeDraftInput, source: IntakeSourceRow,
  dependencies: WorkbookDerivativeDependencies, waiting: () => Promise<void>): Promise<WorkbookSheet[]> {
  const object = await dependencies.open(source.object_key, Number(source.bytes), 120000,
    source.inspection?.largeOriginal?.objectEtag);
  let sheets: WorkbookSheet[] = [];
  const wait = { deadline: null as number | null };
  try {
    await profileWorkbook(object.body, Number(source.bytes), async (read, path) => {
      if (read.bytes !== Number(source.bytes) || read.sha256 !== source.sha256)
        throw new AppError(422, 'SOURCE_INTEGRITY', 'The workbook differs from its original byte receipt.');
      sheets = workbookSheetsSchema.parse(read.sheets);
      if (new Set(sheets.map(sheet => sheet.name)).size !== sheets.length)
        throw new AppError(422, 'WORKBOOK_SHEETS', 'The workbook repeats a sheet name.');
      for (let index = 0; index < sheets.length; index++) {
        const sheet = sheets[index]!;
        sheet.headerRow = statedHeader(source, sheet.name) ?? sheet.headerRow;
        if (sheet.skip || !sheet.headerRow) continue;
        await dependencies.transaction(client => assertIntakeDraftTx(client, input));
        try {
          sheets[index] = await keepSheet(input, source, sheet, index, path, dependencies, waiting, wait);
        } catch (error) {
          if (error instanceof AppError && error.code === 'STALE_REVISION') throw error;
          const timedOut = (error as { killed?: boolean })?.killed;
          let code = timedOut ? 'WORKBOOK_SHEET_SECONDS_LIMIT' : 'WORKBOOK_SHEET_UNAVAILABLE';
          if (error instanceof AppError) code = error.code;
          sheets[index] = { ...sheet, skip: code, retry: true };
        }
      }
    });
  } finally {
    object.body.destroy();
  }
  for (const sheet of sheets) {
    if (!sheet.sourceId) continue;
    await dependencies.transaction(client => assertIntakeDraftTx(client, input));
    await dependencies.register(input.caseId, { sourceId: sheet.sourceId,
      requestKey: intakeDraftKey(sheet.sourceId, 0, 'sheet-enrol') });
  }
  return sheets;
}
