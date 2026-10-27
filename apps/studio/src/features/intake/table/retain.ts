import { api, unwrap } from '@ulpin/api-client';
import type { Selection, TableJob, TableProfile } from './types';

export type TableFormat = Selection['format'];

/** The import dialog knows a dropped file only by its name; a batch item states its format on its card. */
function tableFormat(file: File): TableFormat {
  if (/\.csv$/i.test(file.name)) return 'csv';
  return /\.ods$/i.test(file.name) ? 'ods' : 'xlsx';
}

export function tableSelection(file: File, sheet: string, rows: string): Selection {
  return formatSelection(tableFormat(file), sheet, rows);
}

export function formatSelection(format: TableFormat, sheet: string, rows: string): Selection {
  if (format === 'csv') return { format: 'csv', sheet: 'csv', table: null, headerRows: [1] };
  const parts = rows.split(',').map((part) => part.trim());
  const headerRows = parts.map(Number);
  if (!sheet.trim() || parts.some((part) => !/^\d+$/.test(part)) || headerRows.length > 5 ||
      headerRows.some((row, index) => row < 1 || !Number.isSafeInteger(row) ||
        index > 0 && row <= headerRows[index - 1]!)) {
    throw new Error('Enter the exact sheet name and 1–5 increasing header row numbers, separated by commas.');
  }
  return { format, sheet, table: null, headerRows };
}

export function officerEncodingSelection(selection: Selection, encoding: string): Selection {
  const supported = ['utf-8', 'windows-1252', 'iso-8859-1', 'utf-16le', 'utf-16be'] as const;
  const stated = supported.find((value) => value === encoding);
  if (selection.format !== 'csv' || !stated) {
    throw new Error('Unsupported table encoding. Choose UTF-8, Windows-1252, ISO-8859-1, ' +
      'or UTF-16 LE/BE with a matching BOM.');
  }
  return { ...selection, encoding: stated, encodingBasis: 'officer_stated' };
}

export interface TableFromOriginalBody { requestKey: string; expectedWorkspaceRevision: number; selection: Selection }

/** A kept original up to 16 MiB answers its table profile; a larger CSV or workbook answers its read job. Sending
 * the same body again answers the same job as it stands. */
export async function tableFromOriginal(caseId: string, sourceId: string, body: TableFromOriginalBody)
  : Promise<TableProfile | TableJob> {
  const result = unwrap(await api.POST('/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/table', {
    params: { path: { caseId, sourceId } }, body: body as never,
  }));
  if (result.version === 'table-profile/1') return result as TableJob;
  if (result.version !== 'manual-tabular/1') throw new Error('The server did not return a table profile.');
  return result as TableProfile;
}

export async function createSourceCase(name: string) {
  return unwrap(await api.POST('/api/v1/cases', { body: { name: name.trim() } }));
}

/** N01: the table import keeps a new original in a case it is chosen for, so that case must not be a site's yet. */
export async function readSourceCase(caseId: string) {
  const detail = unwrap(await api.GET('/api/v1/cases/{caseId}', { params: { path: { caseId } } }));
  if (detail.case.siteId || detail.case.archived) {
    throw new Error('Choose an active source case that is not attached to a site.');
  }
  return detail.case;
}

/**
 * TJ1: a table the batch already keeps is read in the batch case, even once its buildings have bound it to a site.
 * Nothing is attached: the read adds a table receipt to that kept original and makes mapped draft rows only.
 */
export async function readBatchCase(caseId: string) {
  const detail = unwrap(await api.GET('/api/v1/cases/{caseId}', { params: { path: { caseId } } }));
  if (detail.case.archived) throw new Error('This batch case is archived; its table cannot be read here.');
  return detail.case;
}
